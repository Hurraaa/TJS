import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { Water } from 'three/addons/objects/Water.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

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
scene.fog = new THREE.Fog('#cfe6e0', 90, 340);

// Gökyüzü (three.js Sky) — günün saati setTimeOfDay() ile ayarlanır
const SUN_DIR = new THREE.Vector3();
let sky;
{
  sky = new Sky();
  sky.scale.setScalar(10000);
  scene.add(sky);
  const u = sky.material.uniforms;
  u.mieCoefficient.value = 0.006;
  u.mieDirectionalG.value = 0.82;
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
const hemi = new THREE.HemisphereLight('#ffe9c8', '#7d9a63', 0.75);
scene.add(hemi);

const sun = new THREE.DirectionalLight('#ffe2b0', 2.3);  // sıcak güneş
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
const colliders = [];                          // {x, z, r} — katı engeller (çarpışma)
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

// Göl (yansımalı su — three.js Water)
const LAKE = { x: -46, z: 40, r: 20 };
let water = null;
{
  const waterNormals = new THREE.TextureLoader().load(
    'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r160/examples/textures/waternormals.jpg',
    (t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; });
  water = new Water(new THREE.CircleGeometry(LAKE.r, 56), {
    textureWidth: 512, textureHeight: 512, waterNormals,
    sunDirection: SUN_DIR.clone().normalize(), sunColor: 0xffffff,
    waterColor: 0x3d6e8c, distortionScale: 2.2, fog: !!scene.fog,
  });
  water.rotation.x = -Math.PI / 2;
  water.position.set(LAKE.x, heightAt(LAKE.x, LAKE.z) + 0.15, LAKE.z);
  scene.add(water);
}

// ---- Günün saati (atmosfer) -------------------------------------------
// t: 0 = gün doğumu · 0.5 = öğle · 1 = gün batımı
const _fogDay = new THREE.Color('#cfe6e0'), _fogWarm = new THREE.Color('#f2c79a');
const _sunDay = new THREE.Color('#fff3da'), _sunWarm = new THREE.Color('#ff8a3d');
const _hemiDay = new THREE.Color('#ffe9c8'), _hemiWarm = new THREE.Color('#ffcf9c');
function setTimeOfDay(t) {
  t = THREE.MathUtils.clamp(t, 0, 1);
  const day = Math.sin(t * Math.PI);          // 0 ufukta, 1 tepede
  const warm = 1 - day;
  const elevation = day * 55 + 3;
  const azimuth = 70 + t * 140;
  SUN_DIR.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - elevation), THREE.MathUtils.degToRad(azimuth));
  const u = sky.material.uniforms;
  u.sunPosition.value.copy(SUN_DIR);
  u.rayleigh.value = 1.1 + warm * 2.2;        // gün batımında daha kızıl
  u.turbidity.value = 4 + warm * 6;
  sun.color.copy(_sunDay).lerp(_sunWarm, warm);
  sun.intensity = 1.5 + day * 1.3;
  hemi.color.copy(_hemiDay).lerp(_hemiWarm, warm);
  hemi.intensity = 0.45 + day * 0.45;
  scene.fog.color.copy(_fogDay).lerp(_fogWarm, warm);
  if (water) water.material.uniforms['sunDirection'].value.copy(SUN_DIR).normalize();
}
setTimeOfDay(0.2);                             // varsayılan: sıcak ikindi
{
  const todEl = document.getElementById('tod');
  if (todEl) {
    todEl.value = '0.2';
    todEl.addEventListener('input', () => setTimeOfDay(parseFloat(todEl.value)));
  }
}

