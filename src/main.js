import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/* =========================================================================
   Ghibli Dünyası — stilize 3B açık dünya (Three.js)
   Teknikler: cel/toon shading, low-poly + instancing, sis, gradyan gökyüzü,
   yumuşak gölgeler ve üçüncü şahıs karakter kontrolcüsü.
   ========================================================================= */

// ---- Renderer ----------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.getElementById('app').appendChild(renderer.domElement);

// ---- Scene & atmosphere -----------------------------------------------
const scene = new THREE.Scene();
const SKY_TOP = new THREE.Color('#7ec8e3');
const SKY_BOTTOM = new THREE.Color('#e9f7ef');
scene.background = SKY_TOP.clone();
scene.fog = new THREE.Fog('#bfe3f0', 60, 240);

// Gradyan gökyüzü kubbesi
{
  const skyGeo = new THREE.SphereGeometry(400, 32, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      top: { value: SKY_TOP }, bottom: { value: SKY_BOTTOM }, offset: { value: 40 },
    },
    vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `varying vec3 vP; uniform vec3 top; uniform vec3 bottom; uniform float offset;
      void main(){ float h = normalize(vP + vec3(0.0, offset, 0.0)).y; float t = clamp(h*0.5+0.5, 0.0, 1.0);
      gl_FragColor = vec4(mix(bottom, top, pow(t, 0.8)), 1.0); }`,
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));
}

// Yumuşak bulutlar
function makeClouds() {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false });
  for (let i = 0; i < 22; i++) {
    const cloud = new THREE.Group();
    const puffs = 3 + (Math.random() * 4 | 0);
    for (let p = 0; p < puffs; p++) {
      const r = 4 + Math.random() * 5;
      const s = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), mat);
      s.position.set((Math.random() - 0.5) * 18, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 8);
      s.scale.y = 0.6; cloud.add(s);
    }
    const ang = Math.random() * Math.PI * 2, dist = 120 + Math.random() * 180;
    cloud.position.set(Math.cos(ang) * dist, 70 + Math.random() * 50, Math.sin(ang) * dist);
    g.add(cloud);
  }
  return g;
}
const clouds = makeClouds();
scene.add(clouds);

// ---- Lights ------------------------------------------------------------
const hemi = new THREE.HemisphereLight('#cfefff', '#7ea06b', 0.9);
scene.add(hemi);

const sun = new THREE.DirectionalLight('#fff4d6', 2.0);
sun.position.set(60, 90, 40);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1; sun.shadow.camera.far = 300;
const sc = sun.shadow.camera;
sc.left = -90; sc.right = 90; sc.top = 90; sc.bottom = -90;
sun.shadow.bias = -0.0004;
scene.add(sun);
scene.add(sun.target);

// ---- Toon (cel) shading yardımcısı ------------------------------------
function gradientMap(steps = 4) {
  const data = new Uint8Array(steps);
  for (let i = 0; i < steps; i++) data[i] = (i / (steps - 1)) * 255;
  const tex = new THREE.DataTexture(data, steps, 1, THREE.RedFormat);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}
const ramp = gradientMap(3);                 // daha yumuşak, suluboya bandı
const toon = (color) => new THREE.MeshToonMaterial({ color, gradientMap: ramp });

// --- El çizimi hissi yardımcıları --------------------------------------
// 1) Mürekkep konturu: nesnenin büyütülmüş, içten görünen koyu kopyası
const INK = new THREE.Color('#3a2f2a');
function addOutline(mesh, thickness = 0.06) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: { thickness: { value: thickness }, inkColor: { value: INK } },
    vertexShader: `uniform float thickness; varying float vy;
      void main(){ vy = position.y; vec3 p = position + normalize(normal) * thickness;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }`,
    fragmentShader: `uniform vec3 inkColor; void main(){ gl_FragColor = vec4(inkColor, 1.0); }`,
  });
  const o = new THREE.Mesh(mesh.geometry, mat);
  o.castShadow = false; o.receiveShadow = false;
  mesh.add(o);
  return o;
}
// 2) Geometriyi düzensizleştir: kusursuz şekilleri elle yapılmış gibi boz
function roughen(geo, amount = 0.12) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    p.setXYZ(i,
      p.getX(i) + (Math.random() - 0.5) * amount,
      p.getY(i) + (Math.random() - 0.5) * amount,
      p.getZ(i) + (Math.random() - 0.5) * amount);
  }
  p.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

