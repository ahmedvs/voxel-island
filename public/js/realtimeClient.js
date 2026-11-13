/**
 * Real-Time Multiplayer WebSocket + WebRTC Mesh Signaling Client.
 * Syncs live island presence, seating, character appearance, and 3D spatial voice tracks
 * over the Express + ws server on port 3000.
 */
export class IslandRealtimeClient {
  constructor({
    spatialAudio,
    onPeersSnapshot,
    onPeerJoined,
    onPeerUpdated,
    onPeerLeft,
    onPeerSpeaking,
    onSelfId,
  } = {}) {
    this.spatialAudio = spatialAudio;
    this.onPeersSnapshot = onPeersSnapshot || (() => {});
    this.onPeerJoined = onPeerJoined || (() => {});
    this.onPeerUpdated = onPeerUpdated || (() => {});
    this.onPeerLeft = onPeerLeft || (() => {});
    this.onPeerSpeaking = onPeerSpeaking || (() => {});
    this.onSelfId = onSelfId || (() => {});

    this.ws = null;
    this.selfId = null;
    this.connected = false;
    this.disposed = false;
    this.reconnectTimer = 0;
    this.lastMoveSent = 0;

    this.localState = null;
    this.localStream = null;
    // peerId -> RTCPeerConnection
    this.rtcConnections = new Map();
    // peerId -> latest state
    this.remotePeers = new Map();
  }