// ---- Dağlar -----------------------------------------------------------
// Şelalenin arkasında, suyun indiği büyük bir dağ kütlesi.
function addMountain(mx, mz, h, baseR, color) {
  const g = new THREE.Group();
  const main = new THREE.Mesh(roughen(new THREE.ConeGeometry(baseR, h, 8), baseR * 0.05), toon(color));
  main.position.y = h / 2; main.castShadow = true; main.receiveShadow = true; addOutline(main, 0.5); g.add(main);
  // yan zirveler
  for (let i = 0; i < 3; i++) {
    const r = baseR * (0.55 - i * 0.12), hh = h * (0.7 - i * 0.15);
    const c = new THREE.Mesh(roughen(new THREE.ConeGeometry(r, hh, 7), r * 0.05), toon(color));
    const a = Math.random() * Math.PI * 2;
    c.position.set(Math.cos(a) * baseR * 0.5, hh / 2, Math.sin(a) * baseR * 0.5);
    c.castShadow = true; addOutline(c, 0.4); g.add(c);
  }
  // kar tepesi
  const snow = new THREE.Mesh(roughen(new THREE.ConeGeometry(baseR * 0.36, h * 0.3, 8), baseR * 0.03), toon('#eef4fb'));
  snow.position.y = h - h * 0.15; addOutline(snow, 0.2); g.add(snow);
  g.position.set(mx, heightAt(mx, mz) - 1, mz);
  scene.add(g);
  colliders.push({ x: mx, z: mz, r: baseR * 0.78 });
  return g;
}
addMountain(-104, 40, 66, 44, '#7c8a86');     // şelale dağı (ana)
addMountain(-120, 92, 52, 36, '#84908b');     // arkada sıradağ
addMountain(-118, -8, 46, 32, '#7a8682');

// ---- Şelale (dağdan göle dökülür) -------------------------------------
const waterfallParts = [];
{
  const baseX = LAKE.x - LAKE.r + 6, baseZ = LAKE.z;
  const lakeY = heightAt(LAKE.x, LAKE.z) + 0.15;
  const fallH = 30;                            // dağ yamacından göle kadar
  const topY = lakeY + fallH;

  // Kaya kanal/uçurum — dağ eteğinden suya
  for (let i = 0; i < 11; i++) {
    const r = 3.4 + Math.random() * 2.2;
    const rock = new THREE.Mesh(roughen(new THREE.DodecahedronGeometry(r, 0), r * 0.2), toon('#7f857f'));
    rock.position.set(baseX - 5 + (Math.random() - 0.5) * 3, lakeY + 1 + i * 2.7, baseZ + (Math.random() - 0.5) * 10);
    rock.rotation.set(Math.random(), Math.random(), Math.random());
    rock.castShadow = true; rock.receiveShadow = true; addOutline(rock, 0.06);
    scene.add(rock);
    if (i < 3) colliders.push({ x: rock.position.x, z: rock.position.z, r: r * 0.7 });
  }

  // Akan su perdesi (animasyonlu shader)
  const fallMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: {
      time: { value: 0 },
      top: { value: new THREE.Color('#e3f4ff') },
      bot: { value: new THREE.Color('#86c6e8') },
    },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      varying vec2 vUv; uniform float time; uniform vec3 top; uniform vec3 bot;
      float hash(float x){ return fract(sin(x * 91.17) * 43758.5453); }
      void main(){
        float lanes = floor(vUv.x * 9.0);
        float speed = 1.3 + hash(lanes) * 0.9;
        float flow = fract(vUv.y * 4.0 - time * speed + hash(lanes) * 5.0);
        float streak = smoothstep(0.0, 0.5, flow) * smoothstep(1.0, 0.5, flow);
        float body = 0.5 + streak * 0.5;
        float edge = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x);
        vec3 col = mix(bot, top, vUv.y);
        col = mix(col, vec3(1.0), smoothstep(0.18, 0.0, vUv.y) * 0.85); // dip köpük
        gl_FragColor = vec4(col, body * edge);
      }`,
  });
  const fall = new THREE.Mesh(new THREE.PlaneGeometry(6.5, fallH), fallMat);
  fall.position.set(baseX, lakeY + fallH / 2, baseZ);
  fall.rotation.y = Math.PI / 2;            // perde göle bakar
  scene.add(fall);
  waterfallParts.push({ type: 'fall', mat: fallMat });

  // Dip köpük — yumuşak, çalkantılı disk (shader)
  const foamMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { time: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      varying vec2 vUv; uniform float time;
      void main(){
        vec2 p = vUv - 0.5;
        float r = length(p) * 2.0;            // 0 merkez .. 1 kenar
        float a = atan(p.y, p.x);
        float churn = 0.5 + 0.5 * sin(a * 7.0 + time * 3.0) * sin(a * 3.0 - time * 2.0);
        float rings = 0.5 + 0.5 * sin(r * 16.0 - time * 5.0);
        float foam = smoothstep(1.0, 0.15, r);            // merkeze doğru yoğun
        foam *= 0.55 + 0.45 * churn;
        foam *= 0.7 + 0.3 * rings;
        float alpha = foam * smoothstep(1.0, 0.6, r);
        gl_FragColor = vec4(vec3(1.0), alpha * 0.9);
      }`,
  });
  const foam = new THREE.Mesh(new THREE.CircleGeometry(6, 44), foamMat);
  foam.rotation.x = -Math.PI / 2;
  foam.position.set(baseX, lakeY + 0.08, baseZ);
  scene.add(foam);
  waterfallParts.push({ type: 'foam', mat: foamMat });

  // Genişleyen dalga halkaları
  const ripples = [];
  for (let i = 0; i < 4; i++) {
    const rg = new THREE.Mesh(
      new THREE.RingGeometry(0.85, 1.15, 36),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false }));
    rg.rotation.x = -Math.PI / 2;
    rg.position.set(baseX, lakeY + 0.07, baseZ);
    scene.add(rg);
    ripples.push({ mesh: rg, phase: i / 4 });
  }
  waterfallParts.push({ type: 'ripples', list: ripples });

  // Buhar (mist) parçacıkları
  const N = 70;
  const pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = baseX + (Math.random() - 0.5) * 4;
    pos[i * 3 + 1] = lakeY + Math.random() * 4;
    pos[i * 3 + 2] = baseZ + (Math.random() - 0.5) * 4;
  }
  const mistGeo = new THREE.BufferGeometry();
  mistGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mist = new THREE.Points(mistGeo, new THREE.PointsMaterial({
    color: 0xffffff, size: 1.7, transparent: true, opacity: 0.3, depthWrite: false, sizeAttenuation: true,
  }));
  scene.add(mist);
  waterfallParts.push({ type: 'mist', geo: mistGeo, base: lakeY });
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
scene.add(scatterGrass(6500));

