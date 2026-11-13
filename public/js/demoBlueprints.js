import { sanitizeVoxelArray } from './voxelCore.js';

/**
 * Generates rich, warm, cohesive voxel structures for Demo Mode & initial seeded island landmarks.
 */

function pushBox(list, x0, y0, z0, x1, y1, z1, color) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        list.push({ x, y, z, c: color });
      }
    }
  }
}

export function buildRusticCabin() {
  const v = [];
  // Stone foundation
  pushBox(v, -3, 0, -3, 3, 0, 3, '#736B62');
  // Timber walls (hollow-ish front & sides)
  for (let y = 1; y <= 3; y++) {
    for (let x = -3; x <= 3; x++) {
      for (let z = -3; z <= 3; z++) {
        const isEdge = Math.abs(x) === 3 || Math.abs(z) === 3;
        if (!isEdge) continue;
        // Doorway on +Z
        if (z === 3 && x === 0 && y <= 2) continue;
        // Warm glowing windows on sides
        if ((Math.abs(x) === 3 && z === 0 && y === 2) || (z === 3 && Math.abs(x) === 2 && y === 2)) {
          v.push({ x, y, z, c: '#F2C166' });
          continue;
        }
        const isCorner = Math.abs(x) === 3 && Math.abs(z) === 3;
        v.push({ x, y, z, c: isCorner ? '#6B4426' : '#9C6B3F' });
      }
    }
  }
  // Wooden door
  v.push({ x: 0, y: 1, z: 3, c: '#54351C' });
  v.push({ x: 0, y: 2, z: 3, c: '#54351C' });
  // Step & porch lantern
  v.push({ x: 0, y: 0, z: 4, c: '#8D8479' });
  v.push({ x: 1, y: 1, z: 4, c: '#4E3824' });
  v.push({ x: 1, y: 2, z: 4, c: '#F5C469' });

  // Gabled terracotta/shingle roof
  for (let step = 0; step <= 3; step++) {
    const y = 4 + step;
    const span = 4 - step;
    for (let x = -span; x <= span; x++) {
      for (let z = -4; z <= 4; z++) {
        if (step < 3 && Math.abs(x) < span && Math.abs(z) < 4) continue;
        const c = step === 3 ? '#8F4632' : (x + z) % 2 === 0 ? '#A8523A' : '#964732';
        v.push({ x, y, z, c });
      }
    }
  }
  // Stone chimney
  pushBox(v, -2, 4, -2, -2, 8, -2, '#6E665E');
  v.push({ x: -2, y: 9, z: -2, c: '#D6CFC4' });

  return sanitizeVoxelArray(v);
}

export function buildCoastalLighthouse() {
  const v = [];
  // Coastal rock base
  pushBox(v, -3, 0, -3, 3, 0, 3, '#6C6862');
  pushBox(v, -2, 1, -2, 2, 1, 2, '#7D7870');

  // Striped tower body
  for (let y = 2; y <= 9; y++) {
    const r = y >= 7 ? 1 : 2;
    const stripe = Math.floor((y - 2) / 2) % 2 === 0 ? '#E8DEC8' : '#B8543D';
    for (let x = -r; x <= r; x++) {
      for (let z = -r; z <= r; z++) {
        if (r === 2 && Math.abs(x) === 2 && Math.abs(z) === 2) continue; // chamfered corners
        if (y === 2 && z === 2 && x === 0) {
          v.push({ x, y, z, c: '#5B3A22' });
        } else {
          v.push({ x, y, z, c: stripe });
        }
      }
    }
  }
  // Observation gallery
  pushBox(v, -2, 10, -2, 2, 10, 2, '#4A433D');
  // Warm beacon room
  for (let x = -1; x <= 1; x++) {
    for (let z = -1; z <= 1; z++) {
      v.push({ x, y: 11, z, c: x === 0 && z === 0 ? '#FFE299' : '#F4C15D' });
      v.push({ x, y: 12, z, c: '#F4C15D' });
    }
  }
  // Copper cap
  pushBox(v, -1, 13, -1, 1, 13, 1, '#4C6B5C');
  v.push({ x: 0, y: 14, z: 0, c: '#D89E52' });

  return sanitizeVoxelArray(v);
}

