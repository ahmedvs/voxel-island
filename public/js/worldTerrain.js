/**
 * Deterministic 260x260 flat floating voxel island generator:
 * - Uniform, completely flat top grass surface at y = 0 across the entire 260x260 canvas
 * - Zero trees, bushes, rocks, rivers, bridges, or hills (open unobstructed build canvas)
 * - Layered dirt and tapered stone cliff edges underneath the floating island perimeter
 * - Spatial 32x32 chunks with hidden interior culling for locked 60 FPS instanced rendering
 */

export const WORLD_SIZE = 260;
export const WORLD_HALF = 130;
export const WORLD_CHUNK_SIZE = 32;
export const WATER_LEVEL = -1;

function hash2D(x, z) {
  const n = Math.sin(x * 127.1 + z * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

/**
 * Samples a single (ix, iz) integer terrain column in [-130, 129].
 * Top surface is uniformly flat at y = 0 across the entire 260x260 island.
 */
export function sampleTerrainColumn(ix, iz) {
  if (ix < -WORLD_HALF || ix >= WORLD_HALF || iz < -WORLD_HALF || iz >= WORLD_HALF) {
    return {
      exists: false,
      topY: WATER_LEVEL,
      surfaceY: WATER_LEVEL,
      isWater: true,
      isBridge: false,
      isBeach: false,
      isPath: false,
      biome: 'ocean',
      bottomY: -4,
    };
  }

  // Distance from outer edges of the 260x260 floating plateau
  const edgeDistX = Math.min(ix + WORLD_HALF, WORLD_HALF - 1 - ix);
  const edgeDistZ = Math.min(iz + WORLD_HALF, WORLD_HALF - 1 - iz);
  const minEdgeDist = Math.min(edgeDistX, edgeDistZ);

  // Tapered underside cliff depth: thinner right at the rim, deeper inward
  const dx = Math.abs(ix + 0.5) / WORLD_HALF;
  const dz = Math.abs(iz + 0.5) / WORLD_HALF;
  const radial = Math.max(dx, dz) * 0.78 + Math.hypot(dx, dz) * 0.22;
  const n = hash2D(ix, iz);
  const underDepth =
    minEdgeDist <= 1
      ? Math.max(2, Math.floor(2 + n * 2.5))
      : Math.max(2, Math.floor((1.05 - Math.min(1, radial * 0.88)) * 9 + n * 2.2));

  return {
    exists: true,
    topY: 0,
    surfaceY: 0,
    isWater: false,
    isBridge: false,
    isBeach: false,
    isPath: false,
    biome: 'plains',
    bottomY: -underDepth,
  };
}

/**
 * Fast surface Y lookup for character grounding, building placement, and walk physics.
 * Always 0 on the flat 260x260 island surface.
 */
export function sampleTerrainHeightAt(x, z) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return 0;
  const ix = Math.round(x);
  const iz = Math.round(z);
  const col = sampleTerrainColumn(ix, iz);
  return col.exists ? 0 : WATER_LEVEL;
}

/**
 * Checks whether (x, z) is inside the flat 260x260 island surface.
 */
export function isWalkableTerrainAt(x, z) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
  const ix = Math.round(x);
  const iz = Math.round(z);
  return ix >= -WORLD_HALF && ix < WORLD_HALF && iz >= -WORLD_HALF && iz < WORLD_HALF;
}

/**
 * Checks whether a 9x9 build plot centered at (gx, gz) sits inside the flat 260x260 island.
 */
export function isPlotOnDryLand(gx, gz, halfSize = 4) {
  return (
    gx - halfSize >= -WORLD_HALF &&
    gx + halfSize < WORLD_HALF &&
    gz - halfSize >= -WORLD_HALF &&
    gz + halfSize < WORLD_HALF
  );
}

/**
 * Builds chunked flat terrain block arrays (32x32 chunks) with hidden interior culling,
 * clean dirt/stone cliffs underneath the outer edges, and zero surface obstructions.
 */
