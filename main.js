/**
 * Rail Rush 3D  —  main.js  (v2 — performance + physics rewrite)
 * ─────────────────────────────────────────────────────────────────
 *  FIXES vs v1:
 *  • Shadows disabled → massive GPU savings, 60 FPS on mobile
 *  • Pixel-ratio capped at 1.5
 *  • All geometry pre-built and shared (zero per-spawn allocation)
 *  • Manual AABB collision (no Box3.setFromObject GC pressure)
 *  • Realistic 3-car train: bogies, windows, headlight glow, wheel spin
 *  • Jump: fast rise → hang → heavy fall (Subway Surfers feel)
 *  • Squash on landing, body lean on lane switch, head bob while running
 *  • Barriers: must JUMP over (height 1.1 u; cleared when y > 1.15)
 *  • Poles: must ROLL under crossbar (bar at 1.3 u; standing head at 1.82 → blocked, rolling head at 0.75 → clear)
 *  • Trains: fill full lane width, fast approach, warning beep, wheel rotation
 */

'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   CONSTANTS
═══════════════════════════════════════════════════════════════════════════ */
const LANE_W      = 2.5;
const LANES       = [-LANE_W, 0, LANE_W];   // world-X for lanes 0,1,2
const TILE_LEN    = 40;
const TILE_N      = 7;
const BASE_SPD    = 15;
const MAX_SPD     = 38;
const GRAVITY     = -34;          // strong → snappy arc like Subway Surfers
const JUMP_V      = 14.0;         // initial upward velocity
const LANE_LERP   = 0.15;         // lateral interpolation per frame
const ROLL_DUR    = 0.75;         // seconds a roll lasts
const DESPAWN     = 14;           // z > this → recycle object
const SPAWN_Z     = -72;          // where obstacles are created

/* ═══════════════════════════════════════════════════════════════════════════
   RENDERER
═══════════════════════════════════════════════════════════════════════════ */
const canvas   = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias        : false,           // off = faster
  powerPreference  : 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.shadowMap.enabled = false;   // shadows OFF = huge perf win
renderer.setClearColor(0x07090f);

const scene = new THREE.Scene();
scene.fog   = new THREE.Fog(0x07090f, 45, 130);

const camera = new THREE.PerspectiveCamera(62, 1, 0.3, 180);

function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', onResize);
onResize();

/* ═══════════════════════════════════════════════════════════════════════════
   LIGHTING  (no shadows needed, just cheap Lambert)
═══════════════════════════════════════════════════════════════════════════ */
scene.add(new THREE.AmbientLight(0x8899cc, 1.15));
const sun = new THREE.DirectionalLight(0xfff3e0, 1.7);
sun.position.set(7, 22, 12);
scene.add(sun);
const rim = new THREE.DirectionalLight(0x2255ff, 0.5);
rim.position.set(-8, 3, -14);
scene.add(rim);

/* ═══════════════════════════════════════════════════════════════════════════
   SHARED MATERIALS  (one material = one draw-call batch)
═══════════════════════════════════════════════════════════════════════════ */
const M = {
  track   : new THREE.MeshLambertMaterial({ color: 0x1c2030 }),
  ground  : new THREE.MeshLambertMaterial({ color: 0x10141e }),
  sleeper : new THREE.MeshLambertMaterial({ color: 0x3c2c1c }),
  rail    : new THREE.MeshLambertMaterial({ color: 0x6677aa }),
  divL    : new THREE.MeshLambertMaterial({ color: 0xffd700, emissive: 0x554400, emissiveIntensity: 0.5 }),
  // Player
  pSkin   : new THREE.MeshLambertMaterial({ color: 0xf5c842 }),
  pSuit   : new THREE.MeshLambertMaterial({ color: 0xff4e6a }),
  pDark   : new THREE.MeshLambertMaterial({ color: 0x111122 }),
  pWhite  : new THREE.MeshLambertMaterial({ color: 0xffffff }),
  // Coin
  coin    : new THREE.MeshLambertMaterial({ color: 0xffd700, emissive: 0xaa7700, emissiveIntensity: 0.7 }),
  // Barrier
  barO    : new THREE.MeshLambertMaterial({ color: 0xee7811 }),
  barK    : new THREE.MeshLambertMaterial({ color: 0x111111 }),
  barY    : new THREE.MeshLambertMaterial({ color: 0xffdd00 }),
  // Pole
  pole    : new THREE.MeshLambertMaterial({ color: 0xaabbcc }),
  poleWR  : new THREE.MeshLambertMaterial({ color: 0xff3300 }),
  poleWY  : new THREE.MeshLambertMaterial({ color: 0xffcc00 }),
  // Train
  tBody   : new THREE.MeshLambertMaterial({ color: 0xbb1122 }),
  tDark   : new THREE.MeshLambertMaterial({ color: 0x880011 }),
  tWin    : new THREE.MeshLambertMaterial({ color: 0x88bbff, transparent: true, opacity: 0.6 }),
  tHL     : new THREE.MeshLambertMaterial({ color: 0xffffaa, emissive: 0xffff44, emissiveIntensity: 1.8 }),
  tWheel  : new THREE.MeshLambertMaterial({ color: 0x222233 }),
  tConn   : new THREE.MeshLambertMaterial({ color: 0x771122 }),
  // Buildings
  bldg    : new THREE.MeshLambertMaterial({ color: 0x0c1020 }),
  bWin    : new THREE.MeshLambertMaterial({ color: 0xffffaa, emissive: 0xaaaa33, emissiveIntensity: 0.9 }),
};

