/**
 * Pure data, collision bounds, seating definitions, and blueprint builder
 * for the Permanent Central Voxel Cafe Landmark at (0, 0) on the 260x260 flat island.
 * Zero Three.js dependencies so Node tests and domain modules can import cleanly.
 */

export const CAFE_CENTER = { x: 0, z: 0 };
export const CAFE_PROTECTED_HALF = 8; // Covers [-8..8] x [-8..8] (17x17 landmark)

/**
 * Interactive seats inside the Cafe hall, at the espresso bar, and on the outdoor patio.
 * Character smoothly seats on (x, seatY, z) facing yaw (Three.js forward is -Z at yaw=0).
 */
export const CAFE_SEATS = [
  {
    id: 'seat_patio_w1',
    labelAr: 'طاولة الشرفة الغربية',
    x: -4.5,
    z: 6.1,
    seatY: 0.56,
    yaw: 0,
    dismountX: -4.5,
    dismountZ: 7.4,
    kind: 'chair',
  },
  {
    id: 'seat_patio_w2',
    labelAr: 'طاولة الشرفة الغربية',
    x: -4.5,
    z: 3.9,
    seatY: 0.56,
    yaw: Math.PI,
    dismountX: -3.2,
    dismountZ: 3.9,
    kind: 'chair',
  },
  {
    id: 'seat_patio_e1',
    labelAr: 'طاولة الشرفة الشرقية',
    x: 4.5,
    z: 6.1,
    seatY: 0.56,
    yaw: 0,
    dismountX: 4.5,
    dismountZ: 7.4,
    kind: 'chair',
  },
  {
    id: 'seat_patio_e2',
    labelAr: 'طاولة الشرفة الشرقية',
    x: 4.5,
    z: 3.9,
    seatY: 0.56,
    yaw: Math.PI,
    dismountX: 3.2,
    dismountZ: 3.9,
    kind: 'chair',
  },
  {
    id: 'seat_in_w1',
    labelAr: 'طاولة النافذة الغربية',
    x: -4.2,
    z: 0.3,
    seatY: 0.56,
    yaw: 0,
    dismountX: -2.9,
    dismountZ: 0.3,
    kind: 'chair',
  },
  {
    id: 'seat_in_w2',
    labelAr: 'طاولة النافذة الغربية',
    x: -4.2,
    z: -1.9,
    seatY: 0.56,
    yaw: Math.PI,
    dismountX: -2.9,
    dismountZ: -1.9,
    kind: 'chair',
  },
  {
    id: 'seat_in_e1',
    labelAr: 'طاولة النافذة الشرقية',
    x: 4.2,
    z: 0.3,
    seatY: 0.56,
    yaw: 0,
    dismountX: 2.9,
    dismountZ: 0.3,
    kind: 'chair',
  },
  {
    id: 'seat_in_e2',
    labelAr: 'طاولة النافذة الشرقية',
    x: 4.2,
    z: -1.9,
    seatY: 0.56,
    yaw: Math.PI,
    dismountX: 2.9,
    dismountZ: -1.9,
    kind: 'chair',
  },
  {
    id: 'seat_bar_1',
    labelAr: 'مقعد بار الإسبريسو',
    x: -1.4,
    z: -3.2,
    seatY: 0.68,
    yaw: 0,
    dismountX: -1.4,
    dismountZ: -1.9,
    kind: 'stool',
  },
  {
    id: 'seat_bar_2',
    labelAr: 'مقعد بار الإسبريسو',
    x: 1.4,
    z: -3.2,
    seatY: 0.68,
    yaw: 0,
    dismountX: 1.4,
    dismountZ: -1.9,
    kind: 'stool',
  },
  {
    id: 'seat_bench_w',
    labelAr: 'مقعد الساحة الأمامية',
    x: -2.6,
    z: 7.45,
    seatY: 0.52,
    yaw: Math.PI,
    dismountX: -2.6,
    dismountZ: 8.6,
    kind: 'bench',
  },
  {
    id: 'seat_bench_e',
    labelAr: 'مقعد الساحة الأمامية',
    x: 2.6,
    z: 7.45,
    seatY: 0.52,
    yaw: Math.PI,
    dismountX: 2.6,
    dismountZ: 8.6,
    kind: 'bench',
  },
];

/**
 * Returns true if a 9x9 (or custom half-size) build plot centered at (gx, gz) overlaps
 * the protected Central Voxel Cafe plaza at (0, 0).
 */