// ---- Çiçekler (renk için) ---------------------------------------------
function scatterFlowers(color, count) {
  const petal = new THREE.SphereGeometry(0.16, 6, 5);
  petal.scale(1, 0.5, 1); petal.translate(0, 0.7, 0);
  const mesh = new THREE.InstancedMesh(petal, toon(color), count);
  mesh.castShadow = false;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1);
  let n = 0;
  for (let i = 0; i < count; i++) {
    const x = (Math.random() - 0.5) * (WORLD - 40);
    const z = (Math.random() - 0.5) * (WORLD - 40);
    if (Math.abs(x) < 6) continue;
    const sc = 0.7 + Math.random() * 0.7;
    s.setScalar(sc);
    m.compose(new THREE.Vector3(x, heightAt(x, z), z), q, s);
    mesh.setMatrixAt(n++, m);
  }
  mesh.count = n; mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}
['#f7f3e8', '#ffd95e', '#ff8fb1', '#b48cff'].forEach((c) => scene.add(scatterFlowers(c, 110)));

// ---- Kelebekler -------------------------------------------------------
const butterflies = [];
// Kelebek kanat silüeti (ön + arka kanat), gövde seamı x=0'da
const _wingShape = new THREE.Shape();
_wingShape.moveTo(0.0, 0.05);
_wingShape.quadraticCurveTo(0.18, 0.52, 0.52, 0.52);   // ön kanat üst uç
_wingShape.quadraticCurveTo(0.68, 0.34, 0.52, 0.14);   // ön kanat dış kenar
_wingShape.quadraticCurveTo(0.44, 0.02, 0.50, -0.12);  // bel (iki kanat arası)
_wingShape.quadraticCurveTo(0.66, -0.36, 0.34, -0.50); // arka kanat dış
_wingShape.quadraticCurveTo(0.12, -0.52, 0.05, -0.26); // arka kanat iç
_wingShape.quadraticCurveTo(0.0, -0.12, 0.0, 0.05);
const _wingGeo = new THREE.ShapeGeometry(_wingShape, 16);
const _spotGeo = new THREE.CircleGeometry(0.09, 12);
function makeButterfly(color, spotColor) {
  const g = new THREE.Group();
  const mat = new THREE.MeshToonMaterial({ color, gradientMap: ramp, side: THREE.DoubleSide });
  const edgeMat = new THREE.MeshBasicMaterial({ color: INK, side: THREE.DoubleSide });
  const spotMat = new THREE.MeshBasicMaterial({ color: spotColor, side: THREE.DoubleSide });
  const mkWing = (sign) => {
    const w = new THREE.Mesh(_wingGeo, mat);
    w.scale.x = sign;
    const edge = new THREE.Mesh(_wingGeo, edgeMat);    // ince koyu kenar (mürekkep)
    edge.scale.set(1.12, 1.1, 1); edge.position.z = -0.012;
    const spot1 = new THREE.Mesh(_spotGeo, spotMat); spot1.position.set(0.42, 0.34, 0.012);
    const spot2 = new THREE.Mesh(_spotGeo, spotMat); spot2.position.set(0.34, -0.32, 0.012); spot2.scale.setScalar(0.7);
    w.add(edge, spot1, spot2);
    return w;
  };
  const wl = mkWing(1), wr = mkWing(-1);
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.5, 4, 6), toon('#2b2320'));
  body.rotation.x = Math.PI / 2;
  g.add(wl, wr, body);
  g.userData = { wl, wr };
  return g;
}
const bflyColors = [                                   // [kanat, benek]
  ['#ff8fb1', '#7a2f48'], ['#ffd95e', '#9a6b1e'], ['#9ad0ff', '#2f5a7a'],
  ['#f2f2f6', '#3a3f55'], ['#c79bff', '#5a3f7a'], ['#ff9e5e', '#8a4520'],
];
for (let i = 0; i < 16; i++) {
  const cx = (Math.random() - 0.5) * (WORLD - 60);
  const cz = (Math.random() - 0.5) * (WORLD - 60);
  const [wc, spc] = bflyColors[i % bflyColors.length];
  const b = makeButterfly(wc, spc);
  b.scale.setScalar(0.42 + Math.random() * 0.22);
  scene.add(b);
  butterflies.push({
    g: b, cx, cz,
    r: 3 + Math.random() * 7,
    h: 1.6 + Math.random() * 2.6,
    speed: 0.4 + Math.random() * 0.5,
    phase: Math.random() * Math.PI * 2,
    flapSpeed: 12 + Math.random() * 7,
    flapPhase: Math.random() * Math.PI * 2,
  });
}