/* ═══════════════════════════════════════════════════════════════════════════
   SHARED GEOMETRIES  (created once, reused everywhere)
═══════════════════════════════════════════════════════════════════════════ */
const G = {
  coinDisc : new THREE.CylinderGeometry(0.30, 0.30, 0.10, 12),
  barBox   : new THREE.BoxGeometry(2.3, 1.1, 0.45),
  barStrip : new THREE.BoxGeometry(0.23, 1.12, 0.47),
  barTop   : new THREE.BoxGeometry(2.3, 0.14, 0.47),
  pShaft   : new THREE.CylinderGeometry(0.10, 0.10, 2.8, 8),
  pBar     : new THREE.BoxGeometry(3.2, 0.16, 0.16),
  pStripe  : new THREE.BoxGeometry(0.22, 0.17, 0.18),
  tWheel   : new THREE.CylinderGeometry(0.30, 0.30, 0.20, 10),
};

/* ═══════════════════════════════════════════════════════════════════════════
   SKY DOME + STARS
═══════════════════════════════════════════════════════════════════════════ */
(function() {
  const sg = new THREE.SphereGeometry(155, 12, 7);
  sg.scale(-1, 1, 1);
  scene.add(new THREE.Mesh(sg, new THREE.ShaderMaterial({
    uniforms: {
      top: { value: new THREE.Color(0x020408) },
      bot: { value: new THREE.Color(0x090e1e) },
    },
    vertexShader:   `varying float h; void main(){ h=position.y; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `uniform vec3 top,bot; varying float h; void main(){ float t=clamp((h+20.)/100.,0.,1.); gl_FragColor=vec4(mix(bot,top,t),1.); }`,
    side: THREE.BackSide,
  })));

  const sp = [];
  for (let i = 0; i < 480; i++) {
    const t = Math.random()*6.28, p = Math.acos(2*Math.random()-1), r = 130+Math.random()*18;
    sp.push(r*Math.sin(p)*Math.cos(t), r*Math.cos(p), r*Math.sin(p)*Math.sin(t));
  }
  const sGeo = new THREE.BufferGeometry();
  sGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  scene.add(new THREE.Points(sGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.5 })));
})();

/* ═══════════════════════════════════════════════════════════════════════════
   BACKGROUND CITY  (static, built once)
═══════════════════════════════════════════════════════════════════════════ */
(function() {
  const rng = (a,b) => a + Math.random()*(b-a);
  for (let i = 0; i < 30; i++) {
    const h = rng(5, 20), w = rng(1.5, 4), d = rng(1.5, 4.5);
    const side = i % 2 ? 1 : -1;
    const x = side * (10 + rng(0, 9));
    const z = rng(-90, -10);
    const bld = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), M.bldg);
    bld.position.set(x, h/2, z);
    scene.add(bld);
    // Lit windows
    const cols = Math.floor(w/0.8), rows = Math.floor(h/1.5);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (Math.random() < 0.4) continue;
      const wm = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.25, 0.05), M.bWin);
      wm.position.set(x - w/2 + 0.4 + c*0.75, 0.8 + r*1.45, z + d/2 + 0.03);
      scene.add(wm);
    }
  }
})();

/* ═══════════════════════════════════════════════════════════════════════════
   GROUND TILES  (pooled, recycled by moving far tiles to back)
═══════════════════════════════════════════════════════════════════════════ */
function buildTile() {
  const g = new THREE.Group();

  // Track bed (shared mat)
  const bed = new THREE.Mesh(new THREE.BoxGeometry(10.5, 0.20, TILE_LEN), M.track);
  bed.position.y = -0.10;
  g.add(bed);

  // Side dirt strips
  [-8.5, 8.5].forEach(x => {
    const s = new THREE.Mesh(new THREE.BoxGeometry(6, 0.12, TILE_LEN), M.ground);
    s.position.set(x, -0.06, 0);
    g.add(s);
  });

  // Sleepers (railroad ties) every 1.4 units
  for (let z = -TILE_LEN/2 + 0.9; z < TILE_LEN/2; z += 1.4) {
    const sl = new THREE.Mesh(new THREE.BoxGeometry(8.5, 0.22, 0.36), M.sleeper);
    sl.position.set(0, 0.02, z);
    g.add(sl);
  }

  // Rails — 4 rails (left pair + right pair)
  [-3.6, -1.1, 1.1, 3.6].forEach(x => {
    const r = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.14, TILE_LEN), M.rail);
    r.position.set(x, 0.24, 0);
    g.add(r);
  });

  // Gold lane-divider strips
  [-LANE_W/2, LANE_W/2].forEach(x => {
    const d = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.20, TILE_LEN), M.divL);
    d.position.set(x, 0.01, 0);
    g.add(d);
  });

  scene.add(g);
  return g;
}

const tiles = [];
for (let i = 0; i < TILE_N; i++) {
  const t = buildTile();
  t.position.z = -i * TILE_LEN + TILE_LEN;
  tiles.push(t);
}

/* ═══════════════════════════════════════════════════════════════════════════
   PLAYER CHARACTER  (articulated, all parts exposed for animation)
═══════════════════════════════════════════════════════════════════════════ */
const PL = {};   // player parts

PL.root = new THREE.Group();
scene.add(PL.root);

// Body group — scaled for squash/stretch
PL.body = new THREE.Group();
PL.root.add(PL.body);

// Torso
PL.torso = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.74, 0.36), M.pSkin);
PL.torso.position.y = 1.05;
PL.body.add(PL.torso);

// Chest logo / badge
const badge = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.22, 0.06), M.pSuit);
badge.position.set(0, 1.12, 0.19);
PL.body.add(badge);

// Head pivot
PL.head = new THREE.Group();
PL.head.position.y = 1.62;
PL.body.add(PL.head);

const headMesh = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.44, 0.44), M.pSkin);
PL.head.add(headMesh);

// Eyes
[-0.10, 0.10].forEach(x => {
  const eye = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.04), M.pDark);
  eye.position.set(x, 0.05, 0.22);
  PL.head.add(eye);
  const shine = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.02), M.pWhite);
  shine.position.set(x+0.025, 0.08, 0.24);
  PL.head.add(shine);
});

// Mouth
const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.04, 0.04), M.pDark);
mouth.position.set(0, -0.10, 0.22);
PL.head.add(mouth);

// Cap
const cap = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.11, 0.48), M.pSuit);
cap.position.y = 0.25;
PL.head.add(cap);
const capBrim = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.07, 0.22), M.pSuit);
capBrim.position.set(0, 0.18, 0.29);
PL.head.add(capBrim);

// Scarf
const scarf = new THREE.Mesh(new THREE.BoxGeometry(0.60, 0.15, 0.38), M.pSuit);
scarf.position.y = 1.36;
PL.body.add(scarf);

// Arms — pivot at shoulder top
function makeArm(side) {
  const pivot = new THREE.Group();
  pivot.position.set(side * 0.41, 1.32, 0);
  const upper = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.40, 0.20), M.pSkin);
  upper.position.y = -0.20;
  pivot.add(upper);
  const lower = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.34, 0.18), M.pSuit);
  lower.position.y = -0.54;
  pivot.add(lower);
  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.16, 0.20), M.pSkin);
  hand.position.y = -0.74;
  pivot.add(hand);
  PL.body.add(pivot);
  return pivot;
}
PL.lArm = makeArm(-1);
PL.rArm = makeArm( 1);

// Legs — pivot at hip
function makeLeg(side) {
  const pivot = new THREE.Group();
  pivot.position.set(side * 0.17, 0.70, 0);
  const upper = new THREE.Mesh(new THREE.BoxGeometry(0.23, 0.44, 0.23), M.pSuit);
  upper.position.y = -0.22;
  pivot.add(upper);
  const lower = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.38, 0.21), M.pSkin);
  lower.position.y = -0.56;
  pivot.add(lower);
  // Shoe
  const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.13, 0.34), M.pDark);
  shoe.position.set(0, -0.78, 0.07);
  pivot.add(shoe);
  PL.body.add(pivot);
  return pivot;
}
PL.lLeg = makeLeg(-1);
PL.rLeg = makeLeg( 1);

/* ═══════════════════════════════════════════════════════════════════════════
   PLAYER PHYSICS STATE
═══════════════════════════════════════════════════════════════════════════ */
const ps = {
  lane       : 1,      // current display lane (0,1,2)
  targetLane : 1,      // desired lane
  x          : 0,      // current world X (lerped)
  y          : 0,      // current world Y (jump offset)
  vy         : 0,      // vertical velocity
  grounded   : true,
  jumping    : false,
  rolling    : false,
  rollTimer  : 0,
  dead       : false,
  runT       : 0,      // animation clock
  squash     : 1.0,    // body y-scale (1 = normal, <1 = squashed on land)
  leanZ      : 0,      // root rotation.z for lane-switch lean
  headBob    : 0,
};

/* ═══════════════════════════════════════════════════════════════════════════
   PLAYER ANIMATION
═══════════════════════════════════════════════════════════════════════════ */
function animatePlayer(dt) {
  ps.runT += dt;
  const t = ps.runT;

  // Squash recovery toward 1
  ps.squash += (1.0 - ps.squash) * 0.20;
  PL.body.scale.set(1.0 / Math.sqrt(ps.squash), ps.squash, 1.0 / Math.sqrt(ps.squash));

  // Lean into lane switch
  const laneErr = LANES[ps.targetLane] - ps.x;
  const leanTgt = -laneErr * 0.20;
  ps.leanZ += (leanTgt - ps.leanZ) * 0.14;
  PL.root.rotation.z = ps.leanZ;

  // Death ragdoll
  if (ps.dead) {
    PL.root.rotation.x += dt * 4.0;
    PL.root.rotation.z += dt * 2.5;
    PL.root.position.y = Math.max(-0.6, PL.root.position.y - dt * 7);
    return;
  }

  // ROLLING — full body curl, height shrinks
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

  // Reset body curl
  PL.body.rotation.x = 0;
  PL.body.position.y = 0;
  PL.head.rotation.x = 0;

  // JUMPING
  if (ps.jumping) {
    const rising = ps.vy > 0;
    PL.root.rotation.x = rising ? -0.30 : 0.18;
    // Arms flare out
    PL.lArm.rotation.x = -1.0; PL.rArm.rotation.x = -1.0;
    PL.lArm.rotation.z =  0.7; PL.rArm.rotation.z = -0.7;
    // Legs tuck
    PL.lLeg.rotation.x = -0.7; PL.rLeg.rotation.x = -0.7;
    return;
  }

  // RUNNING
  PL.root.rotation.x = -0.07;
  const swing = Math.sin(t * 9.5) * 0.70;
  PL.lArm.rotation.x =  swing; PL.rArm.rotation.x = -swing;
  PL.lArm.rotation.z =  0.10;  PL.rArm.rotation.z = -0.10;
  PL.lLeg.rotation.x = -swing * 0.85; PL.rLeg.rotation.x = swing * 0.85;
  // Head bob
  const bob = Math.sin(t * 9.5) * 0.045;
  ps.headBob += (bob - ps.headBob) * 0.30;
  PL.head.position.y = 1.62 + ps.headBob;
}

/* ═══════════════════════════════════════════════════════════════════════════
   OBJECT POOLS
═══════════════════════════════════════════════════════════════════════════ */

/* ── Coins ── */
const coinPool = [];
for (let i = 0; i < 55; i++) {
  const m = new THREE.Mesh(G.coinDisc, M.coin);
  m.rotation.x = Math.PI / 2;
  m.visible = false;
  scene.add(m);
  coinPool.push({ mesh: m, active: false });
}

/* ── Barriers (low block — must JUMP) ──
   Height: 0 – 1.1 units.  Player standing top = 1.82.
   Player's feet while jumping: y > 1.15 clears the barrier.          */
const barrierPool = [];
for (let i = 0; i < 20; i++) {
  const g = new THREE.Group();
  const box = new THREE.Mesh(G.barBox, M.barO);
  box.position.y = 0.55;
  g.add(box);
  // Black danger stripes
  [-0.70, 0, 0.70].forEach(sx => {
    const s = new THREE.Mesh(G.barStrip, M.barK);
    s.position.set(sx, 0.55, 0);
    g.add(s);
  });
  // Yellow top band
  const top = new THREE.Mesh(G.barTop, M.barY);
  top.position.y = 1.06;
  g.add(top);
  g.visible = false;
  scene.add(g);
  barrierPool.push({ mesh: g, active: false, lane: 1 });
}

/* ── Poles (low crossbar — must ROLL under) ──
   Crossbar at y 1.28–1.44.
   Standing player top = 1.82 → hits crossbar.
   Rolling player top  = 0.85 → clears crossbar.                       */
const polePool = [];
for (let i = 0; i < 16; i++) {
  const g = new THREE.Group();
  // Two vertical posts (side posts, very thin — player can pass between)
  [-1.15, 1.15].forEach(x => {
    const shaft = new THREE.Mesh(G.pShaft, M.pole);
    shaft.position.set(x, 1.4, 0);
    g.add(shaft);
  });
  // LOW crossbar (the killer — at y 1.28-1.44)
  const bar = new THREE.Mesh(G.pBar, M.pole);
  bar.position.y = 1.36;
  g.add(bar);
  // Warning stripes on crossbar
  for (let b = -1.35; b < 1.4; b += 0.52) {
    const st = new THREE.Mesh(G.pStripe, b % 1.04 < 0.52 ? M.poleWR : M.poleWY);
    st.position.set(b, 1.36, 0);
    g.add(st);
  }
  g.visible = false;
  scene.add(g);
  polePool.push({ mesh: g, active: false, lane: 1 });
}

/* ── Trains (3-car realistic train — must switch LANE) ── */
const trainPool = [];

function buildTrainMesh() {
  const root    = new THREE.Group();
  const CAR_LEN = 9.5;
  const GAP     = 0.9;
  const N_CARS  = 3;
  const allWheels = [];

  for (let c = 0; c < N_CARS; c++) {
    const car = new THREE.Group();
    car.position.z = -c * (CAR_LEN + GAP);

    // Main body
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.9, CAR_LEN), M.tBody);
    body.position.y = 1.45;
    car.add(body);

    // Roof strip
    const roof = new THREE.Mesh(new THREE.BoxGeometry(2.22, 0.25, CAR_LEN + 0.1), M.tDark);
    roof.position.y = 3.0;
    car.add(roof);

    // Windows — both sides, 4 rows
    [-1.12, 1.12].forEach(wx => {
      for (let row = 0; row < 4; row++) {
        const win = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.55, 1.10), M.tWin);
        win.position.set(wx, 1.95 - row * 0.72, -3.4 + row * 2.1);
        car.add(win);
      }
    });

    // Bogie/wheels — 2 bogies per car
    [-CAR_LEN * 0.30, CAR_LEN * 0.30].forEach(bz => {
      [-0.88, 0.88].forEach(bx => {
        const wh = new THREE.Mesh(G.tWheel, M.tWheel);
        wh.position.set(bx, 0.30, bz);
        wh.rotation.z = Math.PI / 2;
        car.add(wh);
        allWheels.push(wh);
      });
    });

    // Inter-car connector
    if (c < N_CARS - 1) {
      const conn = new THREE.Mesh(
        new THREE.BoxGeometry(1.6, 1.85, GAP + 0.2), M.tConn);
      conn.position.set(0, 0.95, -(CAR_LEN/2 + GAP/2 + 0.05));
      car.add(conn);
    }

    root.add(car);
  }

  // Front face (locomotive nose)
  const nose = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.9, 0.4), M.tDark);
  nose.position.set(0, 1.45, CAR_LEN / 2 + 0.2);
  root.add(nose);

  // Headlights
  [-0.6, 0.6].forEach(x => {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.40, 0.24, 0.12), M.tHL);
    hl.position.set(x, 0.85, CAR_LEN / 2 + 0.35);
    root.add(hl);
    // Headlight point light (cheap — one per train max)
    if (x > 0) {
      const ptl = new THREE.PointLight(0xffffaa, 1.8, 8);
      ptl.position.set(0, 0.85, CAR_LEN / 2 + 1.5);
      root.add(ptl);
    }
  });

  // Front number plate
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.32, 0.08), M.tHL);
  plate.position.set(0, 2.2, CAR_LEN / 2 + 0.37);
  root.add(plate);

  root.visible = false;
  scene.add(root);
  trainPool.push({ mesh: root, active: false, lane: 1, speed: 0, wheels: allWheels });
}

for (let i = 0; i < 5; i++) buildTrainMesh();

/* ═══════════════════════════════════════════════════════════════════════════
   GAME STATE
═══════════════════════════════════════════════════════════════════════════ */
let gameState  = 'idle';
let score      = 0;
let coins      = 0;
let bestScore  = 0;
let gameSpeed  = BASE_SPD;
let dist       = 0;
let spawnTimer = 1.0;
let coinTimer  = 0.5;
let trainTimer = 5.0;

/* ═══════════════════════════════════════════════════════════════════════════
   SPAWNING
═══════════════════════════════════════════════════════════════════════════ */
function spawnCoins(z) {
  const lane  = Math.floor(Math.random() * 3);
  const count = 4 + Math.floor(Math.random() * 7);
  const arc   = Math.random() < 0.4;   // arc pattern vs. straight line
  for (let i = 0; i < count; i++) {
    const c = coinPool.find(c => !c.active);
    if (!c) continue;
    c.active = true;
    c.mesh.visible = true;
    const yOff = arc ? Math.sin(i / count * Math.PI) * 2.5 : 0;
    c.mesh.position.set(LANES[lane], 0.90 + yOff, z - i * 1.7);
  }
}

function spawnBarrier(z) {
  // Randomly block 1 or 2 lanes
  const block = Math.random() < 0.30 ? 2 : 1;
  const start = Math.floor(Math.random() * (4 - block));
  for (let i = 0; i < block; i++) {
    const b = barrierPool.find(b => !b.active);
    if (!b) return;
    b.active = true;
    b.lane   = start + i;
    b.mesh.visible = true;
    b.mesh.position.set(LANES[b.lane], 0, z);
  }
}

function spawnPole(z) {
  const lane = Math.floor(Math.random() * 3);
  const p = polePool.find(p => !p.active);
  if (!p) return;
  p.active = true; p.lane = lane;
  p.mesh.visible = true;
  p.mesh.position.set(LANES[lane], 0, z);
}

function spawnTrain(z) {
  const lane = Math.floor(Math.random() * 3);
  const t = trainPool.find(t => !t.active);
  if (!t) return;
  t.active = true; t.lane = lane;
  // Trains come from far ahead, move faster than world scroll
  t.speed = gameSpeed * (0.5 + Math.random() * 0.65);
  t.mesh.visible = true;
  t.mesh.rotation.set(0, 0, 0);
  // Place far ahead (negative Z = in front)
  t.mesh.position.set(LANES[lane], 0, z - 40);
}

/* ═══════════════════════════════════════════════════════════════════════════
   COLLISION  (manual AABB, zero garbage)
═══════════════════════════════════════════════════════════════════════════ */
// Player AABB — recomputed once per tick
let px0, px1, py0, py1, pz0, pz1;

function buildPlayerBox() {
  const hw = 0.26;
  const h  = ps.rolling ? 0.80 : 1.82;  // rolling = crouched low
  px0 = ps.x - hw;              px1 = ps.x + hw;
  py0 = ps.y;                   py1 = ps.y + h;
  pz0 = PL.root.position.z - 0.22; pz1 = PL.root.position.z + 0.22;
}

function aabb(ax0,ax1,ay0,ay1,az0,az1, bx0,bx1,by0,by1,bz0,bz1) {
  return ax0<bx1 && ax1>bx0 && ay0<by1 && ay1>by0 && az0<bz1 && az1>bz0;
}

function checkCollisions() {
  if (ps.dead) return;
  buildPlayerBox();

  // ── Barriers: solid block y 0 – 1.10
  //    Must jump. Player y (bottom) > 1.10 → safe (feet above barrier top).
  for (const b of barrierPool) {
    if (!b.active) continue;
    const bx = b.mesh.position.x, bz = b.mesh.position.z;
    if (aabb(px0,px1, py0,py1, pz0,pz1,
             bx-1.10,bx+1.10, 0,1.10, bz-0.50,bz+0.50)) {
      triggerDeath(); return;
    }
  }

  // ── Poles: crossbar at y 1.28–1.44, width 3.2
  //    Standing top = 1.82 → hits.  Rolling top = 0.80 → clears.
  for (const p of polePool) {
    if (!p.active) continue;
    const px2 = p.mesh.position.x, pz2 = p.mesh.position.z;
    if (aabb(px0,px1, py0,py1, pz0,pz1,
             px2-1.58,px2+1.58, 1.28,1.44, pz2-0.14,pz2+0.14)) {
      triggerDeath(); return;
    }
  }

  // ── Trains: full lane blocked, y 0–3
  for (const t of trainPool) {
    if (!t.active) continue;
    const tx = t.mesh.position.x, tz = t.mesh.position.z;
    // Full train length is 3 cars × ~10.4 + gaps ≈ 32 units
    if (aabb(px0,px1, py0,py1, pz0,pz1,
             tx-1.08,tx+1.08, 0,3.1, tz-16,tz+6.5)) {
      triggerDeath(); return;
    }
  }
}

function checkCoins() {
  if (ps.dead) return;
  const pzC = PL.root.position.z;
  for (const c of coinPool) {
    if (!c.active) continue;
    const cp = c.mesh.position;
    if (Math.abs(cp.x - ps.x)    < 0.68 &&
        Math.abs(cp.y - ps.y - 0.9) < 0.90 &&
        Math.abs(cp.z - pzC)     < 0.78) {
      c.active = false;
      c.mesh.visible = false;
      coins++;
      score += 10;
      updateHUD();
      showCoinPop();
      playCoinSfx();
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   INPUT
═══════════════════════════════════════════════════════════════════════════ */
document.addEventListener('keydown', e => {
  if (gameState !== 'playing') return;
  switch (e.code) {
    case 'ArrowLeft':  changeLane(-1); break;
    case 'ArrowRight': changeLane( 1); break;
    case 'ArrowUp':    doJump();       break;
    case 'ArrowDown':  doRoll();       break;
  }
  e.preventDefault();
}, { passive: false });

let swX = 0, swY = 0;
window.addEventListener('touchstart', e => { swX = e.touches[0].clientX; swY = e.touches[0].clientY; }, { passive: true });
window.addEventListener('touchend', e => {
  if (gameState !== 'playing') return;
  const dx = e.changedTouches[0].clientX - swX;
  const dy = e.changedTouches[0].clientY - swY;
  if (Math.abs(dx) > Math.abs(dy)) { changeLane(dx > 25 ? 1 : -1); }
  else { if (dy < -25) doJump(); else if (dy > 25) doRoll(); }
}, { passive: true });

function changeLane(d) {
  const n = ps.targetLane + d;
  if (n < 0 || n > 2) return;
  ps.targetLane = n;
}

function doJump() {
  if (!ps.grounded) return;
  ps.vy = JUMP_V;
  ps.grounded = false;
  ps.jumping  = true;
  ps.rolling  = false;   // cancel any active roll
  playJumpSfx();
}

function doRoll() {
  if (!ps.grounded) {
    // Air roll → fast fall
    ps.vy = Math.min(ps.vy, -8);
    return;
  }
  ps.rolling   = true;
  ps.rollTimer = ROLL_DUR;
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

document.getElementById('btn-start').addEventListener('click',   startGame);
document.getElementById('btn-restart').addEventListener('click', startGame);

function showScreen(id) {
  startScr.classList.remove('active');
  goScr.classList.remove('active');
  if (id) document.getElementById(id).classList.add('active');
}

function updateHUD() {
  hudScore.textContent = Math.floor(score);
  hudCoins.textContent = '🪙 ' + coins;
  const pct = Math.min(100, ((gameSpeed - BASE_SPD) / (MAX_SPD - BASE_SPD)) * 100);
  speedBar.style.width = (8 + pct * 0.92) + '%';
}

// Coin pop label
function showCoinPop() {
  const el = document.createElement('div');
  el.className = 'coin-popup';
  el.textContent = '+10';
  el.style.left = (window.innerWidth/2 + (Math.random()-0.5)*80) + 'px';
  el.style.top  = (window.innerHeight * 0.28) + 'px';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 720);
}

// Red crash overlay
const crashOvl = document.createElement('div');
crashOvl.id = 'crash-overlay';
document.body.appendChild(crashOvl);
function flashCrash() {
  crashOvl.classList.remove('flash');
  void crashOvl.offsetWidth;
  crashOvl.classList.add('flash');
}

/* ═══════════════════════════════════════════════════════════════════════════
   AUDIO  (Web Audio API — no external files)
═══════════════════════════════════════════════════════════════════════════ */
let actx = null;
function ac() {
  if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
  return actx;
}

function tone(freq, dur, type = 'sine', vol = 0.15, delay = 0) {
  try {
    const c = ac(), o = c.createOscillator(), g = c.createGain();
    o.connect(g); g.connect(c.destination);
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0, c.currentTime + delay);
    g.gain.linearRampToValueAtTime(vol, c.currentTime + delay + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + delay + dur);
    o.start(c.currentTime + delay);
    o.stop(c.currentTime + delay + dur + 0.01);
  } catch(_) {}
}

function playCoinSfx() {
  tone(880, 0.10, 'sine', 0.14);
  tone(1320, 0.09, 'sine', 0.10, 0.06);
}
function playJumpSfx() {
  tone(260, 0.09, 'square', 0.08);
  tone(380, 0.12, 'sine',   0.07, 0.05);
}
function playCrashSfx() {
  tone(90, 0.55, 'sawtooth', 0.28);
  tone(55, 0.40, 'square',   0.18, 0.05);
}
function playTrainWarnSfx() {
  tone(440, 0.14, 'square', 0.12);
  tone(440, 0.14, 'square', 0.12, 0.22);
  tone(550, 0.14, 'square', 0.12, 0.44);
}

let bgmTimer = null;
function startBGM() {
  stopBGM();
  let s = 0;
  const n = [130, 146, 164, 155, 130, 110, 123, 146];
  bgmTimer = setInterval(() => {
    if (gameState !== 'playing') return;
    tone(n[s++ % n.length], 0.30, 'square', 0.032);
  }, 440);
}
function stopBGM() { clearInterval(bgmTimer); }

/* ═══════════════════════════════════════════════════════════════════════════
   GAME LIFECYCLE
═══════════════════════════════════════════════════════════════════════════ */
function startGame() {
  score = 0; coins = 0; gameSpeed = BASE_SPD; dist = 0;
  spawnTimer = 1.2; coinTimer = 0.4; trainTimer = 5.5;

  // Reset player state
  Object.assign(ps, {
    lane:1, targetLane:1, x:0, y:0, vy:0,
    grounded:true, jumping:false, rolling:false, rollTimer:0,
    dead:false, runT:0, squash:1, leanZ:0, headBob:0,
  });
  PL.root.position.set(0, 0, 0);
  PL.root.rotation.set(0, 0, 0);
  PL.body.scale.set(1, 1, 1);
  PL.body.position.y = 0;
  PL.body.rotation.x = 0;
  PL.head.position.y = 1.62;
  PL.head.rotation.x = 0;

  // Clear pools
  coinPool.forEach(c => { c.active = false; c.mesh.visible = false; });
  barrierPool.forEach(b => { b.active = false; b.mesh.visible = false; });
  polePool.forEach(p => { p.active = false; p.mesh.visible = false; });
  trainPool.forEach(t => { t.active = false; t.mesh.visible = false; });

  // Reset tiles
  tiles.forEach((t, i) => { t.position.z = -i * TILE_LEN + TILE_LEN; });

  gameState = 'playing';
  showScreen(null);
  hudEl.classList.remove('hidden');
  updateHUD();
  startBGM();
}

function triggerDeath() {
  if (ps.dead) return;
  ps.dead   = true;
  gameState = 'dead';
  playCrashSfx();
  flashCrash();
  stopBGM();

  if (score > bestScore) bestScore = score;
  document.getElementById('go-score').textContent = Math.floor(score);
  document.getElementById('go-coins').textContent = coins;
  document.getElementById('go-best').textContent  = Math.floor(bestScore);

  setTimeout(() => {
    hudEl.classList.add('hidden');
    showScreen('gameover-screen');
  }, 1100);
}

/* ═══════════════════════════════════════════════════════════════════════════
   CAMERA  (smooth, follows player with slight lag)
═══════════════════════════════════════════════════════════════════════════ */
let camX = 0, camY = 4.8;

function updateCamera() {
  camX += (ps.x * 0.30 - camX) * 0.10;
  camY += (4.8 + ps.y * 0.28 - camY) * 0.10;
  camera.position.set(camX, camY, 11.0);
  camera.lookAt(ps.x * 0.15, ps.y * 0.28 + 1.35, -3.8);
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN LOOP
═══════════════════════════════════════════════════════════════════════════ */
let lastT = performance.now();

function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min((now - lastT) / 1000, 0.05);  // cap delta
  lastT = now;

  if (gameState === 'playing') {
    tick(dt);
  } else if (gameState === 'dead') {
    animatePlayer(dt);
  }

  renderer.render(scene, camera);
}

function tick(dt) {
  // Speed ramp (distance-based, not time-based)
  gameSpeed  = Math.min(MAX_SPD, BASE_SPD + dist * 0.009);
  dist      += gameSpeed * dt;
  score     += gameSpeed * dt * 0.55;
  updateHUD();

  // ── Lateral lerp ──
  ps.x += (LANES[ps.targetLane] - ps.x) * LANE_LERP;

  // ── Jump physics ──
  if (!ps.grounded) {
    ps.vy += GRAVITY * dt;
    ps.y  += ps.vy  * dt;
    if (ps.y <= 0) {
      ps.y = 0; ps.vy = 0;
      ps.grounded = true;
      ps.jumping  = false;
      ps.squash   = 0.58;   // squash on landing
    }
  }

  // ── Roll countdown ──
  if (ps.rolling) {
    ps.rollTimer -= dt;
    if (ps.rollTimer <= 0) ps.rolling = false;
  }

  // Apply position to mesh
  PL.root.position.x = ps.x;
  PL.root.position.y = ps.y;

  animatePlayer(dt);

  // ── World scroll (everything moves +Z toward camera) ──
  const dz = gameSpeed * dt;

  // Recycle tiles
  for (const t of tiles) {
    t.position.z += dz;
    if (t.position.z > TILE_LEN + 1) t.position.z -= TILE_N * TILE_LEN;
  }

  // Move coins
  for (const c of coinPool) {
    if (!c.active) continue;
    c.mesh.position.z += dz;
    c.mesh.rotation.y += dt * 3.2;
    if (c.mesh.position.z > DESPAWN) { c.active = false; c.mesh.visible = false; }
  }

  // Move barriers
  for (const b of barrierPool) {
    if (!b.active) continue;
    b.mesh.position.z += dz;
    if (b.mesh.position.z > DESPAWN) { b.active = false; b.mesh.visible = false; }
  }

  // Move poles
  for (const p of polePool) {
    if (!p.active) continue;
    p.mesh.position.z += dz;
    if (p.mesh.position.z > DESPAWN) { p.active = false; p.mesh.visible = false; }
  }

  // Move trains (+ their own approach speed + spin wheels)
  for (const t of trainPool) {
    if (!t.active) continue;
    t.mesh.position.z += dz + t.speed * dt;
    const wSpin = (gameSpeed + t.speed) * dt * 1.5;
    for (const w of t.wheels) w.rotation.x += wSpin;
    if (t.mesh.position.z > DESPAWN + 20) { t.active = false; t.mesh.visible = false; }
  }

  // ── Spawn ──
  spawnTimer -= dt;
  coinTimer  -= dt;
  trainTimer -= dt;

  const spawnRate = Math.max(0.55, 2.6 - dist * 0.00016);
  if (spawnTimer <= 0) {
    spawnTimer = spawnRate + Math.random() * 0.55;
    const r = Math.random();
    if      (r < 0.48) spawnBarrier(SPAWN_Z);
    else if (r < 0.74) spawnPole(SPAWN_Z);
    // else: breathing room
  }

  const coinRate = Math.max(0.75, 2.2 - dist * 0.0001);
  if (coinTimer <= 0) {
    coinTimer = coinRate + Math.random() * 0.55;
    spawnCoins(-20);
  }

  const trainRate = Math.max(5.5, 20 - dist * 0.0005);
  if (trainTimer <= 0) {
    trainTimer = trainRate + Math.random() * 3;
    spawnTrain(SPAWN_Z);
    playTrainWarnSfx();
  }

  // ── Collision ──
  checkCollisions();
  checkCoins();

  // ── Camera ──
  updateCamera();
}

/* ═══════════════════════════════════════════════════════════════════════════
   BOOT
═══════════════════════════════════════════════════════════════════════════ */
showScreen('start-screen');
requestAnimationFrame(loop);
