import { getSeededBuildings } from './demoBlueprints.js';
import { findFreeBuildPlot, validateImportedIslandPayload } from './voxelCore.js';
import { isInsideCafeProtectedZone } from './cafeLayout.js';
import { normalizeCharacterConfig } from './characterCatalog.js';

const STATE_KEY = 'voxel_island_state_v1';
const SETTINGS_KEY = 'voxel_island_settings_v1';
const CHARACTER_KEY = 'voxel_island_character_v1';
const USER_PROFILE_KEY = 'voxel_island_user_v1';
const DEFAULT_MODEL_ID = 'gemini-4-hydrogen';

export function normalizeUserProfile(raw) {
  const builderName =
    typeof raw?.builderName === 'string' && raw.builderName.trim()
      ? raw.builderName.trim().slice(0, 32)
      : '';
  const credential =
    typeof raw?.credential === 'string' && raw.credential.trim()
      ? raw.credential.trim().slice(0, 80)
      : '';
  return {
    loggedIn: Boolean(raw?.loggedIn),
    isGuest: Boolean(raw?.isGuest),
    builderName: builderName || (raw?.isGuest ? 'زائر الجزيرة' : ''),
    credential,
    loggedInAt: Number(raw?.loggedInAt) || 0,
  };
}

export function loadUserProfile() {
  try {
    const raw = localStorage.getItem(USER_PROFILE_KEY);
    if (raw) {
      return normalizeUserProfile(JSON.parse(raw));
    }
  } catch {
    // Ignore parse error
  }
  return normalizeUserProfile(null);
}

export function saveUserProfile(profile) {
  const normalized = normalizeUserProfile({
    ...profile,
    loggedIn: profile?.loggedIn !== false,
    loggedInAt: profile?.loggedInAt || Date.now(),
  });
  try {
    localStorage.setItem(USER_PROFILE_KEY, JSON.stringify(normalized));
  } catch {
    // Ignore quota errors
  }
  return normalized;
}

export function logoutUserProfile() {
  const current = loadUserProfile();
  const next = normalizeUserProfile({
    ...current,
    loggedIn: false,
  });
  try {
    localStorage.setItem(USER_PROFILE_KEY, JSON.stringify(next));
  } catch {
    // Ignore quota errors
  }
  return next;
}

export function loadIslandBuildings() {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) {
      const seeded = getSeededBuildings();
      saveIslandBuildings(seeded);
      return seeded;
    }
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.buildings)) {
      const normalized = validateImportedIslandPayload(parsed);
      let migrated = false;
      const safeList = [];
      for (const b of normalized) {
        if (isInsideCafeProtectedZone(b.gx, b.gz, 4)) {
          const free = findFreeBuildPlot(safeList, []);
          if (free) {
            safeList.push({ ...b, gx: free.gx, gz: free.gz });
            migrated = true;
          }
        } else {
          safeList.push(b);
        }
      }
      if (migrated) {
        saveIslandBuildings(safeList);
      }
      return safeList;
    }
  } catch {
    // Fallback to seeded island if storage is corrupted
  }
  const seeded = getSeededBuildings();
  saveIslandBuildings(seeded);
  return seeded;
}

export function saveIslandBuildings(buildings) {
  try {
    localStorage.setItem(
      STATE_KEY,
      JSON.stringify({
        version: 1,
        updatedAt: Date.now(),
        buildings,
      })
    );
  } catch {
    // Ignore quota errors gracefully
  }
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        modelId:
          typeof parsed.modelId === 'string' && parsed.modelId.trim()
            ? parsed.modelId.trim()
            : DEFAULT_MODEL_ID,
      };
    }
  } catch {
    // Ignore parse error
  }
  return {
    modelId: DEFAULT_MODEL_ID,
  };
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        modelId: String(settings.modelId || DEFAULT_MODEL_ID).trim() || DEFAULT_MODEL_ID,
      })
    );
  } catch {
    // Ignore quota errors
  }
}

export function loadCharacterConfig() {
  try {
    const raw = localStorage.getItem(CHARACTER_KEY);
    if (raw) {
      return normalizeCharacterConfig(JSON.parse(raw));
    }
  } catch {
    // Ignore parse errors
  }
  return normalizeCharacterConfig(null);
}

export function saveCharacterConfig(config) {
  const normalized = normalizeCharacterConfig(config);
  try {
    localStorage.setItem(CHARACTER_KEY, JSON.stringify(normalized));
  } catch {
    // Ignore quota errors
  }
  return normalized;
}

export function exportIslandJson(buildings) {
  const payload = {
    app: 'جزيرة الفوكسل',
    version: 1,
    exportedAt: new Date().toISOString(),
    buildings,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `voxel-island-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
