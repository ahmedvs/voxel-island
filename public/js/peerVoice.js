import Peer from 'peerjs';

/**
 * Serverless Spatial 3D Voice Chat via PeerJS.
 * Connects peers in the same Firebase Realtime Database room for WebRTC P2P audio streaming.
 */
export class PeerVoiceManager {
  constructor({ spatialAudio, roomId, onPeerVoiceState } = {}) {
    this.spatialAudio = spatialAudio;
    this.roomId = roomId || 'island_main_room';
    this.onPeerVoiceState = onPeerVoiceState || (() => {});

    this.peer = null;
    this.peerId = null;
    this.activeCalls = new Map(); // peerId -> MediaConnection
    this.localStream = null;
    this.initialized = false;
  }

  async init(builderName) {
    if (this.initialized) return this.peerId;
    const sanitizedName = (builderName || 'explorer').replace(/[^a-zA-Z0-9_-]/g, '_');
    const uniqueId = `voxel_${sanitizedName}_${Math.random().toString(36).slice(2, 8)}`;

    try {
      this.peer = new Peer(uniqueId, {
        debug: 0,
      });

      await new Promise((resolve, reject) => {
        this.peer.on('open', (id) => {
          this.peerId = id;
          this.initialized = true;
          resolve(id);
        });
        this.peer.on('error', (err) => {
          reject(err);
        });
      });

      this.peer.on('call', (call) => {
        if (this.localStream) {
          call.answer(this.localStream);
        } else {
          call.answer();
        }
        this._bindCallEvents(call);
      });

      return this.peerId;
    } catch (err) {
      console.warn('PeerJS initialization warning (voice chat will use fallback):', err);
      return null;
    }
  }

  setLocalStream(stream) {
    this.localStream = stream || null;
    if (!this.localStream) {
      for (const call of this.activeCalls.values()) {
        try {
          call.close();
        } catch {
          // Ignore
        }
      }
      this.activeCalls.clear();
      return;
    }

    // Call existing connected peers
    for (const remotePeerId of this.activeCalls.keys()) {
      this.callPeer(remotePeerId);
    }
  }

  callPeer(remotePeerId) {
    if (!this.peer || !this.localStream || remotePeerId === this.peerId) return;
    if (this.activeCalls.has(remotePeerId)) return;

    try {
      const call = this.peer.call(remotePeerId, this.localStream);
      if (call) {
        this._bindCallEvents(call);
      }
    } catch (err) {
      console.warn(`Failed to call peer ${remotePeerId}:`, err);
    }
  }

  _bindCallEvents(call) {
    const remotePeerId = call.peer;
    this.activeCalls.set(remotePeerId, call);

    call.on('stream', (remoteStream) => {
      this.spatialAudio?.attachRemotePeerStream(remotePeerId, remoteStream);
      this.onPeerVoiceState(remotePeerId, true);
    });

    call.on('close', () => {
      this.activeCalls.delete(remotePeerId);
      this.spatialAudio?.detachRemotePeer(remotePeerId);
      this.onPeerVoiceState(remotePeerId, false);
    });

    call.on('error', () => {
      this.activeCalls.delete(remotePeerId);
      this.spatialAudio?.detachRemotePeer(remotePeerId);
      this.onPeerVoiceState(remotePeerId, false);
    });
  }

  disconnectPeer(remotePeerId) {
    const call = this.activeCalls.get(remotePeerId);
    if (call) {
      try {
        call.close();
      } catch {
        // Ignore
      }
      this.activeCalls.delete(remotePeerId);
    }
    this.spatialAudio?.detachRemotePeer(remotePeerId);
  }

  dispose() {
    for (const call of this.activeCalls.values()) {
      try {
        call.close();
      } catch {
        // Ignore
      }
    }
    this.activeCalls.clear();
    try {
      this.peer?.destroy();
    } catch {
      // Ignore
    }
    this.peer = null;
    this.initialized = false;
  }
}