// ---- Ağaçlar (low-poly, Ghibli) ---------------------------------------
function makeRoundTree() {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(
    roughen(new THREE.CylinderGeometry(0.35, 0.55, 3.2, 6), 0.08), toon('#8a5a3b'));
  trunk.position.y = 1.6; trunk.castShadow = true; addOutline(trunk, 0.05); g.add(trunk);
  const greens = ['#5ea24c', '#6cb85a', '#4f9440'];
  // dağınık yaprak topları → dolgun, elle çizilmiş taç
  const blobs = 4 + (Math.random() * 3 | 0);
  for (let i = 0; i < blobs; i++) {
    const r = 1.4 + Math.random() * 1.1;
    const blob = new THREE.Mesh(
      roughen(new THREE.IcosahedronGeometry(r, 1), r * 0.16), toon(greens[i % 3]));
    blob.position.set((Math.random() - 0.5) * 2.4, 3.4 + Math.random() * 2.2, (Math.random() - 0.5) * 2.4);
    blob.castShadow = true; blob.receiveShadow = true;
    addOutline(blob, 0.07);
    g.add(blob);
  }
  return g;
}
function makePine() {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(
    roughen(new THREE.CylinderGeometry(0.22, 0.4, 1.8, 6), 0.06), toon('#7a5236'));
  trunk.position.y = 0.9; trunk.castShadow = true; addOutline(trunk, 0.045); g.add(trunk);
  const greens = ['#3f7d3a', '#4a8c43', '#356b32'];
  for (let i = 0; i < 4; i++) {
    const r = 2.1 - i * 0.42;
    const cone = new THREE.Mesh(roughen(new THREE.ConeGeometry(r, 1.7, 7), r * 0.12), toon(greens[i % 3]));
    cone.position.y = 1.7 + i * 1.05; cone.castShadow = true; addOutline(cone, 0.06); g.add(cone);
  }
  return g;
}
function makeBush() {
  const g = new THREE.Group();
  const c = ['#5aa34a', '#6cb85a'];
  for (let i = 0; i < 3; i++) {
    const r = 0.6 + Math.random() * 0.5;
    const b = new THREE.Mesh(roughen(new THREE.IcosahedronGeometry(r, 1), r * 0.18), toon(c[i % 2]));
    b.position.set((Math.random() - 0.5) * 1.2, 0.4 + Math.random() * 0.3, (Math.random() - 0.5) * 1.2);
    b.castShadow = true; addOutline(b, 0.05); g.add(b);
  }
  return g;
}
const trees = new THREE.Group();
for (let i = 0; i < 110; i++) {
  const x = (Math.random() - 0.5) * (WORLD - 24);
  const z = (Math.random() - 0.5) * (WORLD - 24);
  if (Math.abs(x) < 7) continue;
  const t = Math.random() < 0.42 ? makePine() : makeRoundTree();
  t.position.set(x, heightAt(x, z), z);
  const ts = 0.7 + Math.random() * 0.8;
  t.scale.setScalar(ts);
  t.rotation.y = Math.random() * Math.PI;
  trees.add(t);
  colliders.push({ x, z, r: 0.9 * ts });       // gövde çarpışması
}
for (let i = 0; i < 40; i++) {                 // çalılar
  const x = (Math.random() - 0.5) * (WORLD - 18);
  const z = (Math.random() - 0.5) * (WORLD - 18);
  if (Math.abs(x) < 5) continue;
  const b = makeBush();
  b.position.set(x, heightAt(x, z), z);
  b.scale.setScalar(0.7 + Math.random() * 0.7);
  trees.add(b);
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
  if (rr > 0.9) colliders.push({ x, z, r: rr * 0.85 });   // sadece büyük kayalar
}

