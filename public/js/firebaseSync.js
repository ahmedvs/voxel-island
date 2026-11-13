import { db, ref, set, onValue, remove, onDisconnect, push, update, off } from './firebaseClient.js';

export function getRoomIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const room = (params.get('room') || '').trim();
  return room ? room.replace(/[^a-zA-Z0-9_-]/g, '_') : 'island_main_room';
}

export class FirebaseIslandSync {
  constructor({ roomId, onPeersSnapshot, onBuildingsSnapshot } = {}) {
    this.roomId = roomId || getRoomIdFromUrl();
    this.onPeersSnapshot = onPeersSnapshot || (() => {});
    this.onBuildingsSnapshot = onBuildingsSnapshot || (() => {});

    this.playerId = `exp_${Math.random().toString(36).slice(2, 9)}`;
    this.peerVoiceId = null;
    this.playersRef = ref(db, `rooms/${this.roomId}/players`);
    this.buildingsRef = ref(db, `rooms/${this.roomId}/buildings`);

    this.playersUnsub = null;
    this.buildingsUnsub = null;
    this.lastMoveSent = 0;
  }

  async registerPlayer(initialState, peerVoiceId) {
    this.peerVoiceId = peerVoiceId || null;
    const playerRef = ref(db, `rooms/${this.roomId}/players/${this.playerId}`);
    const payload = {
      id: this.playerId,
      peerVoiceId: this.peerVoiceId,
      ...initialState,
      lastSeen: Date.now(),
    };

    try {
      await set(playerRef, payload);
      onDisconnect(playerRef).remove();
    } catch (err) {
      console.warn('Firebase registerPlayer warning:', err);
    }
  }

  updatePlayerState(nextState) {
    const playerRef = ref(db, `rooms/${this.roomId}/players/${this.playerId}`);
    const now = performance.now();
    if (now - this.lastMoveSent < 85) return;
    this.lastMoveSent = now;

    try {
      update(playerRef, {
        ...nextState,
        peerVoiceId: this.peerVoiceId,
        lastSeen: Date.now(),
      });
    } catch {
      // Ignore
    }
  }

  sendSpeakingState(speaking, micActive) {
    const playerRef = ref(db, `rooms/${this.roomId}/players/${this.playerId}`);
    try {
      update(playerRef, {
        speaking: Boolean(speaking),
        micActive: Boolean(micActive),
        lastSeen: Date.now(),
      });
    } catch {
      // Ignore
    }
  }

  listenPlayers(callback) {
    this.playersUnsub = onValue(this.playersRef, (snapshot) => {
      const val = snapshot.val() || {};
      const peers = [];
      for (const [id, data] of Object.entries(val)) {
        if (id !== this.playerId && data) {
          peers.push({ id, ...data });
        }
      }
      callback(peers);
    });
  }

  saveBuilding(building) {
    const bRef = ref(db, `rooms/${this.roomId}/buildings/${building.id}`);
    try {
      set(bRef, building);
    } catch (err) {
      console.warn('Firebase saveBuilding warning:', err);
    }
  }

  removeBuilding(buildingId) {
    const bRef = ref(db, `rooms/${this.roomId}/buildings/${buildingId}`);
    try {
      remove(bRef);
    } catch (err) {
      console.warn('Firebase removeBuilding warning:', err);
    }
  }

  updateBuildingLikes(buildingId, likes, likedByMe) {
    const bRef = ref(db, `rooms/${this.roomId}/buildings/${buildingId}`);
    try {
      update(bRef, { likes, likedByMe });
    } catch {
      // Ignore
    }
  }

  listenBuildings(callback) {
    this.buildingsUnsub = onValue(this.buildingsRef, (snapshot) => {
      const val = snapshot.val() || {};
      const list = Object.values(val).filter(Boolean);
      callback(list);
    });
  }

  async removePlayer() {
    const playerRef = ref(db, `rooms/${this.roomId}/players/${this.playerId}`);
    try {
      await remove(playerRef);
    } catch {
      // Ignore
    }
  }

  dispose() {
    if (this.playersUnsub) {
      off(this.playersRef);
    }
    if (this.buildingsUnsub) {
      off(this.buildingsRef);
    }
    this.removePlayer();
  }
}
