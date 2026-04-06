/**
 * Rail Rush 3D — main.js v3
 * NEW: 4 Levels · Costume System · Day/Night Sky · Moving Environment (grass, stones, houses)
 *      Face fixed (forward) · Performance optimised
 */
'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   LEVEL CONFIG
═══════════════════════════════════════════════════════════════════════════ */
const LEVELS = {
  easy   :{ baseSpd:12, maxSpd:30, gravity:-28, jumpV:13, obRate:2, trainRate:5, trainSpd:0.45, label:'EASY',    cls:'easy'    },
  medium :{ baseSpd:16, maxSpd:40, gravity:-32, jumpV:14, obRate:1.2, trainRate:2, trainSpd:0.65, label:'MEDIUM',  cls:'medium'  },
  hard   :{ baseSpd:27, maxSpd:50, gravity:-36, jumpV:14, obRate:0.8, trainRate:1, trainSpd:0.85, label:'HARD',    cls:'hard'    },
  extreme:{ baseSpd:40, maxSpd:60, gravity:-40, jumpV:15, obRate:0.4, trainRate:0.1,  trainSpd:1.5,  label:'EXTREME', cls:'extreme' },
};
let currentLevel = LEVELS.easy;

/* ═══════════════════════════════════════════════════════════════════════════
   CONSTANTS
═══════════════════════════════════════════════════════════════════════════ */
const LANE_W    = 2.5;
const LANES     = [-LANE_W, 0, LANE_W];
const TILE_LEN  = 40;
const TILE_N    = 8;          // ground tiles
const ENV_N     = 8;          // environment tiles (grass/houses/stones)
const LANE_LERP = 0.15;
const ROLL_DUR  = 0.75;
const DESPAWN   = 16;
const SPAWN_Z   = -78;

// Sky/time cycle thresholds (score-based)
const SKY_CYCLE = 500; // every 500 score, time of day changes
const DAY_PHASES = ['dawn','day','dusk','night'];

/* ═══════════════════════════════════════════════════════════════════════════
   RENDERER
═══════════════════════════════════════════════════════════════════════════ */
const canvas   = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias:false, powerPreference:'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.shadowMap.enabled = false;
renderer.setClearColor(0x080d18);

const scene = new THREE.Scene();
scene.fog   = new THREE.Fog(0x080d18, 50, 140);

const camera = new THREE.PerspectiveCamera(62, 1, 0.3, 200);

function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', onResize);
onResize();

/* ═══════════════════════════════════════════════════════════════════════════
   LIGHTING (dynamic — updated by day/night system)
═══════════════════════════════════════════════════════════════════════════ */
const ambLight = new THREE.AmbientLight(0x8899cc, 1.1);
scene.add(ambLight);
const sunLight = new THREE.DirectionalLight(0xfff3e0, 1.7);
sunLight.position.set(7, 22, 12);
scene.add(sunLight);
const rimLight = new THREE.DirectionalLight(0x2255ff, 0.45);
rimLight.position.set(-8, 3, -14);
scene.add(rimLight);

// Day/night phase presets
const SKY_PRESETS = {
  dawn  :{ fog:0x1a0e28, amb:0xcc7755, sun:0xff9944, sunI:1.0, ambI:0.7, fogN:0x1a0e28 },
  day   :{ fog:0x080d18, amb:0x8899cc, sun:0xfff3e0, sunI:1.7, ambI:1.1, fogN:0x080d18 },
  dusk  :{ fog:0x1a0810, amb:0xbb5533, sun:0xff6622, sunI:0.9, ambI:0.6, fogN:0x180810 },
  night :{ fog:0x020508, amb:0x223366, sun:0x334488, sunI:0.3, ambI:0.4, fogN:0x020508 },
};

/* ═══════════════════════════════════════════════════════════════════════════
   MATERIALS
═══════════════════════════════════════════════════════════════════════════ */
const M = {
  track  : new THREE.MeshLambertMaterial({ color:0x1c2030 }),
  ground : new THREE.MeshLambertMaterial({ color:0x10141e }),
  sleeper: new THREE.MeshLambertMaterial({ color:0x3c2c1c }),
  rail   : new THREE.MeshLambertMaterial({ color:0x6677aa }),
  divL   : new THREE.MeshLambertMaterial({ color:0xffd700, emissive:0x554400, emissiveIntensity:0.5 }),
  grass  : new THREE.MeshLambertMaterial({ color:0x2d6a1f }),
  grassD : new THREE.MeshLambertMaterial({ color:0x1e4a14 }),
  stone  : new THREE.MeshLambertMaterial({ color:0x7a7a8a }),
  stoneD : new THREE.MeshLambertMaterial({ color:0x55555f }),
  dirt   : new THREE.MeshLambertMaterial({ color:0x6b4c2a }),
  housW  : new THREE.MeshLambertMaterial({ color:0xddccbb }),
  housR  : new THREE.MeshLambertMaterial({ color:0xaa3322 }),
  housD  : new THREE.MeshLambertMaterial({ color:0x553322 }),
  housWn : new THREE.MeshLambertMaterial({ color:0x88ccff, emissive:0x224466, emissiveIntensity:0.3 }),
  fence  : new THREE.MeshLambertMaterial({ color:0xccaa88 }),
  tree   : new THREE.MeshLambertMaterial({ color:0x1a5c12 }),
  trunk  : new THREE.MeshLambertMaterial({ color:0x5a3a1a }),
  // Player (mutable via costume)
  pSkin  : new THREE.MeshLambertMaterial({ color:0xf5c842 }),
  pSuit  : new THREE.MeshLambertMaterial({ color:0xff4e6a }),
  pDark  : new THREE.MeshLambertMaterial({ color:0x111122 }),
  pWhite : new THREE.MeshLambertMaterial({ color:0xffffff }),
  pGold  : new THREE.MeshLambertMaterial({ color:0xffd700, emissive:0x996600, emissiveIntensity:0.6 }),
  // Obstacles
  coin   : new THREE.MeshLambertMaterial({ color:0xffd700, emissive:0xaa7700, emissiveIntensity:0.7 }),
  barO   : new THREE.MeshLambertMaterial({ color:0xee7811 }),
  barK   : new THREE.MeshLambertMaterial({ color:0x111111 }),
  barY   : new THREE.MeshLambertMaterial({ color:0xffdd00 }),
  pole   : new THREE.MeshLambertMaterial({ color:0xaabbcc }),
  poleR  : new THREE.MeshLambertMaterial({ color:0xff3300 }),
  poleY  : new THREE.MeshLambertMaterial({ color:0xffcc00 }),
  tBody  : new THREE.MeshLambertMaterial({ color:0xbb1122 }),
  tDark  : new THREE.MeshLambertMaterial({ color:0x880011 }),
  tWin   : new THREE.MeshLambertMaterial({ color:0x88bbff, transparent:true, opacity:0.55 }),
  tHL    : new THREE.MeshLambertMaterial({ color:0xffffaa, emissive:0xffff44, emissiveIntensity:1.8 }),
  tWheel : new THREE.MeshLambertMaterial({ color:0x222233 }),
  tConn  : new THREE.MeshLambertMaterial({ color:0x771122 }),
};