// ---- Evler (Ghibli kasabası) ------------------------------------------
function makeHouse(bodyColor, roofColor, opts = {}) {
  const g = new THREE.Group();
  const W = opts.W || 6, H = opts.H || 4, D = opts.D || 5;

  const body = new THREE.Mesh(roughen(new THREE.BoxGeometry(W, H, D, 2, 2, 2), 0.05), toon(bodyColor));
  body.position.y = H / 2; body.castShadow = true; body.receiveShadow = true; addOutline(body, 0.05); g.add(body);

  // Beşik (gable) çatı: iki eğik düzlem (koni piramit yerine gerçek ev çatısı)
  const overX = 0.6, ridge = 1.9;
  const half = W / 2 + overX;
  const slope = Math.hypot(half, ridge);
  const ang = Math.atan2(ridge, half);
  const roofMat = toon(roofColor);
  for (const s of [-1, 1]) {
    const plane = new THREE.Mesh(roughen(new THREE.BoxGeometry(slope, 0.25, D + 1.2), 0.03), roofMat);
    plane.position.set(s * half / 2, H + ridge / 2, 0);
    plane.rotation.z = -s * ang;
    plane.castShadow = true; plane.receiveShadow = true; addOutline(plane, 0.05); g.add(plane);
  }

  // Baca
  const chimney = new THREE.Mesh(roughen(new THREE.BoxGeometry(0.7, 1.8, 0.7), 0.03), toon('#9a6b58'));
  chimney.position.set(W * 0.28, H + ridge * 0.7, -D * 0.2);
  chimney.castShadow = true; addOutline(chimney, 0.04); g.add(chimney);

  // Kapı
  const door = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.2, 0.18), toon('#6b4a30'));
  door.position.set(0, 1.1, D / 2 + 0.05); addOutline(door, 0.03); g.add(door);

  // Pencereler (çerçeve + cam) — ön yüz ve bir yan
  const winMat = toon('#bfe6f0'), frameMat = toon('#6b4a30');
  const addWindow = (px, py, pz, ry) => {
    const f = new THREE.Group();
    f.add(new THREE.Mesh(new THREE.BoxGeometry(1.15, 1.15, 0.12), frameMat));
    f.add(new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.85, 0.16), winMat));
    f.position.set(px, py, pz); f.rotation.y = ry; g.add(f);
  };
  addWindow(-W * 0.28, H * 0.55, D / 2 + 0.04, 0);
  addWindow(W * 0.28, H * 0.55, D / 2 + 0.04, 0);
  addWindow(W / 2 + 0.04, H * 0.55, 0, Math.PI / 2);
  return g;
}
const housesProc = new THREE.Group();
const houseColors = [['#f0e3c8', '#c0584f'], ['#e8d6b8', '#5a7d8c'], ['#efe1cf', '#7a9b6a'], ['#f3ddc0', '#b06a3c']];
const houseSpots = [
  [14, -22], [22, 8], [-20, -16], [-30, 18], [10, 30],
  [26, -10], [-14, 26], [34, 20], [-34, -6], [18, 44],
];
houseSpots.forEach((spot, i) => {
  const [x, z] = spot;
  const [bc, rc] = houseColors[i % houseColors.length];
  const W = 5 + Math.random() * 2.5, D = 4.5 + Math.random() * 2;
  const h = makeHouse(bc, rc, { W, H: 3.5 + Math.random() * 1.5, D });
  h.position.set(x, heightAt(x, z), z);
  h.rotation.y = Math.random() * Math.PI;
  housesProc.add(h);
  colliders.push({ x, z, r: Math.max(W, D) * 0.55 });
});
scene.add(housesProc);

