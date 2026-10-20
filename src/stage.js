// ステージ「サクラ浮島」（空にうかぶ合格祈願の神社）
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toon, addOutline, canvasTex, glowTex } from './gfx.js';
import { World } from './physics.js';
import { mulberry32, TAU } from './util.js';
import { MOVE, TEAM } from './config.js';

const C = {
  grass: 0x86d35e,
  grassDark: 0x5fae45,
  rock: 0x9a8676,
  rockDark: 0x76675a,
  stone: 0xd8d0c2,
  stoneDark: 0xb3aa9a,
  red: 0xe8462e,
  black: 0x2b2b2e,
  white: 0xf7f1e6,
  roof: 0x4f6275,
  wood: 0x8b5a2b,
  pink: 0xffb6cf,
  pink2: 0xff96bd,
  gold: 0xffc93c,
};

// 同じ色の部品はまとめて1つにする（描く回数を減らす）
class Batch {
  constructor() {
    this.map = new Map();
  }
  add(geo, matKey, matrix) {
    const g = geo.clone();
    if (matrix) g.applyMatrix4(matrix);
    // 合体できるようにそろえる
    if (g.index) {
      const ng = g.toNonIndexed();
      g.dispose();
      // 岩と木の葉はカクカクした面に
      if (matKey === 'rock' || matKey === 'rockDark' || matKey === 'pink' || matKey === 'pink2' || matKey === 'grassDark') ng.computeVertexNormals();
      for (const k of Object.keys(ng.attributes)) if (!['position', 'normal', 'uv'].includes(k)) ng.deleteAttribute(k);
      push(this.map, matKey, ng);
    } else {
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
      push(this.map, matKey, g);
    }
  }
  build(group, mats, outlineKeys) {
    for (const [key, list] of this.map) {
      const merged = mergeGeometries(list, false);
      list.forEach((g) => g.dispose());
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mats[key]);
      mesh.matrixAutoUpdate = false;
      if (outlineKeys && outlineKeys.includes(key)) addOutline(mesh, 0x2a2430, 0.06);
      group.add(mesh);
    }
  }
}
function push(map, k, g) {
  if (!map.has(k)) map.set(k, []);
  map.get(k).push(g);
}

const M4 = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const E = new THREE.Euler();
const S = new THREE.Vector3();
const P = new THREE.Vector3();
function mat(x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  E.set(rx, ry, rz);
  Q.setFromEuler(E);
  S.set(sx, sy, sz);
  P.set(x, y, z);
  return M4.compose(P, Q, S);
}