export function isInsideCafeProtectedZone(gx, gz, plotHalfSize = 4) {
  const reach = CAFE_PROTECTED_HALF + plotHalfSize;
  return Math.abs(Math.round(gx)) <= reach && Math.abs(Math.round(gz)) <= reach;
}

/**
 * Returns the closest Cafe seat within maxDist of (px, pz), or null if none.
 */
export function findNearestCafeSeat(px, pz, maxDist = 2.25) {
  let best = null;
  let bestDist = maxDist;
  for (const seat of CAFE_SEATS) {
    const d = Math.hypot(px - seat.x, pz - seat.z);
    if (d <= bestDist) {
      bestDist = d;
      best = seat;
    }
  }
  return best ? { seat: best, distance: bestDist } : null;
}

/**
 * Solid AABB colliders (minX, maxX, minZ, maxZ) for the Cafe walls, pillars, espresso bar, and table pedestals.
 */
export const CAFE_SOLID_OBSTACLES = [
  { minX: -7.45, maxX: 7.45, minZ: -7.45, maxZ: -6.55 },
  { minX: -7.45, maxX: -6.55, minZ: -7.45, maxZ: 2.45 },
  { minX: 6.55, maxX: 7.45, minZ: -7.45, maxZ: 2.45 },
  { minX: -7.45, maxX: -2.1, minZ: 1.55, maxZ: 2.45 },
  { minX: 2.1, maxX: 7.45, minZ: 1.55, maxZ: 2.45 },
  { minX: -7.4, maxX: -6.6, minZ: 6.6, maxZ: 7.4 },
  { minX: 6.6, maxX: 7.4, minZ: 6.6, maxZ: 7.4 },
  { minX: -3.2, maxX: 3.2, minZ: -5.3, maxZ: -4.15 },
  { minX: -4.85, maxX: -3.55, minZ: -1.25, maxZ: -0.35 },
  { minX: 3.55, maxX: 4.85, minZ: -1.25, maxZ: -0.35 },
  { minX: -5.05, maxX: -3.95, minZ: 4.55, maxZ: 5.45 },
  { minX: 3.95, maxX: 5.05, minZ: 4.55, maxZ: 5.45 },
];

