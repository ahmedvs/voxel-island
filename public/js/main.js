import {
  buildInviteUrl,
  calculateIslandStats,
  checkPlotAvailability,
  findFreeBuildPlot,
  parseInviteParams,
  validateExplorerLoginInput,
  validateImportedIslandPayload,
} from './voxelCore.js';
import { generateDemoBuilding } from './demoBlueprints.js';
import {
  fetchActiveModelConfig,
  generateVoxelStructureWithGemini,
} from './geminiClient.js';
import {
  CHARACTER_PRESETS,
  HAIR_HAT_COLOR_SWATCHES,
  OUTFIT_COLOR_SWATCHES,
  SKIN_COLOR_SWATCHES,
  getCharacterPresetById,
} from './characterCatalog.js';
import {
  exportIslandJson,
  loadCharacterConfig,
  loadIslandBuildings,
  loadSettings,
  loadUserProfile,
  logoutUserProfile,
  saveCharacterConfig,
  saveIslandBuildings,
  saveSettings,
  saveUserProfile,
} from './storage.js';
import { SpatialAudioEngine } from './spatialAudio.js';
import { IslandRealtimeClient } from './realtimeClient.js';
import { VoxelIslandScene } from './voxelScene.js';

const dom = {
  canvasContainer: document.getElementById('canvas-container'),
  modelBadgeId: document.getElementById('model-badge-id'),
  statBuildings: document.getElementById('stat-buildings'),
  statVoxels: document.getElementById('stat-voxels'),
  statVitality: document.getElementById('stat-vitality'),
  btnCenterIsland: document.getElementById('btn-center-island'),
  btnResetCamera: document.getElementById('btn-reset-camera'),
  btnExport: document.getElementById('btn-export'),
  btnImport: document.getElementById('btn-import'),
  inputImportFile: document.getElementById('input-import-file'),
  btnInvite: document.getElementById('btn-invite'),
  invitePopover: document.getElementById('invite-popover'),
  btnCloseInvite: document.getElementById('btn-close-invite'),
  inviteUrlInput: document.getElementById('invite-url-input'),
  btnCopyInvite: document.getElementById('btn-copy-invite'),
  inviteShareWhatsapp: document.getElementById('invite-share-whatsapp'),
  inviteShareX: document.getElementById('invite-share-x'),
  btnSettings: document.getElementById('btn-settings'),
  userProfilePill: document.getElementById('user-profile-pill'),
  userBadgeDot: document.getElementById('user-badge-dot'),
  userBadgeName: document.getElementById('user-badge-name'),
  btnLogout: document.getElementById('btn-logout'),
  loginOverlay: document.getElementById('login-overlay'),
  loginInviteBanner: document.getElementById('login-invite-banner'),
  loginForm: document.getElementById('login-form'),
  loginNameInput: document.getElementById('login-name-input'),
  loginCredentialInput: document.getElementById('login-credential-input'),
  loginCharacterSelector: document.getElementById('login-character-selector'),
  loginError: document.getElementById('login-error'),
  btnLoginSubmit: document.getElementById('btn-login-submit'),
  btnLoginGuest: document.getElementById('btn-login-guest'),
  walkHintPill: document.getElementById('walk-hint-pill'),
  sitPromptPill: document.getElementById('sit-prompt-pill'),
  inspectionCard: document.getElementById('inspection-card'),
  inspectPrompt: document.getElementById('inspect-prompt'),
  inspectVoxels: document.getElementById('inspect-voxels'),
  inspectDate: document.getElementById('inspect-date'),
  inspectCoords: document.getElementById('inspect-coords'),
  inspectSource: document.getElementById('inspect-source'),
  btnCloseInspect: document.getElementById('btn-close-inspect'),
  btnLikeBuilding: document.getElementById('btn-like-building'),
  inspectLikes: document.getElementById('inspect-likes'),
  btnFocusBuilding: document.getElementById('btn-focus-building'),
  btnDeleteBuilding: document.getElementById('btn-delete-building'),
  bottomPillDock: document.getElementById('bottom-pill-dock'),
  btnModePan: document.getElementById('btn-mode-pan'),
  btnModeOrbit: document.getElementById('btn-mode-orbit'),
  btnModeWalk: document.getElementById('btn-mode-walk'),
  btnCharacter: document.getElementById('btn-character'),
  characterPillSwatch: document.getElementById('character-pill-swatch'),
  btnMic: document.getElementById('btn-mic'),
  btnAudioPopover: document.getElementById('btn-audio-popover'),
  audioPopover: document.getElementById('audio-popover'),
  btnCloseAudio: document.getElementById('btn-close-audio'),
  micStatusLabel: document.getElementById('mic-status-label'),
  micLevelFill: document.getElementById('mic-level-fill'),
  btnMicTest: document.getElementById('btn-mic-test'),
  btnSpatialChime: document.getElementById('btn-spatial-chime'),
  btnAddStructure: document.getElementById('btn-add-structure'),
  characterPopover: document.getElementById('character-popover'),
  btnCloseCharacter: document.getElementById('btn-close-character'),
  characterPresetsGrid: document.getElementById('character-presets-grid'),
  skinSwatches: document.getElementById('skin-swatches'),
  outfitSwatches: document.getElementById('outfit-swatches'),
  hairHatSwatches: document.getElementById('hairhat-swatches'),
  promptDock: document.getElementById('prompt-dock'),
  selectedPlotCoords: document.getElementById('selected-plot-coords'),
  btnCancelPlot: document.getElementById('btn-cancel-plot'),
  buildForm: document.getElementById('build-form'),
  promptInput: document.getElementById('build-prompt-input'),
  btnStartBuild: document.getElementById('btn-start-build'),
  btnDemoBuild: document.getElementById('btn-demo-build'),
  settingsModal: document.getElementById('settings-modal'),
  settingsForm: document.getElementById('settings-form'),
  inputModelId: document.getElementById('input-model-id'),
  btnCloseSettings: document.getElementById('btn-close-settings'),
  btnCancelSettings: document.getElementById('btn-cancel-settings'),
  btnResetModel: document.getElementById('btn-reset-model'),
  toastRegion: document.getElementById('toast-region'),
};