// ---- Zemin (yumuşak tepeler) ------------------------------------------
const WORLD = 260;
function heightAt(x, z) {
  return Math.sin(x * 0.045) * 2.4 + Math.cos(z * 0.05) * 2.2
       + Math.sin((x + z) * 0.018) * 3.0
       + Math.sin(x * 0.21 + z * 0.13) * 0.45      // ince elle çizilmiş tümsekler
       + Math.cos(x * 0.37 - z * 0.29) * 0.28;
}
const groundGeo = new THREE.PlaneGeometry(WORLD, WORLD, 120, 120);
groundGeo.rotateX(-Math.PI / 2);
{
  const pos = groundGeo.attributes.position;
  // boyasal renk dalgalanması: açık/koyu yeşil yamalar
  const colors = new Float32Array(pos.count * 3);
  const cA = new THREE.Color('#8fc96f'), cB = new THREE.Color('#6fa84f'), tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, heightAt(x, z));
    const t = (Math.sin(x * 0.13) * Math.cos(z * 0.11) * 0.5 + 0.5) * 0.7
            + Math.sin(x * 0.4 + z * 0.3) * 0.15 + 0.15;
    tmp.copy(cA).lerp(cB, THREE.MathUtils.clamp(t, 0, 1));
    colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
  }
  groundGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  groundGeo.computeVertexNormals();
}
const ground = new THREE.Mesh(
  groundGeo,
  new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: ramp })
);
ground.receiveShadow = true;
scene.add(ground);

// Patika / yol (kuzey-güney ekseni boyunca araziye oturur)
{
  const pathGeo = new THREE.PlaneGeometry(7, WORLD, 1, 120);
  pathGeo.rotateX(-Math.PI / 2);
  const pp = pathGeo.attributes.position;
  for (let i = 0; i < pp.count; i++) {
    pp.setY(i, heightAt(pp.getX(i), pp.getZ(i)) + 0.06);
  }
  pathGeo.computeVertexNormals();
  const path = new THREE.Mesh(pathGeo, toon('#d8c9a3'));
  path.receiveShadow = true;
  scene.add(path);
}

// Gölet (su)
{
  const waterGeo = new THREE.CircleGeometry(16, 40);
  {                                          // kıyıyı dalgalandır (kusursuz daire değil)
    const wp = waterGeo.attributes.position;
    for (let i = 1; i < wp.count; i++) {     // 0 = merkez, dokunma
      const ang = Math.atan2(wp.getY(i), wp.getX(i));
      const wob = 1 + Math.sin(ang * 5) * 0.06 + Math.sin(ang * 11) * 0.04;
      wp.setXY(i, wp.getX(i) * wob, wp.getY(i) * wob);
    }
    wp.needsUpdate = true;
  }
  const water = new THREE.Mesh(
    waterGeo,
    new THREE.MeshToonMaterial({ color: '#5fb6d6', gradientMap: ramp, transparent: true, opacity: 0.85 })
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(-46, heightAt(-46, 40) + 0.2, 40);
  scene.add(water);
}

// ---- Instanced doğa: çimen kümeleri -----------------------------------
function scatterGrass(count = 4000) {
  const blade = new THREE.ConeGeometry(0.16, 1.1, 4);
  blade.translate(0, 0.55, 0);
  const mat = toon('#74b85a');
  const mesh = new THREE.InstancedMesh(blade, mat, count);
  mesh.castShadow = false;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  let n = 0;
  for (let i = 0; i < count; i++) {
    const x = (Math.random() - 0.5) * (WORLD - 30);
    const z = (Math.random() - 0.5) * (WORLD - 30);
    if (Math.abs(x) < 5) continue;                 // yolu boş bırak
    const y = heightAt(x, z);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI);
    const sc2 = 0.6 + Math.random() * 0.9;
    s.set(sc2, sc2 * (0.8 + Math.random() * 0.6), sc2);
    m.compose(new THREE.Vector3(x, y, z), q, s);
    mesh.setMatrixAt(n++, m);
  }
  mesh.count = n;
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}
scene.add(scatterGrass());

