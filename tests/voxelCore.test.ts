import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeVoxelArray,
  extractJsonArrayFromText,
  checkPlotAvailability,
  calculateIslandStats,
  validateImportedIslandPayload,
  findFreeBuildPlot,
  findWalkSpawnPoint,
  resolveWalkMovement,
  pruneFloatingVoxels,
  validateExplorerLoginInput,
  computeSpatialAttenuation,
  parseInviteParams,
  buildInviteUrl,
} from '../public/js/voxelCore.js';
import {
  CAFE_SEATS,
  isInsideCafeProtectedZone,
  findNearestCafeSeat,
  isBlockedByCafe,
  buildCentralCafeData,
} from '../public/js/cafeLayout.js';
import { generateDemoBuilding, getSeededBuildings } from '../public/js/demoBlueprints.js';

test('sanitizeVoxelArray clamps coordinates, grounds at y=0, deduplicates, and caps at 300', () => {
  const input = [
    { x: 10, y: 2, z: -12, c: '#abc' },
    { x: 10, y: 2, z: -12, c: '#8B5A2B' },
    { x: 0, y: 20, z: 0, c: 'invalid' },
  ];
  const out = sanitizeVoxelArray(input);
  assert.equal(out.length, 2);
  assert.equal(out[0].x, 5);
  assert.equal(out[0].z, -5);
  assert.equal(out[0].y, 0);
  assert.equal(out[0].c, '#8B5A2B');
  assert.equal(out[1].y, 12);
  assert.match(out[1].c, /^#[0-9A-F]{6}$/);
});

test('extractJsonArrayFromText parses fenced markdown and plain JSON arrays', () => {
  const fenced = '```json\n[{"x":0,"y":0,"z":0,"c":"#A67B5B"}]\n```';
  const parsed = extractJsonArrayFromText(fenced);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].x, 0);
});

test('checkPlotAvailability enforces 260x260 flat bounds, Central Cafe protected zone, building overlap, and construction overlap', () => {
  const existing = [{ id: 'b1', gx: 20, gz: 0 }];
  const activeSites = [{ id: 's1', gx: -24, gz: -24 }];

  // Central Cafe landmark at (0,0) protects [-8..8] with 4-unit plot half -> |gx|<=12 & |gz|<=12
  assert.equal(checkPlotAvailability(0, 0, existing, activeSites).valid, false);
  assert.equal(checkPlotAvailability(9, 0, existing, activeSites).valid, false);
  assert.equal(checkPlotAvailability(14, 0, existing, activeSites).valid, false); // overlaps b1 at gx=20 (dist 6 <= 8)
  assert.equal(checkPlotAvailability(30, 0, existing, activeSites).valid, true);
  assert.equal(checkPlotAvailability(70, -50, existing, activeSites).valid, true);
  assert.equal(checkPlotAvailability(120, -120, existing, activeSites).valid, true);
  assert.equal(checkPlotAvailability(-24, -24, existing, activeSites).valid, false);
  assert.equal(checkPlotAvailability(126, 0, existing, activeSites).valid, false);
});

test('calculateIslandStats computes buildings, voxels, likes, and bounded vitality', () => {
  const seeded = getSeededBuildings();
  const stats = calculateIslandStats(seeded);
  assert.equal(stats.buildingCount, 3);
  assert.ok(stats.totalVoxels > 100);
  assert.ok(stats.vitalityPercent > 18 && stats.vitalityPercent <= 100);
});

test('generateDemoBuilding produces grounded valid voxel blueprints <= 300 voxels', () => {
  for (const prompt of ['منارة بحرية', 'بيت خشبي ريفي', 'شجرة كرز', 'طاحونة هواء', 'معبد أثري']) {
    const voxels = generateDemoBuilding(prompt);
    assert.ok(voxels.length > 20 && voxels.length <= 300);
    assert.equal(
      voxels.some((v) => v.y === 0),
      true
    );
  }
});

test('validateImportedIslandPayload normalizes valid exported island payloads', () => {
  const seeded = getSeededBuildings();
  const validated = validateImportedIslandPayload({ buildings: seeded });
  assert.equal(validated.length, 3);
  assert.equal(validated[0].prompt, seeded[0].prompt);
});