export function buildCherryTree() {
  const v = [];
  // Mossy stone mound
  pushBox(v, -2, 0, -2, 2, 0, 2, '#5F8451');
  v.push({ x: -2, y: 0, z: 2, c: '#7E766B' });
  v.push({ x: 2, y: 0, z: -2, c: '#7E766B' });
  // Roots & curved trunk
  v.push({ x: -1, y: 1, z: 0, c: '#664329' });
  v.push({ x: 1, y: 1, z: 0, c: '#664329' });
  pushBox(v, 0, 1, 0, 0, 5, 0, '#593A22');
  v.push({ x: 1, y: 4, z: 0, c: '#664329' });
  v.push({ x: -1, y: 5, z: 1, c: '#664329' });
  v.push({ x: 0, y: 5, z: -1, c: '#664329' });

  // Blossom canopy layers (warm soft sakura & cream tones)
  const palette = ['#DF9A9E', '#E8B1B4', '#D4838A', '#F2CBCB'];
  const layers = [
    { y: 5, r: 2 },
    { y: 6, r: 3 },
    { y: 7, r: 3 },
    { y: 8, r: 2 },
    { y: 9, r: 1 },
  ];
  for (const layer of layers) {
    for (let x = -layer.r; x <= layer.r; x++) {
      for (let z = -layer.r; z <= layer.r; z++) {
        const dist = Math.abs(x) + Math.abs(z);
        if (dist > layer.r + 1) continue;
        if (layer.y === 6 && x === 0 && z === 0) continue;
        const c = palette[Math.abs(x * 3 + layer.y * 5 + z * 7) % palette.length];
        v.push({ x, y: layer.y, z, c });
      }
    }
  }
  // Fallen petals on ground
  v.push({ x: -2, y: 0, z: -1, c: '#E8B1B4' });
  v.push({ x: 2, y: 0, z: 1, c: '#DF9A9E' });
  v.push({ x: 1, y: 0, z: -2, c: '#F2CBCB' });

  return sanitizeVoxelArray(v);
}

export function buildWindmill() {
  const v = [];
  // Stone base
  pushBox(v, -2, 0, -2, 2, 2, 2, '#7D766D');
  // Timber upper tower
  pushBox(v, -2, 3, -2, 2, 6, 2, '#D9CCB8');
  // Corner timber framing
  for (let y = 3; y <= 6; y++) {
    v.push({ x: -2, y, z: -2, c: '#7B5232' });
    v.push({ x: 2, y, z: -2, c: '#7B5232' });
    v.push({ x: -2, y, z: 2, c: '#7B5232' });
    v.push({ x: 2, y, z: 2, c: '#7B5232' });
  }
  // Door & warm window
  v.push({ x: 0, y: 1, z: 2, c: '#54351C' });
  v.push({ x: 0, y: 2, z: 2, c: '#54351C' });
  v.push({ x: 0, y: 5, z: 2, c: '#F4C15D' });

  // Conical roof
  pushBox(v, -2, 7, -2, 2, 7, 2, '#994B38');
  pushBox(v, -1, 8, -1, 1, 8, 1, '#A6543F');
  v.push({ x: 0, y: 9, z: 0, c: '#7D3E2E' });

  // Windmill blades extending on +Z face (z=3..4)
  v.push({ x: 0, y: 6, z: 3, c: '#5A3B22' });
  for (let d = 1; d <= 4; d++) {
    v.push({ x: 0, y: 6 + d, z: 3, c: '#5A3B22' });
    v.push({ x: 1, y: 6 + d, z: 3, c: '#EFE6D5' });
    v.push({ x: 0, y: 6 - d, z: 3, c: '#5A3B22' });
    v.push({ x: -1, y: 6 - d, z: 3, c: '#EFE6D5' });
    v.push({ x: d, y: 6, z: 3, c: '#5A3B22' });
    v.push({ x: d, y: 5, z: 3, c: '#EFE6D5' });
    v.push({ x: -d, y: 6, z: 3, c: '#5A3B22' });
    v.push({ x: -d, y: 7, z: 3, c: '#EFE6D5' });
  }

  return sanitizeVoxelArray(v);
}