// ---- Ağaçlar (low-poly) -----------------------------------------------
function makeTree() {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(
    roughen(new THREE.CylinderGeometry(0.35, 0.55, 3.2, 6), 0.08), toon('#8a5a3b'));
  trunk.position.y = 1.6; trunk.castShadow = true; addOutline(trunk, 0.05); g.add(trunk);
  const greens = ['#5ea24c', '#6cb85a', '#4f9440'];
  for (let i = 0; i < 3; i++) {
    const r = 2.6 - i * 0.55;
    // detay seviyesi 1 + düzensizleştirme → elle çizilmiş yaprak kümesi
    const blob = new THREE.Mesh(
      roughen(new THREE.IcosahedronGeometry(r, 1), r * 0.18), toon(greens[i % 3]));
    blob.position.y = 3.4 + i * 1.5;
    blob.castShadow = true; blob.receiveShadow = true;
    blob.rotation.set(Math.random(), Math.random(), Math.random());
    addOutline(blob, 0.08);
    g.add(blob);
  }
  return g;
}
const trees = new THREE.Group();
for (let i = 0; i < 90; i++) {
  const x = (Math.random() - 0.5) * (WORLD - 24);
  const z = (Math.random() - 0.5) * (WORLD - 24);
  if (Math.abs(x) < 7) continue;
  const t = makeTree();
  t.position.set(x, heightAt(x, z), z);
  const s = 0.7 + Math.random() * 0.8;
  t.scale.setScalar(s);
  t.rotation.y = Math.random() * Math.PI;
  trees.add(t);
}
scene.add(trees);

// ---- Kayalar -----------------------------------------------------------
for (let i = 0; i < 40; i++) {
  const x = (Math.random() - 0.5) * (WORLD - 20);
  const z = (Math.random() - 0.5) * (WORLD - 20);
  const rr = 0.6 + Math.random() * 1.4;
  const rock = new THREE.Mesh(roughen(new THREE.DodecahedronGeometry(rr, 0), rr * 0.22), toon('#9aa0a6'));
  rock.position.set(x, heightAt(x, z) + 0.2, z);
  rock.rotation.set(Math.random(), Math.random(), Math.random());
  rock.castShadow = true; rock.receiveShadow = true;
  addOutline(rock, 0.05);
  scene.add(rock);
}

// ---- Evler (anime kasaba dokunuşu) ------------------------------------
function makeHouse(bodyColor, roofColor) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(roughen(new THREE.BoxGeometry(6, 4, 5, 2, 2, 2), 0.06), toon(bodyColor));
  body.position.y = 2; body.castShadow = true; body.receiveShadow = true; addOutline(body, 0.06); g.add(body);
  const roof = new THREE.Mesh(roughen(new THREE.ConeGeometry(4.8, 3, 4), 0.07), toon(roofColor));
  roof.position.y = 5.5; roof.rotation.y = Math.PI / 4; roof.castShadow = true; addOutline(roof, 0.07); g.add(roof);
  const door = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.2, 0.2), toon('#6b4a30'));
  door.position.set(0, 1.1, 2.55); g.add(door);
  return g;
}
const houseColors = [['#f0e3c8', '#c0584f'], ['#e8d6b8', '#5a7d8c'], ['#efe1cf', '#7a9b6a']];
const houseSpots = [[14, -22], [22, 8], [-20, -16], [-30, 18], [10, 30]];
houseSpots.forEach((spot, i) => {
  const [x, z] = spot;
  const h = makeHouse(...houseColors[i % houseColors.length]);
  h.position.set(x, heightAt(x, z), z);
  h.rotation.y = Math.random() * Math.PI;
  scene.add(h);
});