export function buildOpenWorldChunks() {
  const grassPalette = [0x5d8d52, 0x67975a, 0x54814b, 0x71a061];
  const dirtPalette = [0x895c3b, 0x7b5033, 0x6e462b];
  const stonePalette = [0x5e5a54, 0x514d48, 0x6b665f];

  const chunkMap = new Map();
  const getChunk = (ix, iz) => {
    const cx = Math.floor((ix + WORLD_HALF) / WORLD_CHUNK_SIZE);
    const cz = Math.floor((iz + WORLD_HALF) / WORLD_CHUNK_SIZE);
    const key = `${cx},${cz}`;
    let list = chunkMap.get(key);
    if (!list) {
      list = [];
      chunkMap.set(key, list);
    }
    return list;
  };

  for (let ix = -WORLD_HALF; ix < WORLD_HALF; ix++) {
    for (let iz = -WORLD_HALF; iz < WORLD_HALF; iz++) {
      const chunk = getChunk(ix, iz);
      const n = hash2D(ix, iz);

      // Flat grass top block centered at y = -0.5 so top surface sits at exact y = 0
      chunk.push({
        x: ix,
        y: -0.5,
        z: iz,
        color: grassPalette[Math.floor(n * grassPalette.length)],
      });

      const edgeDistX = Math.min(ix + WORLD_HALF, WORLD_HALF - 1 - ix);
      const edgeDistZ = Math.min(iz + WORLD_HALF, WORLD_HALF - 1 - iz);
      const minEdgeDist = Math.min(edgeDistX, edgeDistZ);

      // Visible layered dirt & stone cliffs around the outer floating island edges
      if (minEdgeDist <= 3) {
        const col = sampleTerrainColumn(ix, iz);
        const cliffBottom = minEdgeDist === 0 ? col.bottomY : -3;
        for (let vy = -1; vy >= cliffBottom; vy--) {
          const depth = -vy;
          const color =
            depth <= 2
              ? dirtPalette[Math.floor(hash2D(ix + vy, iz - vy) * dirtPalette.length)]
              : stonePalette[Math.floor(hash2D(ix * 3 + vy, iz + vy) * stonePalette.length)];
          chunk.push({ x: ix, y: vy - 0.5, z: iz, color });
        }
      } else if ((Math.abs(ix) + Math.abs(iz)) % 4 === 0) {
        // Light tapered underside stone blocks for views from low camera angles
        const col = sampleTerrainColumn(ix, iz);
        if (col.bottomY <= -4) {
          chunk.push({
            x: ix,
            y: col.bottomY - 0.5,
            z: iz,
            color: stonePalette[Math.floor(n * stonePalette.length)],
          });
        }
      }
    }
  }

  // Subtle tiny wildflower/grass tufts for Island Vitality growth (strictly non-blocking)
  const floraCandidates = [];
  const flowerColors = [0xdfb562, 0xd98c84, 0xeadfce, 0x6f9f60, 0x82af6b];
  for (let i = 0; i < 240; i++) {
    const rx = Math.round((hash2D(i * 3.1, 17.3) - 0.5) * 140) - 0.5;
    const rz = Math.round((hash2D(41.7, i * 2.7) - 0.5) * 140) - 0.5;
    const ox = (hash2D(i, 99) - 0.5) * 0.45;
    const oz = (hash2D(55, i) - 0.5) * 0.45;
    const isFlower = hash2D(i, i * 2) > 0.55;
    floraCandidates.push({
      x: rx + ox,
      y: 0,
      z: rz + oz,
      scale: 0.72 + hash2D(i * 5, 3) * 0.5,
      color: isFlower ? flowerColors[i % 3] : flowerColors[3 + (i % 2)],
    });
  }

  return {
    chunks: Array.from(chunkMap.entries()).map(([key, blocks]) => ({ key, blocks })),
    ambientBlocks: [],
    floraCandidates,
    lanternSpots: [],
  };
}