export function isBlockedByCafe(px, pz, playerRadius = 0.65, currentY = 0) {
  if (currentY > 3.6) return false;
  if (Math.abs(px) > 9 || Math.abs(pz) > 9) return false;
  for (let i = 0; i < CAFE_SOLID_OBSTACLES.length; i++) {
    const box = CAFE_SOLID_OBSTACLES[i];
    if (
      px >= box.minX - playerRadius &&
      px <= box.maxX + playerRadius &&
      pz >= box.minZ - playerRadius &&
      pz <= box.maxZ + playerRadius
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Builds all voxel blocks and lantern points defining the Central Voxel Cafe landmark.
 */
export function buildCentralCafeData() {
  const blocks = [];
  const seen = new Map();
  const addBlock = (x, y, z, color) => {
    const key = `${x},${y.toFixed(2)},${z}`;
    seen.set(key, { x, y, z, color });
  };

  const PAL = {
    stoneEdge: 0xb5a693,
    stoneStep: 0xc5b7a4,
    oakFloor: 0x9b6e44,
    oakFloorAlt: 0x8d613a,
    patioTile: 0xd3c2ab,
    patioTileAlt: 0xc4b097,
    timber: 0x5c3a21,
    timberLight: 0x7a4f2f,
    creamWall: 0xefe5d4,
    terracottaWall: 0xa8563f,
    roofMain: 0xb2543a,
    roofRidge: 0x8e402c,
    awningCream: 0xf4ecde,
    awningTerra: 0xb8583e,
    counterMarble: 0xf3ede2,
    brass: 0xcf9446,
    espressoBody: 0x423a35,
    coffeeBean: 0x4f3222,
    greenery: 0x5f8551,
  };

  for (let x = -8; x <= 8; x++) {
    for (let z = -8; z <= 8; z++) {
      const isBorder = Math.abs(x) === 8 || Math.abs(z) === 8;
      if (isBorder) {
        addBlock(x, -0.44, z, (x + z) % 2 === 0 ? PAL.stoneEdge : PAL.stoneStep);
      } else if (z <= 2) {
        addBlock(x, -0.43, z, (x + z) % 2 === 0 ? PAL.oakFloor : PAL.oakFloorAlt);
      } else {
        addBlock(x, -0.43, z, (x + z) % 2 === 0 ? PAL.patioTile : PAL.patioTileAlt);
      }
    }
  }

  for (let z = 3; z <= 8; z++) {
    for (let x = -1; x <= 1; x++) {
      addBlock(x, -0.42, z, x === 0 ? PAL.stoneStep : PAL.stoneEdge);
    }
  }

  for (let y = 1; y <= 5; y++) {
    for (let x = -7; x <= 7; x++) {
      for (let z = -7; z <= 2; z++) {
        const isOnPerim = x === -7 || x === 7 || z === -7 || z === 2;
        if (!isOnPerim) continue;
        if (z === 2 && Math.abs(x) <= 1 && y <= 4) continue;

        const isCornerPost =
          ((x === -7 || x === 7) && (z === -7 || z === 2)) ||
          (z === 2 && Math.abs(x) === 2) ||
          (z === -7 && Math.abs(x) === 3);

        if (isCornerPost) {
          addBlock(x, y - 0.5, z, PAL.timber);
          continue;
        }

        const isSideWindow = (x === -7 || x === 7) && z >= -5 && z <= 0 && y >= 2 && y <= 4;
        const isFrontWindow = z === 2 && Math.abs(x) >= 3 && Math.abs(x) <= 6 && y >= 2 && y <= 4;
        const isBackWindow = z === -7 && Math.abs(x) >= 4 && Math.abs(x) <= 6 && y >= 2 && y <= 4;

        if (isSideWindow || isFrontWindow || isBackWindow) {
          continue;
        }

        if (y === 1) {
          addBlock(x, y - 0.5, z, PAL.terracottaWall);
        } else if (y === 5) {
          addBlock(x, y - 0.5, z, PAL.timberLight);
        } else {
          addBlock(x, y - 0.5, z, PAL.creamWall);
        }
      }
    }
  }

  for (let step = 0; step <= 2; step++) {
    const ry = 6 + step;
    const xSpan = 8 - step;
    const zMin = -8 + step;
    const zMax = 3 - step;
    for (let x = -xSpan; x <= xSpan; x++) {
      for (let z = zMin; z <= zMax; z++) {
        if (step < 2 && Math.abs(x) < xSpan && z > zMin && z < zMax) continue;
        addBlock(x, ry - 0.5, z, step === 2 ? PAL.roofRidge : PAL.roofMain);
      }
    }
  }

  for (let x = -2; x <= 2; x++) {
    addBlock(x, 5.5, 3, PAL.timber);
    if (Math.abs(x) <= 1) {
      addBlock(x, 6.5, 3, PAL.brass);
    }
  }

  for (let x = -7; x <= 7; x++) {
    const c = Math.abs(x) % 2 === 0 ? PAL.awningTerra : PAL.awningCream;
    addBlock(x, 4.35, 3, c);
    addBlock(x, 4.15, 4, c);
  }

  for (const px of [-7, 7]) {
    for (let y = 1; y <= 4; y++) {
      addBlock(px, y - 0.5, 7, PAL.timber);
    }
    addBlock(px, 0.5, 6, PAL.terracottaWall);
    addBlock(px, 1.35, 6, PAL.greenery);
  }
  for (let x = -7; x <= 7; x++) {
    addBlock(x, 4.4, 7, PAL.timberLight);
  }

  for (let x = -3; x <= 3; x++) {
    addBlock(x, 0.5, -5, PAL.timber);
    addBlock(x, 1.35, -5, PAL.counterMarble);
  }
  addBlock(-1, 2.25, -5, PAL.espressoBody);
  addBlock(0, 2.25, -5, PAL.brass);
  addBlock(1, 2.25, -5, PAL.coffeeBean);
  addBlock(2, 2.15, -5, PAL.patioTile);
  for (let x = -2; x <= 2; x++) {
    for (let y = 3; y <= 4; y++) {
      addBlock(x, y - 0.5, -6, 0x343837);
    }
  }

  for (const item of seen.values()) {
    blocks.push(item);
  }

  const lanterns = [
    { x: -2.2, y: 3.1, z: 2.5, intensity: 3.2 },
    { x: 2.2, y: 3.1, z: 2.5, intensity: 3.2 },
    { x: -7, y: 3.4, z: 7, intensity: 2.8 },
    { x: 7, y: 3.4, z: 7, intensity: 2.8 },
    { x: 0, y: 4.1, z: -3.5, intensity: 3.4 },
  ];

  return {
    blocks,
    lanterns,
    seats: CAFE_SEATS,
  };
}