export function buildStage(scene, opts = {}) {
  const group = new THREE.Group();
  group.name = 'stage';
  const world = new World();
  const b = { x: 100, zMin: -128, zMax: 128, yMin: MOVE.arena.yMin, yMax: 92 };
  world.bounds = b;
  world.floorY = 0;
  const batch = new Batch();
  const rnd = mulberry32(20261021);

  const mats = {
    grass: toon(C.grass),
    grassDark: toon(C.grassDark),
    rock: toon(C.rock),
    rockDark: toon(C.rockDark),
    stone: toon(C.stone),
    stoneDark: toon(C.stoneDark),
    red: toon(C.red),
    black: toon(C.black),
    white: toon(C.white),
    roof: toon(C.roof),
    wood: toon(C.wood),
    pink: toon(C.pink),
    pink2: toon(C.pink2),
    gold: toon(C.gold),
  };

  // ---- 島 ----
  const islands = [];
  function island(x, top, z, R, o = {}) {
    const depth = o.depth || R * 1.15;
    const seg = R > 14 ? 28 : 18;
    // 土台の岩（とがった逆さの山）
    const cone = new THREE.ConeGeometry(R * 0.96, depth, seg, 4);
    const p = cone.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i);
      const h = (vy + depth / 2) / depth; // 0=先 1=上
      const n = 1 + (rnd() - 0.5) * 0.28 * (1 - h * 0.6);
      p.setXYZ(i, vx * n, vy + (rnd() - 0.5) * depth * 0.06 * (h < 0.98 ? 1 : 0), vz * n);
    }
    cone.computeVertexNormals();
    batch.add(cone, rnd() < 0.5 ? 'rock' : 'rockDark', mat(x, top - 2.2 - depth / 2, z, Math.PI, rnd() * TAU, 0));
    // 上の土と草
    batch.add(new THREE.CylinderGeometry(R, R * 0.97, 2.2, seg), 'rockDark', mat(x, top - 1.3, z));
    batch.add(new THREE.CylinderGeometry(R * 1.035, R * 1.0, 0.75, seg), 'grass', mat(x, top - 0.2, z));
    // 当たり
    world.add({ t: 'cyl', x, z, r: R * 1.0, y0: top - 2.4, y1: top + 0.1, kind: 'island' });
    world.add({ t: 'cyl', x, z, r: R * 0.7, y0: top - 2.4 - depth * 0.45, y1: top - 2.4, kind: 'rock' });
    world.add({ t: 'cyl', x, z, r: R * 0.36, y0: top - 2.4 - depth * 0.85, y1: top - 2.4 - depth * 0.45, kind: 'rock' });
    // 草むら
    const tufts = Math.floor(R * 0.6);
    for (let i = 0; i < tufts; i++) {
      const a = rnd() * TAU, rr = Math.sqrt(rnd()) * R * 0.85;
      batch.add(new THREE.IcosahedronGeometry(0.7 + rnd() * 0.6, 0), 'grassDark', mat(x + Math.cos(a) * rr, top + 0.2, z + Math.sin(a) * rr, 0, rnd() * 3, 0, 1, 0.55, 1));
    }
    islands.push({ x, top, z, R });
    return { x, top, z, R };
  }

  // ---- 鳥居 ----
  function torii(x, y, z, ry, s = 1) {
    const h = 9 * s, w = 9 * s, pr = 0.55 * s;
    const c = Math.cos(ry), sn = Math.sin(ry);
    for (const side of [-1, 1]) {
      const px = x + side * (w / 2) * c, pz = z - side * (w / 2) * sn;
      batch.add(new THREE.CylinderGeometry(pr, pr * 1.12, h, 12), 'red', mat(px, y + h / 2, pz));
      batch.add(new THREE.CylinderGeometry(pr * 1.35, pr * 1.35, 0.9 * s, 12), 'black', mat(px, y + 0.45 * s, pz));
      world.add({ t: 'cyl', x: px, z: pz, r: pr + 0.05, y0: y, y1: y + h, kind: 'torii' });
    }
    // 笠木（いちばん上）と貫
    batch.add(new THREE.BoxGeometry(w + 4 * s, 0.9 * s, 1.5 * s), 'black', mat(x, y + h + 0.75 * s, z, 0, ry, 0));
    batch.add(new THREE.BoxGeometry(w + 3 * s, 0.8 * s, 1.2 * s), 'red', mat(x, y + h - 0.1 * s, z, 0, ry, 0));
    batch.add(new THREE.BoxGeometry(w + 1.2 * s, 0.6 * s, 0.7 * s), 'red', mat(x, y + h * 0.72, z, 0, ry, 0));
    batch.add(new THREE.BoxGeometry(1.2 * s, 1.6 * s, 0.4 * s), 'black', mat(x, y + h * 0.86, z, 0, ry, 0));
    world.add({ t: 'box', x, y: y + h + 0.5 * s, z, hx: (w + 4 * s) / 2, hy: 0.9 * s, hz: 0.75 * s, ry, kind: 'torii' });
    world.add({ t: 'box', x, y: y + h * 0.72, z, hx: (w + 1.2 * s) / 2, hy: 0.3 * s, hz: 0.35 * s, ry, kind: 'torii' });
  }

  // ---- サクラの木 ----
  function sakuraTree(x, y, z, s = 1) {
    const h = 5.5 * s;
    batch.add(new THREE.CylinderGeometry(0.35 * s, 0.6 * s, h, 8), 'wood', mat(x, y + h / 2, z, (rnd() - 0.5) * 0.15, 0, (rnd() - 0.5) * 0.15));
    world.add({ t: 'cyl', x, z, r: 0.55 * s, y0: y, y1: y + h, kind: 'tree' });
    const blobs = 5;
    for (let i = 0; i < blobs; i++) {
      const a = (i / blobs) * TAU + rnd();
      const rr = i === 0 ? 0 : 1.7 * s;
      const r = (i === 0 ? 2.6 : 1.9 + rnd() * 0.6) * s;
      batch.add(new THREE.IcosahedronGeometry(r, 1), i % 2 ? 'pink' : 'pink2', mat(x + Math.cos(a) * rr, y + h + 0.6 * s + (i === 0 ? 0.8 * s : rnd() * s), z + Math.sin(a) * rr, rnd(), rnd(), 0));
    }
    world.add({ t: 'sph', x, y: y + h + 1.2 * s, z, r: 2.4 * s, kind: 'tree' });
  }

  // ---- 灯籠 ----
  function lantern(x, y, z) {
    batch.add(new THREE.CylinderGeometry(0.5, 0.7, 0.5, 8), 'stoneDark', mat(x, y + 0.25, z));
    batch.add(new THREE.CylinderGeometry(0.22, 0.22, 1.6, 8), 'stone', mat(x, y + 1.3, z));
    batch.add(new THREE.BoxGeometry(1.0, 0.9, 1.0), 'stone', mat(x, y + 2.5, z));
    batch.add(new THREE.ConeGeometry(0.95, 0.8, 4), 'stoneDark', mat(x, y + 3.35, z, 0, Math.PI / 4, 0));
    world.add({ t: 'cyl', x, z, r: 0.6, y0: y, y1: y + 3.5, kind: 'deco' });
  }

  // ---- 本殿（まん中の建物）----
  function shrine(x, y, z, ry) {
    // 石の基壇
    batch.add(new THREE.BoxGeometry(22, 2, 16), 'stone', mat(x, y + 1, z, 0, ry, 0));
    world.add({ t: 'box', x, y: y + 1, z, hx: 11, hy: 1, hz: 8, ry, kind: 'shrine' });
    // 柱と壁
    const c = Math.cos(ry), s = Math.sin(ry);
    const loc = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
    batch.add(new THREE.BoxGeometry(16, 7, 10), 'white', mat(x, y + 5.5, z, 0, ry, 0));
    for (const lx of [-8, -2.7, 2.7, 8])
      for (const lz of [-5, 5]) {
        const [px, pz] = loc(lx, lz);
        batch.add(new THREE.CylinderGeometry(0.55, 0.55, 7, 10), 'red', mat(px, y + 5.5, pz));
      }
    batch.add(new THREE.BoxGeometry(17, 0.8, 11), 'red', mat(x, y + 9.2, z, 0, ry, 0));
    // 屋根（2枚のななめ板＋棟）
    for (const side of [-1, 1]) {
      const [px, pz] = loc(0, side * 3.4);
      batch.add(new THREE.BoxGeometry(22, 0.9, 9.5), 'roof', mat(px, y + 11.3, pz, side * 0.5, ry, 0));
    }
    batch.add(new THREE.BoxGeometry(22.5, 1.0, 1.2), 'black', mat(x, y + 13.3, z, 0, ry, 0));
    // 金の飾り
    const [gx, gz] = loc(0, 5.6);
    batch.add(new THREE.SphereGeometry(0.9, 12, 8), 'gold', mat(gx, y + 8.0, gz));
    world.add({ t: 'box', x, y: y + 6, z, hx: 8.4, hy: 4.2, hz: 5.4, ry, kind: 'shrine' });
    world.add({ t: 'box', x, y: y + 11.6, z, hx: 11, hy: 2.1, hz: 6.5, ry, kind: 'shrine' });
    // さいせん箱
    const [sx2, sz2] = loc(0, 7);
    batch.add(new THREE.BoxGeometry(3, 1.4, 1.6), 'wood', mat(sx2, y + 2.7, sz2, 0, ry, 0));
  }

  // ---- 石の柱（雲海から生えている）----
  function pillar(x, z, h, r) {
    batch.add(new THREE.CylinderGeometry(r, r * 1.15, h, 10), 'stone', mat(x, h / 2, z));
    for (let y = 8; y < h; y += 9) batch.add(new THREE.CylinderGeometry(r * 1.12, r * 1.12, 0.8, 10), 'stoneDark', mat(x, y, z));
    batch.add(new THREE.CylinderGeometry(r * 1.4, r * 1.2, 1.4, 10), 'stoneDark', mat(x, h + 0.7, z));
    world.add({ t: 'cyl', x, z, r: r * 1.1, y0: 0, y1: h + 1.4, kind: 'pillar' });
  }

  // ===== 配置（z の正負で左右対称）=====
  const BASE_Z = 96;
  // まん中の島と本殿
  island(0, 22, 0, 24, { depth: 26 });
  shrine(0, 22, 0, 0);
  torii(0, 22, 17, 0, 1.1);
  torii(0, 22, -17, Math.PI, 1.1);
  for (const [lx, lz] of [[-14, 12], [14, 12], [-14, -12], [14, -12]]) lantern(lx, 22, lz);
  sakuraTree(-17, 22, 2, 1.1);
  sakuraTree(17, 22, -2, 1.1);

  for (const sgn of [-1, 1]) {
    // 中くらいの島
    island(48 * sgn, 34, -36 * sgn, 12);
    island(-48 * sgn, 34, -36 * sgn, 12);
    sakuraTree(48 * sgn + 3, 34, -36 * sgn - 2, 0.9);
    lantern(-48 * sgn - 4, 34, -36 * sgn + 3);
    island(0, 47, -58 * sgn, 9);
    torii(0, 47, -58 * sgn, 0, 0.8);
    island(76 * sgn, 17, 12 * sgn, 11);
    sakuraTree(76 * sgn, 17, 12 * sgn, 1.0);
    island(30 * sgn, 12, -78 * sgn, 9);
    island(-34 * sgn, 58, 18 * sgn, 7);
    // 浮いている鳥居（くぐれる）
    torii(-60 * sgn, 40, 10 * sgn, Math.PI / 2, 1.0);
    // 柱
    pillar(88 * sgn, -70 * sgn, 52, 3.2);
    pillar(-22 * sgn, -44 * sgn, 30, 2.4);
    pillar(64 * sgn, 70 * sgn, 40, 2.8);
    // 陣地の島（ダルマが乗る）
    island(0, 26, -BASE_Z * sgn, 19, { depth: 24 });
    torii(0, 26, -(BASE_Z - 15) * sgn, sgn > 0 ? 0 : Math.PI, 1.2);
    lantern(-9, 26, -(BASE_Z - 10) * sgn);
    lantern(9, 26, -(BASE_Z - 10) * sgn);
    sakuraTree(-12, 26, -(BASE_Z + 8) * sgn, 1.0);
    sakuraTree(12, 26, -(BASE_Z + 8) * sgn, 1.0);
  }

  batch.build(group, mats, ['red', 'black', 'white', 'roof', 'stone', 'gold']);

  // ===== 空・雲海 =====
  const sky = makeSky();
  group.add(sky);
  const sea = makeCloudSea();
  group.add(sea);
  const far = makeFarClouds(rnd);
  group.add(far);
  // 場外の目印（うっすら光る壁）は近づいたときだけ見せる
  const fence = makeFence(b);
  group.add(fence);

  scene.add(group);

  // ===== 遊びに使う場所 =====
  const bases = [0, 1].map((team) => {
    const sgn = team === 0 ? -1 : 1; // 青は z が負
    const z = BASE_Z * sgn;
    const respawn = [];
    for (let i = 0; i < 4; i++) {
      const a = (i - 1.5) * 0.55;
      respawn.push(new THREE.Vector3(Math.sin(a) * 9, 31, z - sgn * 4 - Math.cos(a) * 6 * -sgn));
    }
    return {
      team,
      daruma: new THREE.Vector3(0, 33.5, z + sgn * 6),
      respawn,
      goal: new THREE.Vector3(0, 46, z + sgn * 2), // ラピッドボールのリング
      flagGoal: new THREE.Vector3(0, 30, z - sgn * 6),
      faceYaw: team === 0 ? 0 : Math.PI, // 正面（まん中のほう）
    };
  });

  // サクラ50個（片側25個を作って反転）
  const half = [];
  // まん中の島の上をぐるっと
  for (let i = 0; i < 6; i++) {
    const a = Math.PI + (i / 6) * Math.PI + 0.26;
    half.push([Math.cos(a) * 20, 27 + (i % 2) * 2, Math.sin(a) * 20 - 2]);
  }
  half.push([0, 8, -10], [-12, 10, -20], [12, 10, -20]); // 島の下
  half.push([48, 38, -36], [-48, 38, -36], [52, 37.5, -40], [-44, 37.5, -32]); // 中くらいの島
  half.push([0, 51, -58], [0, 56, -48]); // 高い島
  half.push([76, 21, -12], [-76, 21, -12]); // 横の島（反転すると逆側）
  half.push([30, 16, -78], [-30, 18, -70]); // 低い島
  half.push([-22, 34, -44], [22, 20, -44]); // 柱のまわり
  half.push([-60, 44, -10], [60, 44, -14]); // 鳥居の近く
  half.push([-34, 62, -18]); // いちばん上
  const sakuraPoints = [];
  for (const [x, y, z] of half) sakuraPoints.push(new THREE.Vector3(x, y, z));
  for (const [x, y, z] of half) sakuraPoints.push(new THREE.Vector3(-x, y, -z));

  // 旗の出る場所（自分の旗は相手の陣地の手前に出る）
  const flagSpawns = [0, 1].map((team) => {
    const sgn = team === 0 ? 1 : -1; // 青の旗は赤側に出る
    return [new THREE.Vector3(-30, 32, 66 * sgn), new THREE.Vector3(30, 32, 66 * sgn), new THREE.Vector3(0, 42, 74 * sgn)];
  });
  // ボールの出る場所
  const ballSpawns = [];
  for (const [x, y, z] of [[0, 30, 0], [-26, 30, -8], [26, 30, 8], [-48, 40, -30], [48, 40, 30], [48, 40, -30], [-48, 40, 30], [0, 52, -40], [0, 52, 40], [-70, 24, 0], [70, 24, 0], [0, 14, 0]]) {
    ballSpawns.push(new THREE.Vector3(x, y, z));
  }

  return {
    group,
    world,
    bases,
    sakuraPoints,
    flagSpawns,
    ballSpawns,
    islands,
    bounds: b,
    update(dt, t, camPos) {
      sea.material.uniforms.uTime.value = t;
      far.rotation.y = t * 0.004;
      sky.position.copy(camPos);
      fence.update(camPos, t);
    },
    dispose() {
      scene.remove(group);
      group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
      });
    },
  };
}