// ---- CC0 .glb prop desteği --------------------------------------------
// public/models/ içine house.glb / tree.glb koyarsan otomatik kullanılır;
// dosya yoksa yukarıdaki prosedürel sürümler sessizce kalır.
const MODELS_BASE = 'public/models/';
function toonify(obj) {
  obj.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true; o.receiveShadow = true;
    const conv = (m) => new THREE.MeshToonMaterial({
      color: m.color || new THREE.Color(0xffffff), map: m.map || null,
      gradientMap: ramp, transparent: m.transparent, opacity: m.opacity,
    });
    o.material = Array.isArray(o.material) ? o.material.map(conv) : conv(o.material);
  });
  return obj;
}
function sizeToHeight(obj, target) {                 // boyunu hedefe sabitle, tabanı 0'a hizala
  obj.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(obj);
  obj.scale.multiplyScalar(target / ((box.max.y - box.min.y) || 1));
  obj.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(obj);
  obj.position.y -= box.min.y;
  return obj;
}
const propLoader = new GLTFLoader();
const tryProp = (file) => new Promise((res, rej) =>
  propLoader.load(MODELS_BASE + file, (g) => res(g.scene), undefined, rej));

tryProp('house.glb').then((proto) => {
  toonify(proto);
  housesProc.visible = false;
  houseSpots.forEach(([x, z]) => {
    const h = proto.clone();
    sizeToHeight(h, 5.5);
    h.position.x = x; h.position.z = z; h.position.y += heightAt(x, z);
    h.rotation.y = Math.random() * Math.PI;
    scene.add(h);
  });
  console.log('house.glb yüklendi → prosedürel evler değiştirildi');
}).catch(() => { /* dosya yok: prosedürel kalsın */ });

