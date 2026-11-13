import * as THREE from 'three';
import { getCharacterPresetById, normalizeCharacterConfig } from './characterCatalog.js';

/**
 * Overhauled high-detail, grounded articulated 3D voxel avatar with:
 * - Expressive eyes (sclera + iris + animated blink eyelids + eyebrows, or retro visor LEDs)
 * - 6 detailed headgear styles & layered hair tufts
 * - 6 distinct outfits & 3D accessories (backpack, tool belt, chest core, cafe apron, satchel, scarf)
 * - Knee-jointed legs for natural standing, walking, jumping, and relaxed Cafe sitting poses
 * - Floating pill nametag + subtle animated soundwave speaking indicator above head
 */
export class VoxelCharacterRig {
  constructor(initialConfig) {
    this.config = normalizeCharacterConfig(initialConfig);
    this.root = new THREE.Group();
    this.root.visible = false;

    this.walkPhase = 0;
    this.landingSquash = 0;
    this.wasGrounded = true;
    this.isSpeaking = false;
    this._voicePhase = 0;
    this._blinkTimer = 1.8;

    this._geometries = [];
    this._materials = [];
    this._sharedMats = this._createMaterials();
    this._nameValue = '';
    this._nameTex = null;
    this._nameSprite = null;
    this._voiceTex = null;
    this._voiceCanvas = null;
    this._voiceCtx = null;
    this._voiceSprite = null;
    this._lastVoiceRedraw = 0;

    this._buildRig();
    this.applyConfig(this.config);
  }

  _trackGeo(geo) {
    this._geometries.push(geo);
    return geo;
  }

  _trackMat(mat) {
    this._materials.push(mat);
    return mat;
  }

