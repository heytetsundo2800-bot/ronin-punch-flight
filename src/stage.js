// ステージ（空にうかぶ島々で 4対4）
//  sakura … サクラ浮島（昼。合格祈願の神社がうかぶ）
//  campus … あこがれキャンパス（夕焼け。受かったら通いたい大学）
// どちらも陣地・ダルマ・リングの場所は同じ（ルールの調整をそろえるため）
// 見た目の部品（岩・草・雲・空のシェーダー、手描き風テクスチャ）は stageart.js
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toon, addOutline, canvasTex, glowTex } from './gfx.js';
import { World } from './physics.js';
import { mulberry32, TAU } from './util.js';
import { MOVE, TEAM, STAGES } from './config.js';
import * as ART from './stageart.js';

// カクカクした面にする色（岩と葉っぱ）
const FACETED = new Set(['rock', 'rockDark', 'pink', 'pink2', 'grassDark', 'ginkgo', 'ginkgo2']);
const KEEP = ['position', 'normal', 'uv', 'color'];

// 同じ色の部品はまとめて1つにする（描く回数を減らす）
//  ・uv はワールドの大きさで貼り直す（材質ごとに uvs[key] = { mode:'box'|'cyl', s:1枚の大きさ }）
//  ・頂点カラー：物ごとの小さな色むら × 足もとのかげ（ground より aoH の高さまで暗く）
class Batch {
  constructor(seed = 1) {
    this.map = new Map();
    this.ground = null;
    this.aoH = 1.5;
    this.aoMin = 0.5;
    this.uvs = {};
    this.trnd = mulberry32(seed);
    this.raws = new Map();
  }
  // 小さな部品をじかにためる入れ物（材質ごと）
  raw(key) {
    if (!this.raws.has(key)) this.raws.set(key, new ART.Raw(4096));
    return this.raws.get(key);
  }
  add(geo, matKey, matrix, o) {
    const indexed = !!geo.index;
    // 呼んだ側が作ったばかりの形なので、インデックスなしならそのまま使う
    const g = indexed ? geo.toNonIndexed() : geo;
    if (indexed) geo.dispose();
    if (matrix) g.applyMatrix4(matrix);
    // 合体できるようにそろえる
    if (indexed && FACETED.has(matKey)) g.computeVertexNormals();
    for (const k of Object.keys(g.attributes)) if (!KEEP.includes(k)) g.deleteAttribute(k);
    const n = g.attributes.position.count;
    const um = (o && o.uv) || this.uvs[matKey];
    if (um && um !== 'keep') worldUV(g, um, o);
    else if (o && o.uvScale && g.attributes.uv) {
      const ua = g.attributes.uv.array;
      for (let i = 0; i < n; i++) {
        ua[i * 2] *= o.uvScale[0];
        ua[i * 2 + 1] *= o.uvScale[1];
      }
    }
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    let col = g.attributes.color;
    if (!col) {
      col = new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3);
      g.setAttribute('color', col);
    }
    const tv = o && o.tint !== undefined ? o.tint : 1 + (this.trnd() - 0.5) * 0.08;
    const tl = Math.pow(tv, 2.2);
    const ground = o && o.ground !== undefined ? o.ground : this.ground;
    const useAo = ground !== null && !(o && o.ao === false);
    if (useAo || tl !== 1) {
      const pa = g.attributes.position.array, ca = col.array, aoH = this.aoH, aoMin = this.aoMin;
      for (let i = 0; i < n; i++) {
        let k = tl;
        if (useAo) {
          const h = pa[i * 3 + 1] - ground;
          if (h < aoH) {
            let t = h > 0 ? h / aoH : 0;
            t = t * t * (3 - 2 * t);
            k *= Math.pow(aoMin + (1 - aoMin) * t, 2.2);
          }
        }
        if (k !== 1) {
          ca[i * 3] *= k;
          ca[i * 3 + 1] *= k;
          ca[i * 3 + 2] *= k;
        }
      }
    }
    push(this.map, matKey, g);
  }
  build(group, mats, outlineKeys) {
    for (const [key, r] of this.raws) {
      const g = r.geometry();
      if (g) push(this.map, key, g);
    }
    this.raws.clear();
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

// ワールドの大きさで uv を貼る（三角ごとに一番近い向きの面に投影。円柱は巻きつける）
function worldUV(g, um, o) {
  const pa = g.attributes.position.array;
  const n = pa.length / 3;
  const uv = new Float32Array(n * 2);
  const s = um.s || 4;
  const mode = um.mode || 'box';
  const cx = o && o.cx !== undefined ? o.cx : 0, cz = o && o.cz !== undefined ? o.cz : 0, cr = o && o.r ? o.r : 1;
  // 円柱は1周がちょうど何枚かになるように
  const su = mode === 'cyl' ? (TAU * cr) / Math.max(1, Math.round((TAU * cr) / s)) : s;
  const ang = [0, 0, 0];
  for (let t = 0; t + 2 < n; t += 3) {
    const a = t * 3, b = a + 3, c = a + 6;
    const e1x = pa[c] - pa[b], e1y = pa[c + 1] - pa[b + 1], e1z = pa[c + 2] - pa[b + 2];
    const e2x = pa[a] - pa[b], e2y = pa[a + 1] - pa[b + 1], e2z = pa[a + 2] - pa[b + 2];
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    const L = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    if (mode === 'cyl' && ay < 0.7 * L) {
      for (let k = 0; k < 3; k++) ang[k] = Math.atan2(pa[a + k * 3 + 2] - cz, pa[a + k * 3] - cx);
      if (Math.max(ang[0], ang[1], ang[2]) - Math.min(ang[0], ang[1], ang[2]) > Math.PI) for (let k = 0; k < 3; k++) if (ang[k] < 0) ang[k] += TAU;
      for (let k = 0; k < 3; k++) {
        uv[(t + k) * 2] = (ang[k] * cr) / su;
        uv[(t + k) * 2 + 1] = pa[a + k * 3 + 1] / s;
      }
    } else {
      // 上下の面は (x, z)、x 向きの面は (z, y)、z 向きの面は (x, y)
      const iu = ay >= ax && ay >= az ? 0 : ax >= az ? 2 : 0;
      const iv = ay >= ax && ay >= az ? 2 : 1;
      for (let k = 0; k < 3; k++) {
        uv[(t + k) * 2] = pa[a + k * 3 + iu] / s;
        uv[(t + k) * 2 + 1] = pa[a + k * 3 + iv] / s;
      }
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
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

// 高い物は縦に区切る（足もとのかげが下のほうだけにつくように）
const hseg = (h) => Math.max(1, Math.min(4, Math.ceil(h / 2.5)));
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d, 1, hseg(h), 1);
const cyl = (rt, rb, h, rs = 12, open = false) => new THREE.CylinderGeometry(rt, rb, h, rs, hseg(h), open);
// 両はしが反った横木（鳥居の笠木）
function bentBeam(len, h, d, lift) {
  const g = new THREE.BoxGeometry(len, h, d, 14, 1, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = Math.abs(p.getX(i)) / (len / 2);
    p.setY(i, p.getY(i) * (1 + t * t * 0.25) + lift * (0.35 * t * t + 0.65 * t * t * t * t));
  }
  g.computeVertexNormals();
  return g;
}
// 三角の板（妻の壁）
function gable(halfBase, height, thick) {
  const s = new THREE.Shape();
  s.moveTo(-halfBase, 0);
  s.lineTo(halfBase, 0);
  s.lineTo(0, height);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: false });
  g.translate(0, 0, -thick / 2);
  return g;
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
// 光る物（あとで入るブルームで光るように、色を1より明るくする）
const glow = (color, k) =>
  flat('g' + color + '|' + k, () => {
    const m = new THREE.MeshBasicMaterial({ color });
    m.color.multiplyScalar(k);
    return m;
  });
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
  return { group, world, b, batch: new Batch(seed + 7), rnd: mulberry32(seed), islands: [], mapRects: [], decals: [] };
}

// 足もとのかげ（色つき）・地面の花びらのまとまり：[x, y, z, 半径x, 半径z, 向き, 色, こさ]
function decal(c, x, y, z, rx, rz, ry, col, a) {
  c.decals.push([x, y, z, rx, rz, ry, col, a]);
}
function shadowAt(c, x, y, z, rx, rz = rx, a = 0.55, ry = 0) {
  decal(c, x, y + 0.2, z, rx, rz, ry, c.art.shadow, a);
}

// 島（地層のある岩・土・ふちから垂れる草・草むら・花・小石・つる）
function islandMaker(c) {
  const { batch, world, rnd, islands } = c;
  return function island(x, top, z, R, o = {}) {
    const depth = o.depth || R * 1.15;
    batch.add(ART.islandRock(rnd, x, top, z, R, depth), 'isleRock', null, { uv: 'keep', tint: 1, ao: false });
    batch.add(ART.islandGrass(rnd, x, top, z, R), 'isleGrass', null, { uv: 'keep', tint: 1, ao: false });
    // 当たり
    world.add({ t: 'cyl', x, z, r: R * 1.0, y0: top - 2.4, y1: top + 0.1, kind: 'island' });
    world.add({ t: 'cyl', x, z, r: R * 0.7, y0: top - 2.4 - depth * 0.45, y1: top - 2.4, kind: 'rock' });
    world.add({ t: 'cyl', x, z, r: R * 0.36, y0: top - 2.4 - depth * 0.85, y1: top - 2.4 - depth * 0.45, kind: 'rock' });
    decorateIsland(c, x, top, z, R, o);
    islands.push({ x, top, z, R });
    return { x, top, z, R };
  };
}

const WHITE3 = [1, 1, 1];
function decorateIsland(c, x, top, z, R, o) {
  const { batch, rnd, art } = c;
  const A = art.deco;
  const veg = batch.raw('veg');
  const y = top + 0.12;
  const at = (a, r) => [x + Math.cos(a) * r, z + Math.sin(a) * r];
  const free = (px, pz) => !(o.clear && o.clear.some(([cx, cz, cr]) => (px - cx) ** 2 + (pz - cz) ** 2 < cr * cr));
  // 草の束（ふちに多く）
  const nEdge = Math.round(R * 2.0), nIn = Math.round(R * 0.7);
  for (let i = 0; i < nEdge + nIn; i++) {
    const a = rnd() * TAU;
    const r = i < nEdge ? R * (0.84 + rnd() * 0.15) : Math.sqrt(rnd()) * R * 0.82;
    const [px, pz] = at(a, r);
    if (!free(px, pz)) continue;
    ART.tuftInto(batch.raw('tuft'), rnd, px, y, pz, 0.7 + rnd() * 0.6, A.tuftBase, A.tuftTip);
  }
  // やぶ（ふち）
  const nBush = Math.max(2, Math.round(R * 0.26));
  for (let i = 0; i < nBush; i++) {
    const a = rnd() * TAU;
    const [px, pz] = at(a, R * (0.8 + rnd() * 0.12));
    if (!free(px, pz)) continue;
    const k = 1 + Math.floor(rnd() * 3);
    for (let j = 0; j < k; j++) {
      const rr = 0.55 + rnd() * 0.5;
      const ox = (rnd() - 0.5) * 1.6, oz = (rnd() - 0.5) * 1.6;
      veg.put(ART.unit('ico', 1), mat(px + ox, y + rr * 0.35, pz + oz, 0, rnd() * TAU, 0, rr, rr * 0.78, rr), ART.gradY(y, y + rr * 1.3, A.bushLo, null, A.bushHi));
    }
  }
  // 花（小さなまとまり）
  const nFl = Math.round(R * 0.55);
  for (let i = 0; i < nFl; i++) {
    const a = rnd() * TAU;
    const [px, pz] = at(a, R * (0.25 + rnd() * 0.68));
    if (!free(px, pz)) continue;
    const colr = A.flowers[Math.floor(rnd() * A.flowers.length)];
    const k = 3 + Math.floor(rnd() * 4);
    for (let j = 0; j < k; j++) {
      const fr = 0.17 + rnd() * 0.08;
      veg.put(ART.unit('oct'), mat(px + (rnd() - 0.5) * 1.4, y + 0.25 + rnd() * 0.25, pz + (rnd() - 0.5) * 1.4, 0, 0, 0, fr, fr, fr), colr);
    }
  }
  // 小石
  const nPeb = Math.round(R * 0.3);
  for (let i = 0; i < nPeb; i++) {
    const a = rnd() * TAU;
    const [px, pz] = at(a, R * (0.6 + rnd() * 0.33));
    if (!free(px, pz)) continue;
    const s = 0.35 + rnd() * 0.6;
    batch.raw('isleRock').put(ART.unit('dod'), mat(px, y + s * 0.15, pz, rnd(), rnd() * TAU, rnd(), s, s * 0.6, s), WHITE3, 100, 30);
  }
  // たれ下がるつる・根っこ
  const nVine = Math.max(2, Math.round(R * 0.34));
  for (let i = 0; i < nVine; i++) {
    const a = rnd() * TAU;
    const ca = Math.cos(a), sa = Math.sin(a);
    const sy = top - 0.35 - rnd() * 0.4;
    const len = 2.2 + rnd() * (1.5 + R * 0.32);
    const { geo, curve } = ART.vineGeo(rnd, x + ca * R * 0.99, sy, z + sa * R * 0.99, ca, sa, len, 0.09 + rnd() * 0.05, A.vineA, A.vineB);
    batch.add(geo, 'veg', null, { uv: 'keep', ao: false });
    // 葉っぱ
    const nl = Math.floor(len / 0.6);
    for (let j = 1; j <= nl; j++) {
      const t = j / nl;
      const q = curve.getPointAt(Math.min(1, t));
      const lr = 0.2 + rnd() * 0.12 + (1 - t) * 0.08;
      const lm = mat(q.x + (rnd() - 0.5) * 0.3, q.y, q.z + (rnd() - 0.5) * 0.3, rnd(), rnd(), rnd(), lr, lr * 0.7, lr * 1.3);
      const bloom = A.blossom && t > 0.65 && rnd() < 0.55;
      veg.put(ART.unit('oct'), lm, bloom ? A.blossom : A.leaves[Math.floor(rnd() * A.leaves.length)]);
    }
  }
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

// 島の上の材質（どちらのステージも同じ形で、色だけちがう）
function commonMats(c, env) {
  const A = c.art;
  const tuft = toon(0xffffff, { vertexColors: true, map: ART.whiteTex() });
  const plaza = toon(0xffffff, { vertexColors: true, map: ART.plazaTex(A.plaza), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  plaza.polygonOffset = true;
  plaza.polygonOffsetFactor = -1;
  plaza.polygonOffsetUnits = -2;
  return {
    isleRock: ART.rockMaterial(env, A.rock),
    isleGrass: ART.grassMaterial(env, A.grass),
    tuft,
    veg: toon(0xffffff, { vertexColors: true, map: ART.whiteTex() }),
    plaza,
  };
}

// まるい石だたみ（島の上にしく）
function plaza(c, x, y, z, r) {
  const g = new THREE.CircleGeometry(r, 64);
  g.rotateX(-Math.PI / 2);
  g.translate(x, y + 0.19, z);
  c.batch.add(g, 'plaza', null, { uv: 'keep', tint: 1, ao: false });
}

// 空・雲海・遠くの雲・場外の目印をつけて、遊びに使う情報とまとめる
function finishStage(scene, c, id, env, extra) {
  const { group, b } = c;
  const sky = makeSky(env);
  group.add(sky);
  const sea = makeCloudSea(env);
  group.add(sea);
  const clouds = makeClouds(c.rnd, env);
  for (const m of clouds.list) group.add(m);
  const far = clouds.far;
  if (c.decals.length) group.add(makeDecals(c.decals));
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

// 足もとのかげなどの丸いしみ（全部まとめて1回で描く）
function makeDecals(list) {
  const n = list.length;
  const pos = new Float32Array(n * 18), uv = new Float32Array(n * 12), col = new Float32Array(n * 24);
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]];
  const cc = new THREE.Color();
  list.forEach(([x, y, z, rx, rz, ry, hex, a], i) => {
    const cs = Math.cos(ry), sn = Math.sin(ry);
    cc.setHex(hex);
    corners.forEach(([u, v], k) => {
      const lx = u * rx, lz = -v * rz;
      const o = i * 6 + k;
      pos.set([x + lx * cs + lz * sn, y, z - lx * sn + lz * cs], o * 3);
      uv.set([(u + 1) / 2, (v + 1) / 2], o * 2);
      col.set([cc.r, cc.g, cc.b, a], o * 4);
    });
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 4));
  const m = new THREE.MeshBasicMaterial({ map: ART.blobTex(), vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  const mesh = new THREE.Mesh(g, m);
  mesh.matrixAutoUpdate = false;
  mesh.renderOrder = 1;
  return mesh;
}

// ======================================================================
// ステージ1「サクラ浮島」（空にうかぶ合格祈願の神社）
// ======================================================================
const C = {
  grass: 0x86d35e,
  grassDark: 0x5fae45,
  rock: 0x9a8676,
  rockDark: 0x76675a,
  stone: 0xd6cfc2,
  stoneDark: 0xaaa293,
  red: 0xe0412b,
  black: 0x2f2d33,
  white: 0xe8e2d6,
  roof: 0x4d6075,
  wood: 0x8b5a2b,
  woodDark: 0x5e3a1f,
  pink: 0xffb6cf,
  pink2: 0xff96bd,
  gold: 0xf0b834,
  rope: 0xe6d394,
};

const lin = (r, g, b) => new THREE.Color().setRGB(r, g, b);
const ENV_SAKURA = {
  fog: [0xcfe7fb, 45, 560],
  hemi: [0xffffff, 0x8fa4d6, 1.55],
  sun: [0xfff1dc, 2.15, [60, 120, -80]],
  // 色は「画面に出る色」（シェーダーの中で linear にする）
  sky: { zen: 0x1d6fe0, up: 0x55a6f4, hor: 0xbfe2fb, horSun: 0xe8f6ff, fog: 0xcfe7fb, sun: [0.45, 0.55, -0.7], sunCol: 0xfffbea, glowCol: 0xfff0c8, glow: 0.38, halo: 0.55, cirrus: 0.42, cirrusCol: 0xf6fbff },
  sea: { lit: 0xe7edf8, shade: 0xbcc8ee, deep: 0xa2b0e0, flat: 0xd9e6f9, sunDir: [0.4, 1.0, -0.6] },
  cloud: { lit: 0xe9eef8, shade: 0xb9c3ec, core: 0x9da8dd, rim: 0xffffff, horizon: 0xcfe7fb },
  light: { lit: [1.0, 0.985, 0.95], shade: [0.71, 0.74, 0.89], rim: [0.55, 0.6, 0.66], bounce: [0.1, 0.12, 0.2] },
};
const ART_SAKURA = {
  rock: { rockA: 0xb39379, rockB: 0x957764, rockC: 0xc9ae8f, crack: 0x5a4136, soil: 0x6e4a30, moss: 0x6ea84f },
  grass: { g1: 0x7fca5a, g2: 0x5ea845, g3: 0xaedd6b, petal: 0xf5b6cc, petal2: 0xf3d9e3, petalAmt: 0.5 },
  plaza: 'sakura',
  shadow: 0x1a2350,
  petalDecal: 0xff9fc0,
  deco: {
    tuftBase: ART.vc(0.24, 0.45, 0.18), tuftTip: ART.vc(0.62, 0.86, 0.38),
    bushLo: ART.vc(0.22, 0.44, 0.2), bushHi: ART.vc(0.46, 0.74, 0.32),
    flowers: [ART.vc(0.93, 0.93, 0.92), ART.vc(0.94, 0.83, 0.38), ART.vc(0.94, 0.62, 0.76), ART.vc(0.72, 0.82, 0.94)],
    vineA: ART.vc(0.2, 0.36, 0.16), vineB: ART.vc(0.3, 0.5, 0.22),
    leaves: [ART.vc(0.3, 0.6, 0.24), ART.vc(0.42, 0.7, 0.28), ART.vc(0.24, 0.5, 0.2)],
    blossom: ART.vc(0.94, 0.68, 0.78),
  },
};

function buildSakura(scene) {
  const c = newStage(20261021);
  c.art = ART_SAKURA;
  const { world, batch, rnd } = c;
  const island = islandMaker(c);

  const T = { stone: ART.stoneTex(), mottle: ART.mottleTex(), tile: ART.tileTex(), wood: ART.woodTex() };
  const tex = { stone: T.stone, stoneDark: T.stone, red: T.mottle, black: T.mottle, white: T.mottle, roof: T.tile, wood: T.wood, woodDark: T.wood };
  const mats = commonMats(c, ENV_SAKURA);
  for (const k of Object.keys(C)) mats[k] = toon(C[k], { vertexColors: true, map: tex[k] || ART.whiteTex() });
  mats.fire = glow(0xff9a3c, 2);
  mats.shoji = toon(0xffffff, { vertexColors: true, map: ART.shojiTex() });
  mats.frieze = toon(0xffffff, { vertexColors: true, map: ART.friezeTex() });
  batch.uvs = { stone: { s: 4 }, stoneDark: { s: 4 }, red: { s: 6 }, black: { s: 6 }, white: { s: 7 }, roof: { s: 2.6 }, wood: { s: 2.4 }, woodDark: { s: 2.4 } };

  // ---- 鳥居 ----
  function torii(x, y, z, ry, s = 1, onGround = true) {
    const h = 9 * s, w = 9 * s, pr = 0.55 * s;
    const c0 = Math.cos(ry), sn = Math.sin(ry);
    batch.ground = onGround ? y : null;
    for (const side of [-1, 1]) {
      const px = x + side * (w / 2) * c0, pz = z - side * (w / 2) * sn;
      batch.add(cyl(pr, pr * 1.12, h, 14), 'red', mat(px, y + h / 2, pz), { uv: { mode: 'cyl', s: 6 }, cx: px, cz: pz, r: pr });
      batch.add(new THREE.CylinderGeometry(pr * 1.35, pr * 1.45, 0.9 * s, 14), 'black', mat(px, y + 0.45 * s, pz));
      world.add({ t: 'cyl', x: px, z: pz, r: pr + 0.05, y0: y, y1: y + h, kind: 'torii' });
      if (onGround) shadowAt(c, px, y, pz, 1.7 * s, 1.7 * s, 0.5);
    }
    batch.ground = null;
    // 笠木（いちばん上。両はしが反る）と島木・貫・額
    batch.add(bentBeam(w + 4 * s, 0.9 * s, 1.5 * s, 0.6 * s), 'black', mat(x, y + h + 0.75 * s, z, 0, ry, 0));
    batch.add(bentBeam(w + 3 * s, 0.8 * s, 1.2 * s, 0.32 * s), 'red', mat(x, y + h - 0.1 * s, z, 0, ry, 0));
    batch.add(new THREE.BoxGeometry(w + 1.2 * s, 0.6 * s, 0.7 * s), 'red', mat(x, y + h * 0.72, z, 0, ry, 0));
    batch.add(new THREE.BoxGeometry(1.2 * s, 1.6 * s, 0.4 * s), 'black', mat(x, y + h * 0.86, z, 0, ry, 0));
    for (const f of [-1, 1]) batch.add(new THREE.BoxGeometry(0.95 * s, 1.3 * s, 0.06), 'gold', mat(x + sn * f * 0.21 * s, y + h * 0.86, z + c0 * f * 0.21 * s, 0, ry, 0));
    world.add({ t: 'box', x, y: y + h + 0.5 * s, z, hx: (w + 4 * s) / 2, hy: 0.9 * s, hz: 0.75 * s, ry, kind: 'torii' });
    world.add({ t: 'box', x, y: y + h * 0.72, z, hx: (w + 1.2 * s) / 2, hy: 0.3 * s, hz: 0.35 * s, ry, kind: 'torii' });
  }

  // ---- サクラの木（花のかたまりを重ねる。下は濃い色、上は明るい色）----
  const pinkLo = ART.vc(0.84, 0.48, 0.64), pinkMid = ART.vc(0.93, 0.64, 0.75), pinkHi = ART.vc(0.94, 0.81, 0.87);
  function sakuraTree(x, y, z, s = 1) {
    const h = 5.5 * s;
    batch.ground = y;
    const tx = (rnd() - 0.5) * 0.15, tz = (rnd() - 0.5) * 0.15;
    batch.add(cyl(0.35 * s, 0.62 * s, h, 9), 'woodDark', mat(x, y + h / 2, z, tx, 0, tz), { uv: { mode: 'cyl', s: 2.4 }, cx: x, cz: z, r: 0.5 * s });
    // 枝
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU + rnd();
      const bl = 2.2 * s;
      batch.add(new THREE.CylinderGeometry(0.12 * s, 0.22 * s, bl, 6), 'woodDark', mat(x + Math.cos(a) * 0.7 * s, y + h * 0.78 + 0.5 * s, z + Math.sin(a) * 0.7 * s, Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9, 1, 1, 1, 'XYZ'), { ao: false });
    }
    batch.ground = null;
    world.add({ t: 'cyl', x, z, r: 0.55 * s, y0: y, y1: y + h, kind: 'tree' });
    // 花のかたまり
    const cy = y + h + 1.2 * s;
    const blobs = [[0, 0.9, 0, 2.3]];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + rnd() * 0.5;
      blobs.push([Math.cos(a) * 1.75, (rnd() - 0.3) * 0.9, Math.sin(a) * 1.75, 1.45 + rnd() * 0.5]);
    }
    for (let i = 0; i < 3; i++) {
      const a = rnd() * TAU;
      blobs.push([Math.cos(a) * 0.9, 1.9 + rnd() * 0.5, Math.sin(a) * 0.9, 1.2 + rnd() * 0.35]);
    }
    for (let i = 0; i < 4; i++) {
      const a = rnd() * TAU;
      blobs.push([Math.cos(a) * 2.2, -0.9 - rnd() * 0.4, Math.sin(a) * 2.2, 0.85 + rnd() * 0.35]);
    }
    const grad = ART.gradY(cy - 1.8 * s, cy + 2.8 * s, pinkLo, pinkMid, pinkHi);
    for (const [bx, by, bz, br] of blobs) batch.raw('veg').put(ART.unit('ico', 1), mat(x + bx * s, cy + by * s, z + bz * s, rnd(), rnd(), 0, br * s, br * s * 0.9, br * s), grad);
    world.add({ t: 'sph', x, y: y + h + 1.2 * s, z, r: 3.1 * s, kind: 'tree' });
    shadowAt(c, x, y, z, 3.6 * s, 3.6 * s, 0.5);
    decal(c, x + 0.6, y + 0.21, z - 0.4, 5.2 * s, 4.6 * s, rnd() * 3, ART_SAKURA.petalDecal, 0.42);
  }

  // ---- 灯籠（六角。火袋が光る）----
  function lantern(x, y, z) {
    batch.ground = y;
    batch.add(new THREE.CylinderGeometry(0.6, 0.72, 0.4, 6), 'stoneDark', mat(x, y + 0.2, z));
    batch.add(new THREE.CylinderGeometry(0.22, 0.27, 1.3, 6), 'stone', mat(x, y + 1.05, z));
    batch.ground = null;
    batch.add(new THREE.CylinderGeometry(0.62, 0.42, 0.3, 6), 'stone', mat(x, y + 1.85, z));
    for (const [dx, dz] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) batch.add(new THREE.BoxGeometry(0.14, 0.72, 0.14), 'stone', mat(x + dx, y + 2.36, z + dz));
    batch.add(new THREE.BoxGeometry(0.48, 0.5, 0.48), 'fire', mat(x, y + 2.36, z));
    batch.add(new THREE.CylinderGeometry(0.32, 0.98, 0.6, 6), 'stoneDark', mat(x, y + 3.02, z));
    batch.add(new THREE.SphereGeometry(0.2, 8, 6), 'stone', mat(x, y + 3.42, z));
    world.add({ t: 'cyl', x, z, r: 0.6, y0: y, y1: y + 3.5, kind: 'deco' });
    shadowAt(c, x, y, z, 1.4, 1.4, 0.55);
  }

  // ---- 本殿（まん中の建物）----
  function shrine(x, y, z, ry) {
    // 石の基壇（ふちどりと前の階段）
    batch.ground = y;
    batch.add(box(22, 2, 16), 'stone', mat(x, y + 1, z, 0, ry, 0));
    batch.ground = null;
    batch.add(new THREE.BoxGeometry(22.5, 0.35, 16.5), 'stoneDark', mat(x, y + 2.0, z, 0, ry, 0));
    world.add({ t: 'box', x, y: y + 1, z, hx: 11, hy: 1, hz: 8, ry, kind: 'shrine' });
    // 柱と壁
    const c0 = Math.cos(ry), s = Math.sin(ry);
    const loc = (lx, lz) => [x + lx * c0 + lz * s, z - lx * s + lz * c0];
    for (let k = 0; k < 3; k++) {
      const [px, pz] = loc(0, 8.5 + k * 0.6);
      batch.add(new THREE.BoxGeometry(7 - k * 0.6, 1.6 - k * 0.5, 0.65), 'stone', mat(px, y + (1.6 - k * 0.5) / 2, pz, 0, ry, 0), { ground: y });
    }
    batch.add(new THREE.BoxGeometry(16, 7, 10), 'white', mat(x, y + 5.5, z, 0, ry, 0));
    // 木の横木（土台・長押・上）
    for (const [yy, hh] of [[2.35, 0.5], [5.4, 0.38], [8.45, 0.42]]) batch.add(new THREE.BoxGeometry(16.3, hh, 10.3), 'woodDark', mat(x, y + yy, z, 0, ry, 0));
    // 正面の障子
    for (const lx of [-5.35, 0, 5.35]) {
      const [px, pz] = loc(lx, 5.17);
      batch.add(new THREE.PlaneGeometry(4.2, 2.6), 'shoji', mat(px, y + 3.95, pz, 0, ry, 0), { uv: 'keep', uvScale: [1, 1] });
      const [qx, qz] = loc(lx, 5.17);
      batch.add(new THREE.PlaneGeometry(4.2, 2.6), 'shoji', mat(qx, y + 6.95, qz, 0, ry, 0), { uv: 'keep' });
    }
    for (const lx of [-8, -2.7, 2.7, 8])
      for (const lz of [-5, 5]) {
        const [px, pz] = loc(lx, lz);
        batch.add(new THREE.CylinderGeometry(0.55, 0.55, 7, 10), 'red', mat(px, y + 5.5, pz), { uv: { mode: 'cyl', s: 6 }, cx: px, cz: pz, r: 0.55 });
        batch.add(new THREE.CylinderGeometry(0.66, 0.7, 0.4, 10), 'black', mat(px, y + 2.2, pz));
      }
    batch.add(new THREE.BoxGeometry(17, 0.8, 11), 'red', mat(x, y + 9.2, z, 0, ry, 0));
    // 妻（屋根の下の三角の壁）
    for (const side of [-1, 1]) {
      const [px, pz] = loc(side * 8.05, 0);
      batch.add(gable(5.5, 3.1, 0.3), 'white', mat(px, y + 9.6, pz, 0, ry + Math.PI / 2, 0));
      const [qx, qz] = loc(side * 8.25, 0);
      batch.add(new THREE.BoxGeometry(0.3, 0.35, 10.4), 'woodDark', mat(qx, y + 10.6, qz, 0, ry, 0));
    }
    // 屋根（2枚のななめ板＋棟）
    for (const side of [-1, 1]) {
      const [px, pz] = loc(0, side * 3.4);
      batch.add(new THREE.BoxGeometry(22, 0.9, 9.5), 'roof', mat(px, y + 11.3, pz, side * 0.5, ry, 0));
      // 軒先の金のふち
      const [ex, ez] = loc(0, side * 7.55);
      batch.add(new THREE.BoxGeometry(22.1, 0.22, 0.25), 'gold', mat(ex, y + 8.82, ez, side * 0.5, ry, 0));
    }
    batch.add(new THREE.BoxGeometry(22.5, 1.0, 1.2), 'black', mat(x, y + 13.3, z, 0, ry, 0));
    // 千木（棟の両はしの×）と鰹木（棟の上の丸太）
    for (const side of [-1, 1]) {
      const [px, pz] = loc(side * 10.6, 0);
      for (const t of [-1, 1]) batch.add(new THREE.BoxGeometry(0.32, 3.2, 0.5), 'black', mat(px, y + 14.1, pz, t * 0.55, ry, 0, 1, 1, 1, 'YXZ'));
    }
    for (const lx of [-6, -3, 0, 3, 6]) {
      const [px, pz] = loc(lx, 0);
      batch.add(new THREE.CylinderGeometry(0.34, 0.34, 1.9, 10), 'wood', mat(px, y + 14.05, pz, Math.PI / 2, ry, 0, 1, 1, 1, 'YXZ'));
      for (const t of [-1, 1]) {
        const [qx, qz] = loc(lx, t * 0.97);
        batch.add(new THREE.CylinderGeometry(0.36, 0.36, 0.08, 10), 'gold', mat(qx, y + 14.05, qz, Math.PI / 2, ry, 0, 1, 1, 1, 'YXZ'));
      }
    }
    // しめ縄と紙垂
    const [r0x, r0z] = loc(-4.6, 5.75), [r1x, r1z] = loc(4.6, 5.75), [rmx, rmz] = loc(0, 5.95);
    const rope = new THREE.CatmullRomCurve3([new THREE.Vector3(r0x, y + 7.75, r0z), new THREE.Vector3(rmx, y + 6.8, rmz), new THREE.Vector3(r1x, y + 7.75, r1z)]);
    batch.add(new THREE.TubeGeometry(rope, 16, 0.3, 7, false), 'rope', null, { uv: 'keep' });
    for (const t of [0.25, 0.5, 0.75]) {
      const q = rope.getPointAt(t);
      for (let k = 0; k < 3; k++) batch.add(new THREE.BoxGeometry(0.42, 0.42, 0.04), 'white', mat(q.x + (k % 2 ? 0.12 : -0.12) * c0, q.y - 0.5 - k * 0.38, q.z, 0, ry, 0));
    }
    // 金の飾り
    const [gx, gz] = loc(0, 5.6);
    batch.add(new THREE.SphereGeometry(0.9, 12, 8), 'gold', mat(gx, y + 8.0, gz));
    world.add({ t: 'box', x, y: y + 6, z, hx: 8.4, hy: 4.2, hz: 5.4, ry, kind: 'shrine' });
    world.add({ t: 'box', x, y: y + 11.6, z, hx: 11, hy: 2.1, hz: 6.5, ry, kind: 'shrine' });
    // さいせん箱
    const [sx2, sz2] = loc(0, 7);
    batch.add(new THREE.BoxGeometry(3, 1.4, 1.6), 'wood', mat(sx2, y + 2.7, sz2, 0, ry, 0));
    batch.add(new THREE.BoxGeometry(3.15, 0.18, 1.75), 'gold', mat(sx2, y + 3.45, sz2, 0, ry, 0));
    shadowAt(c, x, y, z, 14, 10.5, 0.45, ry);
  }

  // ---- 石の柱（雲海から生えている。赤い帯の飾りとつる）----
  function pillar(x, z, h, r) {
    batch.add(new THREE.CylinderGeometry(r, r * 1.15, h, 14), 'stone', mat(x, h / 2, z), { uv: { mode: 'cyl', s: 4 }, cx: x, cz: z, r: r * 1.07 });
    for (let y = 8; y < h - 4; y += 9) batch.add(new THREE.CylinderGeometry(r * 1.12, r * 1.14, 0.8, 14), 'stoneDark', mat(x, y, z), { uv: { mode: 'cyl', s: 4 }, cx: x, cz: z, r: r * 1.12 });
    // 赤い帯（青海波）
    batch.add(new THREE.CylinderGeometry(r * 1.06, r * 1.06, 1.8, 20, 1, true), 'frieze', mat(x, h - 2.4, z), { uv: 'keep', uvScale: [Math.max(2, Math.round((TAU * r * 1.06) / 7.2)), 1] });
    batch.add(new THREE.CylinderGeometry(r * 1.4, r * 1.2, 1.4, 14), 'stoneDark', mat(x, h + 0.7, z), { uv: { mode: 'cyl', s: 4 }, cx: x, cz: z, r: r * 1.3 });
    batch.add(new THREE.CylinderGeometry(r * 1.25, r * 1.4, 0.4, 14), 'stone', mat(x, h + 1.6, z));
    world.add({ t: 'cyl', x, z, r: r * 1.1, y0: 0, y1: h + 1.4, kind: 'pillar' });
    // てっぺんから垂れるつる
    const A = ART_SAKURA.deco;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + rnd() * 0.8;
      const ca = Math.cos(a), sa = Math.sin(a);
      const len = 3 + rnd() * 7;
      const { geo, curve } = ART.vineGeo(rnd, x + ca * r * 1.38, h + 0.2, z + sa * r * 1.38, ca * 0.5, sa * 0.5, len, 0.1, A.vineA, A.vineB);
      batch.add(geo, 'veg', null, { uv: 'keep', ao: false });
      const nl = Math.floor(len / 0.8);
      for (let j = 1; j <= nl; j++) {
        const q = curve.getPointAt(j / nl);
        const lr = 0.24 + rnd() * 0.12;
        batch.raw('veg').put(ART.unit('oct'), mat(q.x, q.y, q.z, rnd(), rnd(), rnd(), lr, lr * 0.7, lr * 1.3), A.leaves[Math.floor(rnd() * A.leaves.length)]);
      }
    }
  }

  // ===== 配置（z の正負で左右対称）=====
  // まん中の島と本殿
  island(0, 22, 0, 24, { depth: 26, clear: [[0, 0, 13.5], [0, 17, 4], [0, -17, 4]] });
  plaza(c, 0, 22, 0, 15.5);
  for (const sz of [-1, 1]) batch.add(new THREE.BoxGeometry(5.6, 0.12, 7), 'stone', mat(0, 22.2, sz * 18.4), { ao: false });
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
    torii(-60 * sgn, 40, 10 * sgn, Math.PI / 2, 1.0, false);
    // 柱
    pillar(88 * sgn, -70 * sgn, 52, 3.2);
    pillar(-22 * sgn, -44 * sgn, 30, 2.4);
    pillar(64 * sgn, 70 * sgn, 40, 2.8);
    // 陣地の島（ダルマが乗る）
    island(0, 26, -BASE_Z * sgn, 19, { depth: 24, clear: [[0, -(BASE_Z + 6) * sgn, 6.5]] });
    plaza(c, 0, 26, -(BASE_Z + 6) * sgn, 6.2);
    shadowAt(c, 0, 26, -(BASE_Z + 6) * sgn, 4.2, 4.2, 0.4);
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
  cream: 0xe6dac0,
  creamDark: 0xd6c19b,
  pave: 0xe6d6b8,
  copper: 0x5fb39f,
  iron: 0x3a3b44,
  wood: 0x8b5a2b,
  ginkgo: 0xffd23c,
  ginkgo2: 0xf2b21a,
  board: 0x2e5b47,
  gold: 0xf0b834,
  glass: 0x41618a,
};

// 夕焼け。空の色は「画面に出る色」で書く
const ENV_CAMPUS = {
  fog: [0xf0b08f, 50, 600],
  hemi: [0xffe0c8, 0x6f60a8, 1.5],
  sun: [0xffb27a, 2.3, [-110, 95, -40]],
  sky: { zen: 0x2b2f72, up: 0x8c5aa8, hor: 0xee9a86, horSun: 0xffc27a, fog: 0xf0b08f, sun: [-0.93, 0.1, -0.35], sunCol: 0xfff4c8, glowCol: 0xffae5a, glow: 0.58, halo: 0.7, cirrus: 0.38, cirrusCol: 0xffc9ae },
  sea: { lit: 0xffdcc0, shade: 0xd6a3b8, deep: 0xb184ae, flat: 0xf1c0a6, sunDir: [-0.75, 1.1, -0.3] },
  cloud: { lit: 0xffdcb8, shade: 0xc596bd, core: 0x9a7cb2, rim: 0xfff0c0, horizon: 0xf0b08f, sunDir: [-0.93, 0.18, -0.35] },
  light: { lit: [1.0, 0.93, 0.84], shade: [0.72, 0.61, 0.78], rim: [0.62, 0.46, 0.3], bounce: [0.2, 0.12, 0.1] },
};
const ART_CAMPUS = {
  rock: { rockA: 0xb68d72, rockB: 0x96705d, rockC: 0xcaa083, crack: 0x5a3c36, soil: 0x6c4535, moss: 0x8ea94f },
  grass: { g1: 0x9ccc5e, g2: 0x7caa4a, g3: 0xc8d86c, petal: 0xf2c438, petal2: 0xe89e1c, petalAmt: 0.42 },
  plaza: 'campus',
  shadow: 0x3a1f52,
  petalDecal: 0xf6be2a,
  deco: {
    tuftBase: ART.vc(0.34, 0.46, 0.18), tuftTip: ART.vc(0.76, 0.84, 0.42),
    bushLo: ART.vc(0.3, 0.42, 0.18), bushHi: ART.vc(0.58, 0.72, 0.3),
    flowers: [ART.vc(0.93, 0.93, 0.92), ART.vc(0.94, 0.78, 0.24), ART.vc(0.94, 0.52, 0.36), ART.vc(0.82, 0.68, 0.94)],
    vineA: ART.vc(0.24, 0.34, 0.16), vineB: ART.vc(0.36, 0.5, 0.22),
    leaves: [ART.vc(0.36, 0.54, 0.21), ART.vc(0.48, 0.64, 0.27), ART.vc(0.8, 0.64, 0.22)],
    blossom: null,
  },
};

function buildCampus(scene) {
  const c = newStage(20261022);
  c.art = ART_CAMPUS;
  const { world, batch, rnd, group } = c;
  const island = islandMaker(c);

  const T = { stone: ART.stoneTex(), mottle: ART.mottleTex(), tile: ART.tileTex(), wood: ART.woodTex(), brick: ART.brickTex() };
  const tex = { brick: T.brick, brickDark: T.brick, cream: T.mottle, creamDark: T.stone, pave: T.stone, copper: T.tile, wood: T.wood, board: T.mottle, iron: T.mottle };
  const mats = commonMats(c, ENV_CAMPUS);
  for (const k of Object.keys(CAMPUS)) mats[k] = toon(CAMPUS[k], { vertexColors: true, map: tex[k] || ART.whiteTex() });
  batch.uvs = { brick: { s: 3.2 }, brickDark: { s: 3.2 }, cream: { s: 6 }, creamDark: { s: 4 }, pave: { s: 3 }, copper: { s: 2.6 }, wood: { s: 2.4 }, board: { s: 6 }, iron: { s: 6 } };
  mats.win = glow(0xffb347, 1.5);
  mats.lamp = glow(0xffd88a, 2);
  mats.clock = texMat('clock', clockTex);
  mats.boardFace = texMat('board', boardTex);
  mats.banner = texMat('banner', bannerTex);
  mats.plate = texMat('plate', plateTex);
  const glows = []; // 街灯の光
  const bigGlows = []; // 大きな街灯の光

  // ---- イチョウの木（とがった黄色い木。下はオレンジ、上は明るい黄色）----
  const gLo = ART.vc(0.84, 0.5, 0.12), gMid = ART.vc(0.94, 0.73, 0.19), gHi = ART.vc(0.95, 0.87, 0.42);
  function ginkgo(x, y, z, s = 1) {
    const h = 4.2 * s;
    batch.add(cyl(0.3 * s, 0.55 * s, h + 3 * s, 8), 'wood', mat(x, y + (h + 3 * s) / 2, z), { ground: y, uv: { mode: 'cyl', s: 2.4 }, cx: x, cz: z, r: 0.45 * s });
    world.add({ t: 'cyl', x, z, r: 0.5 * s, y0: y, y1: y + h, kind: 'tree' });
    const layers = [[2.9, 0, 5, 1.6], [2.3, 2.3, 4, 1.25], [1.6, 4.3, 3, 0.7]];
    const grad = ART.gradY(y + h - 2.6 * s, y + h + 5.6 * s, gLo, gMid, gHi);
    const veg = batch.raw('veg'), ico = ART.unit('ico', 1);
    for (const [r, dy, n, ring] of layers) {
      const k0 = r * s * 0.82;
      veg.put(ico, mat(x, y + h + dy * s, z, rnd(), rnd(), 0, k0, k0 * 1.15, k0), grad);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + rnd() * 0.6;
        const k1 = r * s * (0.48 + rnd() * 0.12);
        veg.put(ico, mat(x + Math.cos(a) * ring * s, y + h + (dy - 0.3 + rnd() * 0.5) * s, z + Math.sin(a) * ring * s, rnd(), rnd(), 0, k1, k1 * 1.1, k1), grad);
      }
    }
    world.add({ t: 'sph', x, y: y + h + 0.2 * s, z, r: 2.9 * s, kind: 'tree' });
    world.add({ t: 'sph', x, y: y + h + 3.0 * s, z, r: 2.2 * s, kind: 'tree' });
    shadowAt(c, x, y, z, 3.3 * s, 3.3 * s, 0.5);
    decal(c, x - 0.5, y + 0.21, z + 0.5, 4.6 * s, 4.0 * s, rnd() * 3, ART_CAMPUS.petalDecal, 0.5);
  }

  // ---- 街灯 ----
  function lamp(x, y, z, s = 1) {
    batch.add(new THREE.CylinderGeometry(0.42 * s, 0.5 * s, 0.4 * s, 8), 'iron', mat(x, y + 0.2 * s, z), { ground: y });
    batch.add(new THREE.CylinderGeometry(0.15 * s, 0.22 * s, 5.2 * s, 8), 'iron', mat(x, y + 2.6 * s, z));
    batch.add(new THREE.CylinderGeometry(0.3 * s, 0.24 * s, 0.25 * s, 8), 'gold', mat(x, y + 5.15 * s, z));
    batch.add(new THREE.SphereGeometry(0.55 * s, 12, 8), 'lamp', mat(x, y + 5.7 * s, z));
    batch.add(new THREE.ConeGeometry(0.62 * s, 0.5 * s, 8), 'iron', mat(x, y + 6.35 * s, z));
    world.add({ t: 'cyl', x, z, r: 0.45 * s, y0: y, y1: y + 6.6 * s, kind: 'deco' });
    glows.push([x, y + 5.7 * s, z]);
    shadowAt(c, x, y, z, 1.2 * s, 1.2 * s, 0.5);
  }

  // ---- れんがのアーチ門（くぐれる）----
  function archGate(x, y, z, ry, s = 1, onGround = true) {
    const w = 11 * s, h = 9 * s, pw = 2 * s, R = w / 2;
    const cs = Math.cos(ry), sn = Math.sin(ry);
    const at = (d) => [x + d * cs, z - d * sn]; // 門の横方向に d ずらした場所
    for (const side of [-1, 1]) {
      const [px, pz] = at(side * R);
      batch.add(box(pw, h, pw * 1.1), 'brick', mat(px, y + h / 2, pz, 0, ry, 0), { ground: onGround ? y : null });
      batch.add(new THREE.BoxGeometry(pw * 1.3, 0.7 * s, pw * 1.4), 'cream', mat(px, y + 0.35 * s, pz, 0, ry, 0), { ground: onGround ? y : null });
      batch.add(new THREE.BoxGeometry(pw * 1.25, 0.6 * s, pw * 1.35), 'cream', mat(px, y + h, pz, 0, ry, 0));
      world.add({ t: 'box', x: px, y: y + (h + 2.4 * s) / 2, z: pz, hx: pw / 2 + 0.05, hy: (h + 2.4 * s) / 2, hz: pw * 0.55 + 0.05, ry, kind: 'gate' });
      // 肩（アーチの両はし）
      const [qx, qz] = at(side * 4.75 * s);
      world.add({ t: 'box', x: qx, y: y + h + 3.7 * s, z: qz, hx: 1.65 * s, hy: 1.3 * s, hz: 0.95 * s, ry, kind: 'gate' });
      if (onGround) shadowAt(c, px, y, pz, 2.2 * s, 2.2 * s, 0.5);
    }
    // 半円のアーチ（てっぺんにかなめ石）
    batch.add(new THREE.TorusGeometry(R, 0.85 * s, 8, 20, Math.PI), 'brick', mat(x, y + h, z, 0, ry, 0));
    batch.add(new THREE.TorusGeometry(R + 0.86 * s, 0.14 * s, 5, 20, Math.PI), 'cream', mat(x, y + h, z, 0, ry, 0));
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
      batch.add(box(pw, h, pw), 'brick', mat(px, y + h / 2, pz, 0, ry, 0), { ground: y });
      batch.add(new THREE.BoxGeometry(pw * 1.25, 0.6 * s, pw * 1.25), 'cream', mat(px, y + h + 0.3 * s, pz, 0, ry, 0));
      batch.add(new THREE.BoxGeometry(pw * 1.2, 0.5 * s, pw * 1.2), 'cream', mat(px, y + 0.25 * s, pz, 0, ry, 0), { ground: y });
      batch.add(new THREE.SphereGeometry(0.55 * s, 10, 8), 'lamp', mat(px, y + h + 1.15 * s, pz));
      glows.push([px, y + h + 1.15 * s, pz]);
      world.add({ t: 'box', x: px, y: y + (h + 1.7 * s) / 2, z: pz, hx: pw / 2 + 0.05, hy: (h + 1.7 * s) / 2, hz: pw / 2 + 0.05, ry, kind: 'gate' });
      shadowAt(c, px, y, pz, 2.4 * s, 2.4 * s, 0.5);
    }
    // 鉄のアーチと名札
    batch.add(new THREE.BoxGeometry(w - pw, 0.35 * s, 0.35 * s), 'iron', mat(x, y + h - 0.6 * s, z, 0, ry, 0));
    batch.add(new THREE.TorusGeometry(aR, 0.16 * s, 6, 28, Math.PI), 'iron', mat(x, y + h - 0.6 * s, z, 0, ry, 0, 1, flatK, 1));
    batch.add(new THREE.BoxGeometry(4.6 * s, 1.2 * s, 0.3 * s), 'cream', mat(x, y + h + 0.9 * s, z, 0, ry, 0));
    for (const face of [0, Math.PI]) {
      const fy = ry + face;
      batch.add(new THREE.PlaneGeometry(4.3 * s, 1.0 * s), 'plate', mat(x + Math.sin(fy) * 0.2 * s, y + h + 0.9 * s, z + Math.cos(fy) * 0.2 * s, 0, fy, 0), { uv: 'keep' });
    }
    world.add({ t: 'box', x, y: y + h + 0.3 * s, z, hx: w / 2, hy: 1.05 * s, hz: 0.3 * s, ry, kind: 'gate' });
  }

  // 窓（わく・まど台つき）。fx,fz＝面の外向き、yaw＝向き
  function windowAt(px, py, pz, yaw, w, h, lit) {
    const sx = Math.sin(yaw), sz = Math.cos(yaw);
    batch.add(new THREE.BoxGeometry(w + 0.36, h + 0.36, 0.14), 'cream', mat(px - sx * 0.03, py, pz - sz * 0.03, 0, yaw, 0));
    batch.add(new THREE.BoxGeometry(w, h, 0.2), lit ? 'win' : 'glass', mat(px + sx * 0.03, py, pz + sz * 0.03, 0, yaw, 0), { uv: 'keep' });
    batch.add(new THREE.BoxGeometry(w * 0.08, h, 0.24), 'cream', mat(px + sx * 0.05, py, pz + sz * 0.05, 0, yaw, 0));
    batch.add(new THREE.BoxGeometry(w + 0.6, 0.18, 0.4), 'creamDark', mat(px + sx * 0.12, py - h / 2 - 0.12, pz + sz * 0.12, 0, yaw, 0));
  }

  // ---- 時計台（まん中）----
  function clockTower(x, y, z) {
    // 土台
    batch.add(new THREE.BoxGeometry(13, 1.2, 13), 'creamDark', mat(x, y + 0.6, z), { ground: y });
    world.add({ t: 'box', x, y: y + 0.6, z, hx: 6.5, hy: 0.6, hz: 6.5, kind: 'tower' });
    // れんがの塔
    const b0 = y + 1.2;
    batch.add(box(9, 26, 9), 'brick', mat(x, b0 + 13, z), { ground: b0 });
    for (const yy of [8.5, 17.5]) batch.add(new THREE.BoxGeometry(9.5, 0.8, 9.5), 'cream', mat(x, b0 + yy, z));
    // 四すみの柱
    for (const [dx, dz] of [[-4.5, -4.5], [4.5, -4.5], [-4.5, 4.5], [4.5, 4.5]]) batch.add(box(1.2, 26, 1.2), 'brickDark', mat(x + dx, b0 + 13, z + dz), { ground: b0 });
    // 窓と入口（4方向）
    const faces = [[0, 1, 0], [0, -1, Math.PI], [1, 0, Math.PI / 2], [-1, 0, -Math.PI / 2]];
    for (const [fx, fz, fr] of faces) {
      for (const yy of [11.5, 21.5]) windowAt(x + fx * 4.55, b0 + yy, z + fz * 4.55, fr, 1.7, 3.4, rnd() < 0.6);
      batch.add(new THREE.BoxGeometry(3, 4.4, 0.3), 'wood', mat(x + fx * 4.55, b0 + 2.2, z + fz * 4.55, 0, fr, 0), { ground: b0 });
      batch.add(new THREE.BoxGeometry(3.8, 0.5, 0.5), 'cream', mat(x + fx * 4.6, b0 + 4.6, z + fz * 4.6, 0, fr, 0));
      for (const d of [-1, 1]) batch.add(new THREE.BoxGeometry(0.4, 4.4, 0.45), 'cream', mat(x + fx * 4.6 + fz * d * 1.7, b0 + 2.2, z + fz * 4.6 - fx * d * 1.7, 0, fr, 0), { ground: b0 });
    }
    world.add({ t: 'box', x, y: b0 + 13, z, hx: 5.1, hy: 13, hz: 5.1, kind: 'tower' });
    // 時計の部屋
    const cy = b0 + 26;
    batch.add(new THREE.BoxGeometry(10.5, 7, 10.5), 'cream', mat(x, cy + 3.5, z));
    batch.add(new THREE.BoxGeometry(11.3, 0.7, 11.3), 'creamDark', mat(x, cy + 0.35, z));
    batch.add(new THREE.BoxGeometry(11.3, 0.7, 11.3), 'creamDark', mat(x, cy + 7.0, z));
    for (const [dx, dz] of [[-5.25, -5.25], [5.25, -5.25], [-5.25, 5.25], [5.25, 5.25]]) batch.add(new THREE.BoxGeometry(0.9, 6.3, 0.9), 'creamDark', mat(x + dx, cy + 3.5, z + dz));
    for (const [fx, fz, fr] of faces) {
      batch.add(new THREE.CircleGeometry(2.6, 32), 'clock', mat(x + fx * 5.32, cy + 3.6, z + fz * 5.32, 0, fr, 0), { uv: 'keep' });
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
    shadowAt(c, x, y, z, 10.5, 10.5, 0.5);
  }

  // ---- 天文台（ドームの建物）----
  function observatory(x, y, z, yaw) {
    const sx = Math.sin(yaw), sz = Math.cos(yaw);
    batch.add(cyl(4.6, 4.8, 5, 20), 'cream', mat(x, y + 2.5, z), { ground: y, uv: { mode: 'cyl', s: 6 }, cx: x, cz: z, r: 4.7 });
    batch.add(new THREE.CylinderGeometry(4.95, 4.95, 0.6, 20), 'creamDark', mat(x, y + 5.0, z), { uv: { mode: 'cyl', s: 4 }, cx: x, cz: z, r: 4.95 });
    batch.add(new THREE.CylinderGeometry(4.9, 5.0, 0.7, 20), 'creamDark', mat(x, y + 0.35, z), { ground: y, uv: { mode: 'cyl', s: 4 }, cx: x, cz: z, r: 5 });
    batch.add(new THREE.SphereGeometry(4.6, 20, 10, 0, TAU, 0, Math.PI / 2), 'copper', mat(x, y + 5.2, z), { uv: { mode: 'cyl', s: 2.2 }, cx: x, cz: z, r: 4.6 });
    // 望遠鏡のすき間（まん中のほうを向く）
    const k = 4.62 * Math.SQRT1_2;
    batch.add(new THREE.BoxGeometry(1.3, 5.2, 0.3), 'iron', mat(x + sx * k, y + 5.2 + k, z + sz * k, -Math.PI / 4, yaw, 0, 1, 1, 1, 'YXZ'));
    // ドアと窓
    batch.add(new THREE.BoxGeometry(1.7, 2.9, 0.3), 'wood', mat(x + sx * 4.72, y + 1.45, z + sz * 4.72, 0, yaw, 0), { ground: y });
    batch.add(new THREE.BoxGeometry(2.2, 3.3, 0.24), 'creamDark', mat(x + sx * 4.66, y + 1.6, z + sz * 4.66, 0, yaw, 0), { ground: y });
    for (const d of [-1, 1]) {
      const a = yaw + d * 1.1;
      windowAt(x + Math.sin(a) * 4.7, y + 3.0, z + Math.cos(a) * 4.7, a, 1.1, 1.4, true);
    }
    world.add({ t: 'cyl', x, z, r: 4.95, y0: y, y1: y + 5.3, kind: 'bldg' });
    world.add({ t: 'sph', x, y: y + 5.2, z, r: 4.65, kind: 'bldg' });
    shadowAt(c, x, y, z, 6.6, 6.6, 0.5);
  }

  // ---- 渡り廊下（島と島をつなぐ橋）----
  function bridge(x0, x1, y, z) {
    const len = x1 - x0, cx = (x0 + x1) / 2;
    batch.add(new THREE.BoxGeometry(len, 1.1, 5.2), 'pave', mat(cx, y - 0.55, z));
    batch.add(new THREE.BoxGeometry(len, 0.6, 5.7), 'brickDark', mat(cx, y - 1.4, z));
    for (const side of [-1, 1]) {
      batch.add(new THREE.BoxGeometry(len, 0.22, 0.22), 'iron', mat(cx, y + 1.15, z + side * 2.45));
      batch.add(new THREE.BoxGeometry(len, 0.3, 0.42), 'cream', mat(cx, y + 0.1, z + side * 2.45));
      for (let px = x0 + 1.5; px <= x1 - 1.4; px += 2.5) batch.add(new THREE.BoxGeometry(0.16, 1.15, 0.16), 'iron', mat(px, y + 0.58, z + side * 2.45));
    }
    world.add({ t: 'box', x: cx, y: y - 0.85, z, hx: len / 2, hy: 0.85, hz: 2.85, kind: 'bridge' });
    // 橋脚
    const piers = [cx - len * 0.2, cx + len * 0.2];
    const bot = y - 1.7;
    for (const px of piers) {
      batch.add(box(2.6, bot, 2.8), 'brick', mat(px, bot / 2, z));
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
    batch.add(box(W, H, D), 'brick', mat(x, y + H / 2, z), { ground: y });
    batch.add(new THREE.BoxGeometry(W + 0.7, 0.7, D + 0.7), 'pave', mat(x, y + H + 0.1, z));
    batch.add(new THREE.BoxGeometry(W + 0.9, 0.25, D + 0.9), 'cream', mat(x, y + H - 0.32, z));
    batch.add(new THREE.BoxGeometry(W + 0.5, 0.6, D + 0.5), 'creamDark', mat(x, y + 0.3, z), { ground: y });
    for (const yy of [3.75, 7.35]) batch.add(new THREE.BoxGeometry(W + 0.25, 0.35, D + 0.25), 'creamDark', mat(x, y + yy, z));
    for (const side of [-1, 1])
      for (let fl = 0; fl < 3; fl++)
        for (let i = 0; i < 5; i++) windowAt(x + side * (W / 2 + 0.05), y + 1.9 + fl * 3.6, z - 5.4 + i * 2.7, side * Math.PI / 2, 1.5, 2.0, rnd() < 0.55);
    for (const side of [-1, 1])
      for (let fl = 0; fl < 3; fl++)
        for (let i = 0; i < 2; i++) windowAt(x - 1.8 + i * 3.6, y + 1.9 + fl * 3.6, z + side * (D / 2 + 0.05), side > 0 ? 0 : Math.PI, 1.5, 2.0, rnd() < 0.5);
    // 角の柱
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) batch.add(box(0.7, H, 0.7), 'brickDark', mat(x + dx * W / 2, y + H / 2, z + dz * D / 2), { ground: y });
    // 屋上の階段室
    batch.add(new THREE.BoxGeometry(3, 2.4, 3.2), 'creamDark', mat(x, y + H + 1.6, z + sgn * 4));
    batch.add(new THREE.BoxGeometry(3.4, 0.3, 3.6), 'copper', mat(x, y + H + 2.95, z + sgn * 4));
    world.add({ t: 'box', x, y: y + H + 1.6, z: z + sgn * 4, hx: 1.55, hy: 1.2, hz: 1.65, kind: 'bldg' });
    // 懸垂幕「祝 合格」（まん中のほうを向く面）
    batch.add(new THREE.PlaneGeometry(2.2, 8.2), 'banner', mat(x - sgn * (W / 2 + 0.24), y + H / 2 + 0.6, z, 0, -sgn * Math.PI / 2, 0), { uv: 'keep' });
    world.add({ t: 'box', x, y: y + (H + 0.45) / 2, z, hx: W / 2 + 0.35, hy: (H + 0.45) / 2, hz: D / 2 + 0.35, kind: 'bldg' });
    shadowAt(c, x, y, z, 7.5, 10, 0.5);
  }

  // ---- 黒板（浪人たちの決意）----
  function blackboard(x, y, z, ry) {
    const cs = Math.cos(ry), sn = Math.sin(ry);
    for (const side of [-1, 1]) {
      const lx = x + side * 4.2 * cs, lz = z - side * 4.2 * sn;
      batch.add(cyl(0.22, 0.28, 6.0, 8), 'wood', mat(lx, y + 3.0, lz), { ground: y });
      world.add({ t: 'cyl', x: lx, z: lz, r: 0.35, y0: y, y1: y + 6, kind: 'deco' });
      shadowAt(c, lx, y, lz, 1.0, 1.0, 0.5);
    }
    batch.add(new THREE.BoxGeometry(11, 5.8, 0.5), 'wood', mat(x, y + 5.6, z, 0, ry, 0));
    batch.add(new THREE.BoxGeometry(10.2, 5.0, 0.56), 'board', mat(x, y + 5.6, z, 0, ry, 0));
    batch.add(new THREE.PlaneGeometry(10.2, 5.0), 'boardFace', mat(x + sn * 0.34, y + 5.6, z + cs * 0.34, 0, ry, 0), { uv: 'keep' });
    batch.add(new THREE.BoxGeometry(10.4, 0.2, 0.7), 'wood', mat(x + sn * 0.4, y + 3.0, z + cs * 0.4, 0, ry, 0));
    world.add({ t: 'box', x, y: y + 5.6, z, hx: 5.5, hy: 2.9, hz: 0.35, ry, kind: 'deco' });
  }

  // ---- あずまや（下をくぐれる）----
  function gazebo(x, y, z) {
    batch.add(new THREE.CylinderGeometry(5.6, 5.8, 0.5, 8), 'creamDark', mat(x, y + 0.25, z, 0, Math.PI / 8, 0), { ground: y });
    world.add({ t: 'cyl', x, z, r: 5.7, y0: y, y1: y + 0.5, kind: 'deco' });
    for (const [dx, dz] of [[-3.6, -3.6], [3.6, -3.6], [-3.6, 3.6], [3.6, 3.6]]) {
      batch.add(cyl(0.3, 0.34, 5.2, 8), 'cream', mat(x + dx, y + 3.0, z + dz), { ground: y + 0.5 });
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
    shadowAt(c, x, y, z, 6.6, 6.6, 0.42);
  }

  // ---- 雲海から立つ大きな街灯 ----
  function lampPillar(x, z, h, r) {
    batch.add(new THREE.CylinderGeometry(r * 0.55, r * 0.75, h, 12), 'cream', mat(x, h / 2, z), { uv: { mode: 'cyl', s: 4 }, cx: x, cz: z, r: r * 0.65 });
    for (let y = 8; y < h; y += 9) batch.add(new THREE.CylinderGeometry(r * 0.72, r * 0.72, 0.8, 12), 'brickDark', mat(x, y, z), { uv: { mode: 'cyl', s: 3.2 }, cx: x, cz: z, r: r * 0.72 });
    batch.add(new THREE.CylinderGeometry(r * 1.0, r * 0.6, 1.4, 12), 'iron', mat(x, h + 0.7, z));
    batch.add(new THREE.SphereGeometry(r * 0.75, 16, 12), 'lamp', mat(x, h + 1.4 + r * 0.6, z));
    batch.add(new THREE.ConeGeometry(r * 0.85, r * 0.7, 12), 'iron', mat(x, h + 1.4 + r * 1.45, z));
    world.add({ t: 'cyl', x, z, r: r * 0.8, y0: 0, y1: h + 1.4, kind: 'pillar' });
    world.add({ t: 'sph', x, y: h + 1.4 + r * 0.6, z, r: r * 0.8, kind: 'pillar' });
    bigGlows.push([x, h + 1.4 + r * 0.6, z]);
  }

  // ===== 配置（まん中を中心に、くるっと回して同じ形）=====
  island(0, 22, 0, 24, { depth: 26, clear: [[0, 0, 12.5], [0, 17, 3.5], [0, -17, 3.5]] });
  plaza(c, 0, 22, 0, 15);
  clockTower(0, 22, 0);
  archGate(0, 22, 17, 0, 1.0);
  archGate(0, 22, -17, Math.PI, 1.0);
  for (const [lx, lz] of [[-14, 12], [14, 12], [-14, -12], [14, -12]]) lamp(lx, 22, lz);
  ginkgo(-17, 22, 4, 1.0);
  ginkgo(17, 22, -4, 1.0);

  for (const sgn of [-1, 1]) {
    // 中くらいの島：天文台の島と、イチョウの島。その間を渡り廊下がつなぐ
    island(48 * sgn, 34, -36 * sgn, 12, { clear: [[48 * sgn, -36 * sgn, 6]] });
    observatory(48 * sgn, 34, -36 * sgn, Math.atan2(-48 * sgn, 36 * sgn));
    island(-48 * sgn, 34, -36 * sgn, 12);
    ginkgo(-48 * sgn - 4 * sgn, 34, -36 * sgn + 4 * sgn, 0.95);
    ginkgo(-48 * sgn + 4 * sgn, 34, -36 * sgn - 4 * sgn, 0.95);
    lamp(-48 * sgn - 6 * sgn, 34, -36 * sgn - 6 * sgn);
    bridge(-36.5, 36.5, 34.2, -36 * sgn);
    // 高い島のあずまや
    island(0, 47, -58 * sgn, 9, { clear: [[0, -58 * sgn, 6]] });
    gazebo(0, 47, -58 * sgn);
    // 横の島の校舎
    island(76 * sgn, 17, 12 * sgn, 11, { clear: [[76 * sgn, 12 * sgn, 8]] });
    schoolBldg(76 * sgn, 17, 12 * sgn, sgn);
    // 低い島のイチョウ
    island(30 * sgn, 12, -78 * sgn, 9);
    ginkgo(26 * sgn, 12, -81 * sgn, 0.85);
    ginkgo(34 * sgn, 12, -75 * sgn, 0.85);
    // いちばん上の小島の黒板（まん中を向く）
    island(-34 * sgn, 58, 18 * sgn, 7);
    blackboard(-34 * sgn, 58, 18 * sgn, Math.atan2(34 * sgn, -18 * sgn));
    // 浮いているアーチ（くぐれる）
    archGate(-60 * sgn, 40, 10 * sgn, Math.PI / 2, 1.0, false);
    // 大きな街灯
    lampPillar(88 * sgn, -70 * sgn, 52, 3.2);
    lampPillar(-22 * sgn, -44 * sgn, 30, 2.4);
    lampPillar(64 * sgn, 70 * sgn, 40, 2.8);
    // 陣地の島（ダルマが乗る）と校門
    island(0, 26, -BASE_Z * sgn, 19, { depth: 24, clear: [[0, -(BASE_Z + 6) * sgn, 6]] });
    plaza(c, 0, 26, -(BASE_Z + 6) * sgn, 6.2);
    shadowAt(c, 0, 26, -(BASE_Z + 6) * sgn, 4.2, 4.2, 0.4);
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
      // チョークの粉（決まった種の乱数）
      const r = mulberry32(99);
      for (let i = 0; i < 900; i++) {
        ctx.fillStyle = `rgba(255,255,255,${0.02 + r() * 0.05})`;
        ctx.fillRect(r() * w, r() * h, 2 + r() * 6, 1 + r() * 2);
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
function makeSky(env) {
  const geo = new THREE.SphereGeometry(900, 48, 24);
  const mesh = new THREE.Mesh(geo, ART.skyMaterial(env.sky));
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return mesh;
}

function makeCloudSea(env) {
  const geo = new THREE.PlaneGeometry(1800, 1800, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, ART.seaMaterial(env, env.sea));
  mesh.position.y = -0.2;
  return mesh;
}

// 雲：遠くの地平線の雲（霧なし・空になじむ）と、少し近くの雲＋雲海のもこもこ（霧あり）
//  形は毎回同じ（決まった乱数）なので、2回目からは作った形を使い回す（乱数を使うのはこれが最後）
const cloudCache = new Map();
function makeClouds(rnd, env) {
  const o = env.cloud;
  const hit = cloudCache.get(env);
  if (hit) {
    const far = new THREE.Mesh(hit.far, ART.cloudMaterial(env, { ...o, far: true }));
    far.frustumCulled = false;
    const mid = new THREE.Mesh(hit.mid, ART.cloudMaterial(env, { ...o, far: false }));
    mid.matrixAutoUpdate = false;
    return { far, list: [far, mid] };
  }
  const farG = new ART.Raw(131072), midG = new ART.Raw(131072);
  // 遠くの輪
  const nFar = 15;
  for (let i = 0; i < nFar; i++) {
    const a = (i / nFar) * TAU + (rnd() - 0.5) * 0.22;
    const r = 470 + rnd() * 190;
    const size = 24 + rnd() * 30;
    const y = -30 + rnd() * 60 + (rnd() < 0.25 ? 50 + rnd() * 60 : 0);
    ART.cloudInto(farG, rnd, Math.cos(a) * r, y, Math.sin(a) * r, size, { yaw: a + Math.PI / 2 + (rnd() - 0.5) * 0.5, detail: 2, smallDetail: 1, tower: rnd() < 0.4, blend: 0.42, smallR: 0.5, bumps: 2 });
  }
  // 少し近くの雲（場外）
  const nMid = 9;
  for (let i = 0; i < nMid; i++) {
    const a = (i / nMid) * TAU + rnd() * 0.4;
    const r = 210 + rnd() * 110;
    const size = 10 + rnd() * 12;
    const y = -8 + rnd() * 58;
    ART.cloudInto(midG, rnd, Math.cos(a) * r, y, Math.sin(a) * r, size, { yaw: a + Math.PI / 2 + (rnd() - 0.5) * 0.8, detail: 2, smallDetail: 1, tower: rnd() < 0.3, smallR: 0.5, bumps: 2 });
  }
  // 雲海のもこもこ（場外に多く、場内は少し）
  for (let i = 0; i < 26; i++) {
    const a = rnd() * TAU;
    const inside = i < 6;
    const r = inside ? 30 + rnd() * 100 : 150 + rnd() * 380;
    const size = inside ? 5 + rnd() * 6 : 9 + rnd() * 16;
    ART.cloudInto(midG, rnd, Math.cos(a) * r, -size * 0.3, Math.sin(a) * r, size, { flat: 0.42, detail: 1, n: 3 + Math.floor(rnd() * 3), len: 2.4 + rnd(), bumps: 1 });
  }
  const mk = (raw, m) => {
    const g = raw.geometry();
    g.deleteAttribute('color');
    return new THREE.Mesh(g, m);
  };
  const far = mk(farG, ART.cloudMaterial(env, { ...o, far: true }));
  far.frustumCulled = false;
  const mid = mk(midG, ART.cloudMaterial(env, { ...o, far: false }));
  mid.matrixAutoUpdate = false;
  cloudCache.set(env, { far: far.geometry, mid: mid.geometry });
  return { far, list: [far, mid] };
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