tryProp('tree.glb').then((proto) => {
  toonify(proto);
  trees.visible = false;
  const g2 = new THREE.Group();
  for (let i = 0; i < 90; i++) {
    const x = (Math.random() - 0.5) * (WORLD - 24);
    const z = (Math.random() - 0.5) * (WORLD - 24);
    if (Math.abs(x) < 7) continue;
    const t = proto.clone();
    sizeToHeight(t, 5 + Math.random() * 3);
    t.position.x = x; t.position.z = z; t.position.y += heightAt(x, z);
    t.rotation.y = Math.random() * Math.PI;
    g2.add(t);
  }
  scene.add(g2);
  console.log('tree.glb yüklendi → prosedürel ağaçlar değiştirildi');
}).catch(() => { /* dosya yok */ });

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
let emoting = null;            // sürekli emote (dans), boştayken oynar
let oneShotActive = false;     // tek seferlik emote (el salla) oynuyor mu
function setAction(name) {
  const next = actions[name] || actions.idle || current;
  if (!next || next === current) return;
  if (current) current.fadeOut(0.2);
  next.reset().fadeIn(0.2).play();
  current = next;
}
// Boştayken eğlence: 'dance' (aç/kapa) veya 'wave' (tek sefer el salla)
function emote(name) {
  if (!actions[name]) return;
  if (name === 'dance') {
    emoting = (emoting === 'dance') ? null : 'dance';   // aç/kapa
    oneShotActive = false;
    return;
  }
  // wave — tek seferlik
  emoting = null; oneShotActive = true;
  const a = actions[name];
  if (current && current !== a) current.fadeOut(0.15);
  a.reset(); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true;
  a.fadeIn(0.15).play();
  current = a;
}
const statusEl = document.getElementById('status');
const setStatus = (msg, cls = '') => { if (statusEl) { statusEl.textContent = 'v19 · ' + msg; statusEl.className = cls; } };
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

    // Boyutlandır: gerçek boyu ölç (matrisler güncel), hedef ~2.4 birim, ayaklar yerde.
    // Kök ölçeği EZME — çarp (model kendi iç ölçeğini koruyabilir).
    model.position.set(0, 0, 0);
    model.updateMatrixWorld(true);
    let box = new THREE.Box3().setFromObject(model);
    const h = (box.max.y - box.min.y) || 1;
    model.scale.multiplyScalar(2.4 / h);
    model.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(model);
    model.position.y += player.position.y - box.min.y;   // ayakları zemine oturt
    setStatus('karakter yüklendi ✓ (boy ' + (box.max.y - box.min.y).toFixed(1) + 'm)', 'ok');

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
    actions.dance = mk(pick('dance'));
    actions.wave = mk(pick('wave'));
    actions.yes = mk(pick('yes'));
    actions.no = mk(pick('no'));
    actions.thumbsup = mk(pick('thumbsup', 'thumbs up'));
    current = actions.idle;
    if (current) current.play();

    // Tek seferlik emote'lar bitince boşa dön
    const oneShots = [actions.wave, actions.yes, actions.no, actions.thumbsup];
    mixer.addEventListener('finished', (e) => {
      if (oneShots.includes(e.action)) oneShotActive = false;
    });
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
addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.repeat) return;
  if (e.code === 'KeyF') emote('dance');
  if (e.code === 'KeyV') emote('wave');
  if (e.code === 'KeyY') emote('yes');
  if (e.code === 'KeyN') emote('no');
  if (e.code === 'KeyT') emote('thumbsup');
});
addEventListener('keyup', (e) => { keys[e.code] = false; });

// GTA tarzı: yatay (yön) kamera otomatik takip eder; sadece DİKEY bakış manuel.
// Ekranı sürükle → yukarı/aşağı bak. (Yön otomatik kaldığı için sürükleme sağ/sol etkilemez.)
let dragId = null, dragLastY = 0;
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (dragId !== null) return;
  dragId = e.pointerId; dragLastY = e.clientY;
});
addEventListener('pointerup', (e) => { if (e.pointerId === dragId) dragId = null; });
addEventListener('pointercancel', (e) => { if (e.pointerId === dragId) dragId = null; });
addEventListener('pointermove', (e) => {
  if (e.pointerId !== dragId) return;
  // yukarı sürükle (clientY azalır) → yukarı bak (camPitch azalır → kamera alçalır, yukarısı görünür)
  camPitch = THREE.MathUtils.clamp(camPitch + (e.clientY - dragLastY) * 0.004, -0.25, 1.1);
  dragLastY = e.clientY;
});

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

  // Emote butonları (tek dokunuş)
  const tap = (id, fn) => {
    const el = document.getElementById(id);
    el.addEventListener('touchstart', (e) => { fn(); e.preventDefault(); }, { passive: false });
  };
  tap('btnDance', () => {
    emote('dance');
    document.getElementById('btnDance').classList.toggle('active', emoting === 'dance');
  });
  tap('btnWave', () => emote('wave'));
  tap('btnYes', () => emote('yes'));
  tap('btnNo', () => emote('no'));
  tap('btnThumb', () => emote('thumbsup'));

  // Emote panelini aç/kapa
  const ewrap = document.getElementById('emoteWrap');
  tap('emoteToggle', () => ewrap.classList.toggle('open'));
}

