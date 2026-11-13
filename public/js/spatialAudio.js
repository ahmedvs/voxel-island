import { computeSpatialAttenuation } from './voxelCore.js';

/**
 * Global 3D Spatial Voice Chat Engine built on Web Audio API PannerNode + AudioListener.
 * - Full crystal-clear volume within 15 voxels
 * - Smooth volume fade between 15 and 45 voxels
 * - Complete silence beyond 45 voxels
 * - Real-time mic speech RMS detector & local Mic Test option
 */
export class SpatialAudioEngine {
  constructor({ onSpeakingChange, onMicLevel, onError } = {}) {
    this.onSpeakingChange = onSpeakingChange || (() => {});
    this.onMicLevel = onMicLevel || (() => {});
    this.onError = onError || (() => {});

    this.ctx = null;
    this.micStream = null;
    this.micSource = null;
    this.analyser = null;
    this.analyserData = null;

    this.micEnabled = false;
    this.micTestActive = false;
    this.isSpeaking = false;
    this.testMonitorGain = null;
    this.testPanner = null;
    this._monitorTimer = 0;

    // peerId -> { stream, audioEl, source, panner, gain, lastDist }
    this.peers = new Map();
    this.listenerPos = { x: 0, y: 1.7, z: 12 };
  }

  async ensureContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) {
        throw new Error('المتصفح لا يدعم Web Audio API');
      }
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
    return this.ctx;
  }

  async enableMicrophone() {
    if (this.micEnabled && this.micStream) return this.micStream;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('واجهة الميكروفون غير مدعومة في هذا المتصفح');
    }

    await this.ensureContext();

    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
    } catch (err) {
      const name = err?.name || '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        throw new Error('يرجى السماح بالوصول إلى الميكروفون لتشغيل الدردشة الصوتية');
      }
      if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        throw new Error('لم يتم العثور على ميكروفون متصل بهذا الجهاز');
      }
      throw new Error('تعذر تشغيل الميكروفون حالياً');
    }

    this.micSource = this.ctx.createMediaStreamSource(this.micStream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyserData = new Uint8Array(this.analyser.fftSize);
    this.micSource.connect(this.analyser);

    this.micEnabled = true;
    this._startSpeechMonitor();
    return this.micStream;
  }

  disableMicrophone() {
    this.stopMicTest();
    this.micEnabled = false;
    window.clearInterval(this._monitorTimer);
    this._monitorTimer = 0;

    if (this.isSpeaking) {
      this.isSpeaking = false;
      this.onSpeakingChange(false);
    }
    this.onMicLevel(0);

    try {
      this.micSource?.disconnect();
    } catch {
      // Ignore
    }
    this.micSource = null;
    this.analyser = null;

    if (this.micStream) {
      for (const track of this.micStream.getTracks()) {
        track.stop();
      }
      this.micStream = null;
    }
  }

  async toggleMicrophone() {
    if (this.micEnabled) {
      this.disableMicrophone();
      return false;
    }
    await this.enableMicrophone();
    return true;
  }

  async startMicTest() {
    await this.ensureContext();
    if (!this.micEnabled) {
      await this.enableMicrophone();
    }
    if (!this.micSource || this.micTestActive) return;

    this.testPanner = this.ctx.createPanner();
    this.testPanner.panningModel = 'HRTF';
    this.testPanner.distanceModel = 'linear';
    this.testPanner.refDistance = 15;
    this.testPanner.maxDistance = 45;
    this.testPanner.rolloffFactor = 1;
    this._setPannerPosition(this.testPanner, this.listenerPos.x + 2, this.listenerPos.y, this.listenerPos.z);

    this.testMonitorGain = this.ctx.createGain();
    this.testMonitorGain.gain.value = 0.65;

    this.micSource.connect(this.testPanner);
    this.testPanner.connect(this.testMonitorGain);
    this.testMonitorGain.connect(this.ctx.destination);
    this.micTestActive = true;
  }

  stopMicTest() {
    this.micTestActive = false;
    try {
      if (this.micSource && this.testPanner) {
        this.micSource.disconnect(this.testPanner);
      }
      this.testPanner?.disconnect();
      this.testMonitorGain?.disconnect();
    } catch {
      // Ignore disconnect races
    }
    this.testPanner = null;
    this.testMonitorGain = null;
  }

  /**
   * Plays a gentle warm acoustic chime positioned 2 voxels away in 3D space so users
   * can verify spatial audio output even without external hardware mic feedback.
   */
  async playSpatialTestChime() {
    const ctx = await this.ensureContext();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'linear';
    panner.refDistance = 15;
    panner.maxDistance = 45;
    this._setPannerPosition(panner, this.listenerPos.x + 3, this.listenerPos.y, this.listenerPos.z - 2);

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(523.25, now);
    osc.frequency.exponentialRampToValueAtTime(659.25, now + 0.14);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.14, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

    osc.connect(gain);
    gain.connect(panner);
    panner.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.36);
  }

  _startSpeechMonitor() {
    window.clearInterval(this._monitorTimer);
    let silentFrames = 0;

    this._monitorTimer = window.setInterval(() => {
      if (!this.micEnabled || !this.analyser || !this.analyserData) return;
      this.analyser.getByteTimeDomainData(this.analyserData);

      let sumSq = 0;
      for (let i = 0; i < this.analyserData.length; i++) {
        const v = (this.analyserData[i] - 128) / 128;
        sumSq += v * v;
      }
      const rms = Math.sqrt(sumSq / this.analyserData.length);
      const normalizedLevel = Math.min(1, rms * 5.5);
      this.onMicLevel(normalizedLevel);

      const threshold = 0.025;
      if (rms > threshold) {
        silentFrames = 0;
        if (!this.isSpeaking) {
          this.isSpeaking = true;
          this.onSpeakingChange(true);
        }
      } else if (this.isSpeaking) {
        silentFrames++;
        if (silentFrames >= 6) {
          this.isSpeaking = false;
          this.onSpeakingChange(false);
        }
      }
    }, 65);
  }

  _setPannerPosition(panner, x, y, z) {
    if (!panner) return;
    if (panner.positionX && typeof panner.positionX.value === 'number') {
      const t = this.ctx ? this.ctx.currentTime : 0;
      panner.positionX.setValueAtTime(x, t);
      panner.positionY.setValueAtTime(y, t);
      panner.positionZ.setValueAtTime(z, t);
    } else if (typeof panner.setPosition === 'function') {
      panner.setPosition(x, y, z);
    }
  }

  /**
   * Updates Web Audio 3D Listener coordinates & orientation each frame.
   */
  updateListenerTransform(x, y, z, fx, fy, fz, ux = 0, uy = 1, uz = 0) {
    this.listenerPos.x = x;
    this.listenerPos.y = y;
    this.listenerPos.z = z;
    if (!this.ctx || this.ctx.state !== 'running') return;

    const listener = this.ctx.listener;
    if (listener.positionX && typeof listener.positionX.value === 'number') {
      const t = this.ctx.currentTime;
      listener.positionX.setValueAtTime(x, t);
      listener.positionY.setValueAtTime(y, t);
      listener.positionZ.setValueAtTime(z, t);
      listener.forwardX.setValueAtTime(fx, t);
      listener.forwardY.setValueAtTime(fy, t);
      listener.forwardZ.setValueAtTime(fz, t);
      listener.upX.setValueAtTime(ux, t);
      listener.upY.setValueAtTime(uy, t);
      listener.upZ.setValueAtTime(uz, t);
    } else if (typeof listener.setPosition === 'function') {
      listener.setPosition(x, y, z);
      listener.setOrientation(fx, fy, fz, ux, uy, uz);
    }
  }

  /**
   * Binds a remote participant's WebRTC MediaStream through a 3D HRTF PannerNode + distance GainNode.
   */
  async attachRemotePeerStream(peerId, stream) {
    this.detachRemotePeer(peerId);
    if (!stream) return;

    try {
      const ctx = await this.ensureContext();
      // Chromium requires an off-DOM muted HTMLAudioElement attached to remote WebRTC MediaStreams
      // in order for MediaStreamAudioSourceNode to pump audio frames cleanly.
      const audioEl = document.createElement('audio');
      audioEl.srcObject = stream;
      audioEl.muted = true;
      audioEl.playsInline = true;
      audioEl.play().catch(() => {});

      const source = ctx.createMediaStreamSource(stream);
      const panner = ctx.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'linear';
      panner.refDistance = 15;
      panner.maxDistance = 45;
      panner.rolloffFactor = 1;

      const gain = ctx.createGain();
      gain.gain.value = 1;

      source.connect(panner);
      panner.connect(gain);
      gain.connect(ctx.destination);

      this.peers.set(peerId, { stream, audioEl, source, panner, gain });
    } catch (err) {
      this.onError(err);
    }
  }

  updateRemotePeerPosition(peerId, px, py, pz) {
    const entry = this.peers.get(peerId);
    if (!entry || !this.ctx) return;

    this._setPannerPosition(entry.panner, px, py + 1.6, pz);
    const dist = Math.hypot(
      px - this.listenerPos.x,
      py + 1.6 - this.listenerPos.y,
      pz - this.listenerPos.z
    );
    const targetGain = computeSpatialAttenuation(dist, 15, 45);
    entry.gain.gain.setTargetAtTime(targetGain, this.ctx.currentTime, 0.04);
  }

  detachRemotePeer(peerId) {
    const entry = this.peers.get(peerId);
    if (!entry) return;
    try {
      entry.audioEl.srcObject = null;
      entry.source.disconnect();
      entry.panner.disconnect();
      entry.gain.disconnect();
    } catch {
      // Ignore
    }
    this.peers.delete(peerId);
  }

  dispose() {
    this.disableMicrophone();
    for (const id of Array.from(this.peers.keys())) {
      this.detachRemotePeer(id);
    }
    this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}