/* ═══════════════════════════════════════════════════════════════════════════
   GEOMETRIES (shared)
═══════════════════════════════════════════════════════════════════════════ */
const G = {
  coinDisc: new THREE.CylinderGeometry(0.3, 0.3, 0.1, 12),
  barBox  : new THREE.BoxGeometry(2.3, 1.1, 0.45),
  barStrp : new THREE.BoxGeometry(0.23, 1.12, 0.47),
  barTop  : new THREE.BoxGeometry(2.3, 0.14, 0.47),
  pShaft  : new THREE.CylinderGeometry(0.1, 0.1, 2.8, 8),
  pBar    : new THREE.BoxGeometry(3.2, 0.16, 0.16),
  pStrp   : new THREE.BoxGeometry(0.22, 0.17, 0.18),
  tWheel  : new THREE.CylinderGeometry(0.3, 0.3, 0.2, 10),
};

/* ═══════════════════════════════════════════════════════════════════════════
   SKY DOME + STARS (dynamic shader)
═══════════════════════════════════════════════════════════════════════════ */
const skyUniforms = {
  topCol: { value: new THREE.Color(0x020408) },
  botCol: { value: new THREE.Color(0x090e1e) },
};
(function buildSky() {
  const sg = new THREE.SphereGeometry(160, 12, 7);
  sg.scale(-1, 1, 1);
  scene.add(new THREE.Mesh(sg, new THREE.ShaderMaterial({
    uniforms: skyUniforms,
    vertexShader:  `varying float h; void main(){ h=position.y; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader:`uniform vec3 topCol,botCol; varying float h;
      void main(){ float t=clamp((h+25.)/120.,0.,1.); gl_FragColor=vec4(mix(botCol,topCol,t),1.); }`,
    side: THREE.BackSide, depthWrite:false,
  })));

  // Stars (visible at night/dusk/dawn)
  const sp = [];
  for (let i=0;i<500;i++){
    const t=Math.random()*6.28,p=Math.acos(2*Math.random()-1),r=140+Math.random()*15;
    sp.push(r*Math.sin(p)*Math.cos(t), r*Math.cos(p), r*Math.sin(p)*Math.sin(t));
  }
  const sGeo = new THREE.BufferGeometry();
  sGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp,3));
  const starPts = new THREE.Points(sGeo, new THREE.PointsMaterial({ color:0xffffff, size:0.55 }));
  starPts.name = 'stars';
  scene.add(starPts);
})();

/* ═══════════════════════════════════════════════════════════════════════════
   GROUND TILES (track only — no buildings here, those are in ENV tiles)
═══════════════════════════════════════════════════════════════════════════ */
function buildTrackTile() {
  const g = new THREE.Group();
  // Track bed
  const bed = new THREE.Mesh(new THREE.BoxGeometry(10.5, 0.20, TILE_LEN), M.track);
  bed.position.y = -0.10;
  g.add(bed);
  // Sleepers
  for (let z=-TILE_LEN/2+0.9; z<TILE_LEN/2; z+=1.4) {
    const sl = new THREE.Mesh(new THREE.BoxGeometry(8.5, 0.22, 0.36), M.sleeper);
    sl.position.set(0, 0.02, z);
    g.add(sl);
  }
  // Rails
  [-3.6,-1.1,1.1,3.6].forEach(x=>{
    const r = new THREE.Mesh(new THREE.BoxGeometry(0.11,0.14,TILE_LEN), M.rail);
    r.position.set(x, 0.24, 0);
    g.add(r);
  });
  // Lane dividers
  [-LANE_W/2,LANE_W/2].forEach(x=>{
    const d = new THREE.Mesh(new THREE.BoxGeometry(0.06,0.20,TILE_LEN), M.divL);
    d.position.set(x, 0.01, 0);
    g.add(d);
  });
  scene.add(g);
  return g;
}

const trackTiles = [];
for (let i=0;i<TILE_N;i++){
  const t = buildTrackTile();
  t.position.z = -i*TILE_LEN + TILE_LEN;
  trackTiles.push(t);
}

/* ═══════════════════════════════════════════════════════════════════════════
   ENVIRONMENT TILES (side scenery — grass, stones, houses, trees, fences)
   These move with the track so everything scrolls together.
═══════════════════════════════════════════════════════════════════════════ */
function rng(a,b){ return a + Math.random()*(b-a); }

function buildEnvTile() {
  const g = new THREE.Group();

  // Grass strips both sides
  [-8.5, 8.5].forEach(sx => {
    const grass = new THREE.Mesh(new THREE.BoxGeometry(7, 0.10, TILE_LEN), M.grass);
    grass.position.set(sx, -0.05, 0);
    g.add(grass);
  });

  // Dirt shoulder
  [-5.8, 5.8].forEach(sx => {
    const d = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.11, TILE_LEN), M.dirt);
    d.position.set(sx, -0.04, 0);
    g.add(d);
  });

  // Random scenery items
  const itemCount = 5 + Math.floor(Math.random()*4);
  for (let i=0; i<itemCount; i++){
    const side = Math.random()>0.5 ? 1:-1;
    const xBase = side * (7 + rng(0,5));
    const zPos  = rng(-TILE_LEN/2+2, TILE_LEN/2-2);
    const r2    = Math.random();

    if (r2 < 0.30) {
      // House
      addHouse(g, xBase, zPos);
    } else if (r2 < 0.55) {
      // Tree
      addTree(g, xBase, zPos);
    } else if (r2 < 0.72) {
      // Stone cluster
      addStones(g, xBase, zPos);
    } else if (r2 < 0.85) {
      // Fence post
      addFence(g, xBase, zPos);
    }
    // else: open field
  }

  scene.add(g);
  return g;
}

function addHouse(g, x, z) {
  const w = rng(2.5,4), h = rng(2,3.5), d = rng(2.5,4);
  // Walls
  const walls = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), M.housW);
  walls.position.set(x, h/2, z);
  g.add(walls);
  // Roof (triangular prism via box rotated)
  const roofH = 1.2;
  const roof = new THREE.Mesh(new THREE.BoxGeometry(w+0.3, roofH, d+0.3), M.housR);
  roof.position.set(x, h + roofH/2, z);
  roof.rotation.x = 0;
  g.add(roof);
  // Door
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.6,1.1,0.05), M.housD);
  door.position.set(x, 0.55, z+d/2+0.03);
  g.add(door);
  // Windows
  [[-0.6,h*0.65],[0.6,h*0.65]].forEach(([wx,wy])=>{
    const win = new THREE.Mesh(new THREE.BoxGeometry(0.55,0.5,0.05), M.housWn);
    win.position.set(x+wx, wy, z+d/2+0.04);
    g.add(win);
  });
}

function addTree(g, x, z) {
  const trunkH = rng(0.8,1.6);
  const trunk = new THREE.Mesh(new THREE.BoxGeometry(0.25, trunkH, 0.25), M.trunk);
  trunk.position.set(x, trunkH/2, z);
  g.add(trunk);
  // Canopy layers
  const layers = 2 + Math.floor(Math.random()*2);
  for (let l=0;l<layers;l++){
    const s = (1.5-l*0.3)+rng(0,0.3);
    const lh = s*0.8;
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(s,lh,s), M.tree);
    leaf.position.set(x, trunkH + l*0.5 + lh/2, z);
    g.add(leaf);
  }
}

function addStones(g, x, z) {
  const count = 2 + Math.floor(Math.random()*3);
  for (let i=0;i<count;i++){
    const s = rng(0.2,0.7);
    const st = new THREE.Mesh(new THREE.BoxGeometry(s,s*0.7,s*0.85), M.stone);
    st.position.set(x+rng(-0.5,0.5), s*0.3, z+rng(-0.5,0.5));
    st.rotation.y = Math.random()*Math.PI;
    g.add(st);
  }
}

function addFence(g, x, z) {
  const posts = 3 + Math.floor(Math.random()*3);
  for (let i=0;i<posts;i++){
    const fp = new THREE.Mesh(new THREE.BoxGeometry(0.08,0.9,0.08), M.fence);
    fp.position.set(x, 0.45, z + i*0.8 - posts*0.4);
    g.add(fp);
    if (i<posts-1){
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.05,0.05,0.8), M.fence);
      rail.position.set(x, 0.65, z + i*0.8 - posts*0.4 + 0.4);
      g.add(rail);
    }
  }
}

const envTiles = [];
for (let i=0;i<ENV_N;i++){
  const t = buildEnvTile();
  t.position.z = -i*TILE_LEN + TILE_LEN;
  envTiles.push(t);
}

/* ═══════════════════════════════════════════════════════════════════════════
   PLAYER CHARACTER
═══════════════════════════════════════════════════════════════════════════ */
const PL = {};
PL.root = new THREE.Group();
scene.add(PL.root);

PL.body = new THREE.Group();
PL.root.add(PL.body);

// Torso
PL.torso = new THREE.Mesh(new THREE.BoxGeometry(0.58,0.74,0.36), M.pSuit);
PL.torso.position.y = 1.05;
PL.body.add(PL.torso);

// Chest badge
const badge = new THREE.Mesh(new THREE.BoxGeometry(0.25,0.22,0.06), M.pSkin);
badge.position.set(0, 1.12, 0.19);
PL.body.add(badge);

// Head — FIXED: face pointing FORWARD (-Z is forward in Three.js)
PL.head = new THREE.Group();
PL.head.position.y = 1.62;
PL.body.add(PL.head);

const headMesh = new THREE.Mesh(new THREE.BoxGeometry(0.44,0.44,0.44), M.pSkin);
PL.head.add(headMesh);

// Eyes: placed at -Z face (front of head, facing camera direction)
[-0.10, 0.10].forEach(ex => {
  const eye = new THREE.Mesh(new THREE.BoxGeometry(0.09,0.09,0.04), M.pDark);
  eye.position.set(ex, 0.05, -0.22);   // -Z = front face (toward player's direction of travel)
  PL.head.add(eye);
  const shine = new THREE.Mesh(new THREE.BoxGeometry(0.03,0.03,0.02), M.pWhite);
  shine.position.set(ex+0.025, 0.08, -0.24);
  PL.head.add(shine);
});

// Mouth at front face
const mth = new THREE.Mesh(new THREE.BoxGeometry(0.14,0.04,0.04), M.pDark);
mth.position.set(0, -0.10, -0.22);
PL.head.add(mth);

// Cap
const cap = new THREE.Mesh(new THREE.BoxGeometry(0.48,0.11,0.48), M.pSuit);
cap.position.y = 0.25;
PL.head.add(cap);
const capBrim = new THREE.Mesh(new THREE.BoxGeometry(0.58,0.07,0.22), M.pSuit);
capBrim.position.set(0, 0.18, -0.29);  // brim extends forward (-Z)
PL.head.add(capBrim);

// Scarf
const scarf = new THREE.Mesh(new THREE.BoxGeometry(0.60,0.15,0.38), M.pSuit);
scarf.position.y = 1.36;
PL.body.add(scarf);

// Arms
function makeArm(side){
  const pivot = new THREE.Group();
  pivot.position.set(side*0.41, 1.32, 0);
  const upper = new THREE.Mesh(new THREE.BoxGeometry(0.20,0.40,0.20), M.pSkin);
  upper.position.y = -0.20;
  pivot.add(upper);
  const lower = new THREE.Mesh(new THREE.BoxGeometry(0.18,0.34,0.18), M.pSuit);
  lower.position.y = -0.54;
  pivot.add(lower);
  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.20,0.16,0.20), M.pSkin);
  hand.position.y = -0.74;
  pivot.add(hand);
  PL.body.add(pivot);
  return pivot;
}
PL.lArm = makeArm(-1);
PL.rArm = makeArm(1);

// Legs
function makeLeg(side){
  const pivot = new THREE.Group();
  pivot.position.set(side*0.17, 0.70, 0);
  const upper = new THREE.Mesh(new THREE.BoxGeometry(0.23,0.44,0.23), M.pSuit);
  upper.position.y = -0.22;
  pivot.add(upper);
  const lower = new THREE.Mesh(new THREE.BoxGeometry(0.21,0.38,0.21), M.pSkin);
  lower.position.y = -0.56;
  pivot.add(lower);
  const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.26,0.13,0.34), M.pDark);
  shoe.position.set(0, -0.78, 0.07);
  pivot.add(shoe);
  PL.body.add(pivot);
  return pivot;
}
PL.lLeg = makeLeg(-1);
PL.rLeg = makeLeg(1);

// Store costume refs
const costumeRefs = {
  suit : [PL.torso, scarf, cap, capBrim, PL.lArm.children[1], PL.rArm.children[1], PL.lLeg.children[0], PL.rLeg.children[0]],
  skin : [headMesh, badge, PL.lArm.children[0], PL.rArm.children[0], PL.lLeg.children[1], PL.rLeg.children[1], PL.lArm.children[2], PL.rArm.children[2]],
};

/* ═══════════════════════════════════════════════════════════════════════════
   PLAYER STATE
═══════════════════════════════════════════════════════════════════════════ */
const ps = {
  lane:1, targetLane:1, x:0, y:0, vy:0,
  grounded:true, jumping:false, rolling:false, rollTimer:0,
  dead:false, runT:0, squash:1, leanZ:0, headBob:0,
};

/* ═══════════════════════════════════════════════════════════════════════════
   PLAYER ANIMATION
═══════════════════════════════════════════════════════════════════════════ */
function animatePlayer(dt) {
  ps.runT += dt;
  const t = ps.runT;

  // Squash recovery
  ps.squash += (1.0 - ps.squash) * 0.20;
  PL.body.scale.set(1/Math.sqrt(ps.squash), ps.squash, 1/Math.sqrt(ps.squash));

  // Lane lean
  const laneErr = LANES[ps.targetLane] - ps.x;
  const lTgt = -laneErr * 0.18;
  ps.leanZ += (lTgt - ps.leanZ) * 0.13;
  PL.root.rotation.z = ps.leanZ;

  if (ps.dead) {
    PL.root.rotation.x += dt * 4.2;
    PL.root.rotation.z += dt * 2.5;
    PL.root.position.y = Math.max(-0.6, PL.root.position.y - dt*7);
    return;
  }

  if (ps.rolling) {
    PL.root.rotation.x = 0;
    PL.body.rotation.x = 1.15;
    PL.head.rotation.x = -1.0;
    PL.lArm.rotation.x = 0.5;  PL.rArm.rotation.x = 0.5;
    PL.lArm.rotation.z = 0;    PL.rArm.rotation.z = 0;
    PL.lLeg.rotation.x = -1.3; PL.rLeg.rotation.x = -1.3;
    PL.body.position.y = -0.50;
    return;
  }

  PL.body.rotation.x = 0;
  PL.body.position.y = 0;
  PL.head.rotation.x = 0;

  if (ps.jumping) {
    PL.root.rotation.x = ps.vy > 0 ? -0.28 : 0.16;
    PL.lArm.rotation.x = -1.0; PL.rArm.rotation.x = -1.0;
    PL.lArm.rotation.z =  0.7; PL.rArm.rotation.z = -0.7;
    PL.lLeg.rotation.x = -0.7; PL.rLeg.rotation.x = -0.7;
    return;
  }

  // Running cycle
  PL.root.rotation.x = -0.07;
  const sw = Math.sin(t*9.5)*0.70;
  PL.lArm.rotation.x =  sw; PL.rArm.rotation.x = -sw;
  PL.lArm.rotation.z =  0.10; PL.rArm.rotation.z = -0.10;
  PL.lLeg.rotation.x = -sw*0.85; PL.rLeg.rotation.x = sw*0.85;
  const bob = Math.sin(t*9.5)*0.04;
  ps.headBob += (bob - ps.headBob)*0.30;
  PL.head.position.y = 1.62 + ps.headBob;
}

/* ═══════════════════════════════════════════════════════════════════════════
   OBJECT POOLS
═══════════════════════════════════════════════════════════════════════════ */
// Coins
const coinPool = [];
for (let i=0;i<55;i++){
  const m = new THREE.Mesh(G.coinDisc, M.coin);
  m.rotation.x = Math.PI/2; m.visible = false;
  scene.add(m);
  coinPool.push({ mesh:m, active:false });
}

// Barriers
const barrierPool = [];
for (let i=0;i<22;i++){
  const g = new THREE.Group();
  const box = new THREE.Mesh(G.barBox, M.barO); box.position.y=0.55; g.add(box);
  [-0.70,0,0.70].forEach(sx=>{ const s=new THREE.Mesh(G.barStrp,M.barK); s.position.set(sx,0.55,0); g.add(s); });
  const top = new THREE.Mesh(G.barTop,M.barY); top.position.y=1.06; g.add(top);
  g.visible=false; scene.add(g);
  barrierPool.push({ mesh:g, active:false, lane:1 });
}

// Poles
const polePool = [];
for (let i=0;i<16;i++){
  const g = new THREE.Group();
  [-1.15,1.15].forEach(x=>{ const s=new THREE.Mesh(G.pShaft,M.pole); s.position.set(x,1.4,0); g.add(s); });
  const bar = new THREE.Mesh(G.pBar,M.pole); bar.position.y=1.36; g.add(bar);
  for (let b=-1.35;b<1.4;b+=0.52){
    const st=new THREE.Mesh(G.pStrp, b%1.04<0.52?M.poleR:M.poleY);
    st.position.set(b,1.36,0); g.add(st);
  }
  g.visible=false; scene.add(g);
  polePool.push({ mesh:g, active:false, lane:1 });
}

// Trains
const trainPool = [];
function buildTrainMesh(){
  const root = new THREE.Group();
  const CAR=9.5, GAP=0.9, NC=3;
  const wheels=[];
  for (let c=0;c<NC;c++){
    const car = new THREE.Group();
    car.position.z = -c*(CAR+GAP);
    const body=new THREE.Mesh(new THREE.BoxGeometry(2.2,2.9,CAR),M.tBody);
    body.position.y=1.45; car.add(body);
    const roof=new THREE.Mesh(new THREE.BoxGeometry(2.22,0.25,CAR+0.1),M.tDark);
    roof.position.y=3.0; car.add(roof);
    [-1.12,1.12].forEach(wx=>{
      for(let r=0;r<4;r++){
        const w=new THREE.Mesh(new THREE.BoxGeometry(0.07,0.55,1.1),M.tWin);
        w.position.set(wx,1.95-r*0.72,-3.4+r*2.1); car.add(w);
      }
    });
    [-CAR*0.30,CAR*0.30].forEach(bz=>{ [-0.88,0.88].forEach(bx=>{
      const wh=new THREE.Mesh(G.tWheel,M.tWheel);
      wh.position.set(bx,0.30,bz); wh.rotation.z=Math.PI/2;
      car.add(wh); wheels.push(wh);
    }); });
    if(c<NC-1){ const cn=new THREE.Mesh(new THREE.BoxGeometry(1.6,1.85,GAP+0.2),M.tConn); cn.position.set(0,0.95,-(CAR/2+GAP/2+0.05)); car.add(cn); }
    root.add(car);
  }
  const nose=new THREE.Mesh(new THREE.BoxGeometry(2.2,2.9,0.4),M.tDark);
  nose.position.set(0,1.45,CAR/2+0.2); root.add(nose);
  [-0.6,0.6].forEach(x=>{ const hl=new THREE.Mesh(new THREE.BoxGeometry(0.40,0.24,0.12),M.tHL); hl.position.set(x,0.85,CAR/2+0.35); root.add(hl); });
  const plate=new THREE.Mesh(new THREE.BoxGeometry(0.85,0.32,0.08),M.tHL);
  plate.position.set(0,2.2,CAR/2+0.37); root.add(plate);
  root.visible=false; scene.add(root);
  trainPool.push({ mesh:root, active:false, lane:1, speed:0, wheels });
}
for (let i=0;i<5;i++) buildTrainMesh();

/* ═══════════════════════════════════════════════════════════════════════════
   GAME STATE
═══════════════════════════════════════════════════════════════════════════ */
let gameState   = 'idle';
let score       = 0, coins = 0, bestScore = 0;
let gameSpeed   = 15;
let dist        = 0;
let spawnTimer  = 1.2, coinTimer = 0.5, trainTimer = 6;
let skyPhaseIdx = 1; // 0=dawn,1=day,2=dusk,3=night
let skyT        = 0; // transition progress 0-1
let lastPhaseScore = 0;

/* ═══════════════════════════════════════════════════════════════════════════
   DAY / NIGHT SYSTEM
═══════════════════════════════════════════════════════════════════════════ */
const skyOverlay = document.getElementById('sky-overlay');
const skyLabel   = document.getElementById('sky-lbl') || document.getElementById('sky-label');

const _c1 = new THREE.Color(), _c2 = new THREE.Color();

function applySkyPhase(phaseKey) {
  const p = SKY_PRESETS[phaseKey];
  // Fog
  scene.fog.color.set(p.fog);
  renderer.setClearColor(p.fog);
  // Lights
  ambLight.color.set(p.amb);
  ambLight.intensity = p.ambI;
  sunLight.color.set(p.sun);
  sunLight.intensity = p.sunI;
  // Sky dome gradient
  if (phaseKey==='day')   { skyUniforms.topCol.value.set(0x04091a); skyUniforms.botCol.value.set(0x0a1840); }
  if (phaseKey==='night') { skyUniforms.topCol.value.set(0x000206); skyUniforms.botCol.value.set(0x010512); }
  if (phaseKey==='dawn')  { skyUniforms.topCol.value.set(0x120520); skyUniforms.botCol.value.set(0x3d1a05); }
  if (phaseKey==='dusk')  { skyUniforms.topCol.value.set(0x0e0410); skyUniforms.botCol.value.set(0x2a0c08); }
  // Stars
  const stars = scene.getObjectByName('stars');
  if (stars) stars.material.opacity = (phaseKey==='night')?1:(phaseKey==='dawn'||phaseKey==='dusk')?0.5:0.05;
  if (stars) stars.material.transparent = true;
  // Overlay
  skyOverlay.className = 'sky-overlay';
  if (phaseKey==='night') skyOverlay.classList.add('night-fade');
  if (phaseKey==='dawn')  skyOverlay.classList.add('dawn-fade');
  // Label
  const names={dawn:'🌅 DAWN',day:'☀ DAY',dusk:'🌆 DUSK',night:'🌙 NIGHT'};
  if (skyLabel) skyLabel.textContent = names[phaseKey]||'';
}

function checkSkyTransition() {
  if (score - lastPhaseScore >= SKY_CYCLE) {
    lastPhaseScore = score;
    skyPhaseIdx = (skyPhaseIdx+1)%4;
    applySkyPhase(DAY_PHASES[skyPhaseIdx]);
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   SPAWNING
═══════════════════════════════════════════════════════════════════════════ */
function spawnCoins(z) {
  const lane=Math.floor(Math.random()*3);
  const n=4+Math.floor(Math.random()*7);
  const arc=Math.random()<0.4;
  for(let i=0;i<n;i++){
    const c=coinPool.find(c=>!c.active); if(!c) continue;
    c.active=true; c.mesh.visible=true;
    const yo=arc?Math.sin(i/n*Math.PI)*2.5:0;
    c.mesh.position.set(LANES[lane],0.90+yo,z-i*1.7);
  }
}

function spawnBarrier(z){
  const block=Math.random()<0.28?2:1;
  const start=Math.floor(Math.random()*(4-block));
  for(let i=0;i<block;i++){
    const b=barrierPool.find(b=>!b.active); if(!b) return;
    b.active=true; b.lane=start+i;
    b.mesh.visible=true;
    b.mesh.position.set(LANES[b.lane],0,z);
  }
}

function spawnPole(z){
  const lane=Math.floor(Math.random()*3);
  const p=polePool.find(p=>!p.active); if(!p) return;
  p.active=true; p.lane=lane;
  p.mesh.visible=true;
  p.mesh.position.set(LANES[lane],0,z);
}

function spawnTrain(z){
  const lane=Math.floor(Math.random()*3);
  const t=trainPool.find(t=>!t.active); if(!t) return;
  t.active=true; t.lane=lane;
  t.speed=gameSpeed*(currentLevel.trainSpd+Math.random()*0.4);
  t.mesh.visible=true;
  t.mesh.rotation.set(0,0,0);
  t.mesh.position.set(LANES[lane],0,z-40);
}

/* ═══════════════════════════════════════════════════════════════════════════
   COLLISION (manual AABB)
═══════════════════════════════════════════════════════════════════════════ */
let px0,px1,py0,py1,pz0,pz1;

function buildPlayerBox(){
  const hw=0.26, h=ps.rolling?0.80:1.82;
  px0=ps.x-hw; px1=ps.x+hw;
  py0=ps.y;    py1=ps.y+h;
  pz0=PL.root.position.z-0.22; pz1=PL.root.position.z+0.22;
}

function aabb(ax0,ax1,ay0,ay1,az0,az1, bx0,bx1,by0,by1,bz0,bz1){
  return ax0<bx1&&ax1>bx0&&ay0<by1&&ay1>by0&&az0<bz1&&az1>bz0;
}

function checkCollisions(){
  if(ps.dead) return;
  buildPlayerBox();
  for(const b of barrierPool){
    if(!b.active) continue;
    const bx=b.mesh.position.x,bz=b.mesh.position.z;
    if(aabb(px0,px1,py0,py1,pz0,pz1, bx-1.10,bx+1.10,0,1.10,bz-0.50,bz+0.50)){ triggerDeath(); return; }
  }
  for(const p of polePool){
    if(!p.active) continue;
    const px2=p.mesh.position.x,pz2=p.mesh.position.z;
    if(aabb(px0,px1,py0,py1,pz0,pz1, px2-1.58,px2+1.58,1.28,1.44,pz2-0.14,pz2+0.14)){ triggerDeath(); return; }
  }
  for(const t of trainPool){
    if(!t.active) continue;
    const tx=t.mesh.position.x,tz=t.mesh.position.z;
    if(aabb(px0,px1,py0,py1,pz0,pz1, tx-1.08,tx+1.08,0,3.1,tz-16,tz+6.5)){ triggerDeath(); return; }
  }
}

function checkCoins(){
  if(ps.dead) return;
  const pzC=PL.root.position.z;
  for(const c of coinPool){
    if(!c.active) continue;
    const cp=c.mesh.position;
    if(Math.abs(cp.x-ps.x)<0.68&&Math.abs(cp.y-ps.y-0.9)<0.90&&Math.abs(cp.z-pzC)<0.78){
      c.active=false; c.mesh.visible=false;
      coins++; score+=10;
      updateHUD();
      showCoinPop();
      playCoinSfx();
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   INPUT
═══════════════════════════════════════════════════════════════════════════ */
document.addEventListener('keydown', e=>{
  if(gameState!=='playing') return;
  if(e.code==='ArrowLeft')  changeLane(-1);
  if(e.code==='ArrowRight') changeLane(1);
  if(e.code==='ArrowUp')    doJump();
  if(e.code==='ArrowDown')  doRoll();
  e.preventDefault();
},{passive:false});

let swX=0,swY=0;
window.addEventListener('touchstart',e=>{ swX=e.touches[0].clientX; swY=e.touches[0].clientY; },{passive:true});
window.addEventListener('touchend',e=>{
  if(gameState!=='playing') return;
  const dx=e.changedTouches[0].clientX-swX, dy=e.changedTouches[0].clientY-swY;
  if(Math.abs(dx)>Math.abs(dy)){ changeLane(dx>25?1:-1); }
  else{ if(dy<-25) doJump(); else if(dy>25) doRoll(); }
},{passive:true});

function changeLane(d){ const n=ps.targetLane+d; if(n<0||n>2) return; ps.targetLane=n; }
function doJump(){
  if(!ps.grounded) return;
  ps.vy=currentLevel.jumpV; ps.grounded=false; ps.jumping=true; ps.rolling=false;
  playJumpSfx();
}
function doRoll(){
  if(!ps.grounded){ ps.vy=Math.min(ps.vy,-8); return; }
  ps.rolling=true; ps.rollTimer=ROLL_DUR;
}

/* ═══════════════════════════════════════════════════════════════════════════
   COSTUME SYSTEM
═══════════════════════════════════════════════════════════════════════════ */
let costumePanel = document.getElementById('costume-panel');
let costumeOpen  = false;
let currentShine = 'matte';

document.getElementById('btn-costume').addEventListener('click',()=>{
  costumeOpen=!costumeOpen;
  costumePanel.classList.toggle('hidden',!costumeOpen);
});
document.getElementById('btn-cp-close').addEventListener('click',()=>{
  costumeOpen=false; costumePanel.classList.add('hidden');
});

// Color buttons
document.querySelectorAll('.cc-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    const type=btn.dataset.type;
    const colorHex=parseInt(btn.dataset.color);
    document.querySelectorAll(`.cc-btn[data-type="${type}"]`).forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    applyColor(type, colorHex);
  });
});

// Shine buttons
document.querySelectorAll('.cs-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('.cs-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    currentShine=btn.dataset.shine;
    applyShine(currentShine);
  });
});

function applyColor(type, hex){
  const col = new THREE.Color(hex);
  const refs = type==='outfit' ? costumeRefs.suit : costumeRefs.skin;
  refs.forEach(mesh=>{ if(mesh&&mesh.material) mesh.material.color.set(col); });
}

function applyShine(shine){
  const skinRefs = costumeRefs.skin.concat(costumeRefs.suit);
  skinRefs.forEach(mesh=>{
    if(!mesh||!mesh.material) return;
    if(shine==='matte'){
      mesh.material.emissiveIntensity=0;
      mesh.material.emissive&&mesh.material.emissive.set(0x000000);
    } else if(shine==='glossy'){
      mesh.material.emissiveIntensity=0.12;
      mesh.material.emissive&&mesh.material.emissive.copy(mesh.material.color).multiplyScalar(0.3);
    } else if(shine==='neon'){
      mesh.material.emissiveIntensity=0.55;
      mesh.material.emissive&&mesh.material.emissive.copy(mesh.material.color);
    } else if(shine==='gold'){
      mesh.material.color.set(0xffd700);
      mesh.material.emissive&&mesh.material.emissive.set(0x886600);
      mesh.material.emissiveIntensity=0.5;
    }
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   UI
═══════════════════════════════════════════════════════════════════════════ */
const hudEl    = document.getElementById('hud');
const hudScore = document.getElementById('hud-score');
const hudCoins = document.getElementById('hud-coins');
const speedBar = document.getElementById('speed-bar');
const startScr = document.getElementById('start-screen');
const goScr    = document.getElementById('gameover-screen');
const hudBadge = document.getElementById('hud-level-badge');

// Level select
document.querySelectorAll('.lvl-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    const key=btn.dataset.level;
    currentLevel=LEVELS[key];
    startGame();
  });
});

document.getElementById('btn-restart').addEventListener('click',()=>startGame());
document.getElementById('btn-menu').addEventListener('click',()=>{
  showScreen('start-screen');
  gameState='idle';
  hudEl.classList.add('hidden');
});

function showScreen(id){
  startScr.classList.remove('active');
  goScr.classList.remove('active');
  if(id) document.getElementById(id).classList.add('active');
}

function updateHUD(){
  hudScore.textContent=Math.floor(score);
  hudCoins.textContent='🪙 '+coins;
  const pct=Math.min(100,((gameSpeed-currentLevel.baseSpd)/(currentLevel.maxSpd-currentLevel.baseSpd))*100);
  speedBar.style.width=(8+pct*0.92)+'%';
}

function showCoinPop(){
  const el=document.createElement('div');
  el.className='coin-popup';
  el.textContent='+10';
  el.style.left=(window.innerWidth/2+(Math.random()-0.5)*80)+'px';
  el.style.top=(window.innerHeight*0.28)+'px';
  document.body.appendChild(el);
  setTimeout(()=>el.remove(),720);
}

const crashOvl=document.getElementById('crash-overlay');
function flashCrash(){
  crashOvl.classList.remove('flash');
  void crashOvl.offsetWidth;
  crashOvl.classList.add('flash');
}

/* ═══════════════════════════════════════════════════════════════════════════
   AUDIO
═══════════════════════════════════════════════════════════════════════════ */
let actx=null;
function ac(){ if(!actx) actx=new(window.AudioContext||window.webkitAudioContext)(); return actx; }
function tone(f,d,type='sine',v=0.15,delay=0){
  try{
    const c=ac(),o=c.createOscillator(),g=c.createGain();
    o.connect(g); g.connect(c.destination);
    o.type=type; o.frequency.value=f;
    g.gain.setValueAtTime(0,c.currentTime+delay);
    g.gain.linearRampToValueAtTime(v,c.currentTime+delay+0.01);
    g.gain.exponentialRampToValueAtTime(0.001,c.currentTime+delay+d);
    o.start(c.currentTime+delay); o.stop(c.currentTime+delay+d+0.01);
  }catch(_){}
}
function playCoinSfx(){ tone(880,0.10,'sine',0.14); tone(1320,0.09,'sine',0.10,0.06); }
function playJumpSfx(){ tone(260,0.09,'square',0.08); tone(380,0.12,'sine',0.07,0.05); }
function playCrashSfx(){ tone(90,0.55,'sawtooth',0.28); tone(55,0.40,'square',0.18,0.05); }
function playTrainWarnSfx(){ tone(440,0.14,'square',0.12); tone(440,0.14,'square',0.12,0.22); tone(550,0.14,'square',0.12,0.44); }

let bgmT=null;
function startBGM(){
  stopBGM();
  let s=0;
  const n=[130,146,164,155,130,110,123,146];
  bgmT=setInterval(()=>{ if(gameState==='playing') tone(n[s++%n.length],0.30,'square',0.032); },440);
}
function stopBGM(){ clearInterval(bgmT); }

/* ═══════════════════════════════════════════════════════════════════════════
   GAME LIFECYCLE
═══════════════════════════════════════════════════════════════════════════ */
function startGame(){
  score=0; coins=0;
  gameSpeed=currentLevel.baseSpd;
  dist=0;
  spawnTimer=1.2; coinTimer=0.5; trainTimer=currentLevel.trainRate*1;
  skyPhaseIdx=1; lastPhaseScore=0;

  Object.assign(ps,{
    lane:1,targetLane:1,x:0,y:0,vy:0,
    grounded:true,jumping:false,rolling:false,rollTimer:0,
    dead:false,runT:0,squash:1,leanZ:0,headBob:0,
  });
  PL.root.position.set(0,0,0);
  PL.root.rotation.set(0,0,0);
  PL.body.scale.set(1,1,1);
  PL.body.position.y=0;
  PL.body.rotation.x=0;
  PL.head.position.y=1.62;
  PL.head.rotation.x=0;

  coinPool.forEach(c=>{ c.active=false; c.mesh.visible=false; });
  barrierPool.forEach(b=>{ b.active=false; b.mesh.visible=false; });
  polePool.forEach(p=>{ p.active=false; p.mesh.visible=false; });
  trainPool.forEach(t=>{ t.active=false; t.mesh.visible=false; });

  trackTiles.forEach((t,i)=>{ t.position.z=-i*TILE_LEN+TILE_LEN; });
  envTiles.forEach((t,i)=>{ t.position.z=-i*TILE_LEN+TILE_LEN; });

  // Apply level badge
  hudBadge.textContent=currentLevel.label;
  hudBadge.className='level-badge '+currentLevel.cls;

  applySkyPhase('day');

  gameState='playing';
  showScreen(null);
  hudEl.classList.remove('hidden');
  costumeOpen=false; costumePanel.classList.add('hidden');
  updateHUD();
  startBGM();
}

function triggerDeath(){
  if(ps.dead) return;
  ps.dead=true; gameState='dead';
  playCrashSfx(); flashCrash(); stopBGM();
  if(score>bestScore) bestScore=score;
  document.getElementById('go-score').textContent=Math.floor(score);
  document.getElementById('go-coins').textContent=coins;
  document.getElementById('go-best').textContent=Math.floor(bestScore);
  document.getElementById('go-level').textContent=currentLevel.label;
  setTimeout(()=>{ hudEl.classList.add('hidden'); showScreen('gameover-screen'); },1100);
}

/* ═══════════════════════════════════════════════════════════════════════════
   CAMERA
═══════════════════════════════════════════════════════════════════════════ */
let camX=0,camY=4.8;
function updateCamera(){
  camX+=(ps.x*0.30-camX)*0.10;
  camY+=(4.8+ps.y*0.28-camY)*0.10;
  camera.position.set(camX,camY,11.0);
  camera.lookAt(ps.x*0.15,ps.y*0.28+1.35,-3.8);
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN LOOP
═══════════════════════════════════════════════════════════════════════════ */
let lastT=performance.now();

function loop(now){
  requestAnimationFrame(loop);
  const dt=Math.min((now-lastT)/1000,0.05);
  lastT=now;
  if(gameState==='playing') tick(dt);
  else if(gameState==='dead') { animatePlayer(dt); updateCamera(); }
  renderer.render(scene,camera);
}

function tick(dt){
  // Speed ramp
  gameSpeed=Math.min(currentLevel.maxSpd, currentLevel.baseSpd+dist*0.009);
  dist+=gameSpeed*dt;
  score+=gameSpeed*dt*0.55;
  updateHUD();
  checkSkyTransition();

  // Lateral
  ps.x+=(LANES[ps.targetLane]-ps.x)*LANE_LERP;

  // Jump physics
  if(!ps.grounded){
    ps.vy+=currentLevel.gravity*dt;
    ps.y+=ps.vy*dt;
    if(ps.y<=0){ ps.y=0; ps.vy=0; ps.grounded=true; ps.jumping=false; ps.squash=0.58; }
  }

  // Roll
  if(ps.rolling){ ps.rollTimer-=dt; if(ps.rollTimer<=0) ps.rolling=false; }

  PL.root.position.x=ps.x;
  PL.root.position.y=ps.y;
  animatePlayer(dt);

  // World scroll
  const dz=gameSpeed*dt;

  // Recycle TRACK tiles
  for(const t of trackTiles){
    t.position.z+=dz;
    if(t.position.z>TILE_LEN+1) t.position.z-=TILE_N*TILE_LEN;
  }

  // Recycle ENV tiles (moves WITH track)
  for(const t of envTiles){
    t.position.z+=dz;
    if(t.position.z>TILE_LEN+1) t.position.z-=ENV_N*TILE_LEN;
  }

  // Move coins
  for(const c of coinPool){
    if(!c.active) continue;
    c.mesh.position.z+=dz;
    c.mesh.rotation.y+=dt*3.2;
    if(c.mesh.position.z>DESPAWN){ c.active=false; c.mesh.visible=false; }
  }
  // Move barriers
  for(const b of barrierPool){
    if(!b.active) continue;
    b.mesh.position.z+=dz;
    if(b.mesh.position.z>DESPAWN){ b.active=false; b.mesh.visible=false; }
  }
  // Move poles
  for(const p of polePool){
    if(!p.active) continue;
    p.mesh.position.z+=dz;
    if(p.mesh.position.z>DESPAWN){ p.active=false; p.mesh.visible=false; }
  }
  // Move trains
  for(const t of trainPool){
    if(!t.active) continue;
    t.mesh.position.z+=dz+t.speed*dt;
    const ws=(gameSpeed+t.speed)*dt*1.5;
    for(const w of t.wheels) w.rotation.x+=ws;
    if(t.mesh.position.z>DESPAWN+20){ t.active=false; t.mesh.visible=false; }
  }

  // Spawn obstacles
  spawnTimer-=dt;
  coinTimer-=dt;
  trainTimer-=dt;

  const obRate=Math.max(0.5,currentLevel.obRate-dist*0.00012);
  if(spawnTimer<=0){
    spawnTimer=obRate+Math.random()*0.5;
    const r=Math.random();
    if(r<0.48) spawnBarrier(SPAWN_Z);
    else if(r<0.74) spawnPole(SPAWN_Z);
  }

  const cRate=Math.max(0.7,2.2-dist*0.0001);
  if(coinTimer<=0){ coinTimer=cRate+Math.random()*0.55; spawnCoins(-20); }

  const tRate=Math.max(5.0,currentLevel.trainRate-dist*0.0004);
  if(trainTimer<=0){ trainTimer=tRate+Math.random()*3; spawnTrain(SPAWN_Z); playTrainWarnSfx(); }

  checkCollisions();
  checkCoins();
  updateCamera();
}

/* ═══════════════════════════════════════════════════════════════════════════
   BOOT
═══════════════════════════════════════════════════════════════════════════ */
applySkyPhase('day');
showScreen('start-screen');
requestAnimationFrame(loop);