// ---- Oyun döngüsü ------------------------------------------------------
const vel = new THREE.Vector3();
let vy = 0, grounded = true, walkPhase = 0, facing = Math.PI;
let elapsed = 0;
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

  // Çarpışma: katı engellerin içinden geçme (daire-daire itme)
  const PR = 0.6;                               // oyuncu yarıçapı
  for (let iter = 0; iter < 2; iter++) {
    for (let c = 0; c < colliders.length; c++) {
      const o = colliders[c];
      const dx = player.position.x - o.x, dz = player.position.z - o.z;
      const min = o.r + PR;
      const d2 = dx * dx + dz * dz;
      if (d2 < min * min && d2 > 1e-6) {
        const d = Math.sqrt(d2), push = min - d;
        player.position.x += (dx / d) * push;
        player.position.z += (dz / d) * push;
      }
    }
  }

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
    if (want !== 'idle') { emoting = null; oneShotActive = false; }  // hareket emote'u iptal eder
    if (oneShotActive) {
      // el salla bitene kadar bekle (finished olayı kapatır)
    } else if (emoting) {
      setAction(emoting);
    } else {
      setAction(want);
    }
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

  // Güneşi gökyüzüyle aynı yönden tut (gölge yönü = gökyüzü güneşi)
  sun.target.position.copy(player.position);
  sun.position.copy(player.position).addScaledVector(SUN_DIR, 120);

  // Su dalgaları
  if (water) water.material.uniforms['time'].value += dt;

  // Şelale
  for (const wf of waterfallParts) {
    if (wf.type === 'fall') {
      wf.mat.uniforms.time.value += dt;
    } else if (wf.type === 'foam') {
      wf.mat.uniforms.time.value += dt;
    } else if (wf.type === 'ripples') {
      for (const rp of wf.list) {
        const t = (elapsed * 0.55 + rp.phase) % 1;
        const s = 1 + t * 5.5;
        rp.mesh.scale.set(s, s, s);
        rp.mesh.material.opacity = (1 - t) * 0.5;
      }
    } else if (wf.type === 'mist') {
      const p = wf.geo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        let y = p.getY(i) + dt * 1.4;
        if (y > wf.base + 5) y = wf.base;
        p.setY(i, y);
      }
      p.needsUpdate = true;
    }
  }

  // Rüzgârda hafif salınım (ağaçlar + çalılar)
  elapsed += dt;
  for (let i = 0; i < trees.children.length; i++) {
    const t = trees.children[i];
    t.rotation.z = Math.sin(elapsed * 1.1 + i * 0.7) * 0.025;
  }

  // Kelebekler — yumuşak gezinme + kanat çırpma
  for (const b of butterflies) {
    const t = elapsed * b.speed + b.phase;
    const x = b.cx + Math.cos(t) * b.r;
    const z = b.cz + Math.sin(t * 0.8) * b.r;
    const y = heightAt(x, z) + b.h + Math.sin(elapsed * 2.4 + b.phase) * 0.4;
    b.g.position.set(x, y, z);
    const dx = -Math.sin(t) * b.r, dz = Math.cos(t * 0.8) * 0.8 * b.r;
    b.g.rotation.y = Math.atan2(dx, dz);
    const flap = 0.15 + (Math.sin(elapsed * b.flapSpeed + b.flapPhase) * 0.5 + 0.5) * 1.15;
    b.g.userData.wl.rotation.y = flap;
    b.g.userData.wr.rotation.y = -flap;
  }

  clouds.rotation.y += dt * 0.005;
}

// ---- Post-processing: hafif bloom (güneş/su parıltısı) ----------------
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight), 0.28, 0.6, 0.85); // güç, yarıçap, eşik
composer.addPass(bloom);
composer.addPass(new OutputPass());

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  update(dt);
  composer.render();
}
animate();

addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

// loader gizle
requestAnimationFrame(() => {
  const l = document.getElementById('loader');
  setTimeout(() => l.classList.add('hide'), 400);
});