  _createMaterials() {
    return {
      skin: this._trackMat(
        new THREE.MeshStandardMaterial({ color: 0xf0c7a5, roughness: 0.72, metalness: 0.04 })
      ),
      outfit: this._trackMat(
        new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.78, metalness: 0.05 })
      ),
      pants: this._trackMat(
        new THREE.MeshStandardMaterial({ color: 0xb8a27a, roughness: 0.82, metalness: 0.04 })
      ),
      hairHat: this._trackMat(
        new THREE.MeshStandardMaterial({ color: 0x5d4037, roughness: 0.74, metalness: 0.06 })
      ),
      accent: this._trackMat(
        new THREE.MeshStandardMaterial({ color: 0xd6a15c, roughness: 0.44, metalness: 0.22 })
      ),
      shoe: this._trackMat(
        new THREE.MeshStandardMaterial({ color: 0x3e2c23, roughness: 0.85, metalness: 0.08 })
      ),
      eye: this._trackMat(
        new THREE.MeshStandardMaterial({ color: 0x1e1b18, roughness: 0.24, metalness: 0.14 })
      ),
      sclera: this._trackMat(
        new THREE.MeshStandardMaterial({ color: 0xfaf7f2, roughness: 0.3, metalness: 0.02 })
      ),
      metal: this._trackMat(
        new THREE.MeshStandardMaterial({ color: 0xd9e0e6, roughness: 0.28, metalness: 0.65 })
      ),
      leaf: this._trackMat(
        new THREE.MeshStandardMaterial({ color: 0x628e53, roughness: 0.72, metalness: 0.04 })
      ),
      apron: this._trackMat(
        new THREE.MeshStandardMaterial({ color: 0x7b4c2d, roughness: 0.76, metalness: 0.04 })
      ),
    };
  }

  _makePart(w, h, d, mat, castShadow = true) {
    const mesh = new THREE.Mesh(this._trackGeo(new THREE.BoxGeometry(w, h, d)), mat);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    return mesh;
  }

  _buildRig() {
    // Contact ground shadow disc
    const shadowCanvas = document.createElement('canvas');
    shadowCanvas.width = 64;
    shadowCanvas.height = 64;
    const sctx = shadowCanvas.getContext('2d');
    const grad = sctx.createRadialGradient(32, 32, 4, 32, 32, 30);
    grad.addColorStop(0, 'rgba(17, 17, 17, 0.46)');
    grad.addColorStop(0.65, 'rgba(17, 17, 17, 0.2)');
    grad.addColorStop(1, 'rgba(17, 17, 17, 0.0)');
    sctx.fillStyle = grad;
    sctx.fillRect(0, 0, 64, 64);

    const shadowTex = new THREE.CanvasTexture(shadowCanvas);
    shadowTex.colorSpace = THREE.SRGBColorSpace;
    this._shadowTex = shadowTex;

    const shadowMat = this._trackMat(
      new THREE.MeshBasicMaterial({
        map: shadowTex,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      })
    );
    this.contactShadow = new THREE.Mesh(
      this._trackGeo(new THREE.CircleGeometry(0.56, 24)).rotateX(-Math.PI / 2),
      shadowMat
    );
    this.contactShadow.position.y = 0.02;
    this.root.add(this.contactShadow);

    // Body pivot at hip height (y = 0.64 above feet)
    this.bodyPivot = new THREE.Group();
    this.bodyPivot.position.y = 0.64;
    this.root.add(this.bodyPivot);

    // Torso (layered jacket/tunic + shirt collar + hem)
    this.torsoGroup = new THREE.Group();
    this.bodyPivot.add(this.torsoGroup);

    const torsoCore = this._makePart(0.56, 0.66, 0.34, this._sharedMats.outfit);
    torsoCore.position.y = 0.34;
    const torsoHem = this._makePart(0.58, 0.09, 0.36, this._sharedMats.accent);
    torsoHem.position.y = 0.05;
    const collar = this._makePart(0.42, 0.09, 0.36, this._sharedMats.accent);
    collar.position.set(0, 0.64, 0);
    const lapelL = this._makePart(0.11, 0.28, 0.04, this._sharedMats.hairHat);
    lapelL.position.set(-0.14, 0.48, -0.175);
    const lapelR = this._makePart(0.11, 0.28, 0.04, this._sharedMats.hairHat);
    lapelR.position.set(0.14, 0.48, -0.175);
    this.torsoGroup.add(torsoCore, torsoHem, collar, lapelL, lapelR);

    // 6 Preset-Specific 3D Accessories
    this.accessories = {
      backpack: new THREE.Group(),
      tool_belt: new THREE.Group(),
      chest_panel: new THREE.Group(),
      apron: new THREE.Group(),
      satchel: new THREE.Group(),
      scarf: new THREE.Group(),
    };

    // 1. Explorer: leather backpack + brass buckle + rolled bedroll
    const packMain = this._makePart(0.42, 0.44, 0.2, this._sharedMats.hairHat);
    packMain.position.set(0, 0.36, 0.25);
    const packPocket = this._makePart(0.32, 0.2, 0.06, this._sharedMats.accent);
    packPocket.position.set(0, 0.25, 0.36);
    const packBedroll = this._makePart(0.48, 0.14, 0.14, this._sharedMats.accent);
    packBedroll.position.set(0, 0.61, 0.24);
    const strapFrontL = this._makePart(0.08, 0.56, 0.38, this._sharedMats.hairHat);
    strapFrontL.position.set(-0.17, 0.38, 0.01);
    const strapFrontR = this._makePart(0.08, 0.56, 0.38, this._sharedMats.hairHat);
    strapFrontR.position.set(0.17, 0.38, 0.01);
    this.accessories.backpack.add(packMain, packPocket, packBedroll, strapFrontL, strapFrontR);

    // 2. Architect: denim overall straps + utility tool belt + side hammer pouch
    const beltBand = this._makePart(0.61, 0.11, 0.39, this._sharedMats.accent);
    beltBand.position.set(0, 0.09, 0);
    const buckle = this._makePart(0.14, 0.12, 0.06, this._sharedMats.metal);
    buckle.position.set(0, 0.09, -0.2);
    const pouchL = this._makePart(0.12, 0.18, 0.22, this._sharedMats.accent);
    pouchL.position.set(-0.32, 0.09, 0);
    const wrench = this._makePart(0.06, 0.22, 0.06, this._sharedMats.metal);
    wrench.position.set(0.32, 0.14, -0.02);
    const strapL = this._makePart(0.1, 0.56, 0.37, this._sharedMats.pants);
    strapL.position.set(-0.16, 0.38, 0);
    const strapR = this._makePart(0.1, 0.56, 0.37, this._sharedMats.pants);
    strapR.position.set(0.16, 0.38, 0);
    this.accessories.tool_belt.add(beltBand, buckle, pouchL, wrench, strapL, strapR);

    // 3. Voxel Bot: chassis core plate + dial + back power battery
    const chestPlate = this._makePart(0.4, 0.36, 0.06, this._sharedMats.metal);
    chestPlate.position.set(0, 0.36, -0.18);
    const chestMeter = this._makePart(0.22, 0.12, 0.04, this._sharedMats.accent);
    chestMeter.position.set(0, 0.38, -0.21);
    const backPack = this._makePart(0.36, 0.4, 0.16, this._sharedMats.metal);
    backPack.position.set(0, 0.36, 0.23);
    this.accessories.chest_panel.add(chestPlate, chestMeter, backPack);

    // 4. Cafe Barista: bib apron + waist ties + coffee badge
    const apronChest = this._makePart(0.44, 0.4, 0.06, this._sharedMats.apron);
    apronChest.position.set(0, 0.34, -0.185);
    const apronSkirt = this._makePart(0.58, 0.26, 0.38, this._sharedMats.apron);
    apronSkirt.position.set(0, 0.08, 0);
    const apronPocket = this._makePart(0.24, 0.14, 0.04, this._sharedMats.accent);
    apronPocket.position.set(0, 0.2, -0.22);
    const coffeePin = this._makePart(0.08, 0.08, 0.04, this._sharedMats.metal);
    coffeePin.position.set(-0.13, 0.48, -0.22);
    this.accessories.apron.add(apronChest, apronSkirt, apronPocket, coffeePin);

    // 5. Botanist: crossbody satchel + leaf sprig
    const bagStrap = this._makePart(0.09, 0.62, 0.38, this._sharedMats.accent);
    bagStrap.position.set(0, 0.36, 0);
    bagStrap.rotation.z = 0.56;
    const satchelBox = this._makePart(0.16, 0.26, 0.28, this._sharedMats.accent);
    satchelBox.position.set(-0.3, 0.14, 0.04);
    const leafStem = this._makePart(0.05, 0.14, 0.05, this._sharedMats.leaf);
    leafStem.position.set(-0.29, 0.3, 0.04);
    const leafTip = this._makePart(0.12, 0.07, 0.08, this._sharedMats.leaf);
    leafTip.position.set(-0.26, 0.36, 0.04);
    this.accessories.satchel.add(bagStrap, satchelBox, leafStem, leafTip);

    // 6. Nomad: layered desert scarf + trailing sash
    const scarfWrap = this._makePart(0.62, 0.16, 0.4, this._sharedMats.accent);
    scarfWrap.position.set(0, 0.61, 0);
    const scarfTail = this._makePart(0.18, 0.38, 0.08, this._sharedMats.accent);
    scarfTail.position.set(0.18, 0.43, 0.21);
    const waistSash = this._makePart(0.6, 0.12, 0.38, this._sharedMats.hairHat);
    waistSash.position.set(0, 0.08, 0);
    this.accessories.scarf.add(scarfWrap, scarfTail, waistSash);

    for (const grp of Object.values(this.accessories)) {
      this.torsoGroup.add(grp);
    }

    // Head Pivot
    this.headPivot = new THREE.Group();
    this.headPivot.position.set(0, 0.69, 0);
    this.torsoGroup.add(this.headPivot);

    const headBlock = this._makePart(0.52, 0.5, 0.5, this._sharedMats.skin);
    headBlock.position.y = 0.26;
    this.headPivot.add(headBlock);

    // Expressive Human Face (Sclera + Iris + Eyelids + Eyebrows + Layered Hair Bangs/Back)
    this.humanFaceGroup = new THREE.Group();
    const eyeScleraL = this._makePart(0.11, 0.1, 0.03, this._sharedMats.sclera, false);
    eyeScleraL.position.set(-0.13, 0.24, -0.252);
    const eyeScleraR = this._makePart(0.11, 0.1, 0.03, this._sharedMats.sclera, false);
    eyeScleraR.position.set(0.13, 0.24, -0.252);

    const eyePupilL = this._makePart(0.065, 0.08, 0.035, this._sharedMats.eye, false);
    eyePupilL.position.set(-0.12, 0.24, -0.26);
    const eyePupilR = this._makePart(0.065, 0.08, 0.035, this._sharedMats.eye, false);
    eyePupilR.position.set(0.12, 0.24, -0.26);

    this.eyelidGroup = new THREE.Group();
    const lidL = this._makePart(0.12, 0.11, 0.04, this._sharedMats.skin, false);
    lidL.position.set(-0.13, 0.24, -0.265);
    const lidR = this._makePart(0.12, 0.11, 0.04, this._sharedMats.skin, false);
    lidR.position.set(0.13, 0.24, -0.265);
    this.eyelidGroup.add(lidL, lidR);
    this.eyelidGroup.visible = false;

    const browL = this._makePart(0.12, 0.035, 0.035, this._sharedMats.hairHat, false);
    browL.position.set(-0.13, 0.33, -0.258);
    const browR = this._makePart(0.12, 0.035, 0.035, this._sharedMats.hairHat, false);
    browR.position.set(0.13, 0.33, -0.258);

    const nose = this._makePart(0.06, 0.06, 0.05, this._sharedMats.skin, false);
    nose.position.set(0, 0.18, -0.265);

    const hairTop = this._makePart(0.55, 0.12, 0.54, this._sharedMats.hairHat);
    hairTop.position.set(0, 0.47, 0);
    const hairBack = this._makePart(0.55, 0.3, 0.16, this._sharedMats.hairHat);
    hairBack.position.set(0, 0.32, 0.2);
    const bangsL = this._makePart(0.16, 0.09, 0.07, this._sharedMats.hairHat);
    bangsL.position.set(-0.17, 0.41, -0.24);
    const bangsR = this._makePart(0.2, 0.1, 0.07, this._sharedMats.hairHat);
    bangsR.position.set(0.14, 0.41, -0.24);

    this.humanFaceGroup.add(
      eyeScleraL,
      eyeScleraR,
      eyePupilL,
      eyePupilR,
      this.eyelidGroup,
      browL,
      browR,
      nose,
      hairTop,
      hairBack,
      bangsL,
      bangsR
    );
    this.headPivot.add(this.humanFaceGroup);

    // Bot Visor Face
    this.botFaceGroup = new THREE.Group();
    const visorFrame = this._makePart(0.46, 0.22, 0.06, this._sharedMats.hairHat, false);
    visorFrame.position.set(0, 0.27, -0.25);
    const visorEyeL = this._makePart(0.1, 0.08, 0.04, this._sharedMats.eye, false);
    visorEyeL.position.set(-0.1, 0.27, -0.275);
    const visorEyeR = this._makePart(0.1, 0.08, 0.04, this._sharedMats.eye, false);
    visorEyeR.position.set(0.1, 0.27, -0.275);
    const earL = this._makePart(0.08, 0.18, 0.18, this._sharedMats.metal);
    earL.position.set(-0.29, 0.26, 0);
    const earR = this._makePart(0.08, 0.18, 0.18, this._sharedMats.metal);
    earR.position.set(0.29, 0.26, 0);
    this.botFaceGroup.add(visorFrame, visorEyeL, visorEyeR, earL, earR);
    this.headPivot.add(this.botFaceGroup);

    // 6 Preset Headgear Options
    this.headgears = {
      adventurer_hat: new THREE.Group(),
      hard_hat: new THREE.Group(),
      antenna: new THREE.Group(),
      flat_cap: new THREE.Group(),
      straw_hat: new THREE.Group(),
      hood: new THREE.Group(),
    };

    // Explorer Adventurer Hat
    const hatBrim = this._makePart(0.78, 0.07, 0.76, this._sharedMats.hairHat);
    hatBrim.position.set(0, 0.51, 0);
    const hatBand = this._makePart(0.56, 0.08, 0.54, this._sharedMats.accent);
    hatBand.position.set(0, 0.58, 0);
    const hatCrown = this._makePart(0.5, 0.18, 0.48, this._sharedMats.hairHat);
    hatCrown.position.set(0, 0.68, 0);
    this.headgears.adventurer_hat.add(hatBrim, hatBand, hatCrown);

    // Architect Hard Hat
    const hardShell = this._makePart(0.58, 0.18, 0.56, this._sharedMats.hairHat);
    hardShell.position.set(0, 0.54, 0);
    const hardRidge = this._makePart(0.14, 0.08, 0.58, this._sharedMats.hairHat);
    hardRidge.position.set(0, 0.64, 0);
    const hardBrim = this._makePart(0.58, 0.06, 0.18, this._sharedMats.hairHat);
    hardBrim.position.set(0, 0.48, -0.3);
    this.headgears.hard_hat.add(hardShell, hardRidge, hardBrim);

    // Voxel Bot Antenna
    const antBase = this._makePart(0.2, 0.08, 0.2, this._sharedMats.hairHat);
    antBase.position.set(0, 0.54, 0);
    const antStem = this._makePart(0.06, 0.24, 0.06, this._sharedMats.metal);
    antStem.position.set(0, 0.68, 0);
    const antTip = this._makePart(0.13, 0.13, 0.13, this._sharedMats.accent);
    antTip.position.set(0, 0.82, 0);
    this.headgears.antenna.add(antBase, antStem, antTip);

    // Cafe Barista Flat Cap
    const capCrown = this._makePart(0.58, 0.13, 0.6, this._sharedMats.hairHat);
    capCrown.position.set(0, 0.53, -0.02);
    const capPeak = this._makePart(0.52, 0.05, 0.22, this._sharedMats.hairHat);
    capPeak.position.set(0, 0.47, -0.31);
    const capButton = this._makePart(0.1, 0.04, 0.1, this._sharedMats.accent);
    capButton.position.set(0, 0.6, 0.02);
    this.headgears.flat_cap.add(capCrown, capPeak, capButton);

    // Botanist Wide Straw Sunhat + Green Leaf Ribbon
    const strawBrim = this._makePart(0.86, 0.06, 0.86, this._sharedMats.hairHat);
    strawBrim.position.set(0, 0.5, 0);
    const strawRibbon = this._makePart(0.56, 0.08, 0.56, this._sharedMats.leaf);
    strawRibbon.position.set(0, 0.56, 0);
    const strawCrown = this._makePart(0.5, 0.15, 0.5, this._sharedMats.hairHat);
    strawCrown.position.set(0, 0.66, 0);
    this.headgears.straw_hat.add(strawBrim, strawRibbon, strawCrown);

    // Nomad Hood
    const hoodTop = this._makePart(0.6, 0.16, 0.58, this._sharedMats.hairHat);
    hoodTop.position.set(0, 0.54, 0.02);
    const hoodSideL = this._makePart(0.08, 0.44, 0.54, this._sharedMats.hairHat);
    hoodSideL.position.set(-0.28, 0.29, 0.03);
    const hoodSideR = this._makePart(0.08, 0.44, 0.54, this._sharedMats.hairHat);
    hoodSideR.position.set(0.28, 0.29, 0.03);
    const hoodBack = this._makePart(0.6, 0.5, 0.14, this._sharedMats.hairHat);
    hoodBack.position.set(0, 0.27, 0.24);
    this.headgears.hood.add(hoodTop, hoodSideL, hoodSideR, hoodBack);

    for (const grp of Object.values(this.headgears)) {
      this.headPivot.add(grp);
    }

    // Articulated Arms (shoulders with rolled-sleeve option)
    this.leftArmPivot = new THREE.Group();
    this.leftArmPivot.position.set(-0.39, 0.6, 0);
    this.lSleeveLong = this._makePart(0.2, 0.34, 0.22, this._sharedMats.outfit);
    this.lSleeveLong.position.y = -0.17;
    this.lSleeveShort = this._makePart(0.22, 0.2, 0.24, this._sharedMats.outfit);
    this.lSleeveShort.position.y = -0.1;
    const lHand = this._makePart(0.18, 0.32, 0.2, this._sharedMats.skin);
    lHand.position.y = -0.42;
    this.leftArmPivot.add(this.lSleeveLong, this.lSleeveShort, lHand);
    this.torsoGroup.add(this.leftArmPivot);

    this.rightArmPivot = new THREE.Group();
    this.rightArmPivot.position.set(0.39, 0.6, 0);
    this.rSleeveLong = this._makePart(0.2, 0.34, 0.22, this._sharedMats.outfit);
    this.rSleeveLong.position.y = -0.17;
    this.rSleeveShort = this._makePart(0.22, 0.2, 0.24, this._sharedMats.outfit);
    this.rSleeveShort.position.y = -0.1;
    const rHand = this._makePart(0.18, 0.32, 0.2, this._sharedMats.skin);
    rHand.position.y = -0.42;
    this.rightArmPivot.add(this.rSleeveLong, this.rSleeveShort, rHand);
    this.torsoGroup.add(this.rightArmPivot);

    // Knee-Jointed Articulated Legs (supports both crisp walking and relaxed Cafe sitting!)
    const buildLeg = (offsetX) => {
      const hipPivot = new THREE.Group();
      hipPivot.position.set(offsetX, 0, 0);
      const thigh = this._makePart(0.24, 0.28, 0.26, this._sharedMats.pants);
      thigh.position.y = -0.14;

      const kneePivot = new THREE.Group();
      kneePivot.position.set(0, -0.28, 0);
      const shin = this._makePart(0.23, 0.22, 0.25, this._sharedMats.pants);
      shin.position.y = -0.11;
      const boot = this._makePart(0.26, 0.14, 0.32, this._sharedMats.shoe);
      boot.position.set(0, -0.29, -0.03);
      const bootToe = this._makePart(0.24, 0.08, 0.1, this._sharedMats.shoe);
      bootToe.position.set(0, -0.32, -0.19);
      kneePivot.add(shin, boot, bootToe);

      hipPivot.add(thigh, kneePivot);
      this.bodyPivot.add(hipPivot);
      return { hipPivot, kneePivot };
    };

    const leftLeg = buildLeg(-0.15);
    this.leftLegPivot = leftLeg.hipPivot;
    this.leftKneePivot = leftLeg.kneePivot;

    const rightLeg = buildLeg(0.15);
    this.rightLegPivot = rightLeg.hipPivot;
    this.rightKneePivot = rightLeg.kneePivot;

    // Floating Pill Nameplate Sprite
    const spriteMat = new THREE.SpriteMaterial({
      transparent: true,
      depthTest: true,
      depthWrite: false,
    });
    this._nameMat = spriteMat;
    this._nameSprite = new THREE.Sprite(spriteMat);
    this._nameSprite.position.set(0, 2.52, 0);
    this._nameSprite.scale.set(2.2, 0.48, 1);
    this._nameSprite.visible = false;
    this.root.add(this._nameSprite);

    // Animated Soundwave Speaking Indicator Sprite above Nameplate
    this._voiceCanvas = document.createElement('canvas');
    this._voiceCanvas.width = 160;
    this._voiceCanvas.height = 72;
    this._voiceCtx = this._voiceCanvas.getContext('2d');
    this._voiceTex = new THREE.CanvasTexture(this._voiceCanvas);
    this._voiceTex.colorSpace = THREE.SRGBColorSpace;
    this._voiceMat = new THREE.SpriteMaterial({
      map: this._voiceTex,
      transparent: true,
      depthTest: true,
      depthWrite: false,
    });
    this._voiceSprite = new THREE.Sprite(this._voiceMat);
    this._voiceSprite.position.set(0, 3.04, 0);
    this._voiceSprite.scale.set(1.05, 0.47, 1);
    this._voiceSprite.visible = false;
    this.root.add(this._voiceSprite);
  }

  _drawVoiceWave(phase) {
    const ctx = this._voiceCtx;
    if (!ctx) return;
    const w = this._voiceCanvas.width;
    const h = this._voiceCanvas.height;
    ctx.clearRect(0, 0, w, h);

    const pillW = 112;
    const pillH = 44;
    const rx = (w - pillW) / 2;
    const ry = (h - pillH) / 2;
    const rad = pillH / 2;

    ctx.beginPath();
    ctx.moveTo(rx + rad, ry);
    ctx.lineTo(rx + pillW - rad, ry);
    ctx.arcTo(rx + pillW, ry, rx + pillW, ry + rad, rad);
    ctx.arcTo(rx + pillW, ry + pillH, rx + pillW - rad, ry + pillH, rad);
    ctx.lineTo(rx + rad, ry + pillH);
    ctx.arcTo(rx, ry + pillH, rx, ry + rad, rad);
    ctx.arcTo(rx, ry, rx + rad, ry, rad);
    ctx.closePath();

    ctx.fillStyle = 'rgba(17, 17, 17, 0.86)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.stroke();

    // 5 subtle warm-ivory animated sound bars (strictly non-neon)
    ctx.fillStyle = '#E8DFD1';
    const barW = 7;
    const gap = 8;
    const startX = w / 2 - (5 * barW + 4 * gap) / 2;
    for (let i = 0; i < 5; i++) {
      const wave = 0.35 + 0.65 * Math.abs(Math.sin(phase * 6.5 + i * 0.85));
      const barH = 8 + wave * 18;
      const bx = startX + i * (barW + gap);
      const by = (h - barH) / 2;
      ctx.beginPath();
      ctx.roundRect(bx, by, barW, barH, 3.5);
      ctx.fill();
    }

    this._voiceTex.needsUpdate = true;
  }

  setSpeaking(active) {
    const next = Boolean(active);
    this.isSpeaking = next;
    if (this._voiceSprite) {
      this._voiceSprite.visible = next;
      if (next) {
        this._drawVoiceWave(this._voicePhase);
      }
    }
  }

  setName(name) {
    const clean = typeof name === 'string' ? name.trim().slice(0, 26) : '';
    if (clean === this._nameValue) return;
    this._nameValue = clean;

    if (!clean || !this._nameSprite || !this._nameMat) {
      if (this._nameSprite) this._nameSprite.visible = false;
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 72;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      ctx.font = '700 28px "Plus Jakarta Sans", "IBM Plex Sans Arabic", sans-serif';
      const metrics = ctx.measureText(clean);
      const pillW = Math.min(308, Math.max(120, Math.ceil(metrics.width) + 44));
      const pillH = 52;
      const rx = (canvas.width - pillW) / 2;
      const ry = (canvas.height - pillH) / 2;
      const rad = pillH / 2;

      ctx.beginPath();
      ctx.moveTo(rx + rad, ry);
      ctx.lineTo(rx + pillW - rad, ry);
      ctx.arcTo(rx + pillW, ry, rx + pillW, ry + rad, rad);
      ctx.arcTo(rx + pillW, ry + pillH, rx + pillW - rad, ry + pillH, rad);
      ctx.lineTo(rx + rad, ry + pillH);
      ctx.arcTo(rx, ry + pillH, rx, ry + rad, rad);
      ctx.arcTo(rx, ry, rx + rad, ry, rad);
      ctx.closePath();

      ctx.fillStyle = 'rgba(17, 17, 17, 0.82)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.34)';
      ctx.stroke();

      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(clean, canvas.width / 2, canvas.height / 2 + 1, pillW - 24);
    }

    this._nameTex?.dispose();
    this._nameTex = new THREE.CanvasTexture(canvas);
    this._nameTex.colorSpace = THREE.SRGBColorSpace;
    this._nameMat.map = this._nameTex;
    this._nameMat.needsUpdate = true;
    this._nameSprite.visible = true;
  }

  applyConfig(nextConfig) {
    this.config = normalizeCharacterConfig(nextConfig);
    const preset = getCharacterPresetById(this.config.presetId);

    this._sharedMats.skin.color.set(this.config.skinColor);
    this._sharedMats.outfit.color.set(this.config.outfitColor);
    this._sharedMats.pants.color.set(preset.pantsColor);
    this._sharedMats.hairHat.color.set(this.config.hairHatColor);
    this._sharedMats.accent.color.set(preset.accentColor);
    this._sharedMats.shoe.color.set(preset.shoeColor);
    this._sharedMats.eye.color.set(preset.eyeColor);

    const isBot = preset.id === 'voxelbot';
    this.humanFaceGroup.visible = !isBot;
    this.botFaceGroup.visible = isBot;

    const rolled = Boolean(preset.rolledSleeves);
    this.lSleeveLong.visible = !rolled;
    this.rSleeveLong.visible = !rolled;
    this.lSleeveShort.visible = rolled;
    this.rSleeveShort.visible = rolled;

    for (const [key, grp] of Object.entries(this.headgears)) {
      grp.visible = key === preset.headgear;
    }
    for (const [key, grp] of Object.entries(this.accessories)) {
      grp.visible = key === preset.accessory;
    }
  }

  setGroundedPosition(x, y, z, yaw, terrainHeight = 0) {
    this.root.position.set(x, y, z);
    this.root.rotation.y = yaw;

    const heightAboveGround = Math.max(0, y - terrainHeight);
    this.contactShadow.position.y = -heightAboveGround + 0.02;
    const shadowScale = Math.max(0.42, 1 - heightAboveGround * 0.22);
    this.contactShadow.scale.set(shadowScale, shadowScale, 1);
    this.contactShadow.material.opacity = Math.max(0.18, 1 - heightAboveGround * 0.26);
  }

  updateAnimation({
    speedRatio = 0,
    isGrounded = true,
    isSitting = false,
    verticalVel = 0,
    elapsed = 0,
    delta = 0.016,
  }) {
    const dt = Math.min(0.1, Math.max(0.001, delta));
    const lerpAlpha = 1 - Math.exp(-14 * dt);

    // Subtle natural eye blink every ~3.6 seconds
    this._blinkTimer -= dt;
    if (this._blinkTimer <= 0) {
      this._blinkTimer = 3.2 + ((elapsed * 1.37) % 1.4);
    }
    this.eyelidGroup.visible = this._blinkTimer < 0.11;

    // Update animated soundwave indicator when speaking
    if (this.isSpeaking && this._voiceSprite) {
      this._voicePhase += dt;
      if (elapsed - this._lastVoiceRedraw > 0.075) {
        this._lastVoiceRedraw = elapsed;
        this._drawVoiceWave(this._voicePhase);
      }
      this._voiceSprite.position.y = (isSitting ? 2.66 : 3.04) + Math.sin(elapsed * 5.2) * 0.03;
    }

    if (isGrounded && !this.wasGrounded && !isSitting) {
      this.landingSquash = 1.0;
    }
    this.wasGrounded = isGrounded;
    this.landingSquash *= Math.exp(-12 * dt);

    let targetBodyY = 0.64 - this.landingSquash * 0.08;
    let targetTorsoLean = 0;
    let targetHeadBob = 0;
    let targetHeadYaw = 0;
    let targetLegL = 0;
    let targetLegR = 0;
    let targetKneeL = 0;
    let targetKneeR = 0;
    let targetArmL = 0;
    let targetArmR = 0;

    if (isSitting) {
      // Relaxed Cafe seating pose: hips down on cushion, thighs horizontal forward (-Z), knees bent 85 deg
      const breath = Math.sin(elapsed * 1.9);
      targetBodyY = 0.16 + breath * 0.008;
      targetTorsoLean = 0.06;
      targetHeadBob = breath * 0.025;
      targetHeadYaw = Math.sin(elapsed * 0.75) * 0.12;
      targetLegL = 1.48;
      targetLegR = 1.42;
      targetKneeL = -1.48;
      targetKneeR = -1.44;
      targetArmL = 0.62 + breath * 0.025;
      targetArmR = 0.56 - breath * 0.025;
      this._nameSprite.position.y = 2.15;
    } else {
      this._nameSprite.position.y = 2.52;
      if (!isGrounded) {
        const riseT = THREE.MathUtils.clamp(verticalVel / 9.2, -1, 1);
        targetLegL = -0.38 - riseT * 0.14;
        targetLegR = 0.42 + riseT * 0.1;
        targetKneeL = -0.25;
        targetKneeR = -0.45;
        targetArmL = 0.72 + riseT * 0.28;
        targetArmR = -0.78 - riseT * 0.25;
        targetTorsoLean = -0.06 * riseT;
      } else if (speedRatio > 0.06) {
        this.walkPhase += dt * (8.5 + speedRatio * 5.2);
        const swing = Math.sin(this.walkPhase) * (0.68 * Math.min(1.15, speedRatio));
        const bounce = Math.abs(Math.cos(this.walkPhase)) * 0.065 * Math.min(1, speedRatio);

        targetBodyY += bounce;
        targetTorsoLean = -0.07 * Math.min(1, speedRatio);
        targetHeadBob = Math.sin(this.walkPhase * 2) * 0.035;
        targetLegL = swing;
        targetLegR = -swing;
        targetKneeL = Math.min(0, -Math.cos(this.walkPhase) * 0.38);
        targetKneeR = Math.min(0, Math.cos(this.walkPhase) * 0.38);
        targetArmL = -swing * 0.85;
        targetArmR = swing * 0.85;
      } else {
        const breath = Math.sin(elapsed * 2.3);
        targetBodyY += breath * 0.014;
        targetHeadBob = breath * 0.025;
        targetArmL = 0.04 + breath * 0.035;
        targetArmR = -0.04 - breath * 0.035;
      }
    }

    this.bodyPivot.position.y = THREE.MathUtils.lerp(this.bodyPivot.position.y, targetBodyY, lerpAlpha);
    this.torsoGroup.rotation.x = THREE.MathUtils.lerp(
      this.torsoGroup.rotation.x,
      targetTorsoLean,
      lerpAlpha
    );
    this.headPivot.rotation.x = THREE.MathUtils.lerp(this.headPivot.rotation.x, targetHeadBob, lerpAlpha);
    this.headPivot.rotation.y = THREE.MathUtils.lerp(this.headPivot.rotation.y, targetHeadYaw, lerpAlpha);

    this.leftLegPivot.rotation.x = THREE.MathUtils.lerp(this.leftLegPivot.rotation.x, targetLegL, lerpAlpha);
    this.rightLegPivot.rotation.x = THREE.MathUtils.lerp(
      this.rightLegPivot.rotation.x,
      targetLegR,
      lerpAlpha
    );
    this.leftKneePivot.rotation.x = THREE.MathUtils.lerp(
      this.leftKneePivot.rotation.x,
      targetKneeL,
      lerpAlpha
    );
    this.rightKneePivot.rotation.x = THREE.MathUtils.lerp(
      this.rightKneePivot.rotation.x,
      targetKneeR,
      lerpAlpha
    );
    this.leftArmPivot.rotation.x = THREE.MathUtils.lerp(this.leftArmPivot.rotation.x, targetArmL, lerpAlpha);
    this.rightArmPivot.rotation.x = THREE.MathUtils.lerp(
      this.rightArmPivot.rotation.x,
      targetArmR,
      lerpAlpha
    );

    const idleFlare = isSitting ? 0.14 : isGrounded ? 0.08 : 0.24;
    this.leftArmPivot.rotation.z = THREE.MathUtils.lerp(
      this.leftArmPivot.rotation.z,
      -idleFlare,
      lerpAlpha
    );
    this.rightArmPivot.rotation.z = THREE.MathUtils.lerp(
      this.rightArmPivot.rotation.z,
      idleFlare,
      lerpAlpha
    );
  }

  dispose() {
    for (const g of this._geometries) g.dispose();
    for (const m of this._materials) m.dispose();
    this._shadowTex?.dispose();
    this._nameTex?.dispose();
    this._nameMat?.dispose();
    this._voiceTex?.dispose();
    this._voiceMat?.dispose();
  }
}