export function buildDesertPavilion(seed = 1) {
  const v = [];
  const stone = seed % 2 === 0 ? '#C9B18C' : '#B89E7A';
  const trim = '#8D633B';
  const dome = seed % 2 === 0 ? '#C77A4A' : '#58826E';

  // Stepped courtyard platform
  pushBox(v, -3, 0, -3, 3, 0, 3, '#A68D6A');
  pushBox(v, -2, 1, -2, 2, 1, 2, stone);

  // Four corner arches/columns
  for (let y = 2; y <= 5; y++) {
    v.push({ x: -2, y, z: -2, c: stone });
    v.push({ x: 2, y, z: -2, c: stone });
    v.push({ x: -2, y, z: 2, c: stone });
    v.push({ x: 2, y, z: 2, c: stone });
  }
  // Warm central lantern brazier
  v.push({ x: 0, y: 2, z: 0, c: trim });
  v.push({ x: 0, y: 3, z: 0, c: '#F5C469' });

  // Roof cornice & dome
  for (let x = -2; x <= 2; x++) {
    for (let z = -2; z <= 2; z++) {
      v.push({ x, y: 6, z, c: trim });
    }
  }
  pushBox(v, -2, 7, -2, 2, 7, 2, dome);
  pushBox(v, -1, 8, -1, 1, 9, 1, dome);
  v.push({ x: 0, y: 10, z: 0, c: '#D89E52' });

  return sanitizeVoxelArray(v);
}

/**
 * Deterministic demo building generator from prompt text.
 */
export function generateDemoBuilding(promptText = '') {
  const p = String(promptText).toLowerCase();
  if (/منار|lighthouse|فانوس|برج بحر/.test(p)) {
    return buildCoastalLighthouse();
  }
  if (/شجر|كرز|حديق|نخل|tree|cherry|blossom|garden/.test(p)) {
    return buildCherryTree();
  }
  if (/طاحون|windmill|مروحة/.test(p)) {
    return buildWindmill();
  }
  if (/بيت|كوخ|منزل|cabin|house|cottage|home/.test(p)) {
    return buildRusticCabin();
  }

  let hash = 0;
  for (let i = 0; i < p.length; i++) {
    hash = (hash * 31 + p.charCodeAt(i)) | 0;
  }
  const pick = Math.abs(hash) % 5;
  if (pick === 0) return buildRusticCabin();
  if (pick === 1) return buildCoastalLighthouse();
  if (pick === 2) return buildCherryTree();
  if (pick === 3) return buildWindmill();
  return buildDesertPavilion(Math.abs(hash));
}

/**
 * Returns 3 initial landmark buildings spaced cleanly on the 40x40 island.
 */
export function getSeededBuildings() {
  const now = Date.now();
  return [
    {
      id: 'seed_cabin',
      prompt: 'كوخ خشبي دافئ',
      gx: -18,
      gz: -16,
      voxels: buildRusticCabin(),
      likes: 3,
      likedByMe: false,
      createdAt: now - 1000 * 60 * 42,
      source: 'demo',
    },
    {
      id: 'seed_lighthouse',
      prompt: 'منارة حجرية ساحلية',
      gx: 19,
      gz: -15,
      voxels: buildCoastalLighthouse(),
      likes: 5,
      likedByMe: false,
      createdAt: now - 1000 * 60 * 25,
      source: 'demo',
    },
    {
      id: 'seed_cherry',
      prompt: 'شجرة كرز مزهرة',
      gx: -17,
      gz: 16,
      voxels: buildCherryTree(),
      likes: 2,
      likedByMe: false,
      createdAt: now - 1000 * 60 * 11,
      source: 'demo',
    },
  ];
}