test('findFreeBuildPlot finds a valid open 9x9 plot on seeded island', () => {
  const seeded = getSeededBuildings();
  const plot = findFreeBuildPlot(seeded, []);
  assert.ok(plot !== null);
  assert.equal(checkPlotAvailability(plot.gx, plot.gz, seeded, []).valid, true);
});

test('Third-Person Walk spawn, full 260x260 flat exploration, boundary clamping, and collision work accurately', () => {
  const seeded = getSeededBuildings();
  const spawn = findWalkSpawnPoint(seeded);
  assert.ok(Math.abs(spawn.x) <= 129);
  assert.ok(Math.abs(spawn.z) <= 129);
  // Forward vector (-sin(yaw), -cos(yaw)) must point inward toward island center (-spawn.x, -spawn.z)
  const dotToCenter = -Math.sin(spawn.yaw) * -spawn.x + -Math.cos(spawn.yaw) * -spawn.z;
  assert.ok(dotToCenter > 0);

  // Unobstructed flat walking works across the full 260x260 island
  const farWalk = resolveWalkMovement(24, 34, 26, 36, seeded);
  assert.equal(farWalk.x, 26);
  assert.equal(farWalk.z, 36);

  // Boundary clamping prevents walking off the outer island cliff into the void
  const edge = resolveWalkMovement(127, 0, 145, 0, seeded);
  assert.ok(edge.x <= 129);

  // Solid collision prevents walking through a solid wall along Z while allowing sliding along X
  const solidWall = [
    {
      id: 'wall',
      gx: 24,
      gz: 24,
      voxels: [
        { x: 0, y: 0, z: 0, c: '#8B5A2B' },
        { x: 1, y: 0, z: 0, c: '#8B5A2B' },
        { x: 2, y: 0, z: 0, c: '#8B5A2B' },
      ],
    },
  ];
  const blocked = resolveWalkMovement(24, 26, 24, 24.2, solidWall);
  assert.equal(blocked.z, 26); // blocked from entering solid voxel at (24,24)

  // Sliding along X still succeeds when Z is blocked against the wall
  const slid = resolveWalkMovement(24, 25.2, 25.5, 24.2, solidWall);
  assert.equal(slid.x, 25.5);
  assert.equal(slid.z, 25.2);
});

test('resolveServerModelId maps aliases and defaults to gemini-4-hydrogen', async () => {
  const { resolveServerModelId } = await import('../src/server/voxelGemini.ts');
  assert.equal(resolveServerModelId(''), 'gemini-4-hydrogen');
  assert.equal(resolveServerModelId(undefined), 'gemini-4-hydrogen');
  assert.equal(resolveServerModelId('hydrogen'), 'gemini-4-hydrogen');
  assert.equal(resolveServerModelId('lite'), 'gemini-3.1-flash-lite');
  assert.equal(resolveServerModelId('gemini-2.5-flash'), 'gemini-2.5-flash');
});

test('pruneFloatingVoxels keeps grounded connected blocks and strips floating blocks', () => {
  const mixed = [
    { x: 0, y: 0, z: 0, c: '#6D4C41' },
    { x: 0, y: 1, z: 0, c: '#6D4C41' },
    { x: 1, y: 2, z: 0, c: '#4CAF50' }, // diagonal edge-connected leaf
    { x: 4, y: 6, z: 4, c: '#FF00FF' }, // disconnected floating stray block
  ];
  const pruned = pruneFloatingVoxels(mixed);
  assert.equal(pruned.length, 3);
  assert.equal(
    pruned.some((v) => v.x === 4 && v.y === 6),
    false
  );
});

test('extractJsonArrayFromText recovers complete voxel objects from truncated JSON array', () => {
  const truncated =
    '[{"x":0,"y":0,"z":0,"c":"#6D4C41"},{"x":0,"y":1,"z":0,"c":"#4CAF50"},{"x":1,"y":1';
  const recovered = extractJsonArrayFromText(truncated);
  assert.equal(recovered.length, 2);
  assert.equal(recovered[1].c, '#4CAF50');
});

test('sanitizeVoxelArray recenters off-center positive-octant structures around origin', () => {
  const shifted = [];
  for (let x = 2; x <= 8; x++) {
    for (let z = 2; z <= 4; z++) {
      shifted.push({ x, y: 0, z, c: '#6D4C41' });
    }
  }
  const out = sanitizeVoxelArray(shifted);
  assert.equal(out.length, shifted.length); // Zero voxels lost to edge clamping
  const xs = out.map((v) => v.x);
  assert.ok(Math.min(...xs) >= -5 && Math.max(...xs) <= 5);
  assert.ok(Math.min(...xs) < 0);
});