// ---- Karakter (low-poly, prosedürel yürüyüş) --------------------------
const player = new THREE.Group();
const parts = {};
{
  const skin = toon('#f3c9a0'), shirt = toon('#4a7ec0'), pants = toon('#3a4a5a'), hair = toon('#3a2a22');

  // Not: grup orijini (y=0) ayak tabanında; bacak merkezi 0.6 → kapsül altı tam y=0'da.
  parts.torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 0.7, 4, 10), shirt);
  parts.torso.position.y = 1.25; player.add(parts.torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 14), skin);
  head.position.y = 2.2; player.add(head);
  const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.46, 16, 14, 0, Math.PI * 2, 0, Math.PI * 0.62), hair);
  hairCap.position.y = 2.26; player.add(hairCap);

  parts.armL = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.7, 4, 8), shirt);
  parts.armR = parts.armL.clone();
  parts.armL.position.set(-0.62, 1.4, 0); parts.armR.position.set(0.62, 1.4, 0);
  player.add(parts.armL, parts.armR);

  parts.legL = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.8, 4, 8), pants);
  parts.legR = parts.legL.clone();
  parts.legL.position.set(-0.24, 0.6, 0); parts.legR.position.set(0.24, 0.6, 0);
  player.add(parts.legL, parts.legR);

  player.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  // mürekkep konturu (mevcut parçalara, kontur kopyaları gölge atmaz)
  [...player.children].forEach((m) => { if (m.isMesh) addOutline(m, 0.035); });
}
// Basit (yedek) gövdeyi bir alt gruba taşı; gerçek model yüklenince gizlenecek
const proc = new THREE.Group();
[...player.children].forEach((c) => proc.add(c));
player.add(proc);
player.position.set(0, heightAt(0, 0), 0);
scene.add(player);

// ---- Gerçek karakter modeli (glTF, hazır animasyonlu) -----------------
let mixer = null;
const actions = {};
let current = null;
function setAction(name) {
  const next = actions[name] || actions.idle || current;
  if (!next || next === current) return;
  if (current) current.fadeOut(0.2);
  next.reset().fadeIn(0.2).play();
  current = next;
}
const statusEl = document.getElementById('status');
const setStatus = (msg, cls = '') => { if (statusEl) { statusEl.textContent = 'v7 · ' + msg; statusEl.className = cls; } };
{
  // Model dosyaları npm paketinde YOK; doğrudan three.js GitHub deposundan çekiyoruz.
  const MODEL_URLS = [
    'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r160/examples/models/gltf/RobotExpressive/RobotExpressive.glb',
    'https://raw.githack.com/mrdoob/three.js/r160/examples/models/gltf/RobotExpressive/RobotExpressive.glb',
  ];
  const loader = new GLTFLoader();
  const onLoad = (gltf) => {
    setStatus('karakter modeli yüklendi ✓', 'ok');
    const model = gltf.scene;

    // Boyutlandır: hedef yükseklik ~2.4, ayaklar y=0'da
    let box = new THREE.Box3().setFromObject(model);
    const s = 2.4 / (box.max.y - box.min.y);
    model.scale.setScalar(s);
    box = new THREE.Box3().setFromObject(model);
    model.position.y -= box.min.y;

    // Dünyanın toon görünümüne uydur
    const conv = (m) => new THREE.MeshToonMaterial({
      color: m.color ? m.color : new THREE.Color(0xffffff),
      map: m.map || null, gradientMap: ramp,
      transparent: m.transparent, opacity: m.opacity,
    });
    model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true; o.receiveShadow = true;
        o.material = Array.isArray(o.material) ? o.material.map(conv) : conv(o.material);
      }
    });

    player.add(model);
    proc.visible = false;                 // yedek gövdeyi gizle

    // Animasyonlar
    mixer = new THREE.AnimationMixer(model);
    const byName = {};
    gltf.animations.forEach((c) => { byName[c.name.toLowerCase()] = c; });
    const pick = (...names) => { for (const n of names) if (byName[n]) return byName[n]; return null; };
    const mk = (clip) => (clip ? mixer.clipAction(clip) : null);
    actions.idle = mk(pick('idle'));
    actions.walk = mk(pick('walking', 'walk'));
    actions.run = mk(pick('running', 'run'));
    actions.jump = mk(pick('jump'));
    current = actions.idle;
    if (current) current.play();
  };

  // Sırayla CDN'leri dene; hepsi başarısızsa basit gövdeye düş
  const tryLoad = (i) => {
    if (i >= MODEL_URLS.length) {
      setStatus('model yüklenemedi — basit gövde kullanılıyor (konsola bak)', 'err');
      console.warn('Karakter modeli hiçbir CDN’den yüklenemedi.');
      return;
    }
    setStatus('karakter modeli yükleniyor… (' + (i + 1) + '/' + MODEL_URLS.length + ')');
    loader.load(MODEL_URLS[i], onLoad, undefined, (err) => {
      console.warn('Model yüklenemedi:', MODEL_URLS[i], err);
      tryLoad(i + 1);
    });
  };
  tryLoad(0);
}