function makeSky() {
  const geo = new THREE.SphereGeometry(900, 32, 16);
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(0x2f86e8) },
      mid: { value: new THREE.Color(0x8fcaff) },
      bot: { value: new THREE.Color(0xe9f6ff) },
      sun: { value: new THREE.Vector3(0.45, 0.55, -0.7).normalize() },
    },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }',
    fragmentShader:
      'uniform vec3 top; uniform vec3 mid; uniform vec3 bot; uniform vec3 sun; varying vec3 vDir;\n' +
      'void main(){ float h = vDir.y; vec3 c = h > 0.0 ? mix(mid, top, smoothstep(0.0, 0.55, h)) : mix(mid, bot, smoothstep(0.0, -0.25, h));\n' +
      ' float s = max(dot(normalize(vDir), sun), 0.0); c += vec3(1.0,0.95,0.8) * (pow(s, 64.0) * 0.9 + pow(s, 8.0) * 0.18);\n' +
      ' gl_FragColor = vec4(c, 1.0); }',
  });
  const mesh = new THREE.Mesh(geo, m);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return mesh;
}

function makeCloudSea() {
  const geo = new THREE.PlaneGeometry(1800, 1800, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.ShaderMaterial({
    transparent: false,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 } }]),
    vertexShader:
      '#include <fog_pars_vertex>\nvarying vec2 vP; void main(){ vP = position.xz; vec4 mvPosition = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mvPosition;\n#include <fog_vertex>\n}',
    fragmentShader:
      '#include <fog_pars_fragment>\nuniform float uTime; varying vec2 vP;\n' +
      'float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }\n' +
      'float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }\n' +
      'void main(){ vec2 p = vP*0.02 + vec2(uTime*0.01, uTime*0.004); float v = n(p)*0.5 + n(p*2.1)*0.3 + n(p*4.3)*0.2;\n' +
      ' vec3 c = mix(vec3(0.80,0.88,0.97), vec3(1.0), smoothstep(0.35, 0.75, v)); gl_FragColor = vec4(c,1.0);\n#include <fog_fragment>\n}',
  });
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.y = -0.2;
  return mesh;
}