test('characterCatalog exposes 6 distinct presets including barista & botanist and validates skin/outfit/hairHat colors', async () => {
  const {
    CHARACTER_PRESETS,
    SKIN_COLOR_SWATCHES,
    normalizeCharacterConfig,
    getCharacterPresetById,
  } = await import('../public/js/characterCatalog.js');
  assert.equal(CHARACTER_PRESETS.length, 6);
  assert.ok(SKIN_COLOR_SWATCHES.length >= 4);
  const ids = CHARACTER_PRESETS.map((p) => p.id);
  assert.deepEqual(ids, ['explorer', 'architect', 'voxelbot', 'barista', 'botanist', 'nomad']);

  const bot = getCharacterPresetById('voxelbot');
  const norm = normalizeCharacterConfig({
    presetId: 'voxelbot',
    skinColor: '#d9a173',
    outfitColor: '#4b7856',
    hairHatColor: 'invalid-color',
  });
  assert.equal(norm.presetId, 'voxelbot');
  assert.equal(norm.skinColor, '#D9A173');
  assert.equal(norm.outfitColor, '#4B7856');
  assert.equal(norm.hairHatColor, bot.hairHatColor);
});

test('Third-Person camera-relative movement and Spacebar jump/gravity ground snapping work accurately', async () => {
  const {
    computeCameraRelativeDirection,
    stepVerticalJumpPhysics,
  } = await import('../public/js/characterCatalog.js');

  // Camera facing -Z (yaw = 0): forward moves toward -Z, right strafes toward +X
  const fwd = computeCameraRelativeDirection(1, 0, 0);
  assert.equal(fwd.isMoving, true);
  assert.ok(Math.abs(fwd.dirX) < 1e-6 && fwd.dirZ < -0.99);

  const right = computeCameraRelativeDirection(0, 1, 0);
  assert.ok(right.dirX > 0.99 && Math.abs(right.dirZ) < 1e-6);

  // Camera rotated 90 deg left (yaw = PI/2): forward vector is (-1, 0)
  const rotated = computeCameraRelativeDirection(1, 0, Math.PI / 2);
  assert.ok(rotated.dirX < -0.99 && Math.abs(rotated.dirZ) < 1e-6);

  // Jump from grounded state launches upward, then gravity snaps back cleanly to terrainHeight=0
  const jump = stepVerticalJumpPhysics({ y: 0, vy: 0, jumpRequested: true, terrainHeight: 0, delta: 0.016 });
  assert.equal(jump.jumped, true);
  assert.equal(jump.isGrounded, false);
  assert.ok(jump.y > 0 && jump.vy > 0);

  // Mid-air Spacebar press does not double-jump
  const midAir = stepVerticalJumpPhysics({ y: jump.y, vy: jump.vy, jumpRequested: true, terrainHeight: 0, delta: 0.016 });
  assert.equal(midAir.jumped, false);

  // Simulate falling until grounded
  let state = { y: midAir.y, vy: midAir.vy, isGrounded: false };
  for (let i = 0; i < 120; i++) {
    state = stepVerticalJumpPhysics({ y: state.y, vy: state.vy, jumpRequested: false, terrainHeight: 0, delta: 0.016 });
  }
  assert.equal(state.y, 0);
  assert.equal(state.vy, 0);
  assert.equal(state.isGrounded, true);
});