// ---- Üçüncü şahıs kamera + giriş --------------------------------------
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 1000);
let camYaw = Math.PI, camPitch = 0.35, camDist = 11;
const camTarget = new THREE.Vector3();

const keys = {};
addEventListener('keydown', (e) => { keys[e.code] = true; });
addEventListener('keyup', (e) => { keys[e.code] = false; });

// GTA tarzı: kamerayı elle çevirme yok; karakteri takip edip otomatik arkasına geçer.
// (Sadece yakınlaştırma manuel.)
addEventListener('wheel', (e) => {
  camDist = THREE.MathUtils.clamp(camDist + e.deltaY * 0.01, 5, 22);
}, { passive: true });

// İki parmakla yakınlaştırma (pinch)
let pinchStart = 0, pinchDist0 = 0;
addEventListener('touchmove', (e) => {
  if (e.touches.length === 2) {
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    const d = Math.hypot(dx, dy);
    if (!pinchStart) { pinchStart = d; pinchDist0 = camDist; }
    camDist = THREE.MathUtils.clamp(pinchDist0 * (pinchStart / d), 5, 22);
  }
}, { passive: true });
addEventListener('touchend', () => { pinchStart = 0; });

// ---- Mobil dokunmatik kontroller (joystick + butonlar) ----------------
const touch = { x: 0, y: 0 };           // joystick yönü, -1..1
let touchRun = false, touchJump = false;
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (isTouch) {
  document.getElementById('touch').classList.add('on');
  document.body.classList.add('touch-device');

  const joy = document.getElementById('joy');
  const knob = document.getElementById('joyKnob');
  let joyId = null;
  const R = 50;                          // joystick yarıçapı (px)
  const setKnob = (dx, dy) => { knob.style.transform = `translate(${dx}px, ${dy}px)`; };
  const onJoy = (e) => {
    const t = [...e.touches].find((tt) => tt.identifier === joyId);
    if (!t) return;
    const r = joy.getBoundingClientRect();
    let dx = t.clientX - (r.left + r.width / 2);
    let dy = t.clientY - (r.top + r.height / 2);
    const len = Math.hypot(dx, dy) || 1;
    if (len > R) { dx = dx / len * R; dy = dy / len * R; }
    setKnob(dx, dy);
    touch.x = dx / R;                    // sağ +
    touch.y = -dy / R;                   // yukarı it → ileri (kameradan uzağa)
  };
  joy.addEventListener('touchstart', (e) => {
    joyId = e.changedTouches[0].identifier; onJoy(e); e.preventDefault();
  }, { passive: false });
  joy.addEventListener('touchmove', (e) => { onJoy(e); e.preventDefault(); }, { passive: false });
  const endJoy = (e) => {
    if ([...e.changedTouches].some((tt) => tt.identifier === joyId)) {
      joyId = null; touch.x = 0; touch.y = 0; setKnob(0, 0);
    }
  };
  joy.addEventListener('touchend', endJoy);
  joy.addEventListener('touchcancel', endJoy);

  const bindHold = (id, set) => {
    const el = document.getElementById(id);
    const on = (e) => { set(true); el.classList.add('active'); e.preventDefault(); };
    const off = (e) => { set(false); el.classList.remove('active'); e.preventDefault(); };
    el.addEventListener('touchstart', on, { passive: false });
    el.addEventListener('touchend', off, { passive: false });
    el.addEventListener('touchcancel', off, { passive: false });
  };
  // KOŞ: aç/kapa (toggle), ZIPLA: bas
  const runEl = document.getElementById('btnRun');
  runEl.addEventListener('touchstart', (e) => {
    touchRun = !touchRun; runEl.classList.toggle('active', touchRun); e.preventDefault();
  }, { passive: false });
  bindHold('btnJump', (v) => { touchJump = v; });
}

// ---- Oyun döngüsü ------------------------------------------------------
const vel = new THREE.Vector3();
let vy = 0, grounded = true, walkPhase = 0, facing = Math.PI;
const clock = new THREE.Clock();