  connect(initialState) {
    this.localState = initialState;
    if (this.disposed) return;

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${window.location.host}/ws`;

    try {
      this.ws = new WebSocket(url);
    } catch {
      this._scheduleReconnect();
      return;
    }

    this.ws.addEventListener('open', () => {
      this.connected = true;
      if (this.localState) {
        this._send({
          type: 'player:join',
          state: this.localState,
        });
      }
    });

    this.ws.addEventListener('message', (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      this._handleMessage(msg);
    });

    this.ws.addEventListener('close', () => {
      this.connected = false;
      this.selfId = null;
      this._closeAllRtc();
      if (!this.disposed) {
        this._scheduleReconnect();
      }
    });

    this.ws.addEventListener('error', () => {
      // Handled gracefully on close
    });
  }

  _scheduleReconnect() {
    window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = window.setTimeout(() => {
      if (!this.disposed && this.localState) {
        this.connect(this.localState);
      }
    }, 3000);
  }

  _send(payload) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  _handleMessage(msg) {
    if (!msg || typeof msg.type !== 'string') return;

    switch (msg.type) {
      case 'session:welcome': {
        this.selfId = msg.selfId || null;
        this.onSelfId(this.selfId);
        const list = Array.isArray(msg.peers) ? msg.peers : [];
        this.remotePeers.clear();
        for (const p of list) {
          if (p && p.id && p.id !== this.selfId) {
            this.remotePeers.set(p.id, p);
          }
        }
        this.onPeersSnapshot(Array.from(this.remotePeers.values()));
        if (this.localStream) {
          for (const peerId of this.remotePeers.keys()) {
            this._initiateOffer(peerId);
          }
        }
        break;
      }
      case 'player:joined': {
        const p = msg.peer;
        if (!p || !p.id || p.id === this.selfId) break;
        this.remotePeers.set(p.id, p);
        this.onPeerJoined(p);
        if (this.localStream && this.selfId && this.selfId < p.id) {
          this._initiateOffer(p.id);
        }
        break;
      }
      case 'player:updated': {
        const p = msg.peer;
        if (!p || !p.id || p.id === this.selfId) break;
        this.remotePeers.set(p.id, p);
        this.onPeerUpdated(p);
        break;
      }
      case 'player:speaking': {
        if (!msg.id || msg.id === this.selfId) break;
        const p = this.remotePeers.get(msg.id);
        if (p) {
          p.speaking = Boolean(msg.speaking);
          p.micActive = Boolean(msg.micActive);
        }
        this.onPeerSpeaking(msg.id, Boolean(msg.speaking), Boolean(msg.micActive));
        break;
      }
      case 'player:left': {
        if (!msg.id) break;
        this.remotePeers.delete(msg.id);
        this._closePeerRtc(msg.id);
        this.spatialAudio?.detachRemotePeer(msg.id);
        this.onPeerLeft(msg.id);
        break;
      }
      case 'rtc:offer': {
        if (msg.fromId && msg.sdp) {
          this._handleOffer(msg.fromId, msg.sdp);
        }
        break;
      }
      case 'rtc:answer': {
        if (msg.fromId && msg.sdp) {
          this._handleAnswer(msg.fromId, msg.sdp);
        }
        break;
      }
      case 'rtc:ice': {
        if (msg.fromId && msg.candidate) {
          this._handleIce(msg.fromId, msg.candidate);
        }
        break;
      }
      default:
        break;
    }
  }

  updateLocalProfileAndState(nextState) {
    this.localState = { ...(this.localState || {}), ...nextState };
    this._send({
      type: 'player:state',
      state: this.localState,
    });
  }

  sendMoveThrottled(state) {
    this.localState = { ...(this.localState || {}), ...state };
    const now = performance.now();
    if (now - this.lastMoveSent < 85) return;
    this.lastMoveSent = now;
    this._send({
      type: 'player:state',
      state: this.localState,
    });
  }

  sendSpeakingState(speaking, micActive) {
    if (this.localState) {
      this.localState.speaking = Boolean(speaking);
      this.localState.micActive = Boolean(micActive);
    }
    this._send({
      type: 'player:speaking',
      speaking: Boolean(speaking),
      micActive: Boolean(micActive),
    });
  }

  async setLocalAudioStream(stream) {
    this.localStream = stream || null;
    if (!this.localStream) {
      for (const pc of this.rtcConnections.values()) {
        for (const sender of pc.getSenders()) {
          if (sender.track) pc.removeTrack(sender);
        }
      }
      return;
    }

    const tracks = this.localStream.getAudioTracks();
    for (const peerId of this.remotePeers.keys()) {
      const pc = this._getOrCreatePeerConnection(peerId);
      for (const track of tracks) {
        const already = pc.getSenders().some((s) => s.track === track);
        if (!already) pc.addTrack(track, this.localStream);
      }
      await this._initiateOffer(peerId);
    }
  }

  _getOrCreatePeerConnection(peerId) {
    const existing = this.rtcConnections.get(peerId);
    if (existing) return existing;

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });

    if (this.localStream) {
      for (const track of this.localStream.getAudioTracks()) {
        pc.addTrack(track, this.localStream);
      }
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this._send({
          type: 'rtc:ice',
          targetId: peerId,
          candidate: e.candidate,
        });
      }
    };

    pc.ontrack = (e) => {
      const remoteStream = e.streams?.[0] || new MediaStream([e.track]);
      this.spatialAudio?.attachRemotePeerStream(peerId, remoteStream);
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this._closePeerRtc(peerId);
      }
    };

    this.rtcConnections.set(peerId, pc);
    return pc;
  }

  async _initiateOffer(peerId) {
    try {
      const pc = this._getOrCreatePeerConnection(peerId);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this._send({
        type: 'rtc:offer',
        targetId: peerId,
        sdp: pc.localDescription,
      });
    } catch {
      // Ignore transient signaling errors
    }
  }

  async _handleOffer(fromId, sdp) {
    try {
      const pc = this._getOrCreatePeerConnection(fromId);
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this._send({
        type: 'rtc:answer',
        targetId: fromId,
        sdp: pc.localDescription,
      });
    } catch {
      // Ignore signaling errors
    }
  }

  async _handleAnswer(fromId, sdp) {
    const pc = this.rtcConnections.get(fromId);
    if (!pc) return;
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    } catch {
      // Ignore
    }
  }

  async _handleIce(fromId, candidate) {
    const pc = this._getOrCreatePeerConnection(fromId);
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch {
      // Ignore
    }
  }

  _closePeerRtc(peerId) {
    const pc = this.rtcConnections.get(peerId);
    if (!pc) return;
    try {
      pc.close();
    } catch {
      // Ignore
    }
    this.rtcConnections.delete(peerId);
  }

  _closeAllRtc() {
    for (const id of Array.from(this.rtcConnections.keys())) {
      this._closePeerRtc(id);
    }
  }

  dispose() {
    this.disposed = true;
    window.clearTimeout(this.reconnectTimer);
    this._closeAllRtc();
    try {
      this.ws?.close();
    } catch {
      // Ignore
    }
    this.ws = null;
  }
}