test('260x260 flat open island has uniform y=0 surface, zero obstacles/rivers/hills, and 32x32 chunks', async () => {
  const {
    WORLD_SIZE,
    sampleTerrainColumn,
    sampleTerrainHeightAt,
    buildOpenWorldChunks,
  } = await import('../public/js/worldTerrain.js');

  assert.equal(WORLD_SIZE, 260);

  // Entire 260x260 area is uniformly flat at y=0 with no water or hills
  for (let x = -129; x <= 129; x += 9) {
    for (let z = -129; z <= 129; z += 9) {
      const col = sampleTerrainColumn(x, z);
      assert.equal(col.exists, true);
      assert.equal(col.topY, 0);
      assert.equal(col.isWater, false);
      assert.equal(col.isBridge, false);
      assert.equal(sampleTerrainHeightAt(x, z), 0);
      assert.ok(col.bottomY <= -2);
    }
  }

  // Outside [-130, 129] is off-island void
  assert.equal(sampleTerrainColumn(130, 0).exists, false);
  assert.equal(sampleTerrainColumn(-131, 0).exists, false);

  // Chunked flat world builds 81 spatial 32x32 chunks with zero trees/rocks/bushes/lanterns
  const world = buildOpenWorldChunks();
  assert.equal(world.chunks.length, 81);
  assert.equal(world.ambientBlocks.length, 0);
  assert.equal(world.lanternSpots.length, 0);
});

test('validateExplorerLoginInput validates builder name, optional email/passcode, and preserves authorName', () => {
  assert.equal(validateExplorerLoginInput('', '').valid, false);
  assert.equal(validateExplorerLoginInput('أ', '').valid, false);
  assert.equal(validateExplorerLoginInput('أحمد المعماري', '').valid, true);
  assert.equal(validateExplorerLoginInput('أحمد المعماري', 'bad-email@').valid, false);
  assert.equal(validateExplorerLoginInput('أحمد المعماري', 'ahmed@voxel.world').valid, true);
  assert.equal(validateExplorerLoginInput('أحمد المعماري', '12').valid, false);
  assert.equal(validateExplorerLoginInput('أحمد المعماري', '1234').valid, true);

  const imported = validateImportedIslandPayload([
    {
      id: 'b_author',
      prompt: 'برج',
      authorName: 'سارة المعمارية',
      gx: 0,
      gz: 0,
      voxels: [{ x: 0, y: 0, z: 0, c: '#8B5A2B' }],
    },
  ]);
  assert.equal(imported[0].authorName, 'سارة المعمارية');
});

test('Central Voxel Cafe protects (0,0), provides 12 interactive seats, open doorway, and solid walls', () => {
  assert.equal(isInsideCafeProtectedZone(0, 0, 4), true);
  assert.equal(isInsideCafeProtectedZone(12, 12, 4), true);
  assert.equal(isInsideCafeProtectedZone(13, 0, 4), false);

  const cafeData = buildCentralCafeData();
  assert.ok(cafeData.blocks.length > 200);
  assert.ok(cafeData.lanterns.length >= 4);
  assert.equal(CAFE_SEATS.length, 12);

  // Near western patio chair (-4.5, 6.1) detects seat prompt within 2.25 voxels
  const nearChair = findNearestCafeSeat(-4.2, 6.8, 2.25);
  assert.ok(nearChair !== null);
  assert.equal(nearChair.seat.id, 'seat_patio_w1');

  // Far away on island returns null
  assert.equal(findNearestCafeSeat(30, 30, 2.25), null);

  // Front doorway at (0, 2) is open, while back wall at (0, -7) blocks movement
  assert.equal(isBlockedByCafe(0, 2.0, 0.5, 0), false);
  assert.equal(isBlockedByCafe(0, -7.0, 0.5, 0), true);
});

test('computeSpatialAttenuation provides crystal-clear <=15v, smooth fade 15..45v, and silence >=45v', () => {
  assert.equal(computeSpatialAttenuation(0), 1);
  assert.equal(computeSpatialAttenuation(10), 1);
  assert.equal(computeSpatialAttenuation(15), 1);
  assert.ok(Math.abs(computeSpatialAttenuation(30) - 0.5) < 1e-6);
  assert.equal(computeSpatialAttenuation(45), 0);
  assert.equal(computeSpatialAttenuation(100), 0);
});

test('parseInviteParams and buildInviteUrl round-trip inviter name and Cafe spawn mode', () => {
  const url = buildInviteUrl('http://localhost:3000', '/', 'أحمد المعماري', 'cafe');
  const parsedUrl = new URL(url);
  const info = parseInviteParams(parsedUrl.search);
  assert.equal(info.hasInvite, true);
  assert.equal(info.inviterName, 'أحمد المعماري');
  assert.equal(info.spawnMode, 'cafe');

  const emptyInfo = parseInviteParams('');
  assert.equal(emptyInfo.hasInvite, false);
  assert.equal(emptyInfo.inviterName, '');
});
