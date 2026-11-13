import * as THREE from 'three';
import {
  CAFE_CENTER,
  CAFE_PROTECTED_HALF,
  CAFE_SEATS,
  CAFE_SOLID_OBSTACLES,
  buildCentralCafeData,
  findNearestCafeSeat,
  isBlockedByCafe,
  isInsideCafeProtectedZone,
} from './cafeLayout.js';

export {
  CAFE_CENTER,
  CAFE_PROTECTED_HALF,
  CAFE_SEATS,
  CAFE_SOLID_OBSTACLES,
  buildCentralCafeData,
  findNearestCafeSeat,
  isBlockedByCafe,
  isInsideCafeProtectedZone,
};

/**
 * Builds the complete Three.js Group for the Central Voxel Cafe, including instanced voxel blocks,
 * warm window glass, wooden tables, interactive chairs/benches, and warm cafe lanterns.
 */
export function createCentralCafeGroup(voxelGeo, voxelMat, isSoftwareGl) {
  const { blocks, lanterns, seats } = buildCentralCafeData();
  const group = new THREE.Group();
  const disposables = [];
  const seatHitboxes = [];

  const trackGeo = (g) => {
    disposables.push(g);
    return g;
  };
  const trackMat = (m) => {
    disposables.push(m);
    return m;
  };

  // 1. Batched InstancedMesh for main cafe voxel architecture
  const mesh = new THREE.InstancedMesh(voxelGeo, voxelMat, blocks.length);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(blocks.length * 3), 3);
  mesh.castShadow = !isSoftwareGl;
  mesh.receiveShadow = !isSoftwareGl;
  mesh.frustumCulled = true;

  const mat4 = new THREE.Matrix4();
  const color = new THREE.Color();
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    mat4.makeTranslation(b.x, b.y, b.z);
    mesh.setMatrixAt(i, mat4);
    color.setHex(b.color);
    mesh.setColorAt(i, color);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  group.add(mesh);
  disposables.push(mesh);

  // 2. Warm Open Panoramic Window Glass Panes (subtle translucent architectural glass)
  const glassMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xeadfc8,
      roughness: 0.16,
      metalness: 0.08,
      transparent: true,
      opacity: 0.24,
      depthWrite: false,
    })
  );
  const sideGlassGeo = trackGeo(new THREE.BoxGeometry(0.08, 2.7, 5.8));
  const westGlass = new THREE.Mesh(sideGlassGeo, glassMat);
  westGlass.position.set(-7, 2.5, -2.5);
  const eastGlass = new THREE.Mesh(sideGlassGeo, glassMat);
  eastGlass.position.set(7, 2.5, -2.5);
  const frontGlassGeo = trackGeo(new THREE.BoxGeometry(3.8, 2.7, 0.08));
  const frontGlassL = new THREE.Mesh(frontGlassGeo, glassMat);
  frontGlassL.position.set(-4.5, 2.5, 2);
  const frontGlassR = new THREE.Mesh(frontGlassGeo, glassMat);
  frontGlassR.position.set(4.5, 2.5, 2);
  group.add(westGlass, eastGlass, frontGlassL, frontGlassR);

  // 3. Cafe Brand Signboard above Entrance ("VOXEL CAFE")
  const signCanvas = document.createElement('canvas');
  signCanvas.width = 512;
  signCanvas.height = 128;
  const sctx = signCanvas.getContext('2d');
  if (sctx) {
    sctx.fillStyle = '#3B281B';
    sctx.fillRect(0, 0, 512, 128);
    sctx.strokeStyle = '#D9A154';
    sctx.lineWidth = 6;
    sctx.strokeRect(8, 8, 496, 112);
    sctx.fillStyle = '#F7EFE2';
    sctx.font = '700 44px "Plus Jakarta Sans", "IBM Plex Sans Arabic", sans-serif';
    sctx.textAlign = 'center';
    sctx.textBaseline = 'middle';
    sctx.fillText('مقهى الفوكسل · CAFE', 256, 66);
  }
  const signTex = trackMat(new THREE.CanvasTexture(signCanvas));
  signTex.colorSpace = THREE.SRGBColorSpace;
  const signMat = trackMat(new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.55 }));
  const signBoard = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(4.2, 0.96, 0.22)), signMat);
  signBoard.position.set(0, 5.65, 3.45);
  group.add(signBoard);

  // 4. Wooden Cafe Tables + Coffee Cups
  const woodDarkMat = trackMat(new THREE.MeshStandardMaterial({ color: 0x5c3a21, roughness: 0.72 }));
  const woodTopMat = trackMat(new THREE.MeshStandardMaterial({ color: 0x8f623c, roughness: 0.65 }));
  const cupMat = trackMat(new THREE.MeshStandardMaterial({ color: 0xf4eee4, roughness: 0.35 }));
  const coffeeMat = trackMat(new THREE.MeshStandardMaterial({ color: 0x4b2f1e, roughness: 0.4 }));
  const cushionMat = trackMat(new THREE.MeshStandardMaterial({ color: 0xa8563f, roughness: 0.8 }));

  const tableCoords = [
    { x: -4.5, z: 5.0 },
    { x: 4.5, z: 5.0 },
    { x: -4.2, z: -0.8 },
    { x: 4.2, z: -0.8 },
  ];
  const tableTopGeo = trackGeo(new THREE.BoxGeometry(1.45, 0.14, 1.1));
  const tableLegGeo = trackGeo(new THREE.BoxGeometry(0.24, 0.78, 0.24));
  const tableBaseGeo = trackGeo(new THREE.BoxGeometry(0.76, 0.1, 0.76));
  const cupBodyGeo = trackGeo(new THREE.BoxGeometry(0.16, 0.18, 0.16));
  const cupLiquidGeo = trackGeo(new THREE.BoxGeometry(0.12, 0.03, 0.12));

  for (const tc of tableCoords) {
    const tGroup = new THREE.Group();
    tGroup.position.set(tc.x, 0.07, tc.z);

    const base = new THREE.Mesh(tableBaseGeo, woodDarkMat);
    base.position.y = 0.05;
    const leg = new THREE.Mesh(tableLegGeo, woodDarkMat);
    leg.position.y = 0.44;
    const top = new THREE.Mesh(tableTopGeo, woodTopMat);
    top.position.y = 0.86;
    top.castShadow = !isSoftwareGl;
    top.receiveShadow = !isSoftwareGl;

    const cup1 = new THREE.Mesh(cupBodyGeo, cupMat);
    cup1.position.set(-0.28, 1.02, 0.18);
    const liq1 = new THREE.Mesh(cupLiquidGeo, coffeeMat);
    liq1.position.set(-0.28, 1.11, 0.18);

    const cup2 = new THREE.Mesh(cupBodyGeo, cupMat);
    cup2.position.set(0.3, 1.02, -0.16);
    const liq2 = new THREE.Mesh(cupLiquidGeo, coffeeMat);
    liq2.position.set(0.3, 1.11, -0.16);

    tGroup.add(base, leg, top, cup1, liq1, cup2, liq2);
    group.add(tGroup);
  }

  // 5. Interactive Chairs, Bar Stools, and Patio Benches
  const chairSeatGeo = trackGeo(new THREE.BoxGeometry(0.68, 0.12, 0.68));
  const chairBackGeo = trackGeo(new THREE.BoxGeometry(0.68, 0.56, 0.12));
  const chairLegGeo = trackGeo(new THREE.BoxGeometry(0.11, 0.48, 0.11));
  const stoolSeatGeo = trackGeo(new THREE.BoxGeometry(0.58, 0.14, 0.58));
  const stoolStemGeo = trackGeo(new THREE.BoxGeometry(0.16, 0.56, 0.16));
  const benchSeatGeo = trackGeo(new THREE.BoxGeometry(1.7, 0.14, 0.64));
  const benchBackGeo = trackGeo(new THREE.BoxGeometry(1.7, 0.44, 0.12));
  const hitMat = trackMat(new THREE.MeshBasicMaterial({ visible: false }));

  for (const seat of seats) {
    const sGroup = new THREE.Group();
    sGroup.position.set(seat.x, 0.06, seat.z);
    sGroup.rotation.y = seat.yaw;

    if (seat.kind === 'stool') {
      const stem = new THREE.Mesh(stoolStemGeo, woodDarkMat);
      stem.position.y = 0.28;
      const top = new THREE.Mesh(stoolSeatGeo, cushionMat);
      top.position.y = 0.6;
      top.castShadow = !isSoftwareGl;
      sGroup.add(stem, top);
    } else if (seat.kind === 'bench') {
      const plank = new THREE.Mesh(benchSeatGeo, woodTopMat);
      plank.position.y = 0.44;
      plank.castShadow = !isSoftwareGl;
      const back = new THREE.Mesh(benchBackGeo, woodDarkMat);
      back.position.set(0, 0.72, 0.26);
      const legL = new THREE.Mesh(chairLegGeo, woodDarkMat);
      legL.position.set(-0.68, 0.22, 0);
      const legR = new THREE.Mesh(chairLegGeo, woodDarkMat);
      legR.position.set(0.68, 0.22, 0);
      sGroup.add(plank, back, legL, legR);
    } else {
      const seatTop = new THREE.Mesh(chairSeatGeo, cushionMat);
      seatTop.position.y = 0.48;
      seatTop.castShadow = !isSoftwareGl;
      const back = new THREE.Mesh(chairBackGeo, woodDarkMat);
      back.position.set(0, 0.8, 0.28);
      for (const [lx, lz] of [
        [-0.26, -0.26],
        [0.26, -0.26],
        [-0.26, 0.26],
        [0.26, 0.26],
      ]) {
        const leg = new THREE.Mesh(chairLegGeo, woodDarkMat);
        leg.position.set(lx, 0.24, lz);
        sGroup.add(leg);
      }
      sGroup.add(seatTop, back);
    }

    const hitbox = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(seat.kind === 'bench' ? 1.9 : 1.0, 1.3, 1.0)),
      hitMat
    );
    hitbox.position.y = 0.65;
    hitbox.userData.seatId = seat.id;
    sGroup.add(hitbox);
    seatHitboxes.push(hitbox);

    group.add(sGroup);
  }

  // 6. Warm Architectural Lantern Props
  const lanternFrameMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0x3b2d22, roughness: 0.65, metalness: 0.25 })
  );
  const lanternGlowMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xffd584,
      emissive: 0xe69738,
      emissiveIntensity: 1.35,
      roughness: 0.25,
    })
  );
  const lBoxGeo = trackGeo(new THREE.BoxGeometry(0.32, 0.36, 0.32));
  const lCapGeo = trackGeo(new THREE.BoxGeometry(0.46, 0.12, 0.46));

  for (const l of lanterns) {
    const lg = new THREE.Group();
    lg.position.set(l.x, l.y, l.z);
    const bulb = new THREE.Mesh(lBoxGeo, lanternGlowMat);
    const capTop = new THREE.Mesh(lCapGeo, lanternFrameMat);
    capTop.position.y = 0.22;
    const capBot = new THREE.Mesh(lCapGeo, lanternFrameMat);
    capBot.position.y = -0.22;
    lg.add(bulb, capTop, capBot);
    group.add(lg);
  }

  return {
    group,
    lanterns,
    seatHitboxes,
    dispose() {
      for (const d of disposables) {
        if (typeof d.dispose === 'function') d.dispose();
      }
    },
  };
}
