/**
 * Character presets (6 rich archetypes), multi-part color swatch palettes
 * (Skin, Outfit, Hair & Hat), and pure third-person walk/jump physics helpers.
 */

export const CHARACTER_PRESETS = [
  {
    id: 'explorer',
    nameAr: 'المستكشف',
    subtitleAr: 'قبعة عريضة وحقيبة ظهر جلدية',
    headgear: 'adventurer_hat',
    accessory: 'backpack',
    rolledSleeves: false,
    skinColor: '#F0C7A5',
    outfitColor: '#8B5A2B',
    pantsColor: '#B8A27A',
    hairHatColor: '#5D4037',
    accentColor: '#D6A15C',
    shoeColor: '#3E2C23',
    eyeColor: '#2E2620',
  },
  {
    id: 'architect',
    nameAr: 'المعماري',
    subtitleAr: 'خوذة عمل، دنيم، وحزام أدوات',
    headgear: 'hard_hat',
    accessory: 'tool_belt',
    rolledSleeves: false,
    skinColor: '#EBC09D',
    outfitColor: '#3B628C',
    pantsColor: '#2F4866',
    hairHatColor: '#D99B26',
    accentColor: '#7B5233',
    shoeColor: '#2B2B2E',
    eyeColor: '#232B35',
  },
  {
    id: 'voxelbot',
    nameAr: 'الروبوت اللطيف',
    subtitleAr: 'شاشة وجه وهوائي معدني',
    headgear: 'antenna',
    accessory: 'chest_panel',
    rolledSleeves: false,
    skinColor: '#DCE3E8',
    outfitColor: '#5C6B78',
    pantsColor: '#45525E',
    hairHatColor: '#37474F',
    accentColor: '#E29E4B',
    shoeColor: '#2F3942',
    eyeColor: '#2E6F7E',
  },
  {
    id: 'barista',
    nameAr: 'الباريستا',
    subtitleAr: 'قبعة مسطحة ومريلة مقهى دافئة',
    headgear: 'flat_cap',
    accessory: 'apron',
    rolledSleeves: true,
    skinColor: '#E4B591',
    outfitColor: '#F0E6D8',
    pantsColor: '#3F3631',
    hairHatColor: '#5C3A21',
    accentColor: '#8D5836',
    shoeColor: '#2C221E',
    eyeColor: '#2B1F19',
  },
  {
    id: 'botanist',
    nameAr: 'المزارع',
    subtitleAr: 'قبعة قش شمسية وحقيبة نباتات',
    headgear: 'straw_hat',
    accessory: 'satchel',
    rolledSleeves: true,
    skinColor: '#DDA982',
    outfitColor: '#4B7856',
    pantsColor: '#7B674E',
    hairHatColor: '#D7B36A',
    accentColor: '#9E5A3E',
    shoeColor: '#4A3628',
    eyeColor: '#2B3325',
  },
  {
    id: 'nomad',
    nameAr: 'الرحالة',
    subtitleAr: 'غطاء رأس دافئ ووشاح صحراوي',
    headgear: 'hood',
    accessory: 'scarf',
    rolledSleeves: false,
    skinColor: '#C99068',
    outfitColor: '#9E4F3D',
    pantsColor: '#594A3E',
    hairHatColor: '#C99B6B',
    accentColor: '#E0C7A3',
    shoeColor: '#3B2F28',
    eyeColor: '#261D17',
  },
];

export const SKIN_COLOR_SWATCHES = [
  { hex: '#F3CFB3', label: 'فاتح دافئ' },
  { hex: '#E8B894', label: 'حنطي فاتح' },
  { hex: '#D69E73', label: 'قمحي دافئ' },
  { hex: '#B47952', label: 'أسمر متوسط' },
  { hex: '#7D4E35', label: 'داكن دافئ' },
  { hex: '#DCE3E8', label: 'معدني فاتح' },
];

export const OUTFIT_COLOR_SWATCHES = [
  { hex: '#8B5A2B', label: 'بني دافئ' },
  { hex: '#3B628C', label: 'أزرق دنيم' },
  { hex: '#9E4F3D', label: 'طوبي طبيعي' },
  { hex: '#4B7856', label: 'أخضر غابات' },
  { hex: '#5C6B78', label: 'رمادي صخري' },
  { hex: '#F0E6D8', label: 'عاجي كتان' },
];

export const HAIR_HAT_COLOR_SWATCHES = [
  { hex: '#5D4037', label: 'كستنائي' },
  { hex: '#D99B26', label: 'خردلي' },
  { hex: '#37474F', label: 'فحمي داكن' },
  { hex: '#D7B36A', label: 'قش ذهبي' },
  { hex: '#7D3C32', label: 'نحاسي' },
  { hex: '#EAE4DA', label: 'عاجي' },
];

export function getCharacterPresetById(presetId) {
  return CHARACTER_PRESETS.find((p) => p.id === presetId) || CHARACTER_PRESETS[0];
}

export function normalizeHex(hex, fallback) {
  if (typeof hex !== 'string') return fallback;
  const clean = hex.trim().toUpperCase();
  if (/^#[0-9A-F]{6}$/.test(clean)) return clean;
  return fallback;
}

export function normalizeCharacterConfig(raw) {
  const preset = getCharacterPresetById(raw?.presetId);
  return {
    presetId: preset.id,
    skinColor: normalizeHex(raw?.skinColor, preset.skinColor),
    outfitColor: normalizeHex(raw?.outfitColor, preset.outfitColor),
    hairHatColor: normalizeHex(raw?.hairHatColor, preset.hairHatColor),
  };
}

/**
 * Computes normalized horizontal movement vector on XZ plane relative to camera yaw.
 * Three.js camera forward vector at yaw is (-sin(yaw), -cos(yaw)); right is (cos(yaw), -sin(yaw)).
 */
export function computeCameraRelativeDirection(forwardInput, strafeInput, cameraYaw) {
  const sinY = Math.sin(cameraYaw);
  const cosY = Math.cos(cameraYaw);
  let dirX = -sinY * forwardInput + cosY * strafeInput;
  let dirZ = -cosY * forwardInput - sinY * strafeInput;
  const len = Math.hypot(dirX, dirZ);
  if (len > 1e-4) {
    dirX /= len;
    dirZ /= len;
  } else {
    dirX = 0;
    dirZ = 0;
  }
  return { dirX, dirZ, isMoving: len > 1e-4 };
}

/**
 * Steps vertical jump + gravity physics and snaps cleanly to terrainHeight (no floating or sinking).
 */
export function stepVerticalJumpPhysics({
  y = 0,
  vy = 0,
  jumpRequested = false,
  terrainHeight = 0,
  delta = 1 / 60,
  gravity = 26,
  jumpImpulse = 9.2,
}) {
  const dt = Math.max(0, Math.min(0.1, Number(delta) || 0));
  const groundedBefore = y <= terrainHeight + 0.001 && vy <= 0.001;
  let nextVy = vy;
  let jumped = false;

  if (jumpRequested && groundedBefore) {
    nextVy = jumpImpulse;
    jumped = true;
  }

  nextVy -= gravity * dt;
  let nextY = y + nextVy * dt;
  let isGrounded = false;

  if (nextY <= terrainHeight) {
    nextY = terrainHeight;
    nextVy = 0;
    isGrounded = true;
  }

  return {
    y: nextY,
    vy: nextVy,
    isGrounded,
    jumped,
  };
}

/**
 * Computes shortest-path angular interpolation on [-PI, PI].
 */
export function lerpAngleRadians(current, target, alpha) {
  let diff = ((target - current + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return current + diff * Math.max(0, Math.min(1, alpha));
}