function update(dt) {
  const run = keys['ShiftLeft'] || keys['ShiftRight'] || touchRun;
  const speed = run ? 11 : 6;

  // kameraya göre yön (forward = kameranın baktığı yön = ekranda ileri/uzağa)
  const forward = new THREE.Vector3(-Math.sin(camYaw), 0, -Math.cos(camYaw));
  const right = new THREE.Vector3(-forward.z, 0, forward.x);

  const move = new THREE.Vector3();
  if (keys['KeyW']) move.add(forward);
  if (keys['KeyS']) move.sub(forward);
  if (keys['KeyD']) move.add(right);
  if (keys['KeyA']) move.sub(right);
  // joystick (analog)
  if (touch.x || touch.y) {
    move.addScaledVector(forward, touch.y).addScaledVector(right, touch.x);
  }

  const moving = move.lengthSq() > 0.0004;
  if (moving) {
    move.normalize();
    vel.lerp(move.multiplyScalar(speed), 1 - Math.pow(0.001, dt));
    facing = Math.atan2(vel.x, vel.z);
  } else {
    vel.lerp(new THREE.Vector3(), 1 - Math.pow(0.0001, dt));
  }

  player.position.x += vel.x * dt;
  player.position.z += vel.z * dt;
  // sınır
  const lim = WORLD / 2 - 6;
  player.position.x = THREE.MathUtils.clamp(player.position.x, -lim, lim);
  player.position.z = THREE.MathUtils.clamp(player.position.z, -lim, lim);

  // zıplama + yerçekimi
  const groundY = heightAt(player.position.x, player.position.z);
  if ((keys['Space'] || touchJump) && grounded) { vy = 9; grounded = false; }
  vy -= 26 * dt;
  player.position.y += vy * dt;
  if (player.position.y <= groundY) { player.position.y = groundY; vy = 0; grounded = true; }

  // yönelme (yumuşak)
  let d = facing - player.rotation.y;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  player.rotation.y += d * Math.min(1, dt * 12);

  const speed2d = Math.hypot(vel.x, vel.z);
  if (mixer) {
    // Gerçek model: hıza/duruma göre klip seç
    const want = !grounded ? 'jump' : (speed2d > 7.5 ? 'run' : (speed2d > 0.4 ? 'walk' : 'idle'));
    setAction(want);
    mixer.update(dt);
  } else {
    // Yedek prosedürel yürüyüş animasyonu
    walkPhase += dt * (speed2d * 1.1 + 0.0);
    const sw = Math.sin(walkPhase * 2) * Math.min(1, speed2d / 5);
    parts.legL.rotation.x = sw * 0.8;
    parts.legR.rotation.x = -sw * 0.8;
    parts.armL.rotation.x = -sw * 0.7;
    parts.armR.rotation.x = sw * 0.7;
    const bob = Math.abs(Math.sin(walkPhase * 2)) * Math.min(1, speed2d / 5) * 0.08;
    parts.torso.position.y = 1.25 + bob;
  }

  // GTA tarzı otomatik kamera: hareket edince yumuşakça karakterin arkasına geç
  if (moving && speed2d > 0.5) {
    const targetYaw = facing - Math.PI;           // kamera, gidiş yönünün arkasında
    let dy = targetYaw - camYaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    camYaw += dy * Math.min(1, dt * 2.2);
  }

  // kamera takip
  camTarget.lerp(new THREE.Vector3(player.position.x, player.position.y + 2.2, player.position.z), 1 - Math.pow(0.0008, dt));
  const cx = camTarget.x + Math.sin(camYaw) * Math.cos(camPitch) * camDist;
  const cy = camTarget.y + Math.sin(camPitch) * camDist;
  const cz = camTarget.z + Math.cos(camYaw) * Math.cos(camPitch) * camDist;
  camera.position.lerp(new THREE.Vector3(cx, cy, cz), 1 - Math.pow(0.001, dt));
  camera.lookAt(camTarget);

  // güneşi oyuncuyla taşı (gölge alanı sınırlı)
  sun.target.position.copy(player.position);
  sun.position.set(player.position.x + 60, 90, player.position.z + 40);

  clouds.rotation.y += dt * 0.005;
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  update(dt);
  renderer.render(scene, camera);
}
animate();

addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// loader gizle
requestAnimationFrame(() => {
  const l = document.getElementById('loader');
  setTimeout(() => l.classList.add('hide'), 400);
});