let _cloudTex = null;
function cloudTex() {
  if (_cloudTex) return _cloudTex;
  _cloudTex = canvasTex(256, 128, (ctx, w, h) => {
    const r = mulberry32(7);
    for (let i = 0; i < 22; i++) {
      const x = w * (0.18 + r() * 0.64), y = h * (0.45 + r() * 0.25), rad = 18 + r() * 34;
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, 'rgba(255,255,255,0.95)');
      g.addColorStop(0.6, 'rgba(255,255,255,0.75)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, TAU);
      ctx.fill();
    }
  });
  _cloudTex.userData.shared = true;
  return _cloudTex;
}

function makeFarClouds(rnd) {
  const g = new THREE.Group();
  const m = new THREE.SpriteMaterial({ map: cloudTex(), transparent: true, depthWrite: false, fog: false });
  for (let i = 0; i < 26; i++) {
    const a = rnd() * TAU, r = 320 + rnd() * 260;
    const s = new THREE.Sprite(m);
    s.position.set(Math.cos(a) * r, -10 + rnd() * 90, Math.sin(a) * r);
    const k = 90 + rnd() * 120;
    s.scale.set(k, k * 0.5, 1);
    g.add(s);
  }
  // 足もとの雲
  const m2 = new THREE.SpriteMaterial({ map: cloudTex(), transparent: true, depthWrite: false, opacity: 0.9 });
  for (let i = 0; i < 30; i++) {
    const s = new THREE.Sprite(m2);
    s.position.set((rnd() - 0.5) * 300, 2 + rnd() * 6, (rnd() - 0.5) * 340);
    const k = 30 + rnd() * 40;
    s.scale.set(k, k * 0.45, 1);
    g.add(s);
  }
  return g;
}

