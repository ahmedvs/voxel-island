/**
 * Pure domain logic for Voxel Island:
 * - Voxel clamping, deduplication, grounding, color sanitization
 * - JSON extraction from LLM responses
 * - Plot collision/availability math
 * - Island vitality and community metrics
 * - Export/Import validation
 */

import {
  WORLD_SIZE,
  WORLD_HALF,
  sampleTerrainHeightAt,
  isWalkableTerrainAt,
  isPlotOnDryLand,
} from './worldTerrain.js';
import { isInsideCafeProtectedZone, isBlockedByCafe } from './cafeLayout.js';

export const ISLAND_GRID_SIZE = WORLD_SIZE;
export const ISLAND_HALF = WORLD_HALF;
export const BUILDABLE_CENTER_LIMIT = 124;
export const PLOT_HALF_SIZE = 4; // 9x9 visual footprint, safe for [-5, 5] voxels
export const MAX_VOXELS_PER_BUILDING = 300;
export const VOXEL_BOUNDS = {
  minX: -5,
  maxX: 5,
  minZ: -5,
  maxZ: 5,
  minY: 0,
  maxY: 14,
};

const DEFAULT_FALLBACK_COLOR = '#8B5A2B';

/**
 * Normalizes a hex color string without scrambling colors across indices.
 */
