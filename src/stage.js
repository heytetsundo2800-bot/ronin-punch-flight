// ステージ（空にうかぶ島々で 4対4）
//  sakura … サクラ浮島（昼。合格祈願の神社がうかぶ）
//  campus … あこがれキャンパス（夕焼け。受かったら通いたい大学）
// どちらも陣地・ダルマ・リングの場所は同じ（ルールの調整をそろえるため）
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toon, addOutline, canvasTex, glowTex } from './gfx.js';
import { World } from './physics.js';
import { mulberry32, TAU } from './util.js';
import { MOVE, TEAM, STAGES } from './config.js';

// カクカクした面にする色（岩と葉っぱ）
const FACETED = new Set(['rock', 'rockDark', 'pink', 'pink2', 'grassDark', 'ginkgo', 'ginkgo2']);

// 同じ色の部品はまとめて1つにする（描く回数を減らす）
class Batch {
  constructor() {
    this.map = new Map();
  }
  add(geo, matKey, matrix) {
    const g = geo.clone();
    geo.dispose();
    if (matrix) g.applyMatrix4(matrix);
    // 合体できるようにそろえる
    if (g.index) {
      const ng = g.toNonIndexed();
      g.dispose();
      if (FACETED.has(matKey)) ng.computeVertexNormals();
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
function mat(x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, order = 'XYZ') {
  E.set(rx, ry, rz, order);
  Q.setFromEuler(E);
  S.set(sx, sy, sz);
  P.set(x, y, z);
  return M4.compose(P, Q, S);
}

// 光の影響を受けない色（窓の明かり・街灯）と、絵をはった板。使い回す
const flatCache = new Map();
function flat(key, make) {
  if (!flatCache.has(key)) {
    const m = make();
    m.userData.shared = true;
    flatCache.set(key, m);
  }
  return flatCache.get(key);
}
const basic = (color) => flat('c' + color, () => new THREE.MeshBasicMaterial({ color }));
const texMat = (key, tex) => flat('t' + key, () => new THREE.MeshBasicMaterial({ map: tex() }));

export function buildStage(scene, opts = {}) {
  const id = STAGES[opts.id] ? opts.id : 'sakura';
  return id === 'campus' ? buildCampus(scene) : buildSakura(scene);
}

// ===== 共通：入れ物・島・陣地・空 =====
const BASE_Z = 96;

function newStage(seed) {
  const group = new THREE.Group();
  group.name = 'stage';
  const world = new World();
  const b = { x: 100, zMin: -128, zMax: 128, yMin: MOVE.arena.yMin, yMax: 92 };
  world.bounds = b;
  world.floorY = 0;
  return { group, world, b, batch: new Batch(), rnd: mulberry32(seed), islands: [], mapRects: [] };
}

// 島（とがった岩の上に草）
function islandMaker(c) {
  const { batch, world, rnd, islands } = c;
  return function island(x, top, z, R, o = {}) {
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
  };
}

function makeBases() {
  return [0, 1].map((team) => {
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
}

// 旗の出る場所（自分の旗は相手の陣地の手前に出る）
function makeFlagSpawns() {
  return [0, 1].map((team) => {
    const sgn = team === 0 ? 1 : -1; // 青の旗は赤側に出る
    return [new THREE.Vector3(-30, 32, 66 * sgn), new THREE.Vector3(30, 32, 66 * sgn), new THREE.Vector3(0, 42, 74 * sgn)];
  });
}

// 片側の点を作って、まん中を中心にくるっと反転（どちらのチームにも同じ）
function mirrored(half) {
  const out = [];
  for (const [x, y, z] of half) out.push(new THREE.Vector3(x, y, z));
  for (const [x, y, z] of half) out.push(new THREE.Vector3(-x, y, -z));
  return out;
}

// 空・雲海・遠くの雲・場外の目印をつけて、遊びに使う情報とまとめる
function finishStage(scene, c, id, env, extra) {
  const { group, b } = c;
  const sky = makeSky(env.sky);
  group.add(sky);
  const sea = makeCloudSea(env.sea);
  group.add(sea);
  const far = makeFarClouds(c.rnd, env.cloud);
  group.add(far);
  // 場外の目印（うっすら光る壁）は近づいたときだけ見せる
  const fence = makeFence(b);
  group.add(fence);
  scene.add(group);
  return {
    id,
    name: STAGES[id].name,
    env,
    group,
    world: c.world,
    bases: makeBases(),
    flagSpawns: makeFlagSpawns(),
    islands: c.islands,
    mapRects: c.mapRects,
    bounds: b,
    rapidSpawn: new THREE.Vector3(0, 32, 0),
    ...extra,
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

// ======================================================================
// ステージ1「サクラ浮島」（空にうかぶ合格祈願の神社）
// ======================================================================
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

const ENV_SAKURA = {
  fog: [0xcfe9ff, 140, 430],
  hemi: [0xffffff, 0x9fb4cf, 1.55],
  sun: [0xfff4e0, 2.1, [60, 120, -80]],
  sky: { top: new THREE.Color(0x2f86e8), mid: new THREE.Color(0x8fcaff), bot: new THREE.Color(0xe9f6ff), sun: [0.45, 0.55, -0.7], sunCol: [1.0, 0.95, 0.8], glow: 0.18 },
  sea: { lo: [0.8, 0.88, 0.97], hi: [1, 1, 1] },
  cloud: 0xffffff,
};

function buildSakura(scene) {
  const c = newStage(20261021);
  const { world, batch, rnd } = c;
  const island = islandMaker(c);

  const mats = {};
  for (const k of Object.keys(C)) mats[k] = toon(C[k]);

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
    world.add({ t: 'sph', x, y: y + h + 1.2 * s, z, r: 3.1 * s, kind: 'tree' });
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

  batch.build(c.group, mats, ['red', 'black', 'white', 'roof', 'stone', 'gold']);

  // サクラ50個（片側25個を作って反転）
  const half = [];
  // まん中の島の上をぐるっと
  for (let i = 0; i < 6; i++) {
    const a = Math.PI + (i / 6) * Math.PI + 0.26;
    half.push([Math.cos(a) * 20, 27 + (i % 2) * 2, Math.sin(a) * 20 - 2]);
  }
  half.push([0, 4, -12], [-12, 10, -20], [12, 10, -20]); // 島の下
  half.push([48, 38, -36], [-48, 38, -36], [53, 37, -42], [-44, 37.5, -32]); // 中くらいの島
  half.push([0, 50.6, -58], [0, 56, -48]); // 高い島
  half.push([76, 21, -12], [-76, 21, -6.5]); // 横の島（反転すると逆側）
  half.push([30, 16, -78], [-30, 18, -70]); // 低い島
  half.push([-22, 34, -44], [22, 20, -44]); // 柱のまわり
  half.push([-60, 44, -10], [60, 44, -10]); // 鳥居の近く・鳥居の中
  half.push([-34, 62, -18]); // いちばん上
  half.push([0, 26, -17]); // 本殿の前の鳥居の中

  // ボールの出る場所
  const ballSpawns = [];
  for (const [x, y, z] of [[0, 28.5, 11.5], [0, 28.5, -11.5], [-26, 30, -8], [26, 30, 8], [-48, 45, -30], [48, 45, 30], [48, 45, -30], [-48, 45, 30], [0, 52, -40], [0, 52, 40], [-70, 24, 0], [70, 24, 0], [14, 3, 0], [-14, 3, 0]]) {
    ballSpawns.push(new THREE.Vector3(x, y, z));
  }

  return finishStage(scene, c, 'sakura', ENV_SAKURA, {
    sakuraPoints: mirrored(half),
    ballSpawns,
    // ラピッドボールは本殿の屋根の上に出る
    rapidSpawn: new THREE.Vector3(0, 40, 0),
  });
}

// ======================================================================
// ステージ2「あこがれキャンパス」（夕焼けの空にうかぶ大学）
//  まん中に時計台、中くらいの島どうしを渡り廊下がつなぐ。
//  陣地には校門、イチョウ並木、街灯。黒板には浪人たちの決意。
// ======================================================================
const CAMPUS = {
  grass: 0x9bcf63,
  grassDark: 0x76ad4a,
  rock: 0xa48b7a,
  rockDark: 0x7d695c,
  brick: 0xc65a3e,
  brickDark: 0x96432f,
  cream: 0xf7ecd6,
  creamDark: 0xd8c5a0,
  copper: 0x5fb39f,
  iron: 0x3a3b44,
  wood: 0x8b5a2b,
  ginkgo: 0xffd23c,
  ginkgo2: 0xf2b21a,
  board: 0x2e5b47,
  gold: 0xffc93c,
  glass: 0x41618a,
};

// 夕焼け。空の色は「画面に出る色」で書く（空のシェーダーは色をそのまま出すため）
const lin = (r, g, b) => new THREE.Color().setRGB(r, g, b);
const ENV_CAMPUS = {
  fog: [0xf6bf9c, 150, 470],
  hemi: [0xffe0c8, 0x7b6aa5, 1.5],
  sun: [0xffb27a, 2.3, [-110, 95, -40]],
  sky: { top: lin(0.33, 0.31, 0.64), mid: lin(1.0, 0.6, 0.45), bot: lin(1.0, 0.8, 0.62), sun: [-0.93, 0.1, -0.35], sunCol: [1.0, 0.82, 0.5], glow: 0.45 },
  sea: { lo: [0.98, 0.72, 0.62], hi: [1.0, 0.9, 0.8] },
  cloud: 0xffcfb0,
};

function buildCampus(scene) {
  const c = newStage(20261022);
  const { world, batch, rnd, group } = c;
  const island = islandMaker(c);

  const mats = {};
  for (const k of Object.keys(CAMPUS)) mats[k] = toon(CAMPUS[k]);
  mats.win = basic(0xffd27a);
  mats.lamp = basic(0xfff3c4);
  mats.clock = texMat('clock', clockTex);
  mats.boardFace = texMat('board', boardTex);
  mats.banner = texMat('banner', bannerTex);
  mats.plate = texMat('plate', plateTex);
  const glows = []; // 街灯の光
  const bigGlows = []; // 大きな街灯の光

  // ---- イチョウの木（とがった黄色い木）----
  function ginkgo(x, y, z, s = 1) {
    const h = 4.2 * s;
    batch.add(new THREE.CylinderGeometry(0.3 * s, 0.55 * s, h + 3 * s, 8), 'wood', mat(x, y + (h + 3 * s) / 2, z));
    world.add({ t: 'cyl', x, z, r: 0.5 * s, y0: y, y1: y + h, kind: 'tree' });
    const layers = [[2.9, 0], [2.3, 2.3], [1.6, 4.3]];
    layers.forEach(([r, dy], i) => {
      batch.add(new THREE.IcosahedronGeometry(r * s, 1), i % 2 ? 'ginkgo2' : 'ginkgo', mat(x + (rnd() - 0.5) * 0.4 * s, y + h + dy * s, z + (rnd() - 0.5) * 0.4 * s, rnd(), rnd(), 0, 1, 1.15, 1));
    });
    world.add({ t: 'sph', x, y: y + h + 0.2 * s, z, r: 2.9 * s, kind: 'tree' });
    world.add({ t: 'sph', x, y: y + h + 3.0 * s, z, r: 2.2 * s, kind: 'tree' });
  }

  // ---- 街灯 ----
  function lamp(x, y, z, s = 1) {
    batch.add(new THREE.CylinderGeometry(0.42 * s, 0.5 * s, 0.4 * s, 8), 'iron', mat(x, y + 0.2 * s, z));
    batch.add(new THREE.CylinderGeometry(0.15 * s, 0.22 * s, 5.2 * s, 8), 'iron', mat(x, y + 2.6 * s, z));
    batch.add(new THREE.SphereGeometry(0.55 * s, 12, 8), 'lamp', mat(x, y + 5.7 * s, z));
    batch.add(new THREE.ConeGeometry(0.62 * s, 0.5 * s, 8), 'iron', mat(x, y + 6.35 * s, z));
    world.add({ t: 'cyl', x, z, r: 0.45 * s, y0: y, y1: y + 6.6 * s, kind: 'deco' });
    glows.push([x, y + 5.7 * s, z]);
  }

  // ---- れんがのアーチ門（くぐれる）----
  function archGate(x, y, z, ry, s = 1) {
    const w = 11 * s, h = 9 * s, pw = 2 * s, R = w / 2;
    const cs = Math.cos(ry), sn = Math.sin(ry);
    const at = (d) => [x + d * cs, z - d * sn]; // 門の横方向に d ずらした場所
    for (const side of [-1, 1]) {
      const [px, pz] = at(side * R);
      batch.add(new THREE.BoxGeometry(pw, h, pw * 1.1), 'brick', mat(px, y + h / 2, pz, 0, ry, 0));
      batch.add(new THREE.BoxGeometry(pw * 1.3, 0.7 * s, pw * 1.4), 'cream', mat(px, y + 0.35 * s, pz, 0, ry, 0));
      batch.add(new THREE.BoxGeometry(pw * 1.25, 0.6 * s, pw * 1.35), 'cream', mat(px, y + h, pz, 0, ry, 0));
      world.add({ t: 'box', x: px, y: y + (h + 2.4 * s) / 2, z: pz, hx: pw / 2 + 0.05, hy: (h + 2.4 * s) / 2, hz: pw * 0.55 + 0.05, ry, kind: 'gate' });
      // 肩（アーチの両はし）
      const [qx, qz] = at(side * 4.75 * s);
      world.add({ t: 'box', x: qx, y: y + h + 3.7 * s, z: qz, hx: 1.65 * s, hy: 1.3 * s, hz: 0.95 * s, ry, kind: 'gate' });
    }
    // 半円のアーチ（てっぺんにかなめ石）
    batch.add(new THREE.TorusGeometry(R, 0.85 * s, 8, 20, Math.PI), 'brick', mat(x, y + h, z, 0, ry, 0));
    batch.add(new THREE.BoxGeometry(1.4 * s, 1.8 * s, 2.0 * s), 'cream', mat(x, y + h + R, z, 0, ry, 0));
    world.add({ t: 'box', x, y: y + h + R + 0.2 * s, z, hx: 3.1 * s, hy: 1.3 * s, hz: 1.0 * s, ry, kind: 'gate' });
  }

  // ---- 校門（陣地の入口。名札は「あこがれ大学」）----
  function schoolGate(x, y, z, ry, s = 1, w = 11 * s) {
    const h = 7.5 * s, pw = 2.2 * s;
    const aR = w / 2 - pw / 2, flatK = Math.min(0.38, (2.1 * s) / aR);
    const cs = Math.cos(ry), sn = Math.sin(ry);
    for (const side of [-1, 1]) {
      const px = x + side * (w / 2) * cs, pz = z - side * (w / 2) * sn;
      batch.add(new THREE.BoxGeometry(pw, h, pw), 'brick', mat(px, y + h / 2, pz, 0, ry, 0));
      batch.add(new THREE.BoxGeometry(pw * 1.25, 0.6 * s, pw * 1.25), 'cream', mat(px, y + h + 0.3 * s, pz, 0, ry, 0));
      batch.add(new THREE.BoxGeometry(pw * 1.2, 0.5 * s, pw * 1.2), 'cream', mat(px, y + 0.25 * s, pz, 0, ry, 0));
      batch.add(new THREE.SphereGeometry(0.55 * s, 10, 8), 'lamp', mat(px, y + h + 1.15 * s, pz));
      glows.push([px, y + h + 1.15 * s, pz]);
      world.add({ t: 'box', x: px, y: y + (h + 1.7 * s) / 2, z: pz, hx: pw / 2 + 0.05, hy: (h + 1.7 * s) / 2, hz: pw / 2 + 0.05, ry, kind: 'gate' });
    }
    // 鉄のアーチと名札
    batch.add(new THREE.BoxGeometry(w - pw, 0.35 * s, 0.35 * s), 'iron', mat(x, y + h - 0.6 * s, z, 0, ry, 0));
    batch.add(new THREE.TorusGeometry(aR, 0.16 * s, 6, 28, Math.PI), 'iron', mat(x, y + h - 0.6 * s, z, 0, ry, 0, 1, flatK, 1));
    batch.add(new THREE.BoxGeometry(4.6 * s, 1.2 * s, 0.3 * s), 'cream', mat(x, y + h + 0.9 * s, z, 0, ry, 0));
    for (const face of [0, Math.PI]) {
      const fy = ry + face;
      batch.add(new THREE.PlaneGeometry(4.3 * s, 1.0 * s), 'plate', mat(x + Math.sin(fy) * 0.2 * s, y + h + 0.9 * s, z + Math.cos(fy) * 0.2 * s, 0, fy, 0));
    }
    world.add({ t: 'box', x, y: y + h + 0.3 * s, z, hx: w / 2, hy: 1.05 * s, hz: 0.3 * s, ry, kind: 'gate' });
  }

  // ---- 時計台（まん中）----
  function clockTower(x, y, z) {
    // 土台
    batch.add(new THREE.BoxGeometry(13, 1.2, 13), 'creamDark', mat(x, y + 0.6, z));
    world.add({ t: 'box', x, y: y + 0.6, z, hx: 6.5, hy: 0.6, hz: 6.5, kind: 'tower' });
    // れんがの塔
    const b0 = y + 1.2;
    batch.add(new THREE.BoxGeometry(9, 26, 9), 'brick', mat(x, b0 + 13, z));
    for (const yy of [8.5, 17.5]) batch.add(new THREE.BoxGeometry(9.5, 0.8, 9.5), 'cream', mat(x, b0 + yy, z));
    // 四すみの柱
    for (const [dx, dz] of [[-4.5, -4.5], [4.5, -4.5], [-4.5, 4.5], [4.5, 4.5]]) batch.add(new THREE.BoxGeometry(1.2, 26, 1.2), 'brickDark', mat(x + dx, b0 + 13, z + dz));
    // 窓と入口（4方向）
    const faces = [[0, 1, 0], [0, -1, Math.PI], [1, 0, Math.PI / 2], [-1, 0, -Math.PI / 2]];
    for (const [fx, fz, fr] of faces) {
      for (const yy of [11.5, 21.5]) batch.add(new THREE.BoxGeometry(1.7, 3.4, 0.2), rnd() < 0.6 ? 'win' : 'glass', mat(x + fx * 4.55, b0 + yy, z + fz * 4.55, 0, fr, 0));
      batch.add(new THREE.BoxGeometry(3, 4.4, 0.3), 'wood', mat(x + fx * 4.55, b0 + 2.2, z + fz * 4.55, 0, fr, 0));
      batch.add(new THREE.BoxGeometry(3.8, 0.5, 0.5), 'cream', mat(x + fx * 4.6, b0 + 4.6, z + fz * 4.6, 0, fr, 0));
    }
    world.add({ t: 'box', x, y: b0 + 13, z, hx: 5.1, hy: 13, hz: 5.1, kind: 'tower' });
    // 時計の部屋
    const cy = b0 + 26;
    batch.add(new THREE.BoxGeometry(10.5, 7, 10.5), 'cream', mat(x, cy + 3.5, z));
    batch.add(new THREE.BoxGeometry(11.3, 0.7, 11.3), 'creamDark', mat(x, cy + 0.35, z));
    batch.add(new THREE.BoxGeometry(11.3, 0.7, 11.3), 'creamDark', mat(x, cy + 7.0, z));
    for (const [fx, fz, fr] of faces) {
      batch.add(new THREE.CircleGeometry(2.6, 32), 'clock', mat(x + fx * 5.32, cy + 3.6, z + fz * 5.32, 0, fr, 0));
      batch.add(new THREE.TorusGeometry(2.72, 0.22, 6, 32), 'gold', mat(x + fx * 5.36, cy + 3.6, z + fz * 5.36, 0, fr, 0));
    }
    world.add({ t: 'box', x, y: cy + 3.6, z, hx: 5.65, hy: 3.95, hz: 5.65, kind: 'tower' });
    // 屋根（四角すい）とてっぺん
    const ry0 = cy + 7.35;
    batch.add(new THREE.ConeGeometry(8.0, 9, 4, 1), 'copper', mat(x, ry0 + 4.5, z, 0, Math.PI / 4, 0));
    batch.add(new THREE.SphereGeometry(0.55, 10, 8), 'gold', mat(x, ry0 + 9.2, z));
    batch.add(new THREE.CylinderGeometry(0.12, 0.12, 2.6, 6), 'iron', mat(x, ry0 + 10.6, z));
    // 当たりは見た目の四角すいに合わせて6段の箱
    for (let k = 0; k < 6; k++) {
      const hw = 5.657 * (1 - (k + 0.5) / 6);
      world.add({ t: 'box', x, y: ry0 + (k + 0.5) * 1.5, z, hx: hw, hy: 0.75, hz: hw, kind: 'tower' });
    }
  }

  // ---- 天文台（ドームの建物）----
  function observatory(x, y, z, yaw) {
    const sx = Math.sin(yaw), sz = Math.cos(yaw);
    batch.add(new THREE.CylinderGeometry(4.6, 4.8, 5, 20), 'cream', mat(x, y + 2.5, z));
    batch.add(new THREE.CylinderGeometry(4.95, 4.95, 0.6, 20), 'creamDark', mat(x, y + 5.0, z));
    batch.add(new THREE.SphereGeometry(4.6, 20, 10, 0, TAU, 0, Math.PI / 2), 'copper', mat(x, y + 5.2, z));
    // 望遠鏡のすき間（まん中のほうを向く）
    const k = 4.62 * Math.SQRT1_2;
    batch.add(new THREE.BoxGeometry(1.3, 5.2, 0.3), 'iron', mat(x + sx * k, y + 5.2 + k, z + sz * k, -Math.PI / 4, yaw, 0, 1, 1, 1, 'YXZ'));
    // ドアと窓
    batch.add(new THREE.BoxGeometry(1.7, 2.9, 0.3), 'wood', mat(x + sx * 4.72, y + 1.45, z + sz * 4.72, 0, yaw, 0));
    for (const d of [-1, 1]) {
      const a = yaw + d * 1.1;
      batch.add(new THREE.BoxGeometry(1.1, 1.4, 0.2), 'win', mat(x + Math.sin(a) * 4.7, y + 3.0, z + Math.cos(a) * 4.7, 0, a, 0));
    }
    world.add({ t: 'cyl', x, z, r: 4.95, y0: y, y1: y + 5.3, kind: 'bldg' });
    world.add({ t: 'sph', x, y: y + 5.2, z, r: 4.65, kind: 'bldg' });
  }

  // ---- 渡り廊下（島と島をつなぐ橋）----
  function bridge(x0, x1, y, z) {
    const len = x1 - x0, cx = (x0 + x1) / 2;
    batch.add(new THREE.BoxGeometry(len, 1.1, 5.2), 'cream', mat(cx, y - 0.55, z));
    batch.add(new THREE.BoxGeometry(len, 0.6, 5.7), 'brickDark', mat(cx, y - 1.4, z));
    for (const side of [-1, 1]) {
      batch.add(new THREE.BoxGeometry(len, 0.22, 0.22), 'iron', mat(cx, y + 1.15, z + side * 2.45));
      for (let px = x0 + 1.5; px <= x1 - 1.4; px += 2.5) batch.add(new THREE.BoxGeometry(0.16, 1.15, 0.16), 'iron', mat(px, y + 0.58, z + side * 2.45));
    }
    world.add({ t: 'box', x: cx, y: y - 0.85, z, hx: len / 2, hy: 0.85, hz: 2.85, kind: 'bridge' });
    // 橋脚
    const piers = [cx - len * 0.2, cx + len * 0.2];
    const bot = y - 1.7;
    for (const px of piers) {
      batch.add(new THREE.BoxGeometry(2.6, bot, 2.8), 'brick', mat(px, bot / 2, z));
      for (let yy = 6; yy < bot - 1; yy += 8) batch.add(new THREE.BoxGeometry(2.9, 0.5, 3.1), 'cream', mat(px, yy, z));
      world.add({ t: 'box', x: px, y: bot / 2, z, hx: 1.3, hy: bot / 2, hz: 1.4, kind: 'pillar' });
    }
    // 橋脚の上の受け（小さな飾り。下を飛ぶじゃまにならない大きさ）
    for (const px of piers) batch.add(new THREE.BoxGeometry(4.2, 0.7, 3.2), 'cream', mat(px, bot - 0.35, z));
    c.mapRects.push({ x: cx, z, w: len, h: 5.7 });
  }

  // ---- 校舎（3階建て。屋上に立てる）----
  function schoolBldg(x, y, z, sgn) {
    const W = 9, H = 11, D = 14;
    batch.add(new THREE.BoxGeometry(W, H, D), 'brick', mat(x, y + H / 2, z));
    batch.add(new THREE.BoxGeometry(W + 0.7, 0.7, D + 0.7), 'cream', mat(x, y + H + 0.1, z));
    batch.add(new THREE.BoxGeometry(W + 0.5, 0.6, D + 0.5), 'creamDark', mat(x, y + 0.3, z));
    for (const yy of [3.75, 7.35]) batch.add(new THREE.BoxGeometry(W + 0.25, 0.35, D + 0.25), 'creamDark', mat(x, y + yy, z));
    for (const side of [-1, 1])
      for (let fl = 0; fl < 3; fl++)
        for (let i = 0; i < 5; i++) batch.add(new THREE.BoxGeometry(0.16, 2.0, 1.6), rnd() < 0.55 ? 'win' : 'glass', mat(x + side * (W / 2 + 0.05), y + 1.9 + fl * 3.6, z - 5.4 + i * 2.7));
    for (const side of [-1, 1])
      for (let fl = 0; fl < 3; fl++)
        for (let i = 0; i < 2; i++) batch.add(new THREE.BoxGeometry(1.5, 2.0, 0.16), rnd() < 0.5 ? 'win' : 'glass', mat(x - 1.8 + i * 3.6, y + 1.9 + fl * 3.6, z + side * (D / 2 + 0.05)));
    // 屋上の階段室
    batch.add(new THREE.BoxGeometry(3, 2.4, 3.2), 'creamDark', mat(x, y + H + 1.6, z + sgn * 4));
    world.add({ t: 'box', x, y: y + H + 1.6, z: z + sgn * 4, hx: 1.55, hy: 1.2, hz: 1.65, kind: 'bldg' });
    // 懸垂幕「祝 合格」（まん中のほうを向く面）
    batch.add(new THREE.PlaneGeometry(2.2, 8.2), 'banner', mat(x - sgn * (W / 2 + 0.24), y + H / 2 + 0.6, z, 0, -sgn * Math.PI / 2, 0));
    world.add({ t: 'box', x, y: y + (H + 0.45) / 2, z, hx: W / 2 + 0.35, hy: (H + 0.45) / 2, hz: D / 2 + 0.35, kind: 'bldg' });
  }

  // ---- 黒板（浪人たちの決意）----
  function blackboard(x, y, z, ry) {
    const cs = Math.cos(ry), sn = Math.sin(ry);
    for (const side of [-1, 1]) {
      const lx = x + side * 4.2 * cs, lz = z - side * 4.2 * sn;
      batch.add(new THREE.CylinderGeometry(0.22, 0.28, 6.0, 8), 'wood', mat(lx, y + 3.0, lz));
      world.add({ t: 'cyl', x: lx, z: lz, r: 0.35, y0: y, y1: y + 6, kind: 'deco' });
    }
    batch.add(new THREE.BoxGeometry(11, 5.8, 0.5), 'wood', mat(x, y + 5.6, z, 0, ry, 0));
    batch.add(new THREE.BoxGeometry(10.2, 5.0, 0.56), 'board', mat(x, y + 5.6, z, 0, ry, 0));
    batch.add(new THREE.PlaneGeometry(10.2, 5.0), 'boardFace', mat(x + sn * 0.34, y + 5.6, z + cs * 0.34, 0, ry, 0));
    batch.add(new THREE.BoxGeometry(10.4, 0.2, 0.7), 'wood', mat(x + sn * 0.4, y + 3.0, z + cs * 0.4, 0, ry, 0));
    world.add({ t: 'box', x, y: y + 5.6, z, hx: 5.5, hy: 2.9, hz: 0.35, ry, kind: 'deco' });
  }

  // ---- あずまや（下をくぐれる）----
  function gazebo(x, y, z) {
    batch.add(new THREE.CylinderGeometry(5.6, 5.8, 0.5, 8), 'creamDark', mat(x, y + 0.25, z, 0, Math.PI / 8, 0));
    world.add({ t: 'cyl', x, z, r: 5.7, y0: y, y1: y + 0.5, kind: 'deco' });
    for (const [dx, dz] of [[-3.6, -3.6], [3.6, -3.6], [-3.6, 3.6], [3.6, 3.6]]) {
      batch.add(new THREE.CylinderGeometry(0.3, 0.34, 5.2, 8), 'cream', mat(x + dx, y + 3.0, z + dz));
      world.add({ t: 'cyl', x: x + dx, z: z + dz, r: 0.4, y0: y, y1: y + 5.6, kind: 'deco' });
    }
    batch.add(new THREE.BoxGeometry(9.4, 0.6, 9.4), 'creamDark', mat(x, y + 5.6, z));
    batch.add(new THREE.ConeGeometry(7.4, 3.4, 4), 'copper', mat(x, y + 7.6, z, 0, Math.PI / 4, 0));
    batch.add(new THREE.SphereGeometry(0.45, 8, 6), 'gold', mat(x, y + 9.5, z));
    world.add({ t: 'box', x, y: y + 5.6, z, hx: 4.75, hy: 0.32, hz: 4.75, kind: 'deco' });
    for (let k = 0; k < 3; k++) {
      const hw = 5.23 * (1 - (k + 0.5) / 3);
      world.add({ t: 'box', x, y: y + 5.9 + (k + 0.5) * (3.4 / 3), z, hx: hw, hy: 3.4 / 6, hz: hw, kind: 'deco' });
    }
  }

  // ---- 雲海から立つ大きな街灯 ----
  function lampPillar(x, z, h, r) {
    batch.add(new THREE.CylinderGeometry(r * 0.55, r * 0.75, h, 12), 'cream', mat(x, h / 2, z));
    for (let y = 8; y < h; y += 9) batch.add(new THREE.CylinderGeometry(r * 0.72, r * 0.72, 0.8, 12), 'brickDark', mat(x, y, z));
    batch.add(new THREE.CylinderGeometry(r * 1.0, r * 0.6, 1.4, 12), 'iron', mat(x, h + 0.7, z));
    batch.add(new THREE.SphereGeometry(r * 0.75, 16, 12), 'lamp', mat(x, h + 1.4 + r * 0.6, z));
    batch.add(new THREE.ConeGeometry(r * 0.85, r * 0.7, 12), 'iron', mat(x, h + 1.4 + r * 1.45, z));
    world.add({ t: 'cyl', x, z, r: r * 0.8, y0: 0, y1: h + 1.4, kind: 'pillar' });
    world.add({ t: 'sph', x, y: h + 1.4 + r * 0.6, z, r: r * 0.8, kind: 'pillar' });
    bigGlows.push([x, h + 1.4 + r * 0.6, z]);
  }

  // ===== 配置（まん中を中心に、くるっと回して同じ形）=====
  island(0, 22, 0, 24, { depth: 26 });
  clockTower(0, 22, 0);
  archGate(0, 22, 17, 0, 1.0);
  archGate(0, 22, -17, Math.PI, 1.0);
  for (const [lx, lz] of [[-14, 12], [14, 12], [-14, -12], [14, -12]]) lamp(lx, 22, lz);
  ginkgo(-17, 22, 4, 1.0);
  ginkgo(17, 22, -4, 1.0);

  for (const sgn of [-1, 1]) {
    // 中くらいの島：天文台の島と、イチョウの島。その間を渡り廊下がつなぐ
    island(48 * sgn, 34, -36 * sgn, 12);
    observatory(48 * sgn, 34, -36 * sgn, Math.atan2(-48 * sgn, 36 * sgn));
    island(-48 * sgn, 34, -36 * sgn, 12);
    ginkgo(-48 * sgn - 4 * sgn, 34, -36 * sgn + 4 * sgn, 0.95);
    ginkgo(-48 * sgn + 4 * sgn, 34, -36 * sgn - 4 * sgn, 0.95);
    lamp(-48 * sgn - 6 * sgn, 34, -36 * sgn - 6 * sgn);
    bridge(-36.5, 36.5, 34.2, -36 * sgn);
    // 高い島のあずまや
    island(0, 47, -58 * sgn, 9);
    gazebo(0, 47, -58 * sgn);
    // 横の島の校舎
    island(76 * sgn, 17, 12 * sgn, 11);
    schoolBldg(76 * sgn, 17, 12 * sgn, sgn);
    // 低い島のイチョウ
    island(30 * sgn, 12, -78 * sgn, 9);
    ginkgo(26 * sgn, 12, -81 * sgn, 0.85);
    ginkgo(34 * sgn, 12, -75 * sgn, 0.85);
    // いちばん上の小島の黒板（まん中を向く）
    island(-34 * sgn, 58, 18 * sgn, 7);
    blackboard(-34 * sgn, 58, 18 * sgn, Math.atan2(34 * sgn, -18 * sgn));
    // 浮いているアーチ（くぐれる）
    archGate(-60 * sgn, 40, 10 * sgn, Math.PI / 2, 1.0);
    // 大きな街灯
    lampPillar(88 * sgn, -70 * sgn, 52, 3.2);
    lampPillar(-22 * sgn, -44 * sgn, 30, 2.4);
    lampPillar(64 * sgn, 70 * sgn, 40, 2.8);
    // 陣地の島（ダルマが乗る）と校門
    island(0, 26, -BASE_Z * sgn, 19, { depth: 24 });
    schoolGate(0, 26, -(BASE_Z - 15) * sgn, sgn > 0 ? 0 : Math.PI, 1.2, 20);
    lamp(-9, 26, -(BASE_Z - 10) * sgn);
    lamp(9, 26, -(BASE_Z - 10) * sgn);
    ginkgo(-11, 26, -(BASE_Z + 14.5) * sgn, 0.85);
    ginkgo(11, 26, -(BASE_Z + 14.5) * sgn, 0.85);
  }

  batch.build(group, mats, ['brick', 'brickDark', 'cream', 'copper', 'iron', 'board', 'gold']);

  // 街灯の光（まとめて1回で描く）
  const glowPts = (list, size, color) => {
    if (!list.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(list.flat(), 3));
    const m = new THREE.PointsMaterial({ map: glowTex(), color, size, sizeAttenuation: true, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending });
    const pts = new THREE.Points(g, m);
    pts.renderOrder = 2;
    group.add(pts);
  };
  glowPts(glows, 5.5, 0xffc46b);
  glowPts(bigGlows, 15, 0xffb35c);

  // サクラ50個（片側25個を作って反転）
  const half = [];
  for (let i = 0; i < 6; i++) {
    const a = Math.PI + (i / 6) * Math.PI + 0.26;
    half.push([Math.cos(a) * 20, 27 + (i % 2) * 2, Math.sin(a) * 20 - 2]);
  }
  half.push([0, 4, -12], [-12, 10, -20], [12, 10, -20]); // 島の下
  half.push([48, 46.5, -36], [55, 37.5, -41], [-48, 38, -36], [-41, 37.5, -31]); // 天文台の上・イチョウの島
  half.push([0, 49.5, -58]); // あずまやの中
  half.push([76, 21, -12], [-76, 31, -12]); // 校舎の屋上
  half.push([30, 16, -78]); // 低い島
  half.push([-22, 37.5, -44], [22, 20, -44]); // 大きな街灯のまわり
  half.push([60, 45, -10], [-60, 44, -12]); // アーチの中
  half.push([-34, 62, -18]); // いちばん上
  half.push([0, 37, -36], [0, 29, -36]); // 渡り廊下の上と下
  half.push([0, 52.5, -8.5]); // 時計の前

  const ballSpawns = [];
  for (const [x, y, z] of [[0, 27, 10.5], [0, 27, -10.5], [-26, 30, -8], [26, 30, 8], [-40, 44, -26], [40, 44, 26], [40, 44, -26], [-40, 44, 26], [0, 52, -40], [0, 52, 40], [-66, 26, 0], [66, 26, 0]]) {
    ballSpawns.push(new THREE.Vector3(x, y, z));
  }

  return finishStage(scene, c, 'campus', ENV_CAMPUS, {
    sakuraPoints: mirrored(half),
    ballSpawns,
    // ラピッドボールは時計台の上に出る（ふらふら動ける高さも上げる）
    rapidSpawn: new THREE.Vector3(0, 74, 0),
    rapidTop: 80,
  });
}

// ---- キャンパスの絵（文字盤・黒板・幕・名札）----
const JP = '"Hiragino Maru Gothic ProN","Hiragino Sans","Yu Gothic","Noto Sans JP",sans-serif';
const JPM = '"Hiragino Mincho ProN","Yu Mincho","Noto Serif JP",serif';
function shared(t) {
  t.userData.shared = true;
  return t;
}
function clockTex() {
  return shared(
    canvasTex(256, 256, (ctx, w, h) => {
      const cx = w / 2, cy = h / 2, R = w / 2 - 4;
      ctx.fillStyle = '#fffaf0';
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = '#2b2b2e';
      ctx.lineWidth = 8;
      ctx.stroke();
      for (let i = 0; i < 60; i++) {
        const a = (i / 60) * TAU, big = i % 5 === 0;
        const r0 = R - (big ? 28 : 15), r1 = R - 9;
        ctx.lineWidth = big ? 8 : 3;
        ctx.beginPath();
        ctx.moveTo(cx + Math.sin(a) * r0, cy - Math.cos(a) * r0);
        ctx.lineTo(cx + Math.sin(a) * r1, cy - Math.cos(a) * r1);
        ctx.stroke();
      }
      // 針（夕方の4時50分）
      const hand = (a, len, wid) => {
        ctx.lineWidth = wid;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(cx - Math.sin(a) * 16, cy + Math.cos(a) * 16);
        ctx.lineTo(cx + Math.sin(a) * len, cy - Math.cos(a) * len);
        ctx.stroke();
      };
      hand(((4 + 50 / 60) / 12) * TAU, R * 0.5, 13);
      hand((50 / 60) * TAU, R * 0.78, 8);
      ctx.fillStyle = '#c0392b';
      ctx.beginPath();
      ctx.arc(cx, cy, 10, 0, TAU);
      ctx.fill();
    })
  );
}
function boardTex() {
  return shared(
    canvasTex(512, 256, (ctx, w, h) => {
      ctx.fillStyle = '#2e5b47';
      ctx.fillRect(0, 0, w, h);
      // チョークの粉
      for (let i = 0; i < 900; i++) {
        ctx.fillStyle = `rgba(255,255,255,${0.02 + Math.random() * 0.05})`;
        ctx.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 6, 1 + Math.random() * 2);
      }
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255,255,255,0.93)';
      ctx.font = 'bold 58px ' + JP;
      ctx.fillText('春から ここに通う！', w / 2, h * 0.42);
      ctx.strokeStyle = 'rgba(255,224,102,0.9)';
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(w * 0.14, h * 0.62);
      ctx.quadraticCurveTo(w * 0.5, h * 0.67, w * 0.86, h * 0.6);
      ctx.stroke();
      ctx.font = 'bold 30px ' + JP;
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(255,190,214,0.95)';
      ctx.fillText('― 浪人一同', w * 0.9, h * 0.82);
    })
  );
}
function bannerTex() {
  return shared(
    canvasTex(128, 512, (ctx, w, h) => {
      ctx.fillStyle = '#d93a2b';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#fff3e0';
      ctx.lineWidth = 8;
      ctx.strokeRect(8, 8, w - 16, h - 16);
      ctx.fillStyle = '#fffaf0';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 88px ' + JPM;
      ['祝', '合', '格'].forEach((ch, i) => ctx.fillText(ch, w / 2, 96 + i * 150));
    })
  );
}
function plateTex() {
  return shared(
    canvasTex(512, 120, (ctx, w, h) => {
      ctx.fillStyle = '#f7ecd6';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#2b2b2e';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 70px ' + JPM;
      ctx.fillText('あこがれ大学', w / 2, h / 2 + 4);
    })
  );
}

// ===== 空・雲海・雲・場外の壁 =====
function makeSky(o) {
  const geo = new THREE.SphereGeometry(900, 32, 16);
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: o.top },
      mid: { value: o.mid },
      bot: { value: o.bot },
      sun: { value: new THREE.Vector3(...o.sun).normalize() },
      sunCol: { value: new THREE.Vector3(...o.sunCol) },
      glow: { value: o.glow },
    },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }',
    fragmentShader:
      'uniform vec3 top; uniform vec3 mid; uniform vec3 bot; uniform vec3 sun; uniform vec3 sunCol; uniform float glow; varying vec3 vDir;\n' +
      'void main(){ float h = vDir.y; vec3 c = h > 0.0 ? mix(mid, top, smoothstep(0.0, 0.55, h)) : mix(mid, bot, smoothstep(0.0, -0.25, h));\n' +
      ' float s = max(dot(normalize(vDir), sun), 0.0); c += sunCol * (pow(s, 64.0) * 0.9 + pow(s, 8.0) * glow);\n' +
      ' gl_FragColor = vec4(c, 1.0); }',
  });
  const mesh = new THREE.Mesh(geo, m);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return mesh;
}