function makeFence(b) {
  const g = new THREE.Group();
  const m = new THREE.MeshBasicMaterial({ color: 0x9fe3ff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  const walls = [];
  const H = b.yMax;
  const mk = (w, x, z, ry) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, H), m.clone());
    mesh.position.set(x, H / 2, z);
    mesh.rotation.y = ry;
    g.add(mesh);
    walls.push(mesh);
  };
  mk(b.zMax - b.zMin, -b.x, 0, Math.PI / 2);
  mk(b.zMax - b.zMin, b.x, 0, -Math.PI / 2);
  mk(b.x * 2, 0, b.zMin, 0);
  mk(b.x * 2, 0, b.zMax, Math.PI);
  g.update = (cam, t) => {
    const d = [cam.x + b.x, b.x - cam.x, cam.z - b.zMin, b.zMax - cam.z];
    walls.forEach((w, i) => {
      w.material.opacity = Math.max(0, 0.35 - d[i] / 40) * (0.75 + 0.25 * Math.sin(t * 4));
      w.visible = w.material.opacity > 0.01;
    });
  };
  return g;
}

// ダルマ（チームのガーディアン）
export function buildDaruma(team) {
  const T = TEAM[team];
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(3.4, 32, 24), toon(T.hex));
  body.scale.set(1, 1.08, 0.95);
  addOutline(body, T.dark, 0.08);
  g.add(body);
  // 顔の白いところ
  const faceTex = canvasTex(512, 512, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
  });
  const face = new THREE.Mesh(new THREE.SphereGeometry(2.25, 28, 20, Math.PI * 0.18, Math.PI * 0.64, Math.PI * 0.18, Math.PI * 0.42), toon(0xfff6e8));
  face.position.set(0, 0.55, 0.85);
  face.rotation.y = -Math.PI / 2;
  g.add(face);
  // 目（左は最初から、右は勝ったら入る）
  const eyes = [];
  for (const sx of [-1, 1]) {
    const eyeWhite = new THREE.Mesh(new THREE.CircleGeometry(0.62, 20), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    eyeWhite.position.set(sx * 0.85, 1.0, 3.06);
    eyeWhite.rotation.y = sx * 0.2;
    g.add(eyeWhite);
    const pupil = new THREE.Mesh(new THREE.CircleGeometry(0.42, 20), new THREE.MeshBasicMaterial({ color: 0x111111 }));
    pupil.position.set(sx * 0.85, 1.0, 3.09);
    pupil.rotation.y = sx * 0.2;
    pupil.visible = sx < 0;
    g.add(pupil);
    eyes.push(pupil);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.72, 20), new THREE.MeshBasicMaterial({ color: 0x111111 }));
    ring.position.copy(eyeWhite.position);
    ring.position.z += 0.01;
    ring.rotation.y = sx * 0.2;
    g.add(ring);
  }
  // まゆ・ひげ（金）
  const gold = toon(0xffc93c);
  for (const sx of [-1, 1]) {
    const brow = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.12, 6, 12, Math.PI), gold);
    brow.position.set(sx * 0.85, 1.75, 2.9);
    brow.rotation.set(-0.25, sx * 0.2, 0);
    g.add(brow);
    const beard = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.11, 6, 12, Math.PI * 0.8), gold);
    beard.position.set(sx * 0.7, -0.35, 3.0);
    beard.rotation.set(-0.3, sx * 0.25, Math.PI + sx * 0.4);
    g.add(beard);
  }
  // おなかの「合格」
  const belly = new THREE.Mesh(
    new THREE.PlaneGeometry(2.4, 1.3),
    new THREE.MeshBasicMaterial({
      map: canvasTex(256, 128, (ctx, w, h) => {
        ctx.fillStyle = '#ffc93c';
        ctx.font = 'bold 92px "Hiragino Mincho ProN","Yu Mincho",serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('合格', w / 2, h / 2 + 4);
      }),
      transparent: true,
    })
  );
  belly.position.set(0, -1.7, 2.75);
  belly.rotation.x = -0.35;
  g.add(belly);
  // 光の輪（チーム色）
  const halo = new THREE.Mesh(new THREE.TorusGeometry(5.2, 0.18, 8, 48), new THREE.MeshBasicMaterial({ color: T.light, transparent: true, opacity: 0.8 }));
  halo.rotation.x = Math.PI / 2;
  halo.position.y = -2.6;
  g.add(halo);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: T.hex, transparent: true, opacity: 0.35, depthWrite: false }));
  glow.scale.set(14, 14, 1);
  g.add(glow);
  g.userData = { body, eyes, halo, glow };
  return g;
}