export function normalizeVoxelColor(input) {
  if (typeof input !== 'string') {
    return DEFAULT_FALLBACK_COLOR;
  }
  let hex = input.trim();
  if (/^#[0-9a-fA-F]{3}$/.test(hex)) {
    hex = `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) {
    return DEFAULT_FALLBACK_COLOR;
  }
  return hex.toUpperCase();
}

/**
 * Recovers complete JSON objects from a truncated JSON array string (e.g., if token limit hit mid-tail).
 */
function recoverCompleteVoxelObjects(text) {
  const start = text.indexOf('[');
  const scanFrom = start !== -1 ? start + 1 : 0;
  const recovered = [];
  let inString = false;
  let escaped = false;
  let depth = 0;
  let objStart = -1;

  for (let i = scanFrom; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') {
      if (depth === 0) objStart = i;
      depth++;
    } else if (ch === '}' && depth > 0) {
      depth--;
      if (depth === 0 && objStart !== -1) {
        const chunk = text.slice(objStart, i + 1);
        try {
          const obj = JSON.parse(chunk);
          if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
            recovered.push(obj);
          }
        } catch {
          // Skip malformed chunk
        }
        objStart = -1;
      }
    }
  }
  return recovered;
}

/**
 * Extracts a JSON array from raw LLM text (supports raw JSON, fenced markdown, and truncated tails).
 */
export function extractJsonArrayFromText(rawText) {
  if (typeof rawText !== 'string') {
    throw new Error('استجابة غير صالحة من النموذج');
  }
  const trimmed = rawText.trim();
  const withoutFences = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    const direct = JSON.parse(withoutFences);
    if (Array.isArray(direct)) return direct;
    if (direct && Array.isArray(direct.voxels)) return direct.voxels;
  } catch {
    // Fall through to bracket search & partial recovery
  }

  const start = withoutFences.indexOf('[');
  const end = withoutFences.lastIndexOf(']');
  if (start !== -1 && end > start) {
    try {
      const slice = withoutFences.slice(start, end + 1);
      const parsed = JSON.parse(slice);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Fall through to partial object recovery
    }
  }

  const recovered = recoverCompleteVoxelObjects(withoutFences);
  if (recovered.length > 0) {
    return recovered;
  }

  throw new Error('تعذر استخراج مصفوفة JSON صالحة من استجابة الذكاء الاصطناعي');
}

/**
 * Validates, clamps, grounds at y=0, deduplicates, and caps voxels at 300.
 */
export function sanitizeVoxelArray(rawVoxels) {
  if (!Array.isArray(rawVoxels) || rawVoxels.length === 0) {
    throw new Error('لم يتم العثور على أي فوكسلات صالحة في التصميم');
  }

  const parsed = [];
  for (let i = 0; i < rawVoxels.length; i++) {
    const item = rawVoxels[i];
    if (!item || typeof item !== 'object') continue;
    const rx = Math.round(Number(item.x));
    const ry = Math.round(Number(item.y));
    const rz = Math.round(Number(item.z));
    if (!Number.isFinite(rx) || !Number.isFinite(ry) || !Number.isFinite(rz)) continue;
    parsed.push({ rx, ry, rz, c: normalizeVoxelColor(item.c) });
  }

  if (parsed.length === 0) {
    throw new Error('إحداثيات الفوكسلات المستلمة غير صالحة');
  }

  // If a full structure (>= 10 voxels) was shifted off-center (e.g. 0..8) while fitting within 11x11, recenter x/z around 0
  let shiftX = 0;
  let shiftZ = 0;
  if (parsed.length >= 10) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of parsed) {
      if (p.rx < minX) minX = p.rx;
      if (p.rx > maxX) maxX = p.rx;
      if (p.rz < minZ) minZ = p.rz;
      if (p.rz > maxZ) maxZ = p.rz;
    }
    if ((minX < VOXEL_BOUNDS.minX || maxX > VOXEL_BOUNDS.maxX) && maxX - minX <= 10) {
      shiftX = Math.round((minX + maxX) / 2);
    }
    if ((minZ < VOXEL_BOUNDS.minZ || maxZ > VOXEL_BOUNDS.maxZ) && maxZ - minZ <= 10) {
      shiftZ = Math.round((minZ + maxZ) / 2);
    }
  }

  const valid = [];
  for (const p of parsed) {
    const x = Math.max(VOXEL_BOUNDS.minX, Math.min(VOXEL_BOUNDS.maxX, p.rx - shiftX));
    const y = Math.max(VOXEL_BOUNDS.minY, Math.min(VOXEL_BOUNDS.maxY, p.ry));
    const z = Math.max(VOXEL_BOUNDS.minZ, Math.min(VOXEL_BOUNDS.maxZ, p.rz - shiftZ));
    valid.push({ x, y, z, c: p.c });
  }

  // Ensure structure is grounded at y=0
  let minY = Infinity;
  for (const v of valid) {
    if (v.y < minY) minY = v.y;
  }
  const shiftY = minY > 0 ? minY : 0;

  // Deduplicate by coordinate (keep last color) and sort bottom-to-top for layer reveal
  const seen = new Map();
  for (const v of valid) {
    const gy = Math.max(0, Math.min(VOXEL_BOUNDS.maxY, v.y - shiftY));
    const key = `${v.x},${gy},${v.z}`;
    seen.set(key, { x: v.x, y: gy, z: v.z, c: v.c });
  }

  const deduped = Array.from(seen.values());
  deduped.sort((a, b) => a.y - b.y || a.x - b.x || a.z - b.z);

  return deduped.slice(0, MAX_VOXELS_PER_BUILDING);
}

/**
 * Keeps only voxels that are 26-neighbor connected to at least one grounded voxel at y=0,
 * removing floating disconnected blocks while preserving diagonal roofs, stairs, and canopies.
 */
export function pruneFloatingVoxels(voxels) {
  if (!Array.isArray(voxels) || voxels.length === 0) return [];
  const byKey = new Map();
  const queue = [];
  const visited = new Set();

  for (const v of voxels) {
    const key = `${v.x},${v.y},${v.z}`;
    byKey.set(key, v);
    if (v.y === 0) {
      visited.add(key);
      queue.push(v);
    }
  }

  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          if (dx === 0 && dy === 0 && dz === 0) continue;
          const nKey = `${cur.x + dx},${cur.y + dy},${cur.z + dz}`;
          if (!visited.has(nKey) && byKey.has(nKey)) {
            visited.add(nKey);
            queue.push(byKey.get(nKey));
          }
        }
      }
    }
  }

  const connected = Array.from(visited, (key) => byKey.get(key));
  connected.sort((a, b) => a.y - b.y || a.x - b.x || a.z - b.z);
  return connected;
}

/**
 * Checks whether a 9x9 plot centered at (gx, gz) is inside island bounds and free of overlaps.
 */
export function checkPlotAvailability(
  gx,
  gz,
  buildings = [],
  constructionSites = [],
  halfSize = PLOT_HALF_SIZE,
  centerLimit = BUILDABLE_CENTER_LIMIT
) {
  const cx = Math.round(gx);
  const cz = Math.round(gz);

  if (
    !Number.isFinite(cx) ||
    !Number.isFinite(cz) ||
    Math.abs(cx) > centerLimit ||
    Math.abs(cz) > centerLimit
  ) {
    return { valid: false, reason: 'خارج حدود البناء الآمنة للجزيرة' };
  }

  if (!isPlotOnDryLand(cx, cz, halfSize)) {
    return { valid: false, reason: 'لا يمكن البناء فوق الماء أو خارج اليابسة' };
  }

  if (isInsideCafeProtectedZone(cx, cz, halfSize)) {
    return { valid: false, reason: 'هذا الموقع محجوز للمقهى المركزي بالجزيرة' };
  }

  const minSeparation = halfSize * 2 + 1; // 9 units center-to-center for 9x9 non-overlapping plots

  for (const b of buildings) {
    if (Math.abs(cx - b.gx) < minSeparation && Math.abs(cz - b.gz) < minSeparation) {
      return { valid: false, reason: 'يتقاطع هذا الموقع مع مبنى قائم' };
    }
  }

  for (const site of constructionSites) {
    if (Math.abs(cx - site.gx) < minSeparation && Math.abs(cz - site.gz) < minSeparation) {
      return { valid: false, reason: 'هذا الموقع قيد الإنشاء حالياً' };
    }
  }

  return { valid: true, reason: '' };
}

/**
 * Computes aggregate island statistics and organic vitality percentage (18% -> 100%).
 */
export function calculateIslandStats(buildings = []) {
  const buildingCount = buildings.length;
  let totalVoxels = 0;
  let totalLikes = 0;

  for (const b of buildings) {
    totalVoxels += Array.isArray(b.voxels) ? b.voxels.length : 0;
    totalLikes += Math.max(0, Number(b.likes) || 0);
  }

  // Smooth curve: starts at 18%, grows with buildings, voxels, and community likes
  const vitalityRaw =
    18 +
    Math.min(52, buildingCount * 9) +
    Math.min(20, Math.round(totalVoxels / 75)) +
    Math.min(10, totalLikes * 2);

  const vitalityPercent = Math.max(18, Math.min(100, vitalityRaw));

  return {
    buildingCount,
    totalVoxels,
    totalLikes,
    vitalityPercent,
  };
}

/**
 * Validates an imported JSON island snapshot and normalizes every building record.
 */
export function validateImportedIslandPayload(payload) {
  const list = Array.isArray(payload)
    ? payload
    : payload && Array.isArray(payload.buildings)
      ? payload.buildings
      : null;

  if (!list) {
    throw new Error('صيغة ملف الجزيرة غير صالحة');
  }

  const normalized = [];
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    if (!item || typeof item !== 'object') continue;
    const gx = Math.round(Number(item.gx));
    const gz = Math.round(Number(item.gz));
    if (!Number.isFinite(gx) || !Number.isFinite(gz)) continue;

    const voxels = sanitizeVoxelArray(item.voxels);
    normalized.push({
      id: typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `bld_${Date.now()}_${i}`,
      prompt:
        typeof item.prompt === 'string' && item.prompt.trim()
          ? item.prompt.trim().slice(0, 140)
          : 'مبنى مستورد',
      authorName:
        typeof item.authorName === 'string' && item.authorName.trim()
          ? item.authorName.trim().slice(0, 32)
          : '',
      gx: Math.max(-BUILDABLE_CENTER_LIMIT, Math.min(BUILDABLE_CENTER_LIMIT, gx)),
      gz: Math.max(-BUILDABLE_CENTER_LIMIT, Math.min(BUILDABLE_CENTER_LIMIT, gz)),
      voxels,
      likes: Math.max(0, Math.round(Number(item.likes) || 0)),
      likedByMe: Boolean(item.likedByMe),
      createdAt: Number(item.createdAt) || Date.now(),
      source: item.source === 'ai' ? 'ai' : 'demo',
    });
  }

  return normalized;
}

/**
 * Validates login form explorer name and optional email/passcode.
 */
export function validateExplorerLoginInput(rawName, rawCredential = '') {
  const builderName = typeof rawName === 'string' ? rawName.trim().slice(0, 32) : '';
  const credential = typeof rawCredential === 'string' ? rawCredential.trim().slice(0, 80) : '';

  if (builderName.length < 2) {
    return {
      valid: false,
      reason: 'يرجى إدخال اسم المستكشف (حرفين على الأقل)',
      builderName,
      credential,
    };
  }

  if (credential.length > 0) {
    if (credential.includes('@')) {
      const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(credential);
      if (!emailOk) {
        return {
          valid: false,
          reason: 'صيغة البريد الإلكتروني غير صحيحة',
          builderName,
          credential,
        };
      }
    } else if (credential.length < 3) {
      return {
        valid: false,
        reason: 'يجب أن يتكون رمز الدخول من 3 أحرف على الأقل أو يُترك فارغاً',
        builderName,
        credential,
      };
    }
  }

  return {
    valid: true,
    reason: '',
    builderName,
    credential,
  };
}

/**
 * Finds an available 9x9 build plot center on the 260x260 island.
 */
export function findFreeBuildPlot(buildings = [], constructionSites = []) {
  const preferred = [
    [15, 14],
    [-15, 14],
    [0, 17],
    [0, -17],
    [17, 0],
    [-17, 0],
    [-26, 16],
    [26, 14],
    [-30, -24],
    [48, -14],
    [-48, -18],
  ];
  for (const [gx, gz] of preferred) {
    if (checkPlotAvailability(gx, gz, buildings, constructionSites).valid) {
      return { gx, gz };
    }
  }
  // Expanding ring search outward from village center
  for (let radius = 16; radius <= BUILDABLE_CENTER_LIMIT; radius += 8) {
    for (let gx = -radius; gx <= radius; gx += 6) {
      for (const gz of [-radius, radius]) {
        if (checkPlotAvailability(gx, gz, buildings, constructionSites).valid) {
          return { gx, gz };
        }
      }
    }
    for (let gz = -radius + 6; gz <= radius - 6; gz += 6) {
      for (const gx of [-radius, radius]) {
        if (checkPlotAvailability(gx, gz, buildings, constructionSites).valid) {
          return { gx, gz };
        }
      }
    }
  }
  return null;
}

/**
 * Checks if a player circle at (px, pz) collides with ocean, unbridged water, steep cliffs,
 * or solid building voxels adjusted for each building's terrain elevation.
 */
export function isWalkPositionBlocked(
  px,
  pz,
  buildings = [],
  playerRadius = 0.65,
  islandHalfLimit = 129,
  currentY = 0
) {
  if (
    !Number.isFinite(px) ||
    !Number.isFinite(pz) ||
    Math.abs(px + 0.5) > islandHalfLimit ||
    Math.abs(pz + 0.5) > islandHalfLimit
  ) {
    return true;
  }

  // Keep player safely on walkable dry ground or bridge decks (avoid clipping into river/ocean rims)
  if (
    !isWalkableTerrainAt(px, pz) ||
    !isWalkableTerrainAt(px + 0.3, pz) ||
    !isWalkableTerrainAt(px - 0.3, pz) ||
    !isWalkableTerrainAt(px, pz + 0.3) ||
    !isWalkableTerrainAt(px, pz - 0.3)
  ) {
    return true;
  }

  // Steep cliff wall check (allow stepping up 1-block slopes or jumping higher)
  const targetGroundY = sampleTerrainHeightAt(px, pz);
  if (targetGroundY - currentY > 1.35) {
    return true;
  }

  if (isBlockedByCafe(px, pz, playerRadius, currentY)) {
    return true;
  }

  const minDist = 0.5 + playerRadius;
  for (const b of buildings) {
    // Quick broad-phase rejection (buildings are at most [-5, 5] around gx/gz)
    if (Math.abs(px - b.gx) > 6.5 || Math.abs(pz - b.gz) > 6.5) continue;
    const bGroundY = Math.max(0, sampleTerrainHeightAt(b.gx, b.gz));
    const voxels = b.voxels || [];
    for (let i = 0; i < voxels.length; i++) {
      const v = voxels[i];
      const worldVoxelY = v.y + bGroundY;
      if (worldVoxelY > currentY + 2.2 || worldVoxelY + 1 < currentY) continue;
      const vx = b.gx + v.x;
      const vz = b.gz + v.z;
      if (Math.abs(px - vx) < minDist && Math.abs(pz - vz) < minDist) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Finds a clear spawn point near the Central Voxel Cafe promenade (or near an inviter).
 */
export function findWalkSpawnPoint(buildings = [], customTarget = null) {
  if (customTarget && Number.isFinite(customTarget.x) && Number.isFinite(customTarget.z)) {
    const offsets = [
      [1.8, 1.8],
      [-1.8, 1.8],
      [2.2, 0],
      [-2.2, 0],
      [0, 2.4],
    ];
    for (const [ox, oz] of offsets) {
      const cx = customTarget.x + ox;
      const cz = customTarget.z + oz;
      if (!isWalkPositionBlocked(cx, cz, buildings, 0.75, 126, 0)) {
        const yaw = Math.atan2(cx - customTarget.x, cz - customTarget.z);
        return { x: cx, z: cz, yaw };
      }
    }
  }

  const candidates = [
    [0, 11.5],
    [2.4, 11.5],
    [-2.4, 11.5],
    [0, 14.5],
    [6, 12.5],
    [-6, 12.5],
  ];
  for (const [cx, cz] of candidates) {
    if (!isWalkPositionBlocked(cx, cz, buildings, 0.8, 126, 0)) {
      // Forward vector in Three.js YXZ is (-sin(yaw), -cos(yaw)); yaw=0 faces -Z directly into the Cafe!
      const yaw = Math.atan2(cx, cz);
      return { x: cx, z: cz, yaw };
    }
  }
  for (let gx = -22; gx <= 22; gx += 2) {
    for (let gz = 22; gz >= -22; gz -= 2) {
      if (!isWalkPositionBlocked(gx, gz, buildings, 0.8, 126, 0)) {
        return { x: gx, z: gz, yaw: Math.atan2(gx, gz) };
      }
    }
  }
  return { x: 0, z: 12.5, yaw: 0 };
}

/**
 * Resolves smooth sliding walk movement with organic island/river boundaries and solid building collision.
 */
export function resolveWalkMovement(
  curX,
  curZ,
  nextX,
  nextZ,
  buildings = [],
  playerRadius = 0.65,
  islandHalfLimit = 129,
  currentY = 0
) {
  const minBound = -0.5 - islandHalfLimit;
  const maxBound = -0.5 + islandHalfLimit;

  const clampedX = Math.max(minBound, Math.min(maxBound, nextX));
  const clampedZ = Math.max(minBound, Math.min(maxBound, nextZ));

  let resolvedX = curX;
  if (!isWalkPositionBlocked(clampedX, curZ, buildings, playerRadius, islandHalfLimit, currentY)) {
    resolvedX = clampedX;
  }

  let resolvedZ = curZ;
  if (!isWalkPositionBlocked(resolvedX, clampedZ, buildings, playerRadius, islandHalfLimit, currentY)) {
    resolvedZ = clampedZ;
  }

  return { x: resolvedX, z: resolvedZ };
}

/**
 * Returns the walkable island terrain top surface Y height at world (x, z).
 */
export function getTerrainHeightAt(x, z) {
  return sampleTerrainHeightAt(x, z);
}

/**
 * Computes spatial 3D voice attenuation gain:
 * - Full volume (1.0) within fullRange (15 voxels)
 * - Smooth fade from 1.0 -> 0.0 between fullRange (15) and silentRange (45)
 * - Total silence (0.0) beyond silentRange (45 voxels)
 */
export function computeSpatialAttenuation(distance, fullRange = 15, silentRange = 45) {
  if (!Number.isFinite(distance) || distance <= fullRange) return 1;
  if (distance >= silentRange) return 0;
  const t = (distance - fullRange) / Math.max(0.001, silentRange - fullRange);
  return Math.max(0, Math.min(1, 1 - t));
}

/**
 * Parses ?ref=<BuilderName>&spawn=cafe invite parameters from URL query string.
 */
export function parseInviteParams(searchString = '') {
  try {
    const raw = typeof searchString === 'string' ? searchString : '';
    const params = new URLSearchParams(raw.startsWith('?') ? raw : `?${raw}`);
    const refRaw = (params.get('ref') || '').trim().slice(0, 32);
    const spawnRaw = (params.get('spawn') || '').trim().toLowerCase();
    return {
      inviterName: refRaw,
      spawnMode: spawnRaw === 'cafe' ? 'cafe' : '',
      hasInvite: refRaw.length >= 1,
    };
  } catch {
    return { inviterName: '', spawnMode: '', hasInvite: false };
  }
}

/**
 * Builds a clean shareable invite URL embedding ?ref=<BuilderName>&spawn=cafe.
 */
export function buildInviteUrl(origin, pathname = '/', builderName = 'زائر الجزيرة', spawn = 'cafe') {
  const cleanOrigin = typeof origin === 'string' && origin ? origin.replace(/\/$/, '') : '';
  const cleanPath = typeof pathname === 'string' && pathname.startsWith('/') ? pathname : '/';
  const safeName = (typeof builderName === 'string' ? builderName.trim() : '') || 'زائر الجزيرة';
  const params = new URLSearchParams();
  params.set('ref', safeName.slice(0, 32));
  params.set('spawn', spawn === 'cafe' ? 'cafe' : 'cafe');
  return `${cleanOrigin}${cleanPath}?${params.toString()}`;
}