function makeCloudSea(o) {
  const geo = new THREE.PlaneGeometry(1800, 1800, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.ShaderMaterial({
    transparent: false,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, lo: { value: new THREE.Vector3(...o.lo) }, hi: { value: new THREE.Vector3(...o.hi) } }]),
    vertexShader:
      '#include <fog_pars_vertex>\nvarying vec2 vP; void main(){ vP = position.xz; vec4 mvPosition = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mvPosition;\n#include <fog_vertex>\n}',
    fragmentShader:
      '#include <fog_pars_fragment>\nuniform float uTime; uniform vec3 lo; uniform vec3 hi; varying vec2 vP;\n' +
      'float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }\n' +
      'float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }\n' +
      'void main(){ vec2 p = vP*0.02 + vec2(uTime*0.01, uTime*0.004); float v = n(p)*0.5 + n(p*2.1)*0.3 + n(p*4.3)*0.2;\n' +
      ' vec3 c = mix(lo, hi, smoothstep(0.35, 0.75, v)); gl_FragColor = vec4(c,1.0);\n#include <fog_fragment>\n}',
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

function makeFarClouds(rnd, tint = 0xffffff) {
  const g = new THREE.Group();
  const m = new THREE.SpriteMaterial({ map: cloudTex(), color: tint, transparent: true, depthWrite: false, fog: false });
  for (let i = 0; i < 26; i++) {
    const a = rnd() * TAU, r = 320 + rnd() * 260;
    const s = new THREE.Sprite(m);
    s.position.set(Math.cos(a) * r, -10 + rnd() * 90, Math.sin(a) * r);
    const k = 90 + rnd() * 120;
    s.scale.set(k, k * 0.5, 1);
    g.add(s);
  }
  // 足もとの雲
  const m2 = new THREE.SpriteMaterial({ map: cloudTex(), color: tint, transparent: true, depthWrite: false, opacity: 0.9 });
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