let buildings = loadIslandBuildings();
let settings = loadSettings();
let characterConfig = loadCharacterConfig();
let userProfile = loadUserProfile();
let cameraMode = 'orbit'; // 'orbit' | 'pan' | 'walk'
let selectedPlot = null; // { gx, gz }
let inspectedBuildingId = null;
let activeConstructionPlots = []; // [{ id, gx, gz }]
let loginHideTimer = 0;

const inviteInfo = parseInviteParams(window.location.search);
let pendingInviteSpawn = inviteInfo.hasInvite;

const dateFormatter = new Intl.DateTimeFormat('ar-EG', {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function showToast(message, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type === 'success' ? 'toast-success' : type === 'error' ? 'toast-error' : ''}`;
  el.textContent = message;
  dom.toastRegion.appendChild(el);
  window.setTimeout(() => {
    el.remove();
  }, 4200);
}

function updateStatsUI() {
  const stats = calculateIslandStats(buildings);
  dom.statBuildings.textContent = String(stats.buildingCount);
  dom.statVoxels.textContent = stats.totalVoxels.toLocaleString('en-US');
  dom.statVitality.textContent = `${stats.vitalityPercent}%`;
}

function setActiveModelBadge(modelName) {
  if (dom.modelBadgeId && typeof modelName === 'string' && modelName.trim()) {
    dom.modelBadgeId.textContent = modelName.trim();
  }
}

async function syncActiveModelBadge() {
  setActiveModelBadge(settings.modelId || 'gemini-4-hydrogen');
  try {
    const config = await fetchActiveModelConfig(settings.modelId);
    if (config?.activeModel) {
      setActiveModelBadge(config.activeModel);
    }
  } catch {
    // Keep local setting fallback if offline
  }
}

function setCameraMode(mode, options = {}) {
  const nextMode = mode === 'pan' || mode === 'walk' ? mode : 'orbit';
  cameraMode = nextMode;
  document.body.setAttribute('data-camera-mode', nextMode);

  const modeButtons = [
    [dom.btnModePan, 'pan'],
    [dom.btnModeOrbit, 'orbit'],
    [dom.btnModeWalk, 'walk'],
  ];
  for (const [btn, btnMode] of modeButtons) {
    const isActive = btnMode === nextMode;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  }

  dom.walkHintPill.classList.toggle('hidden', nextMode !== 'walk');

  if (nextMode === 'walk') {
    closePlotSelector();
  } else {
    closeCharacterPopover();
    updateSitPromptPill(null);
  }

  sceneEngine.setCameraMode(nextMode, options);
  syncLocalRealtimeState();
}

function renderCharacterCustomizer() {
  if (dom.characterPillSwatch) {
    dom.characterPillSwatch.style.backgroundColor = characterConfig.outfitColor;
  }

  dom.characterPresetsGrid.innerHTML = '';
  for (const preset of CHARACTER_PRESETS) {
    const isActive = preset.id === characterConfig.presetId;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `preset-card-btn${isActive ? ' active' : ''}`;
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', isActive ? 'true' : 'false');
    btn.dataset.presetId = preset.id;

    const dot = document.createElement('span');
    dot.className = 'preset-avatar-dot';
    dot.style.backgroundColor = isActive ? characterConfig.outfitColor : preset.outfitColor;
    dot.setAttribute('aria-hidden', 'true');

    const hat = document.createElement('span');
    hat.className = 'preset-avatar-hat';
    hat.style.backgroundColor = isActive ? characterConfig.hairHatColor : preset.hairHatColor;
    dot.appendChild(hat);

    const textWrap = document.createElement('span');
    textWrap.className = 'preset-text';

    const nameEl = document.createElement('span');
    nameEl.className = 'preset-name';
    nameEl.textContent = preset.nameAr;

    const subEl = document.createElement('span');
    subEl.className = 'preset-sub';
    subEl.textContent = preset.subtitleAr;

    textWrap.append(nameEl, subEl);
    btn.append(dot, textWrap);

    btn.addEventListener('click', () => {
      const nextPreset = getCharacterPresetById(preset.id);
      applyCharacterUpdate({
        presetId: nextPreset.id,
        skinColor: nextPreset.skinColor,
        outfitColor: nextPreset.outfitColor,
        hairHatColor: nextPreset.hairHatColor,
      });
    });

    dom.characterPresetsGrid.appendChild(btn);
  }

  const renderSwatches = (container, list, activeHex, field) => {
    if (!container) return;
    container.innerHTML = '';
    for (const sw of list) {
      const isActive = sw.hex.toUpperCase() === (activeHex || '').toUpperCase();
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `swatch-btn${isActive ? ' active' : ''}`;
      btn.style.backgroundColor = sw.hex;
      btn.title = sw.label;
      btn.setAttribute('aria-label', sw.label);
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-checked', isActive ? 'true' : 'false');
      btn.addEventListener('click', () => {
        applyCharacterUpdate({
          ...characterConfig,
          [field]: sw.hex,
        });
      });
      container.appendChild(btn);
    }
  };

  renderSwatches(dom.skinSwatches, SKIN_COLOR_SWATCHES, characterConfig.skinColor, 'skinColor');
  renderSwatches(dom.outfitSwatches, OUTFIT_COLOR_SWATCHES, characterConfig.outfitColor, 'outfitColor');
  renderSwatches(dom.hairHatSwatches, HAIR_HAT_COLOR_SWATCHES, characterConfig.hairHatColor, 'hairHatColor');
}

function applyCharacterUpdate(nextConfig) {
  characterConfig = saveCharacterConfig(nextConfig);
  sceneEngine.setCharacterConfig(characterConfig);
  renderCharacterCustomizer();
  renderLoginCharacterSelector();
  syncUserBadgeUI();
  syncLocalRealtimeState();
  document.body.dataset.characterPreset = characterConfig.presetId;
}

function renderLoginCharacterSelector() {
  if (!dom.loginCharacterSelector) return;
  dom.loginCharacterSelector.innerHTML = '';
  for (const preset of CHARACTER_PRESETS) {
    const isActive = preset.id === characterConfig.presetId;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `login-char-pill${isActive ? ' active' : ''}`;
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', isActive ? 'true' : 'false');
    btn.dataset.loginPresetId = preset.id;

    const dot = document.createElement('span');
    dot.className = 'login-char-dot';
    dot.style.backgroundColor = isActive ? characterConfig.outfitColor : preset.outfitColor;
    dot.setAttribute('aria-hidden', 'true');

    const label = document.createElement('span');
    label.textContent = preset.nameAr;

    btn.append(dot, label);
    btn.addEventListener('click', () => {
      applyCharacterUpdate({
        presetId: preset.id,
        skinColor: preset.skinColor,
        outfitColor: preset.outfitColor,
        hairHatColor: preset.hairHatColor,
      });
    });

    dom.loginCharacterSelector.appendChild(btn);
  }
}

function syncUserBadgeUI() {
  const displayName = userProfile.builderName || 'زائر الجزيرة';
  if (dom.userBadgeName) {
    dom.userBadgeName.textContent = displayName;
    dom.userBadgeName.title = displayName;
  }
  if (dom.userBadgeDot) {
    dom.userBadgeDot.style.backgroundColor = characterConfig.outfitColor;
  }
  sceneEngine?.setCharacterName(displayName);
}

function showLoginError(msg) {
  if (!dom.loginError) return;
  if (!msg) {
    dom.loginError.textContent = '';
    dom.loginError.classList.add('hidden');
  } else {
    dom.loginError.textContent = msg;
    dom.loginError.classList.remove('hidden');
  }
}

function updateSitPromptPill(seatState) {
  if (!dom.sitPromptPill) return;
  if (!seatState || !seatState.seat) {
    dom.sitPromptPill.classList.add('hidden');
    return;
  }
  dom.sitPromptPill.textContent = seatState.isSitting
    ? 'اضغط [E] أو WASD للوقوف'
    : 'اضغط [E] أو انقر للجلوس (Sit)';
  dom.sitPromptPill.classList.remove('hidden');
}

function updateMicUI() {
  const active = spatialAudio.micEnabled;
  const speaking = spatialAudio.isSpeaking;
  const testing = spatialAudio.micTestActive;

  if (dom.btnMic) {
    dom.btnMic.classList.toggle('active', active);
    dom.btnMic.setAttribute('aria-pressed', active ? 'true' : 'false');
    document.body.dataset.micActive = active ? 'true' : 'false';
  }
  if (dom.btnMicTest) {
    dom.btnMicTest.classList.toggle('active', testing);
    dom.btnMicTest.setAttribute('aria-pressed', testing ? 'true' : 'false');
    dom.btnMicTest.textContent = testing ? 'إيقاف الاختبار' : 'اختبار الميكروفون';
  }
  if (dom.micStatusLabel) {
    if (!active) {
      dom.micStatusLabel.textContent = 'مغلق';
    } else if (testing) {
      dom.micStatusLabel.textContent = 'وضع الاختبار المحلي';
    } else if (speaking) {
      dom.micStatusLabel.textContent = 'تتحدث الآن';
    } else {
      dom.micStatusLabel.textContent = 'مفتوح (صوت محيطي 3D)';
    }
  }
}

function buildLocalRealtimePayload() {
  const snap = sceneEngine ? sceneEngine.getLocalWalkSnapshot() : { x: 0, y: 0, z: 11.5, yaw: 0, isSitting: false, visible: false };
  return {
    builderName: userProfile.builderName || 'زائر الجزيرة',
    characterConfig,
    ...snap,
    speaking: spatialAudio.isSpeaking,
    micActive: spatialAudio.micEnabled,
  };
}

function syncLocalRealtimeState() {
  if (!userProfile.loggedIn) return;
  realtimeClient.updateLocalProfileAndState(buildLocalRealtimePayload());
}

function ensureRealtimeConnected() {
  if (!userProfile.loggedIn) return;
  if (!realtimeClient.ws || realtimeClient.ws.readyState === WebSocket.CLOSED) {
    realtimeClient.connect(buildLocalRealtimePayload());
  } else {
    syncLocalRealtimeState();
  }
}

function findInviterSpawnTarget() {
  if (!inviteInfo.hasInvite) return null;
  const inviterLower = (inviteInfo.inviterName || '').trim().toLowerCase();
  if (inviterLower) {
    for (const peer of realtimeClient.remotePeers.values()) {
      if ((peer.builderName || '').trim().toLowerCase() === inviterLower) {
        return { x: peer.x, z: peer.z };
      }
    }
  }
  return { x: 0, z: 11.5 };
}

function enterIslandSession({ builderName, credential, isGuest }) {
  window.clearTimeout(loginHideTimer);
  userProfile = saveUserProfile({
    loggedIn: true,
    isGuest: Boolean(isGuest),
    builderName,
    credential: credential || '',
    loggedInAt: Date.now(),
  });
  showLoginError('');
  syncUserBadgeUI();
  document.body.setAttribute('data-auth', 'authenticated');
  sceneEngine.setWelcomeShowcase(false);

  dom.loginOverlay.classList.add('is-closing');
  loginHideTimer = window.setTimeout(() => {
    dom.loginOverlay.classList.add('hidden');
    dom.loginOverlay.classList.remove('is-closing');
  }, 380);

  ensureRealtimeConnected();

  if (pendingInviteSpawn) {
    pendingInviteSpawn = false;
    const customSpawn = findInviterSpawnTarget();
    setCameraMode('walk', { customSpawn });
    showToast(
      inviteInfo.inviterName
        ? `تم الانضمام بدعوة من ${inviteInfo.inviterName} عند مقهى الفوكسل`
        : 'مرحباً بك عند مقهى الفوكسل المركزي',
      'success'
    );
  } else {
    showToast(`مرحباً بك في جزيرة الفوكسل يا ${userProfile.builderName}`, 'success');
  }
}

function returnToLoginOverlay() {
  window.clearTimeout(loginHideTimer);
  if (spatialAudio.micEnabled) {
    spatialAudio.disableMicrophone();
    realtimeClient.setLocalAudioStream(null);
    updateMicUI();
  }
  userProfile = logoutUserProfile();
  closeInspectionCard();
  closePlotSelector();
  closeCharacterPopover();
  closeAudioPopover();
  closeInvitePopover();
  closeSettingsModal();
  if (cameraMode === 'walk') {
    setCameraMode('orbit');
  }
  document.body.setAttribute('data-auth', 'welcome');
  sceneEngine.setWelcomeShowcase(true);

  if (dom.loginNameInput && !userProfile.isGuest && userProfile.builderName) {
    dom.loginNameInput.value = userProfile.builderName;
  } else if (dom.loginNameInput && userProfile.isGuest) {
    dom.loginNameInput.value = '';
  }
  if (dom.loginCredentialInput) {
    dom.loginCredentialInput.value = userProfile.credential || '';
  }
  showLoginError('');
  renderLoginCharacterSelector();

  dom.loginOverlay.classList.remove('hidden', 'is-closing');
  window.setTimeout(() => dom.loginNameInput?.focus(), 60);
}

function openCharacterPopover() {
  if (cameraMode !== 'walk') {
    setCameraMode('walk');
  }
  closeInspectionCard();
  closePlotSelector();
  closeAudioPopover();
  closeInvitePopover();
  renderCharacterCustomizer();
  dom.characterPopover.classList.remove('hidden');
  dom.btnCharacter.classList.add('active');
  dom.btnCharacter.setAttribute('aria-expanded', 'true');
}

function closeCharacterPopover() {
  dom.characterPopover.classList.add('hidden');
  dom.btnCharacter.classList.remove('active');
  dom.btnCharacter.setAttribute('aria-expanded', 'false');
}

function openAudioPopover() {
  closeCharacterPopover();
  closeInvitePopover();
  updateMicUI();
  dom.audioPopover?.classList.remove('hidden');
  dom.btnAudioPopover?.classList.add('active');
  dom.btnAudioPopover?.setAttribute('aria-expanded', 'true');
}

function closeAudioPopover() {
  dom.audioPopover?.classList.add('hidden');
  dom.btnAudioPopover?.classList.remove('active');
  dom.btnAudioPopover?.setAttribute('aria-expanded', 'false');
}

function refreshInviteShareContent() {
  const inviter = userProfile.builderName || 'مستكشف الجزيرة';
  const url = buildInviteUrl(window.location.origin, window.location.pathname, inviter, 'cafe');
  if (dom.inviteUrlInput) {
    dom.inviteUrlInput.value = url;
  }
  const shareText = `انضم إليّ في جزيرة الفوكسل التشاركية عند المقهى المركزي وتحدّث معنا بالصوت المحيطي!`;
  if (dom.inviteShareWhatsapp) {
    dom.inviteShareWhatsapp.href = `https://wa.me/?text=${encodeURIComponent(`${shareText}\n${url}`)}`;
  }
  if (dom.inviteShareX) {
    dom.inviteShareX.href = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(url)}`;
  }
  return url;
}

function openInvitePopover() {
  closeCharacterPopover();
  closeAudioPopover();
  refreshInviteShareContent();
  dom.invitePopover?.classList.remove('hidden');
  dom.btnInvite?.classList.add('active');
  dom.btnInvite?.setAttribute('aria-expanded', 'true');
}

function closeInvitePopover() {
  dom.invitePopover?.classList.add('hidden');
  dom.btnInvite?.classList.remove('active');
  dom.btnInvite?.setAttribute('aria-expanded', 'false');
}

function openPlotSelector(gx, gz) {
  selectedPlot = { gx, gz };
  closeInspectionCard();
  closeCharacterPopover();
  dom.selectedPlotCoords.textContent = `(${gx}, ${gz})`;
  dom.bottomPillDock.classList.add('hidden');
  dom.promptDock.classList.remove('hidden');
  sceneEngine.setSelectedPlot(gx, gz);
  window.setTimeout(() => dom.promptInput.focus(), 40);
}

function closePlotSelector() {
  selectedPlot = null;
  dom.promptDock.classList.add('hidden');
  dom.bottomPillDock.classList.remove('hidden');
  sceneEngine.setSelectedPlot(null, null);
}

function openInspectionCard(buildingId) {
  const b = buildings.find((item) => item.id === buildingId);
  if (!b) return;
  closePlotSelector();
  inspectedBuildingId = b.id;
  sceneEngine.setSelectedBuildingId(b.id);

  dom.inspectPrompt.textContent = b.prompt;
  dom.inspectVoxels.textContent = `${b.voxels.length} فوكسل`;
  dom.inspectDate.textContent = dateFormatter.format(new Date(b.createdAt));
  dom.inspectCoords.textContent = `(${b.gx}, ${b.gz})`;
  const baseSource =
    b.source === 'ai'
      ? 'تم التصميم بواسطة الذكاء الاصطناعي (Gemini)'
      : 'تصميم معماري فوكسلي متكامل';
  dom.inspectSource.textContent = b.authorName ? `المُنشئ: ${b.authorName} · ${baseSource}` : baseSource;
  dom.inspectLikes.textContent = String(b.likes || 0);
  dom.btnLikeBuilding.classList.toggle('liked', Boolean(b.likedByMe));
  dom.btnLikeBuilding.setAttribute('aria-pressed', b.likedByMe ? 'true' : 'false');

  dom.inspectionCard.classList.remove('hidden');
}

function closeInspectionCard() {
  inspectedBuildingId = null;
  sceneEngine.setSelectedBuildingId(null);
  dom.inspectionCard.classList.add('hidden');
}

function openSettingsModal() {
  dom.inputModelId.value = settings.modelId || 'gemini-4-hydrogen';
  dom.settingsModal.classList.remove('hidden');
  window.setTimeout(() => dom.inputModelId.focus(), 40);
}

function closeSettingsModal() {
  dom.settingsModal.classList.add('hidden');
}

const spatialAudio = new SpatialAudioEngine({
  onSpeakingChange: (speaking) => {
    sceneEngine?.setLocalSpeaking(speaking);
    realtimeClient?.sendSpeakingState(speaking, spatialAudio.micEnabled);
    updateMicUI();
  },
  onMicLevel: (level) => {
    if (dom.micLevelFill) {
      dom.micLevelFill.style.width = `${Math.round(Math.min(1, Math.max(0, level)) * 100)}%`;
    }
  },
  onError: (err) => {
    showToast(err?.message || 'تعذر معالجة الصوت المحيطي', 'error');
  },
});

const realtimeClient = new IslandRealtimeClient({
  spatialAudio,
  onPeersSnapshot: (peers) => sceneEngine?.syncRemotePeers(peers),
  onPeerJoined: (peer) => sceneEngine?.upsertRemotePeer(peer),
  onPeerUpdated: (peer) => sceneEngine?.upsertRemotePeer(peer),
  onPeerLeft: (peerId) => sceneEngine?.removeRemotePeer(peerId),
  onPeerSpeaking: (peerId, speaking) => sceneEngine?.updateRemotePeerSpeaking(peerId, speaking),
});

const sceneEngine = new VoxelIslandScene(dom.canvasContainer, {
  characterConfig,
  characterName: userProfile.builderName || 'زائر الجزيرة',
  initialWelcomeShowcase: !userProfile.loggedIn,
  onSelectPlot: (gx, gz) => openPlotSelector(gx, gz),
  onInvalidPlot: (reason) => showToast(reason || 'لا يمكن البناء في هذا الموقع', 'error'),
  onSelectBuilding: (buildingId) => openInspectionCard(buildingId),
  onNearSeatChange: (seatState) => updateSitPromptPill(seatState),
  onLocalTransform: (snap) => {
    if (!userProfile.loggedIn) return;
    realtimeClient.sendMoveThrottled({
      builderName: userProfile.builderName || 'زائر الجزيرة',
      characterConfig,
      ...snap,
      speaking: spatialAudio.isSpeaking,
      micActive: spatialAudio.micEnabled,
    });
  },
  onSpatialFrame: ({ listenerX, listenerY, listenerZ, forwardX, forwardY, forwardZ, remotePeers }) => {
    spatialAudio.updateListenerTransform(listenerX, listenerY, listenerZ, forwardX, forwardY, forwardZ);
    for (const [peerId, entry] of remotePeers.entries()) {
      spatialAudio.updateRemotePeerPosition(peerId, entry.curX, entry.curY, entry.curZ);
    }
  },
});

sceneEngine.syncBuildings(buildings);
updateStatsUI();
syncActiveModelBadge();
renderCharacterCustomizer();
renderLoginCharacterSelector();
syncUserBadgeUI();
updateMicUI();
document.body.dataset.characterPreset = characterConfig.presetId;

if (inviteInfo.hasInvite && dom.loginInviteBanner) {
  dom.loginInviteBanner.textContent = inviteInfo.inviterName
    ? `تمت دعوتك بواسطة ${inviteInfo.inviterName} للانضمام إلى الجزيرة!`
    : 'تمت دعوتك للانضمام إلى جزيرة الفوكسل ومقهاها المركزي!';
  dom.loginInviteBanner.classList.remove('hidden');
}

if (userProfile.loggedIn) {
  document.body.setAttribute('data-auth', 'authenticated');
  dom.loginOverlay.classList.add('hidden');
  ensureRealtimeConnected();
  if (pendingInviteSpawn) {
    pendingInviteSpawn = false;
    setCameraMode('walk', { customSpawn: findInviterSpawnTarget() });
  }
} else {
  document.body.setAttribute('data-auth', 'welcome');
  if (dom.loginNameInput && !userProfile.isGuest && userProfile.builderName) {
    dom.loginNameInput.value = userProfile.builderName;
  }
  dom.loginOverlay.classList.remove('hidden');
}

// Construction Workflow (Client-Side BYOK Gemini or Demo)
async function startConstruction({ useDemo }) {
  if (!selectedPlot) {
    showToast('اختر موقعاً فارغاً على الجزيرة أولاً', 'error');
    return;
  }

  const rawPrompt = dom.promptInput.value.trim();
  const prompt = rawPrompt || (useDemo ? 'منارة بحرية دافئة' : '');

  if (!prompt) {
    showToast('يرجى كتابة وصف لما تريد بناءه', 'error');
    dom.promptInput.focus();
    return;
  }

  const { gx, gz } = selectedPlot;
  const check = checkPlotAvailability(gx, gz, buildings, activeConstructionPlots);
  if (!check.valid) {
    showToast(check.reason, 'error');
    return;
  }

  const siteId = `site_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  activeConstructionPlots.push({ id: siteId, gx, gz });
  sceneEngine.addConstructionSite(siteId, gx, gz);
  closePlotSelector();
  dom.promptInput.value = '';
  document.body.setAttribute('data-state', 'constructing');

  try {
    let voxels;
    if (useDemo) {
      await new Promise((resolve) => window.setTimeout(resolve, 1200));
      voxels = generateDemoBuilding(prompt);
    } else {
      voxels = await generateVoxelStructureWithGemini({
        prompt,
        modelId: settings.modelId,
        onModelResolved: (resolvedModel) => setActiveModelBadge(resolvedModel),
      });
    }

    const newBuilding = {
      id: `bld_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      prompt,
      authorName: userProfile.builderName || 'زائر الجزيرة',
      gx,
      gz,
      voxels,
      likes: 0,
      likedByMe: false,
      createdAt: Date.now(),
      source: useDemo ? 'demo' : 'ai',
    };

    buildings = [...buildings, newBuilding];
    saveIslandBuildings(buildings);

    sceneEngine.removeConstructionSite(siteId);
    activeConstructionPlots = activeConstructionPlots.filter((s) => s.id !== siteId);

    sceneEngine.syncBuildings(buildings, new Set([newBuilding.id]));
    updateStatsUI();
    showToast(`اكتمل بناء «${prompt}» (${voxels.length} فوكسل)`, 'success');
  } catch (err) {
    sceneEngine.removeConstructionSite(siteId);
    activeConstructionPlots = activeConstructionPlots.filter((s) => s.id !== siteId);
    showToast(err?.message || 'حدث خطأ أثناء توليد المبنى', 'error');
  } finally {
    if (activeConstructionPlots.length === 0) {
      document.body.setAttribute('data-state', 'ready');
    }
  }
}

// Camera Mode, Character Customizer & Add Structure Pill Events
dom.btnModePan.addEventListener('click', () => setCameraMode('pan'));
dom.btnModeOrbit.addEventListener('click', () => setCameraMode('orbit'));
dom.btnModeWalk.addEventListener('click', () => setCameraMode('walk'));

dom.btnCharacter.addEventListener('click', () => {
  const isOpen = !dom.characterPopover.classList.contains('hidden');
  if (isOpen) {
    closeCharacterPopover();
  } else {
    openCharacterPopover();
  }
});

dom.btnCloseCharacter.addEventListener('click', closeCharacterPopover);

dom.sitPromptPill?.addEventListener('click', () => {
  sceneEngine.toggleSitNearSeat();
});

dom.btnMic?.addEventListener('click', async () => {
  try {
    const enabled = await spatialAudio.toggleMicrophone();
    await realtimeClient.setLocalAudioStream(enabled ? spatialAudio.micStream : null);
    realtimeClient.sendSpeakingState(spatialAudio.isSpeaking, enabled);
    updateMicUI();
    showToast(
      enabled
        ? 'تم تشغيل الميكروفون للصوت المحيطي في كل أنحاء الجزيرة'
        : 'تم إيقاف الميكروفون',
      enabled ? 'success' : 'info'
    );
  } catch (err) {
    updateMicUI();
    showToast(err?.message || 'تعذر الوصول إلى الميكروفون', 'error');
  }
});

dom.btnAudioPopover?.addEventListener('click', () => {
  const isOpen = dom.audioPopover && !dom.audioPopover.classList.contains('hidden');
  if (isOpen) {
    closeAudioPopover();
  } else {
    openAudioPopover();
  }
});

dom.btnCloseAudio?.addEventListener('click', closeAudioPopover);

dom.btnMicTest?.addEventListener('click', async () => {
  try {
    if (spatialAudio.micTestActive) {
      spatialAudio.stopMicTest();
    } else {
      await spatialAudio.startMicTest();
      await realtimeClient.setLocalAudioStream(spatialAudio.micStream);
    }
    updateMicUI();
  } catch (err) {
    updateMicUI();
    showToast(err?.message || 'تعذر بدء اختبار الميكروفون', 'error');
  }
});

dom.btnSpatialChime?.addEventListener('click', async () => {
  try {
    await spatialAudio.playSpatialTestChime();
    showToast('تم تشغيل نغمة الاختبار المحيطية (3D)', 'success');
  } catch (err) {
    showToast(err?.message || 'تعذر تشغيل اختبار الصوت', 'error');
  }
});

dom.btnInvite?.addEventListener('click', () => {
  const isOpen = dom.invitePopover && !dom.invitePopover.classList.contains('hidden');
  if (isOpen) {
    closeInvitePopover();
  } else {
    openInvitePopover();
  }
});

dom.btnCloseInvite?.addEventListener('click', closeInvitePopover);

dom.btnCopyInvite?.addEventListener('click', async () => {
  const url = dom.inviteUrlInput?.value || refreshInviteShareContent();
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
    } else if (dom.inviteUrlInput) {
      dom.inviteUrlInput.select();
      document.execCommand('copy');
    }
    showToast('تم نسخ رابط الدعوة!', 'success');
  } catch {
    if (dom.inviteUrlInput) {
      dom.inviteUrlInput.select();
      document.execCommand('copy');
      showToast('تم نسخ رابط الدعوة!', 'success');
    } else {
      showToast('تعذر نسخ الرابط تلقائياً، يمكنك نسخه من الحقل', 'error');
    }
  }
});

dom.btnAddStructure.addEventListener('click', () => {
  closeCharacterPopover();
  closeAudioPopover();
  closeInvitePopover();
  if (cameraMode === 'walk') {
    setCameraMode('orbit');
  }
  const plot = selectedPlot || findFreeBuildPlot(buildings, activeConstructionPlots);
  if (!plot) {
    showToast('الجزيرة ممتلئة حالياً، يمكنك حذف مبنى لإفساح مساحة', 'error');
    return;
  }
  openPlotSelector(plot.gx, plot.gz);
  sceneEngine.focusOnPoint(plot.gx, plot.gz, 2.5);
});

// Build Form & Quick Ideas
dom.buildForm.addEventListener('submit', (e) => {
  e.preventDefault();
  startConstruction({ useDemo: false });
});

dom.btnDemoBuild.addEventListener('click', () => {
  startConstruction({ useDemo: true });
});

document.querySelectorAll('.idea-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const idea = btn.getAttribute('data-prompt') || '';
    dom.promptInput.value = idea;
    dom.promptInput.focus();
  });
});

dom.btnCancelPlot.addEventListener('click', closePlotSelector);
dom.btnCloseInspect.addEventListener('click', closeInspectionCard);

dom.btnLikeBuilding.addEventListener('click', () => {
  if (!inspectedBuildingId) return;
  buildings = buildings.map((b) => {
    if (b.id !== inspectedBuildingId) return b;
    const nextLiked = !b.likedByMe;
    const nextLikes = Math.max(0, (b.likes || 0) + (nextLiked ? 1 : -1));
    return { ...b, likedByMe: nextLiked, likes: nextLikes };
  });
  saveIslandBuildings(buildings);
  sceneEngine.syncBuildings(buildings);
  updateStatsUI();
  openInspectionCard(inspectedBuildingId);
});

dom.btnFocusBuilding.addEventListener('click', () => {
  const b = buildings.find((item) => item.id === inspectedBuildingId);
  if (!b) return;
  if (cameraMode === 'walk') {
    setCameraMode('orbit');
  }
  sceneEngine.focusOnPoint(b.gx, b.gz, 4);
});

dom.btnDeleteBuilding.addEventListener('click', () => {
  if (!inspectedBuildingId) return;
  const target = buildings.find((item) => item.id === inspectedBuildingId);
  buildings = buildings.filter((item) => item.id !== inspectedBuildingId);
  saveIslandBuildings(buildings);
  closeInspectionCard();
  sceneEngine.syncBuildings(buildings);
  updateStatsUI();
  if (target) {
    showToast(`تمت إزالة «${target.prompt}»`, 'info');
  }
});

dom.btnCenterIsland?.addEventListener('click', () => {
  closeCharacterPopover();
  if (cameraMode === 'walk') {
    sceneEngine.teleportWalkToCenter();
    showToast('تم الانتقال إلى مركز الجزيرة', 'info');
  } else {
    sceneEngine.resetCamera();
    showToast('تمت العودة إلى مركز الجزيرة', 'info');
  }
});

dom.btnResetCamera.addEventListener('click', () => {
  if (cameraMode === 'walk') {
    setCameraMode('orbit');
  } else {
    sceneEngine.resetCamera();
  }
});

dom.btnSettings.addEventListener('click', openSettingsModal);
dom.btnCloseSettings.addEventListener('click', closeSettingsModal);
dom.btnCancelSettings.addEventListener('click', closeSettingsModal);

dom.settingsModal.addEventListener('click', (e) => {
  if (e.target === dom.settingsModal) closeSettingsModal();
});

dom.settingsForm.addEventListener('submit', (e) => {
  e.preventDefault();
  settings = {
    modelId: dom.inputModelId.value.trim() || 'gemini-4-hydrogen',
  };
  saveSettings(settings);
  syncActiveModelBadge();
  closeSettingsModal();
  showToast('تم حفظ إعدادات النموذج محلياً', 'success');
});

dom.btnResetModel.addEventListener('click', () => {
  dom.inputModelId.value = 'gemini-4-hydrogen';
  settings = { modelId: 'gemini-4-hydrogen' };
  saveSettings(settings);
  syncActiveModelBadge();
  showToast('تمت استعادة النموذج الافتراضي (gemini-4-hydrogen)', 'info');
});

dom.btnExport.addEventListener('click', () => {
  exportIslandJson(buildings);
  showToast('تم تصدير بيانات الجزيرة بصيغة JSON', 'success');
});

dom.btnImport.addEventListener('click', () => {
  dom.inputImportFile.click();
});

dom.inputImportFile.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;

  try {
    const text = await file.text();
    const json = JSON.parse(text);
    const imported = validateImportedIslandPayload(json);
    if (imported.length === 0) {
      throw new Error('لا يحتوي الملف على مبانٍ صالحة');
    }
    buildings = imported;
    saveIslandBuildings(buildings);
    closeInspectionCard();
    closePlotSelector();
    sceneEngine.syncBuildings(buildings, new Set(buildings.map((b) => b.id)));
    updateStatsUI();
    showToast(`تم استيراد ${buildings.length} مبنى بنجاح`, 'success');
  } catch (err) {
    showToast(err?.message || 'تعذر قراءة ملف JSON', 'error');
  }
});

dom.loginForm?.addEventListener('submit', (e) => {
  e.preventDefault();
  const res = validateExplorerLoginInput(
    dom.loginNameInput?.value,
    dom.loginCredentialInput?.value
  );
  if (!res.valid) {
    showLoginError(res.reason);
    dom.loginNameInput?.focus();
    return;
  }
  enterIslandSession({
    builderName: res.builderName,
    credential: res.credential,
    isGuest: false,
  });
});

dom.btnLoginGuest?.addEventListener('click', () => {
  enterIslandSession({
    builderName: 'زائر الجزيرة',
    credential: '',
    isGuest: true,
  });
});

dom.loginNameInput?.addEventListener('input', () => showLoginError(''));
dom.loginCredentialInput?.addEventListener('input', () => showLoginError(''));

dom.btnLogout?.addEventListener('click', () => {
  returnToLoginOverlay();
  showToast('تم تسجيل الخروج بنجاح', 'info');
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!dom.settingsModal.classList.contains('hidden')) {
      closeSettingsModal();
    } else if (dom.invitePopover && !dom.invitePopover.classList.contains('hidden')) {
      closeInvitePopover();
    } else if (dom.audioPopover && !dom.audioPopover.classList.contains('hidden')) {
      closeAudioPopover();
    } else if (!dom.characterPopover.classList.contains('hidden')) {
      closeCharacterPopover();
    } else if (!dom.promptDock.classList.contains('hidden')) {
      closePlotSelector();
    } else if (!dom.inspectionCard.classList.contains('hidden')) {
      closeInspectionCard();
    } else if (cameraMode === 'walk') {
      setCameraMode('orbit');
    }
  }
});
