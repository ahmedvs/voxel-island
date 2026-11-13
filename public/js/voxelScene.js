import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  ISLAND_HALF,
  PLOT_HALF_SIZE,
  checkPlotAvailability,
  calculateIslandStats,
  findWalkSpawnPoint,
  getTerrainHeightAt,
  resolveWalkMovement,
} from './voxelCore.js';
import { WORLD_SIZE, buildOpenWorldChunks } from './worldTerrain.js';
import {
  computeCameraRelativeDirection,
  lerpAngleRadians,
  stepVerticalJumpPhysics,
} from './characterCatalog.js';
import { VoxelCharacterRig } from './voxelCharacter.js';
import {
  createCentralCafeGroup,
  findNearestCafeSeat,
  CAFE_SEATS,
} from './voxelCafe.js';

const _vec3 = new THREE.Vector3();
const _mat4 = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _color = new THREE.Color();
const _walkAnchor = new THREE.Vector3();
const _walkRayDir = new THREE.Vector3();
const _walkTargetPos = new THREE.Vector3();

function detectSoftwareGl() {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return false;
  }
}

function createVoxelBumpTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#d8d8d8';
  ctx.fillRect(0, 0, size, size);

  // Subtle inner bevel border
  ctx.strokeStyle = '#9a9a9a';
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, size - 3, size - 3);

  // Subtle organic grain
  for (let y = 4; y < size - 4; y += 2) {
    for (let x = 4; x < size - 4; x += 2) {
      const n = ((x * 73856093) ^ (y * 19349663)) & 255;
      const shade = 205 + (n % 30);
      ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
      ctx.fillRect(x, y, 2, 2);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function hash2D(x, z) {
  const n = Math.sin(x * 127.1 + z * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

export class VoxelIslandScene {
  constructor(container, callbacks) {
    this.container = container;
    this.callbacks = callbacks || {};
    this.isSoftwareGl = detectSoftwareGl();
    if (this.isSoftwareGl) {
      document.body.classList.add('software-gl');
    }

    this.buildingsState = [];
    this.buildingEntries = new Map(); // id -> { mesh, hitbox, group, lanternGroup, ... }
    this.constructionSites = new Map(); // id -> { gx, gz, group, ring, startedAt }
    this.selectedPlot = null;
    this.selectedBuildingId = null;
    this.hoverGrid = null;
    this.vitalityRatio = 0.18;

    this.cameraMode = 'orbit'; // 'orbit' | 'pan' | 'walk'
    this.welcomeShowcase = Boolean(this.callbacks.initialWelcomeShowcase);
    this.cameraTargetGoal = null;
    this.cameraPosGoal = null;

    this.walkState = {
      active: false,
      x: 0,
      y: 0,
      z: 11.5,
      vy: 0,
      isGrounded: true,
      isSitting: false,
      seatId: null,
      nearSeatId: null,
      sitProgressX: 0,
      sitProgressZ: 0,
      jumpQueued: false,
      charYaw: 0,
      camYaw: 0,
      camPitch: 0.34,
      camDist: 6.4,
      vx: 0,
      vz: 0,
      dragging: false,
      lastX: 0,
      lastY: 0,
      keys: new Set(),
    };

    this.remotePeers = new Map(); // id -> { rig, state, targetX, targetY, targetZ, targetYaw, speedRatio }
    this.pointerDownPos = { x: 0, y: 0 };
    this.lastHoverRaycast = 0;
    this.frameId = 0;
    this.disposed = false;

    this._initRendererAndScene();
    this._initSkyAndOcean();
    this._initLighting();
    this._initFloatingIsland();
    this._initFloraAndLanternLights();
    this._initCentralCafe();
    this._initCursors();
    this._initCharacter();
    this._initEvents();

    this.clock = new THREE.Clock();
    this._startLoop();
  }

  _initRendererAndScene() {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9bb0c1);
    this.scene.fog = new THREE.FogExp2(0x9bb0c1, 0.0022);

    this.camera = new THREE.PerspectiveCamera(44, width / height, 0.5, 2000);
    if (this.welcomeShowcase) {
      this.camera.position.set(54, 34, 54);
    } else {
      this.camera.position.set(42, 34, 48);
    }

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.container.appendChild(this.renderer.domElement);

    // Studio environment reflection on hardware GPUs (skip on CPU SwiftShader to keep 10+ FPS)
    if (!this.isSoftwareGl) {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      this.envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      this.scene.environment = this.envTexture;
      pmrem.dispose();
    }

    // OrbitControls expanded for massive 260x260 open-world vista & street-level inspection
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(-0.5, 1.5, -0.5);
    this.controls.enabled = !this.welcomeShowcase;
    this.controls.enableDamping = !this.isSoftwareGl;
    this.controls.dampingFactor = 0.06;
    this.controls.minDistance = 10;
    this.controls.maxDistance = 320;
    this.controls.minPolarAngle = 0.18;
    this.controls.maxPolarAngle = Math.PI * 0.53;
    this.controls.panSpeed = 0.85;
    this.controls.rotateSpeed = 0.75;
    this.lastLanternPoolUpdate = 0;

    this.controls.addEventListener('start', () => {
      this.cameraPosGoal = null;
      this.cameraTargetGoal = null;
    });

    this.raycaster = new THREE.Raycaster();
    this.pointerNdc = new THREE.Vector2();

    // Shared voxel geometry & material
    this.voxelGeo = new THREE.BoxGeometry(0.98, 0.98, 0.98);
    this.bumpTex = createVoxelBumpTexture();
    this.bumpTex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();

    this.voxelMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.76,
      metalness: 0.05,
      bumpMap: this.bumpTex,
      bumpScale: 0.025,
    });

    // Root group for gentle floating motion of island + all buildings
    this.islandRoot = new THREE.Group();
    this.scene.add(this.islandRoot);
  }

  _initSkyAndOcean() {
    // Soft atmospheric sky dome covering the 260x260 open world
    const skyGeo = new THREE.SphereGeometry(1200, 24, 16);
    this.skyUniforms = {
      uTopColor: { value: new THREE.Color(0x526e8a) },
      uHorizonColor: { value: new THREE.Color(0xb6c5cf) },
      uWarmth: { value: 0.18 },
    };
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: this.skyUniforms,
      vertexShader: `
        varying vec3 vWorldPos;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform vec3 uTopColor;
        uniform vec3 uHorizonColor;
        uniform float uWarmth;
        varying vec3 vWorldPos;
        void main() {
          float h = normalize(vWorldPos).y;
          float t = clamp(h * 1.45 + 0.12, 0.0, 1.0);
          vec3 warmHorizon = mix(uHorizonColor, vec3(0.84, 0.78, 0.69), uWarmth * 0.55);
          vec3 sky = mix(warmHorizon, uTopColor, pow(t, 0.75));
          gl_FragColor = vec4(sky, 1.0);
        }
      `,
    });
    this.skyDome = new THREE.Mesh(skyGeo, skyMat);
    this.scene.add(this.skyDome);

    // Wide atmospheric ocean far below the floating open-world island
    const oceanGeo = new THREE.CircleGeometry(1100, 48);
    oceanGeo.rotateX(-Math.PI / 2);
    this.oceanUniforms = { uTime: { value: 0 } };
    const oceanMat = new THREE.MeshStandardMaterial({
      color: 0x3b6175,
      roughness: 0.28,
      metalness: 0.14,
    });
    oceanMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.oceanUniforms.uTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           float wave = sin(position.x * 0.045 + uTime * 0.8) * cos(position.z * 0.045 + uTime * 0.6) * 0.45;
           transformed.y += wave;`
        );
    };
    this.oceanMesh = new THREE.Mesh(oceanGeo, oceanMat);
    this.oceanMesh.position.y = -14.5;
    this.oceanMesh.receiveShadow = false;
    this.scene.add(this.oceanMesh);
  }

  _initLighting() {
    this.hemiLight = new THREE.HemisphereLight(0xcbe0ef, 0x5c4736, 0.95);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xffe7c4, 2.05);
    this.sunLight.position.set(54, 76, 44);
    this.sunLight.castShadow = !this.isSoftwareGl;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.near = 6;
    this.sunLight.shadow.camera.far = 260;
    const d = 75;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.0005;
    this.sunLight.shadow.normalBias = 0.025;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    this.rimLight = new THREE.DirectionalLight(0xffcf9e, 0.52);
    this.rimLight.position.set(-48, 26, -52);
    this.scene.add(this.rimLight);
  }

  _initFloatingIsland() {
    const worldData = buildOpenWorldChunks();
    this.worldLanternSpots = worldData.lanternSpots || [];
    this.worldFloraCandidates = worldData.floraCandidates || [];
    this.terrainChunkMeshes = [];

    for (const chunk of worldData.chunks) {
      const blocks = chunk.blocks;
      if (!blocks || blocks.length === 0) continue;

      const chunkMesh = new THREE.InstancedMesh(this.voxelGeo, this.voxelMat, blocks.length);
      chunkMesh.instanceColor = new THREE.InstancedBufferAttribute(
        new Float32Array(blocks.length * 3),
        3
      );
      chunkMesh.receiveShadow = !this.isSoftwareGl;
      chunkMesh.castShadow = !this.isSoftwareGl;
      chunkMesh.frustumCulled = true;

      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i];
        _mat4.makeTranslation(b.x, b.y, b.z);
        chunkMesh.setMatrixAt(i, _mat4);
        _color.setHex(b.color);
        chunkMesh.setColorAt(i, _color);
      }
      chunkMesh.instanceMatrix.needsUpdate = true;
      chunkMesh.instanceColor.needsUpdate = true;
      chunkMesh.computeBoundingSphere();

      this.terrainChunkMeshes.push(chunkMesh);
      this.islandRoot.add(chunkMesh);
    }

    // Batched procedural ambient nature props (trees, boulders, bushes, bridge railings, lantern posts)
    const ambientBlocks = worldData.ambientBlocks || [];
    if (ambientBlocks.length > 0) {
      const ambientMesh = new THREE.InstancedMesh(
        this.voxelGeo,
        this.voxelMat,
        ambientBlocks.length
      );
      ambientMesh.instanceColor = new THREE.InstancedBufferAttribute(
        new Float32Array(ambientBlocks.length * 3),
        3
      );
      ambientMesh.castShadow = !this.isSoftwareGl;
      ambientMesh.receiveShadow = !this.isSoftwareGl;
      ambientMesh.frustumCulled = true;

      for (let i = 0; i < ambientBlocks.length; i++) {
        const ab = ambientBlocks[i];
        _mat4.makeTranslation(ab.x, ab.y, ab.z);
        ambientMesh.setMatrixAt(i, _mat4);
        _color.setHex(ab.color);
        ambientMesh.setColorAt(i, _color);
      }
      ambientMesh.instanceMatrix.needsUpdate = true;
      ambientMesh.instanceColor.needsUpdate = true;
      ambientMesh.computeBoundingSphere();

      this.ambientMesh = ambientMesh;
      this.islandRoot.add(ambientMesh);
    }

    // Fallback invisible base plane spanning full 260x260 island
    const surfaceGeo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE);
    surfaceGeo.rotateX(-Math.PI / 2);
    const surfaceMat = new THREE.MeshBasicMaterial({ visible: false });
    this.topSurfacePlane = new THREE.Mesh(surfaceGeo, surfaceMat);
    this.topSurfacePlane.position.set(-0.5, 0.0, -0.5);
    this.islandRoot.add(this.topSurfacePlane);
  }

  _initFloraAndLanternLights() {
    // Decorative voxel grass tufts & wildflower blossoms scattered across empty tiles
    this.floraCandidates = this.worldFloraCandidates || [];
    const maxFlora = Math.max(1, this.floraCandidates.length);
    const tuftGeo = new THREE.BoxGeometry(0.26, 0.36, 0.26);
    const tuftMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.85,
      metalness: 0.0,
    });
    this.floraMesh = new THREE.InstancedMesh(tuftGeo, tuftMat, maxFlora);
    this.floraMesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(maxFlora * 3),
      3
    );
    this.floraMesh.count = 0;
    this.floraMesh.frustumCulled = false;
    this.islandRoot.add(this.floraMesh);

    // Pooled warm lantern PointLights (max 5 active per GPU/software budget)
    this.lanternLights = [];
    for (let i = 0; i < 5; i++) {
      const pl = new THREE.PointLight(0xffb85c, 0, 16, 1.65);
      pl.visible = false;
      this.islandRoot.add(pl);
      this.lanternLights.push(pl);
    }

    this.buildingsGroup = new THREE.Group();
    this.islandRoot.add(this.buildingsGroup);
    this.hitboxes = [];
  }

  _initCentralCafe() {
    this.cafeBuild = createCentralCafeGroup(this.voxelGeo, this.voxelMat, this.isSoftwareGl);
    this.islandRoot.add(this.cafeBuild.group);
    this.cafeLanterns = this.cafeBuild.lanterns || [];
    this.seatHitboxes = this.cafeBuild.seatHitboxes || [];
  }

  _initCharacter() {
    this.characterRig = new VoxelCharacterRig(this.callbacks.characterConfig);
    if (this.callbacks.characterName) {
      this.characterRig.setName(this.callbacks.characterName);
    }
    this.islandRoot.add(this.characterRig.root);
  }

  setCharacterConfig(nextConfig) {
    if (!this.characterRig) return;
    this.characterRig.applyConfig(nextConfig);
    if (this.isSoftwareGl) {
      this.renderer.render(this.scene, this.camera);
    }
  }

  setCharacterName(name) {
    if (!this.characterRig) return;
    this.characterRig.setName(name);
    if (this.isSoftwareGl) {
      this.renderer.render(this.scene, this.camera);
    }
  }

  setLocalSpeaking(active) {
    if (!this.characterRig) return;
    this.characterRig.setSpeaking(active);
  }

  getLocalWalkSnapshot() {
    return {
      x: this.walkState.x,
      y: this.walkState.y,
      z: this.walkState.z,
      yaw: this.walkState.charYaw,
      isSitting: this.walkState.isSitting,
      seatId: this.walkState.seatId,
      visible: this.cameraMode === 'walk' && this.walkState.active,
    };
  }

  getFirstRemotePeerPosition() {
    for (const entry of this.remotePeers.values()) {
      if (entry.state) {
        return { x: entry.state.x, z: entry.state.z };
      }
    }
    return null;
  }

  syncRemotePeers(peersList = []) {
    const keepIds = new Set();
    for (const p of peersList) {
      if (!p || !p.id) continue;
      keepIds.add(p.id);
      this.upsertRemotePeer(p);
    }
    for (const existingId of Array.from(this.remotePeers.keys())) {
      if (!keepIds.has(existingId)) {
        this.removeRemotePeer(existingId);
      }
    }
  }

  upsertRemotePeer(peer) {
    if (!peer || !peer.id) return;
    let entry = this.remotePeers.get(peer.id);
    if (!entry) {
      const rig = new VoxelCharacterRig(peer.characterConfig);
      rig.setName(peer.builderName || 'مستكشف');
      rig.setSpeaking(Boolean(peer.speaking));
      rig.root.visible = peer.visible !== false;
      rig.setGroundedPosition(peer.x || 0, peer.y || 0, peer.z || 11.5, peer.yaw || 0, 0);
      this.islandRoot.add(rig.root);
      entry = {
        rig,
        state: { ...peer },
        targetX: Number(peer.x) || 0,
        targetY: Number(peer.y) || 0,
        targetZ: Number(peer.z) || 11.5,
        targetYaw: Number(peer.yaw) || 0,
        curX: Number(peer.x) || 0,
        curY: Number(peer.y) || 0,
        curZ: Number(peer.z) || 11.5,
        curYaw: Number(peer.yaw) || 0,
        speedRatio: 0,
      };
      this.remotePeers.set(peer.id, entry);
      return;
    }

    entry.state = { ...entry.state, ...peer };
    entry.rig.applyConfig(peer.characterConfig);
    entry.rig.setName(peer.builderName || 'مستكشف');
    entry.rig.setSpeaking(Boolean(peer.speaking));
    entry.rig.root.visible = peer.visible !== false;
    entry.targetX = Number(peer.x) || 0;
    entry.targetY = Number(peer.y) || 0;
    entry.targetZ = Number(peer.z) || 11.5;
    entry.targetYaw = Number(peer.yaw) || 0;
  }

  updateRemotePeerSpeaking(peerId, speaking) {
    const entry = this.remotePeers.get(peerId);
    if (!entry) return;
    entry.state.speaking = Boolean(speaking);
    entry.rig.setSpeaking(Boolean(speaking));
  }

  removeRemotePeer(peerId) {
    const entry = this.remotePeers.get(peerId);
    if (!entry) return;
    this.islandRoot.remove(entry.rig.root);
    entry.rig.dispose();
    this.remotePeers.delete(peerId);
  }

  setWelcomeShowcase(active) {
    const next = Boolean(active);
    this.welcomeShowcase = next;
    if (next) {
      if (this.cameraMode === 'walk') {
        this.setCameraMode('orbit');
      }
      this.hoverGroup.visible = false;
      this.setSelectedPlot(null, null);
      this.controls.enabled = false;
      this.cameraTargetGoal = null;
      this.cameraPosGoal = null;
    } else {
      this.controls.enabled = this.cameraMode !== 'walk';
      this.controls.target.set(-0.5, 2.0, -0.5);
      if (this.isSoftwareGl) {
        this.camera.position.set(42, 34, 48);
        this.cameraTargetGoal = null;
        this.cameraPosGoal = null;
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
      } else {
        this.resetCamera();
      }
    }
  }

  _initCursors() {
    const plotDim = PLOT_HALF_SIZE * 2 + 1; // 9x9

    // Hover footprint cursor
    this.hoverGroup = new THREE.Group();
    const fillGeo = new THREE.PlaneGeometry(plotDim, plotDim);
    fillGeo.rotateX(-Math.PI / 2);
    this.hoverFillMat = new THREE.MeshBasicMaterial({
      color: 0x4ea879,
      transparent: true,
      opacity: 0.24,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const fillMesh = new THREE.Mesh(fillGeo, this.hoverFillMat);
    fillMesh.position.y = 0.025;

    const borderGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(plotDim, 0.08, plotDim));
    this.hoverLineMat = new THREE.LineBasicMaterial({
      color: 0x62bf8d,
      transparent: true,
      opacity: 0.88,
    });
    const borderLines = new THREE.LineSegments(borderGeo, this.hoverLineMat);
    borderLines.position.y = 0.05;

    // Subtle 9x9 internal grid lines inside footprint
    const gridPts = [];
    const halfSpan = plotDim / 2;
    for (let i = -halfSpan + 1; i < halfSpan; i += 1) {
      gridPts.push(i, 0.035, -halfSpan, i, 0.035, halfSpan);
      gridPts.push(-halfSpan, 0.035, i, halfSpan, 0.035, i);
    }
    const innerGridGeo = new THREE.BufferGeometry();
    innerGridGeo.setAttribute('position', new THREE.Float32BufferAttribute(gridPts, 3));
    this.hoverInnerLineMat = new THREE.LineBasicMaterial({
      color: 0x62bf8d,
      transparent: true,
      opacity: 0.35,
    });
    const innerGrid = new THREE.LineSegments(innerGridGeo, this.hoverInnerLineMat);

    this.hoverGroup.add(fillMesh, borderLines, innerGrid);
    this.hoverGroup.visible = false;
    this.islandRoot.add(this.hoverGroup);

    // Locked selected plot indicator
    this.selectedPlotGroup = new THREE.Group();
    const selBorderGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(plotDim, 0.14, plotDim));
    const selLineMat = new THREE.LineBasicMaterial({
      color: 0xd89e52,
      transparent: true,
      opacity: 0.92,
    });
    const selFillMat = new THREE.MeshBasicMaterial({
      color: 0xd89e52,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const selFill = new THREE.Mesh(fillGeo.clone(), selFillMat);
    selFill.position.y = 0.03;
    const selLines = new THREE.LineSegments(selBorderGeo, selLineMat);
    selLines.position.y = 0.08;
    this.selectedPlotGroup.add(selFill, selLines);
    this.selectedPlotGroup.visible = false;
    this.islandRoot.add(this.selectedPlotGroup);
  }

  _initEvents() {
    const dom = this.renderer.domElement;

    this._onPointerMove = (e) => {
      if (this.cameraMode === 'walk') {
        this.hoverGroup.visible = false;
        if (!this.walkState.dragging) {
          const now = performance.now();
          if (now - this.lastHoverRaycast >= 48) {
            this.lastHoverRaycast = now;
            this._setPointerNdc(e);
            this.raycaster.setFromCamera(this.pointerNdc, this.camera);
            const sHits = this.seatHitboxes?.length
              ? this.raycaster.intersectObjects(this.seatHitboxes, false)
              : [];
            const bHits = this.raycaster.intersectObjects(this.hitboxes, false);
            dom.style.cursor = sHits.length > 0 || bHits.length > 0 ? 'pointer' : 'grab';
          }
        }
        return;
      }

      const now = performance.now();
      if (now - this.lastHoverRaycast < 32) return;
      this.lastHoverRaycast = now;
      this._updateHover(e);
    };

    this._onWindowPointerMove = (e) => {
      if (this.cameraMode !== 'walk' || !this.walkState.dragging) return;
      const dx = e.clientX - this.walkState.lastX;
      const dy = e.clientY - this.walkState.lastY;
      this.walkState.lastX = e.clientX;
      this.walkState.lastY = e.clientY;
      this.walkState.camYaw -= dx * 0.0055;
      this.walkState.camPitch = THREE.MathUtils.clamp(
        this.walkState.camPitch + dy * 0.0045,
        0.12,
        1.08
      );
    };

    this._onWheel = (e) => {
      if (this.cameraMode !== 'walk') return;
      this.walkState.camDist = THREE.MathUtils.clamp(
        this.walkState.camDist + e.deltaY * 0.004,
        3.8,
        10.5
      );
    };

    this._onPointerDown = (e) => {
      this.pointerDownPos = { x: e.clientX, y: e.clientY };
      if (this.cameraMode === 'walk' && e.button === 0) {
        this.walkState.dragging = true;
        this.walkState.lastX = e.clientX;
        this.walkState.lastY = e.clientY;
        dom.style.cursor = 'grabbing';
      }
    };

    this._onWindowPointerUp = () => {
      if (this.walkState.dragging) {
        this.walkState.dragging = false;
        if (this.cameraMode === 'walk') {
          dom.style.cursor = 'grab';
        }
      }
    };

    this._onPointerUp = (e) => {
      if (e.button !== 0) return;
      const dist = Math.hypot(
        e.clientX - this.pointerDownPos.x,
        e.clientY - this.pointerDownPos.y
      );
      if (dist > 6) return; // Was an orbit/pan/look drag, not a click
      this._handleCanvasClick(e);
    };

    this._onKeyDown = (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (this.cameraMode === 'walk' && !e.repeat && (e.code === 'KeyE' || e.key === 'e' || e.key === 'E' || e.key === 'ث')) {
        e.preventDefault();
        this.toggleSitNearSeat();
        return;
      }

      const keyId = this._normalizeWalkKey(e);
      if (!keyId) return;
      if (this.cameraMode === 'walk') {
        if (e.code.startsWith('Arrow') || keyId === 'jump') {
          e.preventDefault();
        }
        if (keyId === 'jump' && !e.repeat) {
          if (this.walkState.isSitting) {
            this.standUpFromSeat();
          } else {
            this.walkState.jumpQueued = true;
          }
        } else if (
          this.walkState.isSitting &&
          (keyId === 'forward' || keyId === 'backward' || keyId === 'left' || keyId === 'right')
        ) {
          this.standUpFromSeat();
        }
      }
      this.walkState.keys.add(keyId);
    };

    this._onKeyUp = (e) => {
      const keyId = this._normalizeWalkKey(e);
      if (keyId) {
        this.walkState.keys.delete(keyId);
      }
    };

    this._onWindowBlur = () => {
      this.walkState.keys.clear();
      this.walkState.dragging = false;
    };

    this._onResize = () => {
      const w = this.container.clientWidth || window.innerWidth;
      const h = this.container.clientHeight || window.innerHeight;
      this.camera.aspect = w / h;
      // Widen FOV slightly on narrow portrait viewports so the 40x40 island stays framed
      this.camera.fov = this.camera.aspect < 0.8 ? 58 : 44;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
      this.renderer.render(this.scene, this.camera);
    };

    this._onContextLost = (e) => {
      e.preventDefault();
    };

    dom.addEventListener('pointermove', this._onPointerMove);
    dom.addEventListener('pointerdown', this._onPointerDown);
    dom.addEventListener('pointerup', this._onPointerUp);
    dom.addEventListener('wheel', this._onWheel, { passive: true });
    dom.addEventListener('webglcontextlost', this._onContextLost);
    window.addEventListener('pointermove', this._onWindowPointerMove);
    window.addEventListener('pointerup', this._onWindowPointerUp);
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onWindowBlur);
    window.addEventListener('resize', this._onResize);
  }

  _normalizeWalkKey(e) {
    switch (e.code) {
      case 'KeyW':
      case 'ArrowUp':
        return 'forward';
      case 'KeyS':
      case 'ArrowDown':
        return 'backward';
      case 'KeyA':
      case 'ArrowLeft':
        return 'left';
      case 'KeyD':
      case 'ArrowRight':
        return 'right';
      case 'Space':
        return 'jump';
      case 'ShiftLeft':
      case 'ShiftRight':
        return 'sprint';
      default: {
        const k = String(e.key || '').toLowerCase();
        if (k === 'w') return 'forward';
        if (k === 's') return 'backward';
        if (k === 'a') return 'left';
        if (k === 'd') return 'right';
        if (k === ' ') return 'jump';
        return null;
      }
    }
  }

  _setPointerNdc(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  _raycastTerrainSurface() {
    this.raycaster.near = 0.5;
    this.raycaster.far = 2000;
    const planeHits = this.raycaster.intersectObject(this.topSurfacePlane, false);
    return planeHits.length > 0 ? planeHits[0] : null;
  }

  _updateHover(e) {
    if (this.welcomeShowcase || this.cameraMode === 'walk') {
      this.hoverGroup.visible = false;
      return;
    }

    this._setPointerNdc(e);
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);

    // Check if hovering over an existing building first
    const bHits = this.raycaster.intersectObjects(this.hitboxes, false);
    if (bHits.length > 0) {
      this.hoverGroup.visible = false;
      this.renderer.domElement.style.cursor = 'pointer';
      return;
    }

    const hit = this._raycastTerrainSurface();
    if (!hit) {
      this.hoverGroup.visible = false;
      this.renderer.domElement.style.cursor = this.cameraMode === 'pan' ? 'grab' : 'default';
      return;
    }

    const localPt = this.islandRoot.worldToLocal(_vec3.copy(hit.point));
    const gx = Math.round(localPt.x);
    const gz = Math.round(localPt.z);
    this.hoverGrid = { gx, gz };

    const check = checkPlotAvailability(
      gx,
      gz,
      this.buildingsState,
      Array.from(this.constructionSites.values())
    );

    this.hoverGroup.position.set(gx, 0, gz);
    this.hoverGroup.visible = true;

    if (check.valid) {
      this.hoverFillMat.color.setHex(0x4ea879);
      this.hoverLineMat.color.setHex(0x62bf8d);
      this.hoverInnerLineMat.color.setHex(0x62bf8d);
      this.renderer.domElement.style.cursor = 'crosshair';
    } else {
      this.hoverFillMat.color.setHex(0xc95d4e);
      this.hoverLineMat.color.setHex(0xde7262);
      this.hoverInnerLineMat.color.setHex(0xde7262);
      this.renderer.domElement.style.cursor = 'not-allowed';
    }
  }

  _handleCanvasClick(e) {
    if (this.welcomeShowcase) return;
    this._setPointerNdc(e);
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);

    // 1. Check interactive Cafe chair/bench click in Walk mode
    if (this.cameraMode === 'walk' && this.seatHitboxes?.length) {
      const sHits = this.raycaster.intersectObjects(this.seatHitboxes, false);
      if (sHits.length > 0) {
        const seatId = sHits[0].object.userData.seatId;
        const seat = CAFE_SEATS.find((s) => s.id === seatId);
        if (seat && Math.hypot(this.walkState.x - seat.x, this.walkState.z - seat.z) <= 4.5) {
          this.toggleSitNearSeat(seat.id);
          return;
        }
      }
    }

    // 2. Check building click first (works in all camera modes including Walk)
    const bHits = this.raycaster.intersectObjects(this.hitboxes, false);
    if (bHits.length > 0) {
      const buildingId = bHits[0].object.userData.buildingId;
      if (buildingId && this.callbacks.onSelectBuilding) {
        this.callbacks.onSelectBuilding(buildingId);
      }
      return;
    }

    // Do not select build plots by clicking the ground in Walk mode
    if (this.cameraMode === 'walk') return;

    // 3. Otherwise check island terrain plot click
    const hit = this._raycastTerrainSurface();
    if (!hit) return;

    const localPt = this.islandRoot.worldToLocal(_vec3.copy(hit.point));
    const gx = Math.round(localPt.x);
    const gz = Math.round(localPt.z);

    const check = checkPlotAvailability(
      gx,
      gz,
      this.buildingsState,
      Array.from(this.constructionSites.values())
    );

    if (check.valid) {
      this.setSelectedPlot(gx, gz);
      if (this.callbacks.onSelectPlot) {
        this.callbacks.onSelectPlot(gx, gz);
      }
    } else if (this.callbacks.onInvalidPlot) {
      this.callbacks.onInvalidPlot(check.reason);
    }
  }

  _notifySeatPrompt() {
    if (!this.callbacks.onNearSeatChange) return;
    if (this.cameraMode !== 'walk' || !this.walkState.active) {
      this.callbacks.onNearSeatChange(null);
      return;
    }
    if (this.walkState.isSitting) {
      const currentSeat = CAFE_SEATS.find((s) => s.id === this.walkState.seatId) || null;
      this.callbacks.onNearSeatChange(currentSeat ? { seat: currentSeat, isSitting: true } : null);
      return;
    }
    const near = findNearestCafeSeat(this.walkState.x, this.walkState.z, 2.25);
    this.callbacks.onNearSeatChange(near ? { seat: near.seat, isSitting: false } : null);
  }

  sitOnSeat(seatId) {
    const seat = CAFE_SEATS.find((s) => s.id === seatId);
    if (!seat || this.cameraMode !== 'walk') return false;

    this.walkState.isSitting = true;
    this.walkState.seatId = seat.id;
    this.walkState.nearSeatId = seat.id;
    this.walkState.x = seat.x;
    this.walkState.y = seat.seatY;
    this.walkState.z = seat.z;
    this.walkState.vy = 0;
    this.walkState.vx = 0;
    this.walkState.vz = 0;
    this.walkState.isGrounded = true;
    this.walkState.charYaw = seat.yaw;

    if (this.characterRig) {
      this.characterRig.setGroundedPosition(seat.x, seat.seatY, seat.z, seat.yaw, 0);
    }
    document.body.dataset.walkSitting = 'true';
    this._notifySeatPrompt();
    this.callbacks.onLocalTransform?.(this.getLocalWalkSnapshot());
    return true;
  }

  standUpFromSeat() {
    if (!this.walkState.isSitting) return false;
    const seat = CAFE_SEATS.find((s) => s.id === this.walkState.seatId);
    this.walkState.isSitting = false;
    this.walkState.seatId = null;
    if (seat) {
      this.walkState.x = seat.dismountX;
      this.walkState.z = seat.dismountZ;
    }
    this.walkState.y = 0;
    this.walkState.vy = 0;
    this.walkState.isGrounded = true;
    if (this.characterRig) {
      this.characterRig.setGroundedPosition(
        this.walkState.x,
        0,
        this.walkState.z,
        this.walkState.charYaw,
        0
      );
    }
    delete document.body.dataset.walkSitting;
    this._notifySeatPrompt();
    this.callbacks.onLocalTransform?.(this.getLocalWalkSnapshot());
    return true;
  }

  toggleSitNearSeat(explicitSeatId = null) {
    if (this.cameraMode !== 'walk' || !this.walkState.active) return false;
    if (this.walkState.isSitting) {
      return this.standUpFromSeat();
    }
    if (explicitSeatId) {
      return this.sitOnSeat(explicitSeatId);
    }
    const near = findNearestCafeSeat(this.walkState.x, this.walkState.z, 2.35);
    if (near?.seat) {
      return this.sitOnSeat(near.seat.id);
    }
    return false;
  }

  setCameraMode(mode, options = {}) {
    const nextMode = mode === 'pan' || mode === 'walk' ? mode : 'orbit';
    const wasWalk = this.cameraMode === 'walk';
    this.cameraMode = nextMode;

    if (nextMode === 'walk') {
      this.cameraTargetGoal = null;
      this.cameraPosGoal = null;
      this.controls.enabled = false;
      this.hoverGroup.visible = false;
      this.setSelectedPlot(null, null);

      const spawnTarget = options.customSpawn || this.getFirstRemotePeerPosition();
      const spawn = findWalkSpawnPoint(this.buildingsState, spawnTarget);
      const groundY = getTerrainHeightAt(spawn.x, spawn.z);
      this.walkState.active = true;
      this.walkState.isSitting = false;
      this.walkState.seatId = null;
      this.walkState.nearSeatId = null;
      this.walkState.x = spawn.x;
      this.walkState.y = groundY;
      this.walkState.z = spawn.z;
      this.walkState.vy = 0;
      this.walkState.isGrounded = true;
      this.walkState.jumpQueued = false;
      this.walkState.charYaw = spawn.yaw;
      this.walkState.camYaw = spawn.yaw;
      this.walkState.camPitch = 0.34;
      this.walkState.vx = 0;
      this.walkState.vz = 0;
      this.walkState.dragging = false;
      this.walkState.keys.clear();
      delete document.body.dataset.walkSitting;

      if (this.characterRig) {
        this.characterRig.root.visible = true;
        this.characterRig.setGroundedPosition(
          this.walkState.x,
          this.walkState.y,
          this.walkState.z,
          this.walkState.charYaw,
          groundY
        );
      }

      this.renderer.domElement.style.cursor = 'grab';
      document.body.dataset.walkPos = `${this.walkState.x.toFixed(2)},${this.walkState.z.toFixed(2)}`;
      document.body.dataset.walkY = this.walkState.y.toFixed(2);
      document.body.dataset.walkGrounded = 'true';
      this._notifySeatPrompt();
      this.callbacks.onLocalTransform?.(this.getLocalWalkSnapshot());

      if (this.isSoftwareGl) {
        this._positionThirdPersonCamera(1);
        this.renderer.render(this.scene, this.camera);
      }
      return;
    }

    this.walkState.active = false;
    this.walkState.isSitting = false;
    this.walkState.seatId = null;
    this.walkState.dragging = false;
    this.walkState.jumpQueued = false;
    this.walkState.keys.clear();
    if (this.characterRig) {
      this.characterRig.root.visible = false;
    }
    delete document.body.dataset.walkPos;
    delete document.body.dataset.walkY;
    delete document.body.dataset.walkGrounded;
    delete document.body.dataset.walkSitting;
    this._notifySeatPrompt();
    this.callbacks.onLocalTransform?.(this.getLocalWalkSnapshot());

    if (nextMode === 'pan') {
      this.controls.mouseButtons = {
        LEFT: THREE.MOUSE.PAN,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.ROTATE,
      };
      this.controls.touches = {
        ONE: THREE.TOUCH.PAN,
        TWO: THREE.TOUCH.DOLLY_ROTATE,
      };
      this.renderer.domElement.style.cursor = 'grab';
    } else {
      this.controls.mouseButtons = {
        LEFT: THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN,
      };
      this.controls.touches = {
        ONE: THREE.TOUCH.ROTATE,
        TWO: THREE.TOUCH.DOLLY_PAN,
      };
      this.renderer.domElement.style.cursor = 'default';
    }

    if (wasWalk) {
      if (this.isSoftwareGl) {
        this.controls.target.set(-0.5, 1.5, -0.5);
        this.camera.position.set(42, 34, 48);
        this.cameraTargetGoal = null;
        this.cameraPosGoal = null;
      } else {
        this.controls.target.set(this.walkState.x, this.walkState.y + 1.4, this.walkState.z);
        this.resetCamera();
      }
    }
    this.controls.enabled = true;
    if (this.isSoftwareGl) {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    }
  }

  teleportWalkToCenter() {
    if (this.cameraMode !== 'walk') {
      this.resetCamera();
      return;
    }
    const spawn = findWalkSpawnPoint(this.buildingsState);
    const groundY = Math.max(0, getTerrainHeightAt(spawn.x, spawn.z));
    this.walkState.x = spawn.x;
    this.walkState.y = groundY;
    this.walkState.z = spawn.z;
    this.walkState.vy = 0;
    this.walkState.isGrounded = true;
    this.walkState.jumpQueued = false;
    this.walkState.vx = 0;
    this.walkState.vz = 0;
    this.walkState.charYaw = spawn.yaw;
    this.walkState.camYaw = spawn.yaw;

    if (this.characterRig) {
      this.characterRig.setGroundedPosition(
        this.walkState.x,
        this.walkState.y,
        this.walkState.z,
        this.walkState.charYaw,
        groundY
      );
    }

    document.body.dataset.walkPos = `${this.walkState.x.toFixed(2)},${this.walkState.z.toFixed(2)}`;
    document.body.dataset.walkY = this.walkState.y.toFixed(2);
    document.body.dataset.walkGrounded = 'true';

    this._positionThirdPersonCamera(1);
    if (this.isSoftwareGl) {
      this.renderer.render(this.scene, this.camera);
    }
  }

  _positionThirdPersonCamera(camAlpha) {
    const islandY = this.islandRoot.position.y;
    _walkAnchor.set(
      this.walkState.x,
      this.walkState.y + 1.28 + islandY,
      this.walkState.z
    );

    const cosP = Math.cos(this.walkState.camPitch);
    const sinP = Math.sin(this.walkState.camPitch);
    const sinY = Math.sin(this.walkState.camYaw);
    const cosY = Math.cos(this.walkState.camYaw);

    _walkRayDir.set(sinY * cosP, sinP, cosY * cosP).normalize();
    let effectiveDist = this.walkState.camDist;

    if (this.hitboxes.length > 0) {
      this.raycaster.set(_walkAnchor, _walkRayDir);
      this.raycaster.near = 0.2;
      this.raycaster.far = effectiveDist;
      const hits = this.raycaster.intersectObjects(this.hitboxes, false);
      if (hits.length > 0) {
        effectiveDist = Math.max(2.1, hits[0].distance - 0.35);
      }
    }

    _walkTargetPos.copy(_walkAnchor).addScaledVector(_walkRayDir, effectiveDist);
    // Keep camera safely above the hill/island terrain beneath it
    const camGroundY = Math.max(0, getTerrainHeightAt(_walkTargetPos.x, _walkTargetPos.z));
    const minCamY = islandY + camGroundY + 0.85;
    if (_walkTargetPos.y < minCamY) {
      _walkTargetPos.y = minCamY;
    }

    this.camera.position.lerp(_walkTargetPos, camAlpha);
    this.camera.lookAt(_walkAnchor);
  }

  setSelectedPlot(gx, gz) {
    if (gx === null || gz === null) {
      this.selectedPlot = null;
      this.selectedPlotGroup.visible = false;
      return;
    }
    this.selectedPlot = { gx, gz };
    this.selectedPlotGroup.position.set(gx, 0, gz);
    this.selectedPlotGroup.visible = true;
  }

  setSelectedBuildingId(buildingId) {
    this.selectedBuildingId = buildingId;
    for (const [id, entry] of this.buildingEntries.entries()) {
      if (entry.selectionRing) {
        entry.selectionRing.visible = id === buildingId;
      }
    }
  }

  focusOnPoint(gx, gz, height = 4) {
    this.cameraTargetGoal = new THREE.Vector3(gx, height, gz);
    const offset = new THREE.Vector3(16, 14, 18);
    this.cameraPosGoal = new THREE.Vector3(gx, height, gz).add(offset);
  }

  resetCamera() {
    this.cameraTargetGoal = new THREE.Vector3(-0.5, 1.5, -0.5);
    this.cameraPosGoal = new THREE.Vector3(42, 34, 48);
  }

  /**
   * Spawns a 3D Voxel Construction Site with wooden/amber scaffolding and pulsing progress ring.
   */
  addConstructionSite(siteId, gx, gz) {
    if (this.constructionSites.has(siteId)) return;

    const group = new THREE.Group();
    group.position.set(gx, 0, gz);

    const poleMat = new THREE.MeshStandardMaterial({
      color: 0xb8864b,
      roughness: 0.72,
      metalness: 0.08,
    });
    const barrierMat = new THREE.MeshStandardMaterial({
      color: 0xd89e52,
      roughness: 0.55,
      metalness: 0.1,
    });
    const darkTrimMat = new THREE.MeshStandardMaterial({
      color: 0x3b332b,
      roughness: 0.75,
      metalness: 0.15,
    });

    const poleGeo = new THREE.CylinderGeometry(0.11, 0.13, 5.2, 8);
    const beamGeo = new THREE.BoxGeometry(8.2, 0.14, 0.14);
    const postGeo = new THREE.BoxGeometry(0.24, 0.75, 0.24);
    const railGeo = new THREE.BoxGeometry(8.4, 0.18, 0.14);

    const corners = [
      [-4, -4],
      [4, -4],
      [-4, 4],
      [4, 4],
    ];
    for (const [cx, cz] of corners) {
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.set(cx, 2.6, cz);
      pole.castShadow = !this.isSoftwareGl;
      group.add(pole);

      const post = new THREE.Mesh(postGeo, darkTrimMat);
      post.position.set(cx, 0.38, cz);
      group.add(post);
    }

    // Upper scaffolding crossbeams
    for (const y of [2.5, 4.9]) {
      const b1 = new THREE.Mesh(beamGeo, poleMat);
      b1.position.set(0, y, -4);
      const b2 = new THREE.Mesh(beamGeo, poleMat);
      b2.position.set(0, y, 4);
      const b3 = new THREE.Mesh(beamGeo, poleMat);
      b3.rotation.y = Math.PI / 2;
      b3.position.set(-4, y, 0);
      const b4 = new THREE.Mesh(beamGeo, poleMat);
      b4.rotation.y = Math.PI / 2;
      b4.position.set(4, y, 0);
      group.add(b1, b2, b3, b4);
    }

    // Low caution barrier rails
    const r1 = new THREE.Mesh(railGeo, barrierMat);
    r1.position.set(0, 0.52, -4);
    const r2 = new THREE.Mesh(railGeo, barrierMat);
    r2.position.set(0, 0.52, 4);
    const r3 = new THREE.Mesh(railGeo, barrierMat);
    r3.rotation.y = Math.PI / 2;
    r3.position.set(-4, 0.52, 0);
    const r4 = new THREE.Mesh(railGeo, barrierMat);
    r4.rotation.y = Math.PI / 2;
    r4.position.set(4, 0.52, 0);
    group.add(r1, r2, r3, r4);

    // Subtle pulsing wireframe progress ring
    const ringGeo = new THREE.RingGeometry(2.4, 2.75, 32);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xe3a857,
      transparent: true,
      opacity: 0.72,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.y = 0.14;
    group.add(ring);

    const wireBoxGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(6.5, 4.5, 6.5));
    const wireBoxMat = new THREE.LineBasicMaterial({
      color: 0xd89e52,
      transparent: true,
      opacity: 0.35,
    });
    const wireBox = new THREE.LineSegments(wireBoxGeo, wireBoxMat);
    wireBox.position.y = 2.25;
    group.add(wireBox);

    this.islandRoot.add(group);
    this.constructionSites.set(siteId, {
      id: siteId,
      gx,
      gz,
      group,
      ring,
      ringMat,
      wireBoxMat,
      startedAt: performance.now(),
    });
    this.renderer.render(this.scene, this.camera);
  }

  removeConstructionSite(siteId) {
    const site = this.constructionSites.get(siteId);
    if (!site) return;
    this.islandRoot.remove(site.group);
    site.group.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    });
    this.constructionSites.delete(siteId);
  }

  /**
   * Syncs the full list of buildings, animating any newly added building layer-by-layer.
   */
  syncBuildings(buildings, animateNewIds = new Set()) {
    this.buildingsState = buildings;

    const currentIds = new Set(buildings.map((b) => b.id));
    // Remove deleted buildings
    for (const [id, entry] of this.buildingEntries.entries()) {
      if (!currentIds.has(id)) {
        this._disposeBuildingEntry(id, entry);
      }
    }

    // Add or update buildings
    for (const b of buildings) {
      const existing = this.buildingEntries.get(b.id);
      if (!existing) {
        const shouldAnimate = animateNewIds.has(b.id);
        this._createBuildingEntry(b, shouldAnimate);
      } else {
        // Update lantern badge if likes changed
        this._updateBuildingLantern(existing, b);
      }
    }

    this._updateIslandVitality();
  }

  _createBuildingEntry(b, animateReveal) {
    const group = new THREE.Group();
    group.position.set(b.gx, 0, b.gz);

    const count = b.voxels.length;
    const mesh = new THREE.InstancedMesh(this.voxelGeo, this.voxelMat, count);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    mesh.castShadow = !this.isSoftwareGl;
    mesh.receiveShadow = !this.isSoftwareGl;
    mesh.frustumCulled = !animateReveal;

    let maxY = 0;
    let minX = 0;
    let maxX = 0;
    let minZ = 0;
    let maxZ = 0;

    for (let i = 0; i < count; i++) {
      const v = b.voxels[i];
      if (v.y > maxY) maxY = v.y;
      if (v.x < minX) minX = v.x;
      if (v.x > maxX) maxX = v.x;
      if (v.z < minZ) minZ = v.z;
      if (v.z > maxZ) maxZ = v.z;

      _color.set(v.c);
      mesh.setColorAt(i, _color);

      if (animateReveal) {
        _mat4.makeScale(0.001, 0.001, 0.001);
        _mat4.setPosition(v.x, v.y + 0.5, v.z);
      } else {
        _mat4.makeTranslation(v.x, v.y + 0.5, v.z);
      }
      mesh.setMatrixAt(i, _mat4);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();

    group.add(mesh);

    // Simplified bounding hitbox for fast click raycasting
    const spanX = Math.max(3, maxX - minX + 1.4);
    const spanZ = Math.max(3, maxZ - minZ + 1.4);
    const spanY = Math.max(2, maxY + 1.2);
    const hitGeo = new THREE.BoxGeometry(spanX, spanY, spanZ);
    const hitMat = new THREE.MeshBasicMaterial({ visible: false });
    const hitbox = new THREE.Mesh(hitGeo, hitMat);
    hitbox.position.set((minX + maxX) / 2, spanY / 2, (minZ + maxZ) / 2);
    hitbox.userData.buildingId = b.id;
    group.add(hitbox);
    this.hitboxes.push(hitbox);

    // Selection outline ring
    const selGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(9, 0.14, 9));
    const selMat = new THREE.LineBasicMaterial({ color: 0xe3b166 });
    const selectionRing = new THREE.LineSegments(selGeo, selMat);
    selectionRing.position.y = 0.07;
    selectionRing.visible = b.id === this.selectedBuildingId;
    group.add(selectionRing);

    // Warm lantern prop next to the structure
    const lanternGroup = this._buildLanternProp(b.likes > 0);
    lanternGroup.position.set(4.1, 0, 4.1);
    group.add(lanternGroup);

    this.buildingsGroup.add(group);

    this.buildingEntries.set(b.id, {
      id: b.id,
      building: b,
      group,
      mesh,
      hitbox,
      selectionRing,
      lanternGroup,
      maxY,
      animating: animateReveal,
      revealStartTime: performance.now(),
      revealDuration: Math.min(1.35, 0.72 + maxY * 0.045),
    });
  }

  _buildLanternProp(isPopular) {
    const g = new THREE.Group();
    const postMat = new THREE.MeshStandardMaterial({
      color: isPopular ? 0x9b6d38 : 0x5c422a,
      roughness: isPopular ? 0.45 : 0.8,
      metalness: isPopular ? 0.35 : 0.05,
    });
    const coreMat = new THREE.MeshStandardMaterial({
      color: 0xffd27d,
      emissive: 0xe89b3c,
      emissiveIntensity: isPopular ? 1.4 : 0.75,
      roughness: 0.3,
    });

    const base = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.25, 0.42), postMat);
    base.position.y = 0.125;
    const pole = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, isPopular ? 1.5 : 1.05, 0.18),
      postMat
    );
    pole.position.y = isPopular ? 0.85 : 0.65;
    const lamp = new THREE.Mesh(
      new THREE.BoxGeometry(isPopular ? 0.42 : 0.3, isPopular ? 0.42 : 0.3, isPopular ? 0.42 : 0.3),
      coreMat
    );
    lamp.position.y = isPopular ? 1.75 : 1.28;
    const cap = new THREE.Mesh(
      new THREE.BoxGeometry(isPopular ? 0.56 : 0.4, 0.14, isPopular ? 0.56 : 0.4),
      postMat
    );
    cap.position.y = isPopular ? 2.02 : 1.48;

    g.add(base, pole, lamp, cap);
    g.userData.isPopular = isPopular;
    return g;
  }

  _updateBuildingLantern(entry, building) {
    entry.building = building;
    const wantPopular = building.likes > 0;
    if (entry.lanternGroup.userData.isPopular !== wantPopular) {
      entry.group.remove(entry.lanternGroup);
      entry.lanternGroup.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
      entry.lanternGroup = this._buildLanternProp(wantPopular);
      entry.lanternGroup.position.set(4.1, 0, 4.1);
      entry.group.add(entry.lanternGroup);
    }
  }

  _disposeBuildingEntry(id, entry) {
    this.buildingsGroup.remove(entry.group);
    const idx = this.hitboxes.indexOf(entry.hitbox);
    if (idx !== -1) this.hitboxes.splice(idx, 1);

    if (entry.mesh) {
      entry.mesh.dispose();
    }
    entry.group.traverse((obj) => {
      if (obj.geometry && obj.geometry !== this.voxelGeo) {
        obj.geometry.dispose();
      }
      if (obj.material && obj.material !== this.voxelMat) {
        obj.material.dispose();
      }
    });
    this.buildingEntries.delete(id);
  }

  _updateIslandVitality() {
    const stats = calculateIslandStats(this.buildingsState);
    this.vitalityRatio = stats.vitalityPercent / 100;

    // 1. Update sky warmth & sunlight warmth
    this.skyUniforms.uWarmth.value = this.vitalityRatio;
    _color.setHex(0xffe7c4).lerp(new THREE.Color(0xffd79e), this.vitalityRatio * 0.45);
    this.sunLight.color.copy(_color);
    this.sunLight.intensity = 1.9 + this.vitalityRatio * 0.45;

    // 2. Dynamic subtle wildflower specks on empty grass tiles as island vitality grows
    const targetFloraCount = Math.min(
      this.floraCandidates.length,
      Math.round(28 + this.vitalityRatio * 200)
    );
    let placed = 0;
    for (let i = 0; i < this.floraCandidates.length && placed < targetFloraCount; i++) {
      const c = this.floraCandidates[i];
      let overlapsBuilding = false;
      for (const b of this.buildingsState) {
        if (Math.abs(c.x - b.gx) <= 4.7 && Math.abs(c.z - b.gz) <= 4.7) {
          overlapsBuilding = true;
          break;
        }
      }
      if (overlapsBuilding) continue;

      _scale.set(c.scale, c.scale, c.scale);
      _quat.identity();
      _vec3.set(c.x, (c.y || 0) + 0.16 * c.scale, c.z);
      _mat4.compose(_vec3, _quat, _scale);
      this.floraMesh.setMatrixAt(placed, _mat4);
      _color.setHex(c.color);
      this.floraMesh.setColorAt(placed, _color);
      placed++;
    }
    this.floraMesh.count = placed;
    this.floraMesh.instanceMatrix.needsUpdate = true;
    if (this.floraMesh.instanceColor) this.floraMesh.instanceColor.needsUpdate = true;

    this._refreshLanternPool();
  }

  _refreshLanternPool() {
    if (!this.lanternLights || this.lanternLights.length === 0) return;

    const focusX = this.walkState.active ? this.walkState.x : this.controls.target.x;
    const focusZ = this.walkState.active ? this.walkState.z : this.controls.target.z;

    const candidates = [];
    for (const b of this.buildingsState) {
      const gy = Math.max(0, getTerrainHeightAt(b.gx, b.gz));
      const lx = b.gx + 4.1;
      const lz = b.gz + 4.1;
      const d2 = (lx - focusX) * (lx - focusX) + (lz - focusZ) * (lz - focusZ);
      candidates.push({
        x: lx,
        y: gy + 2.2,
        z: lz,
        intensity: b.likes > 0 ? 4.2 : 1.9,
        distSq: d2,
      });
    }
    for (const cl of this.cafeLanterns || []) {
      const d2 = (cl.x - focusX) * (cl.x - focusX) + (cl.z - focusZ) * (cl.z - focusZ);
      candidates.push({
        x: cl.x,
        y: cl.y,
        z: cl.z,
        intensity: cl.intensity || 2.8,
        distSq: d2,
      });
    }
    for (const spot of this.worldLanternSpots || []) {
      const d2 = (spot.x - focusX) * (spot.x - focusX) + (spot.z - focusZ) * (spot.z - focusZ);
      candidates.push({
        x: spot.x,
        y: (spot.y || 0) + 2.5,
        z: spot.z,
        intensity: 2.1,
        distSq: d2,
      });
    }

    candidates.sort((a, b) => a.distSq - b.distSq);
    const maxLights = this.isSoftwareGl ? 1 : this.lanternLights.length;
    for (let i = 0; i < this.lanternLights.length; i++) {
      const pl = this.lanternLights[i];
      const item = i < maxLights ? candidates[i] : null;
      if (item) {
        pl.position.set(item.x, item.y, item.z);
        pl.intensity = item.intensity;
        pl.visible = true;
      } else {
        pl.intensity = 0;
        pl.visible = false;
      }
    }
  }

  _animateStep(elapsed, delta) {
    // Gentle floating island bob
    this.islandRoot.position.y = Math.sin(elapsed * 0.7) * 0.1;

    // Ocean wave uniform
    this.oceanUniforms.uTime.value = elapsed;

    // Camera & Character handling: Welcome Showcase slow orbit vs Third-Person Walk vs Orbit/Pan controls
    if (this.welcomeShowcase) {
      const angle = elapsed * 0.085 + 0.72;
      const radius = 64;
      this.camera.position.set(
        Math.cos(angle) * radius,
        34 + Math.sin(elapsed * 0.25) * 2.0,
        Math.sin(angle) * radius
      );
      this.camera.lookAt(-0.5, 2.0, -0.5);
    } else if (this.cameraMode === 'walk' && this.walkState.active) {
      if (this.walkState.isSitting) {
        const seat = CAFE_SEATS.find((s) => s.id === this.walkState.seatId);
        if (seat && this.characterRig) {
          this.characterRig.setGroundedPosition(seat.x, seat.seatY, seat.z, seat.yaw, 0);
          this.characterRig.updateAnimation({
            speedRatio: 0,
            isGrounded: true,
            isSitting: true,
            verticalVel: 0,
            elapsed,
            delta,
          });
        }
        const camAlpha = this.isSoftwareGl ? 1 : 1 - Math.exp(-11 * delta);
        this._positionThirdPersonCamera(camAlpha);
      } else {
        const keys = this.walkState.keys;
        const forward = (keys.has('forward') ? 1 : 0) - (keys.has('backward') ? 1 : 0);
        const strafe = (keys.has('right') ? 1 : 0) - (keys.has('left') ? 1 : 0);

        const { dirX, dirZ, isMoving } = computeCameraRelativeDirection(
          forward,
          strafe,
          this.walkState.camYaw
        );

        const maxSpeed = keys.has('sprint') ? 10.5 : 6.6;
        const moveAlpha = 1 - Math.exp(-14 * delta);
        this.walkState.vx += (dirX * maxSpeed - this.walkState.vx) * moveAlpha;
        this.walkState.vz += (dirZ * maxSpeed - this.walkState.vz) * moveAlpha;

        const horizSpeed = Math.hypot(this.walkState.vx, this.walkState.vz);
        if (horizSpeed > 0.01) {
          const nextX = this.walkState.x + this.walkState.vx * delta;
          const nextZ = this.walkState.z + this.walkState.vz * delta;
          const resolved = resolveWalkMovement(
            this.walkState.x,
            this.walkState.z,
            nextX,
            nextZ,
            this.buildingsState,
            0.65,
            128,
            this.walkState.y
          );
          this.walkState.x = resolved.x;
          this.walkState.z = resolved.z;
        }

        if (isMoving) {
          const desiredYaw = Math.atan2(-dirX, -dirZ);
          this.walkState.charYaw = lerpAngleRadians(
            this.walkState.charYaw,
            desiredYaw,
            1 - Math.exp(-14 * delta)
          );
        }

        const terrainHeight = Math.max(0, getTerrainHeightAt(this.walkState.x, this.walkState.z));
        if (
          this.walkState.isGrounded &&
          terrainHeight > this.walkState.y &&
          terrainHeight - this.walkState.y <= 1.25
        ) {
          this.walkState.y = terrainHeight;
        }
        const jumpWanted = this.walkState.jumpQueued || keys.has('jump');
        this.walkState.jumpQueued = false;

        const vert = stepVerticalJumpPhysics({
          y: this.walkState.y,
          vy: this.walkState.vy,
          jumpRequested: jumpWanted,
          terrainHeight,
          delta,
        });
        this.walkState.y = vert.y;
        this.walkState.vy = vert.vy;
        this.walkState.isGrounded = vert.isGrounded;

        if (this.characterRig) {
          this.characterRig.setGroundedPosition(
            this.walkState.x,
            this.walkState.y,
            this.walkState.z,
            this.walkState.charYaw,
            terrainHeight
          );
          this.characterRig.updateAnimation({
            speedRatio: horizSpeed / 6.6,
            isGrounded: this.walkState.isGrounded,
            isSitting: false,
            verticalVel: this.walkState.vy,
            elapsed,
            delta,
          });
        }

        const near = findNearestCafeSeat(this.walkState.x, this.walkState.z, 2.25);
        const nextNearId = near?.seat?.id || null;
        if (nextNearId !== this.walkState.nearSeatId) {
          this.walkState.nearSeatId = nextNearId;
          this._notifySeatPrompt();
        }

        document.body.dataset.walkPos = `${this.walkState.x.toFixed(2)},${this.walkState.z.toFixed(2)}`;
        document.body.dataset.walkY = this.walkState.y.toFixed(2);
        document.body.dataset.walkGrounded = this.walkState.isGrounded ? 'true' : 'false';

        const camAlpha = this.isSoftwareGl ? 1 : 1 - Math.exp(-11 * delta);
        this._positionThirdPersonCamera(camAlpha);

        if (horizSpeed > 0.05 || !vert.isGrounded) {
          this.callbacks.onLocalTransform?.(this.getLocalWalkSnapshot());
        }
      }
    } else {
      if (this.cameraTargetGoal && this.cameraPosGoal) {
        const alpha = 1 - Math.exp(-5.5 * delta);
        this.controls.target.lerp(this.cameraTargetGoal, alpha);
        this.camera.position.lerp(this.cameraPosGoal, alpha);
        if (
          this.camera.position.distanceTo(this.cameraPosGoal) < 0.08 &&
          this.controls.target.distanceTo(this.cameraTargetGoal) < 0.05
        ) {
          this.cameraTargetGoal = null;
          this.cameraPosGoal = null;
        }
      }

      this.controls.update();
    }

    // Update remote multiplayer voxel avatars & 3D spatial audio coordinates
    if (this.remotePeers.size > 0) {
      const peerAlpha = 1 - Math.exp(-12 * delta);
      for (const entry of this.remotePeers.values()) {
        const dx = entry.targetX - entry.curX;
        const dz = entry.targetZ - entry.curZ;
        const stepDist = Math.hypot(dx, dz);
        entry.curX = THREE.MathUtils.lerp(entry.curX, entry.targetX, peerAlpha);
        entry.curY = THREE.MathUtils.lerp(entry.curY, entry.targetY, peerAlpha);
        entry.curZ = THREE.MathUtils.lerp(entry.curZ, entry.targetZ, peerAlpha);
        entry.curYaw = lerpAngleRadians(entry.curYaw, entry.targetYaw, peerAlpha);
        entry.speedRatio = THREE.MathUtils.lerp(
          entry.speedRatio,
          Math.min(1.2, (stepDist / Math.max(0.016, delta)) * 0.16),
          0.3
        );
        entry.rig.setGroundedPosition(entry.curX, entry.curY, entry.curZ, entry.curYaw, 0);
        entry.rig.updateAnimation({
          speedRatio: entry.state.isSitting ? 0 : entry.speedRatio,
          isGrounded: entry.curY <= 0.05,
          isSitting: Boolean(entry.state.isSitting),
          verticalVel: 0,
          elapsed,
          delta,
        });
      }
    }

    if (this.callbacks.onSpatialFrame) {
      this.camera.getWorldDirection(_vec3);
      const lx = this.walkState.active ? this.walkState.x : this.controls.target.x;
      const ly = this.walkState.active ? this.walkState.y + 1.65 : this.camera.position.y;
      const lz = this.walkState.active ? this.walkState.z : this.controls.target.z;
      this.callbacks.onSpatialFrame({
        listenerX: lx,
        listenerY: ly,
        listenerZ: lz,
        forwardX: _vec3.x,
        forwardY: _vec3.y,
        forwardZ: _vec3.z,
        remotePeers: this.remotePeers,
      });
    }

    // Track dynamic directional shadows around active camera focus across the 260x260 world
    if (!this.isSoftwareGl) {
      const fx = Math.round((this.walkState.active ? this.walkState.x : this.controls.target.x) / 2) * 2;
      const fz = Math.round((this.walkState.active ? this.walkState.z : this.controls.target.z) / 2) * 2;
      this.sunLight.target.position.set(fx, 0, fz);
      this.sunLight.position.set(fx + 54, 76, fz + 44);
    }

    if (elapsed - this.lastLanternPoolUpdate > 0.65) {
      this.lastLanternPoolUpdate = elapsed;
      this._refreshLanternPool();
    }

    // Construction sites animation
    for (const site of this.constructionSites.values()) {
      const age = (performance.now() - site.startedAt) * 0.001;
      site.ring.rotation.z = age * 1.1;
      const pulseScale = 0.92 + Math.sin(age * 3.4) * 0.08;
      site.ring.scale.set(pulseScale, pulseScale, 1);
      site.ringMat.opacity = 0.52 + Math.sin(age * 3.4) * 0.22;
      site.wireBoxMat.opacity = 0.22 + Math.sin(age * 2.5) * 0.12;
    }

    // Layer-by-layer voxel reveal animation (wall-clock accurate across GPU and software WebGL)
    const nowMs = performance.now();
    for (const entry of this.buildingEntries.values()) {
      if (!entry.animating) continue;
      const elapsedSec = (nowMs - entry.revealStartTime) / 1000;
      const progress = Math.min(1, elapsedSec / entry.revealDuration);
      const voxels = entry.building.voxels;
      const maxLayer = Math.max(1, entry.maxY);

      for (let i = 0; i < voxels.length; i++) {
        const v = voxels[i];
        const layerStart = (v.y / (maxLayer + 1)) * 0.62;
        const localT = THREE.MathUtils.clamp((progress - layerStart) / 0.34, 0, 1);
        const s = localT === 0 ? 0.001 : Math.max(0.001, easeOutBack(localT));
        _scale.set(s, s, s);
        _quat.identity();
        _vec3.set(v.x, v.y + 0.5 * s, v.z);
        _mat4.compose(_vec3, _quat, _scale);
        entry.mesh.setMatrixAt(i, _mat4);
      }
      entry.mesh.instanceMatrix.needsUpdate = true;

      if (progress >= 1) {
        entry.animating = false;
        entry.mesh.frustumCulled = true;
        entry.mesh.computeBoundingSphere();
      }
    }
  }

  _afterDraw(cb) {
    const gl = this.renderer.getContext();
    if (!gl || typeof gl.fenceSync !== 'function') {
      this.frameId = window.setTimeout(cb, 110);
      return;
    }
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (this.disposed) {
        if (sync) gl.deleteSync(sync);
        return;
      }
      const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (state === gl.UNSIGNALED) {
        gl.flush();
        this.frameId = window.setTimeout(poll, 25);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 110);
      }
    };
    this.frameId = window.setTimeout(poll, 25);
  }

  _startLoop() {
    const tick = () => {
      if (this.disposed) return;
      const delta = Math.min(0.1, this.clock.getDelta());
      const elapsed = this.clock.elapsedTime;
      this._animateStep(elapsed, delta);
      this.renderer.render(this.scene, this.camera);

      if (this.isSoftwareGl) {
        this._afterDraw(tick);
      } else {
        this.frameId = window.requestAnimationFrame(tick);
      }
    };
    tick();
  }

  dispose() {
    this.disposed = true;
    window.cancelAnimationFrame(this.frameId);
    window.clearTimeout(this.frameId);
    const dom = this.renderer.domElement;
    dom.removeEventListener('pointermove', this._onPointerMove);
    dom.removeEventListener('pointerdown', this._onPointerDown);
    dom.removeEventListener('pointerup', this._onPointerUp);
    dom.removeEventListener('wheel', this._onWheel);
    dom.removeEventListener('webglcontextlost', this._onContextLost);
    window.removeEventListener('pointermove', this._onWindowPointerMove);
    window.removeEventListener('pointerup', this._onWindowPointerUp);
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onWindowBlur);
    window.removeEventListener('resize', this._onResize);
    this.controls.dispose();
    this.characterRig?.dispose();
    for (const entry of this.remotePeers.values()) {
      entry.rig.dispose();
    }
    this.remotePeers.clear();
    this.cafeBuild?.dispose();
    if (this.terrainChunkMeshes) {
      for (const cm of this.terrainChunkMeshes) {
        cm.dispose();
      }
    }
    this.ambientMesh?.dispose();
    this.voxelGeo.dispose();
    this.voxelMat.dispose();
    this.bumpTex.dispose();
    this.envTexture?.dispose();
    this.renderer.dispose();
  }
}
