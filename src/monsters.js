// ディスクのモンスター（キックフライトのディスクと同じく、使うとキャラのよこに現れて技を出す）
// すべてこのゲームのオリジナル。丸・円すい・曲がった管・切りぬいた板を組み合わせる。
// ふちが属性の色に光る（呼び出された感じ）
import * as THREE from 'three';
import { toonGradient, addOutline, glowTex, shareMark } from './gfx.js';

// ---- 色（属性ごと） ----
const PAL = {
  fire: { body: 0xd9322b, body2: 0xff7a2e, dark: 0x2a1218, accent: 0xffc23a, glow: 0xff8a1f, eye: 0xffe35a, rim: 0xff6a1a },
  water: { body: 0x2a7ce0, body2: 0x56c6ff, dark: 0x0d1f3f, accent: 0xeaf6ff, glow: 0x3be6ff, eye: 0x9af6ff, rim: 0x3bd8ff },
  wind: { body: 0x26b865, body2: 0x8bf06a, dark: 0x0c2a1d, accent: 0xf2fff4, glow: 0x9dff4a, eye: 0xd8ff7a, rim: 0x7dff5a },
};

// ---- 色の材料 ----
// トゥーン＋ふちの光（見る角度が浅いところほど属性の色に光る）
const matCache = new Map();
function rimMat(color, rim, o = {}) {
  const key = color + '|' + rim + '|' + (o.side || 0) + '|' + (o.opacity || 1);
  let m = matCache.get(key);
  if (m) return m;
  m = new THREE.MeshToonMaterial({ color, gradientMap: toonGradient() });
  if (o.side) m.side = o.side;
  if (o.opacity && o.opacity < 1) {
    m.transparent = true;
    m.opacity = o.opacity;
    m.depthWrite = false;
  }
  const rc = new THREE.Color(rim);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uRim = { value: rc };
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRim;')
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n{ float fr = 1.0 - abs(dot(normalize(vViewPosition), normal)); totalEmissiveRadiance += uRim * pow(fr, 3.0) * 0.9; }'
      );
  };
  m.customProgramCacheKey = () => 'monrim';
  m.userData.shared = true;
  matCache.set(key, m);
  return m;
}
// 光る色（光の当たり方に関係なく明るい）
const basicCache = new Map();
function glow(color, opacity = 1) {
  const key = color + '|' + opacity;
  if (!basicCache.has(key)) {
    const m = new THREE.MeshBasicMaterial({ color });
    if (opacity < 1) {
      m.transparent = true;
      m.opacity = opacity;
      m.depthWrite = false;
      m.blending = THREE.AdditiveBlending;
    }
    basicCache.set(key, shareMark(m));
  }
  return basicCache.get(key);
}
const spriteCache = new Map();
function addGlow(parent, color, size, p, opacity = 0.85) {
  const key = color + '|' + opacity;
  if (!spriteCache.has(key)) spriteCache.set(key, shareMark(new THREE.SpriteMaterial({ map: glowTex(), color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending })));
  const s = new THREE.Sprite(spriteCache.get(key));
  s.scale.set(size, size, 1);
  s.position.set(p[0], p[1], p[2]);
  parent.add(s);
  return s;
}

// ---- 形（同じ形は1回だけ作る）----
const _geoCache = new Map();
function G(key, make) {
  let g = _geoCache.get(key);
  if (!g) {
    g = make();
    g.userData.shared = true;
    _geoCache.set(key, g);
  }
  return g;
}
const SPH = (s = 14) => G('sph' + s, () => new THREE.SphereGeometry(1, s * 2, s));
const CONE = (s = 10) => G('cone' + s, () => new THREE.ConeGeometry(1, 1, s));
const CYL = (s = 12) => G('cyl' + s, () => new THREE.CylinderGeometry(1, 1, 1, s));
const BOX = () => G('box', () => new THREE.BoxGeometry(1, 1, 1));
const HEMI = () => G('hemi', () => new THREE.SphereGeometry(1, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2));
const TOR = (t = 0.12) => G('tor' + t, () => new THREE.TorusGeometry(1, t, 6, 36));
const ICO = () => G('ico1', () => new THREE.IcosahedronGeometry(1, 1));

// 先にいくほど細くなる、曲がった管（首・しっぽ・角・足・触手）
function tube(key, pts, r0, r1, seg = 18, rad = 9) {
  return G('tb_' + key, () => {
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
    const g = new THREE.TubeGeometry(curve, seg, 1, rad, false);
    const pos = g.attributes.position;
    const v = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      const ring = Math.floor(i / (rad + 1));
      const t = ring / seg;
      curve.getPointAt(t, c);
      v.fromBufferAttribute(pos, i).sub(c).multiplyScalar(r0 + (r1 - r0) * t).add(c);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    return g;
  });
}
// 切りぬいた板（つばさ・ひれ・しっぽ）。点は [横, 前] で、板は水平（前＝+Z）
function flat(key, pts, depth = 0.06, bevel = 0.022) {
  return G('fl_' + key, () => {
    const s = new THREE.Shape();
    s.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 4 });
    g.translate(0, 0, -depth / 2);
    g.rotateX(Math.PI / 2); // 形の「前」を +Z に、厚みを上下に
    g.computeVertexNormals();
    return g;
  });
}

// 部品をつくる
function part(parent, geo, material, p = [0, 0, 0], s = [1, 1, 1], r = [0, 0, 0], opts = {}) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(p[0], p[1], p[2]);
  if (typeof s === 'number') m.scale.setScalar(s);
  else m.scale.set(s[0], s[1], s[2]);
  m.rotation.set(r[0], r[1], r[2]);
  if (opts.outline) addOutline(m, 0x0d1019, opts.ow || 0.03);
  if (opts.name) m.name = opts.name;
  parent.add(m);
  return m;
}
function grp(parent, name, p = [0, 0, 0], r = [0, 0, 0], sx = 1) {
  const g = new THREE.Group();
  if (name) g.name = name;
  g.position.set(p[0], p[1], p[2]);
  g.rotation.set(r[0], r[1], r[2]);
  if (sx !== 1) g.scale.set(sx, 1, 1);
  parent.add(g);
  return g;
}
// 左右の組（右は +X、左は鏡にうつす）
function pair(parent, nameL, nameR, p, build) {
  const R = grp(parent, nameR, [p[0], p[1], p[2]]);
  build(R, 1);
  const L = grp(parent, nameL, [-p[0], p[1], p[2]], [0, 0, 0], -1);
  build(L, -1);
  return [L, R];
}

// ===== モンスター図鑑 =====
// mouth：技が出る場所（モンスターの中の位置・大きさをかける前）／scale：大きさ／anim：動きの型
export const MONSTERS = {
  drake: { name: 'ブレイズドレイク', motif: '炎の竜', elem: 'fire', mouth: [0, 0.74, 1.82], scale: 0.86, anim: 'breath' },
  falcon: { name: 'ゲイルファルコン', motif: '風のハヤブサ', elem: 'wind', mouth: [0, 0.1, 1.25], scale: 0.95, anim: 'swing' },
  narwhal: { name: 'ランスナーヴァル', motif: '水のイッカク', elem: 'water', mouth: [0, 0.1, 2.25], scale: 0.78, anim: 'thrust' },
  jelly: { name: 'ヒールジェリー', motif: 'いやしのクラゲ', elem: 'water', mouth: [0, 0, 0], scale: 0.95, anim: 'pulse' },
  owl: { name: 'スリープアウル', motif: '夜のフクロウ', elem: 'wind', mouth: [0, 0.6, 0.55], scale: 0.92, anim: 'spread' },
  lion: { name: 'ブレイブレオ', motif: '炎の獅子', elem: 'fire', mouth: [0, 0.42, 1.5], scale: 0.9, anim: 'roar' },
  cheetah: { name: 'ブリッツチーター', motif: 'いなずまのチーター', elem: 'wind', mouth: [0, 0.28, 1.4], scale: 0.92, anim: 'run' },
  tortoise: { name: 'アイギスタートル', motif: '盾の亀', elem: 'water', mouth: [0, 0.05, 1.3], scale: 0.9, anim: 'guard' },
  beetle: { name: 'ボムビートル', motif: '爆弾カブトムシ', elem: 'fire', mouth: [0, -0.1, 1.0], scale: 0.95, anim: 'plant' },
  octopus: { name: 'グリッドオクトパス', motif: '方眼のタコ', elem: 'water', mouth: [0, 0, 0], scale: 0.9, anim: 'slam' },
  fox: { name: 'フェイズフォックス', motif: '狐火のキツネ', elem: 'wind', mouth: [0, 0.38, 1.3], scale: 0.95, anim: 'dash' },
  firefly: { name: 'ホタルゲート', motif: '門をひらくホタル', elem: 'water', mouth: [0, 0, 0], scale: 1.0, anim: 'gate' },
  boar: { name: 'ロケットボア', motif: 'ロケットのイノシシ', elem: 'fire', mouth: [0, 0.1, 1.25], scale: 0.92, anim: 'run' },
  swallow: { name: 'スカイスワロー', motif: '空のツバメ', elem: 'wind', mouth: [0, 0.1, 0.95], scale: 1.0, anim: 'swoop' },
};

// ---- それぞれの形（体のまん中が原点、前が +Z）----
const BUILD = {
  drake(root, c) {
    const T = (x) => rimMat(x, c.rim);
    const body = grp(root, 'body');
    part(body, SPH(), T(c.body), [0, 0, 0], [0.55, 0.5, 0.9], [0, 0, 0], { outline: true });
    part(body, SPH(), T(c.accent), [0, -0.17, 0.14], [0.42, 0.34, 0.72]);
    for (let i = 0; i < 5; i++) part(body, CONE(4), T(c.dark), [0, 0.48 - i * 0.025, 0.5 - i * 0.3], [0.09, 0.34 - i * 0.04, 0.16], [-0.55, 0, 0]);
    part(body, SPH(8), glow(c.glow), [0, -0.02, 0.8], 0.12);
    addGlow(body, c.glow, 1.1, [0, -0.02, 0.86]);
    part(body, tube('drkNeck', [[0, 0.15, 0.6], [0, 0.45, 0.95], [0, 0.7, 1.15]], 0.25, 0.17), T(c.body), [0, 0, 0], 1, [0, 0, 0], { outline: true });
    const head = grp(root, 'head', [0, 0.78, 1.25]);
    part(head, SPH(), T(c.body), [0, 0, 0], [0.26, 0.22, 0.3], [0, 0, 0], { outline: true });
    part(head, SPH(), T(c.body), [0, -0.04, 0.3], [0.17, 0.13, 0.27], [0, 0, 0], { outline: true });
    for (const sx of [-1, 1]) {
      part(head, BOX(), T(c.dark), [sx * 0.12, 0.12, 0.13], [0.11, 0.045, 0.22], [0.2, sx * 0.35, sx * -0.25]);
      part(head, BOX(), glow(c.eye), [sx * 0.14, 0.065, 0.19], [0.1, 0.035, 0.1], [0, sx * 0.45, sx * -0.2]);
      part(head, tube('drkHorn', [[0, 0, 0], [0, 0.1, -0.18], [0, 0.17, -0.42], [0, 0.13, -0.62]], 0.07, 0.012), T(c.accent), [sx * 0.13, 0.13, -0.04], 1, [0, 0, sx * -0.35], { outline: true });
    }
    const jaw = grp(head, 'jaw', [0, -0.12, 0.04]);
    part(jaw, SPH(), T(0x8a1a1a), [0, 0, 0.22], [0.14, 0.05, 0.28]);
    for (const sx of [-1, 1]) part(jaw, CONE(4), T(0xfff4e0), [sx * 0.08, 0.06, 0.38], [0.025, 0.08, 0.025]);
    addGlow(head, c.glow, 0.5, [0, -0.08, 0.48], 0.7);
    // つばさ（コウモリ型：骨と膜）
    pair(root, 'wingL', 'wingR', [0.38, 0.36, 0.12], (w) => {
      part(w, flat('drkWing', [[0, 0.18], [0.75, 0.5], [1.45, 0.55], [2.15, 0.3], [1.8, 0], [1.95, -0.42], [1.45, -0.38], [1.35, -0.85], [0.85, -0.55], [0.3, -0.5], [0, -0.3]], 0.035, 0.012), T(c.body2), [0, 0, 0], 1, [0, 0, 0], { outline: true, ow: 0.02 });
      part(w, tube('drkArm', [[0, 0.03, 0.15], [0.4, 0.07, 0.42], [0.75, 0.06, 0.5]], 0.07, 0.05), T(c.dark));
      part(w, tube('drkF1', [[0.75, 0.05, 0.5], [1.45, 0.05, 0.56], [2.15, 0.03, 0.3]], 0.05, 0.015), T(c.dark));
      part(w, tube('drkF2', [[0.75, 0.05, 0.5], [1.4, 0.04, 0.05], [1.95, 0.03, -0.42]], 0.045, 0.015), T(c.dark));
      part(w, tube('drkF3', [[0.75, 0.05, 0.5], [1.1, 0.04, -0.2], [1.35, 0.03, -0.85]], 0.045, 0.015), T(c.dark));
      part(w, tube('drkEdge', [[0.05, 0.06, 0.2], [0.75, 0.08, 0.53], [1.45, 0.08, 0.59], [2.15, 0.06, 0.33]], 0.022, 0.01, 22, 6), glow(c.glow));
      part(w, CONE(5), T(c.accent), [0.78, 0.12, 0.56], [0.04, 0.16, 0.04], [0.4, 0, -0.3]);
    });
    // しっぽ
    const tail = grp(root, 'tail', [0, 0, -0.7]);
    part(tail, tube('drkTail', [[0, -0.02, 0], [0, -0.14, -0.5], [0, 0, -0.98], [0, 0.26, -1.28]], 0.27, 0.05, 22), T(c.body), [0, 0, 0], 1, [0, 0, 0], { outline: true });
    part(tail, CONE(4), T(c.accent), [0, 0.32, -1.36], [0.16, 0.3, 0.06], [-0.9, 0, 0], { outline: true });
    addGlow(tail, c.glow, 0.9, [0, 0.36, -1.4]);
    // 足
    for (const sx of [-1, 1]) {
      part(body, SPH(), T(c.body), [sx * 0.34, -0.22, -0.25], [0.17, 0.25, 0.23], [0, 0, 0], { outline: true });
      part(body, tube('drkShin', [[0, 0, 0], [0, -0.22, 0.1], [0, -0.4, 0.03]], 0.095, 0.06), T(c.body), [sx * 0.38, -0.34, -0.2], 1, [0, 0, 0], { outline: true });
      for (let k = -1; k <= 1; k++) part(body, CONE(4), T(c.accent), [sx * 0.38 + k * 0.05, -0.76, -0.1], [0.025, 0.12, 0.025], [1.3, 0, 0]);
      part(body, tube('drkArmF', [[0, 0, 0], [0, -0.15, 0.12], [0, -0.22, 0.26]], 0.07, 0.045), T(c.body), [sx * 0.28, -0.18, 0.55], 1, [0, 0, 0], { outline: true });
    }
  },

  falcon(root, c) {
    const T = (x) => rimMat(x, c.rim);
    const body = grp(root, 'body');
    part(body, SPH(), T(c.body), [0, 0, 0], [0.36, 0.34, 0.8], [0, 0, 0], { outline: true });
    part(body, SPH(), T(c.accent), [0, -0.1, 0.08], [0.3, 0.26, 0.66]);
    for (const sx of [-1, 1]) part(body, CONE(4), T(c.dark), [sx * 0.12, -0.36, 0.05], [0.04, 0.18, 0.04], [0.6, 0, 0]);
    const head = grp(root, 'head', [0, 0.22, 0.72]);
    part(head, SPH(), T(c.body), [0, 0, 0], [0.25, 0.23, 0.27], [0, 0, 0], { outline: true });
    part(head, SPH(), T(c.accent), [0, -0.05, 0.11], [0.19, 0.15, 0.17]);
    part(head, tube('flcBeak', [[0, 0.04, 0.17], [0, 0, 0.35], [0, -0.1, 0.43]], 0.075, 0.01), T(0xffc23a), [0, 0, 0], 1, [0, 0, 0], { outline: true, ow: 0.015 });
    part(head, BOX(), glow(c.eye), [0, 0.065, 0.16], [0.42, 0.06, 0.08]);
    for (let i = -1; i <= 1; i++) part(head, CONE(4), T(c.body2), [i * 0.07, 0.17, -0.18], [0.04, 0.32, 0.03], [-1.9, 0, i * 0.25]);
    pair(root, 'wingL', 'wingR', [0.28, 0.1, 0.12], (w) => {
      part(w, flat('flcWing', [[0, 0.22], [0.6, 0.32], [1.2, 0.26], [1.75, 0.08], [2.05, -0.12], [1.8, -0.26], [1.9, -0.4], [1.55, -0.4], [1.6, -0.56], [1.25, -0.5], [1.25, -0.66], [0.9, -0.56], [0.55, -0.5], [0, -0.34]], 0.04, 0.015), T(c.body), [0, 0, 0], 1, [0, 0, 0], { outline: true, ow: 0.02 });
      part(w, flat('flcWing2', [[0.05, 0.1], [0.7, 0.14], [1.3, 0.04], [1.1, -0.3], [0.6, -0.36], [0.05, -0.24]], 0.03, 0.01), T(c.accent), [0, -0.05, 0]);
      part(w, tube('flcEdge', [[0.02, 0.05, 0.24], [0.6, 0.05, 0.35], [1.2, 0.05, 0.29], [1.75, 0.04, 0.11], [2.05, 0.03, -0.1]], 0.02, 0.008, 24, 6), glow(c.glow));
    });
    const tail = grp(root, 'tail', [0, 0.02, -0.7]);
    part(tail, flat('flcTail', [[-0.14, 0.12], [0.14, 0.12], [0.34, -0.6], [0.13, -0.5], [0, -0.64], [-0.13, -0.5], [-0.34, -0.6]], 0.04, 0.015), T(c.body), [0, 0, 0], 1, [0, 0, 0], { outline: true, ow: 0.02 });
    part(tail, BOX(), glow(c.glow), [0, 0.03, -0.45], [0.5, 0.02, 0.03]);
  },

  narwhal(root, c) {
    const T = (x) => rimMat(x, c.rim);
    const body = grp(root, 'body');
    part(body, SPH(), T(c.body), [0, 0, 0], [0.48, 0.44, 1.05], [0, 0, 0], { outline: true });
    part(body, SPH(), T(c.accent), [0, -0.16, 0.08], [0.38, 0.3, 0.88]);
    for (const sx of [-1, 1]) {
      part(body, tube('nwLine', [[0.42, 0.12, 0.75], [0.47, 0.08, 0], [0.38, 0.02, -0.72]], 0.022, 0.012, 16, 6), glow(c.glow), [0, 0, 0], [sx, 1, 1]);
      part(body, BOX(), glow(c.eye), [sx * 0.32, 0.12, 0.82], [0.07, 0.05, 0.12], [0, sx * 0.55, 0]);
      const fin = grp(body, sx < 0 ? 'finL' : 'finR', [sx * 0.4, -0.22, 0.42], [0, 0, sx * -0.5], sx);
      part(fin, flat('nwFin', [[0, 0.12], [0.48, -0.06], [0.52, -0.3], [0, -0.12]], 0.04, 0.015), T(c.dark), [0, 0, 0], 1, [0, 0, 0], { outline: true, ow: 0.02 });
    }
    for (let i = 0; i < 4; i++) part(body, SPH(6), T(c.dark), [(i % 2 ? 0.16 : -0.14) + i * 0.02, 0.38 - i * 0.02, 0.5 - i * 0.34], [0.07, 0.035, 0.09]);
    const head = grp(root, 'head', [0, 0.1, 1.0]);
    part(head, CONE(12), T(0xf6f0dc), [0, 0, 0.62], [0.075, 1.25, 0.075], [Math.PI / 2, 0, 0], { outline: true, ow: 0.015 });
    for (let i = 0; i < 5; i++) part(head, TOR(0.16), glow(c.glow), [0, 0, 0.12 + i * 0.22], [0.075 - i * 0.012, 0.075 - i * 0.012, 0.075], [0, 0, i * 0.5]);
    addGlow(head, c.glow, 0.7, [0, 0, 1.25]);
    const tail = grp(root, 'tail', [0, 0, -0.85]);
    part(tail, tube('nwStock', [[0, 0, 0.1], [0, 0.04, -0.3], [0, 0.1, -0.6]], 0.27, 0.09), T(c.body), [0, 0, 0], 1, [0, 0, 0], { outline: true });
    part(tail, flat('nwFluke', [[0, 0.12], [0.3, -0.04], [0.62, -0.36], [0.4, -0.33], [0.12, -0.2], [0, -0.27], [-0.12, -0.2], [-0.4, -0.33], [-0.62, -0.36], [-0.3, -0.04]], 0.05, 0.018), T(c.body), [0, 0.1, -0.62], 1, [0, 0, 0], { outline: true, ow: 0.02 });
  },

  jelly(root, c) {
    const body = grp(root, 'body', [0, 0.3, 0]);
    part(body, HEMI(), rimMat(0x8fefff, 0x6ad8ff, { opacity: 0.78 }), [0, 0, 0], [0.75, 0.62, 0.75], [0, 0, 0], { outline: true, ow: 0.025 });
    part(body, HEMI(), glow(0xff8fd0, 0.55), [0, 0.02, 0], [0.45, 0.4, 0.45]);
    part(body, SPH(10), glow(0xffd0f0), [0, 0.2, 0], 0.16);
    addGlow(body, 0xff9fe0, 1.7, [0, 0.22, 0]);
    part(body, TOR(0.09), glow(c.glow), [0, 0.01, 0], [0.76, 0.76, 0.6], [Math.PI / 2, 0, 0]);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      part(body, SPH(8), rimMat(0xbff6ff, 0x6ad8ff), [Math.cos(a) * 0.72, -0.02, Math.sin(a) * 0.72], [0.1, 0.06, 0.1]);
    }
    const ten = grp(root, 'tail', [0, 0.3, 0]);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.2;
      const t = grp(grp(ten, '', [Math.cos(a) * 0.55, 0, Math.sin(a) * 0.55], [0, -a, 0]), 'ten' + i);
      const L = 1.0 + (i % 3) * 0.2;
      part(t, tube('jlTen' + (i % 3), [[0, 0, 0], [0.04, -L * 0.3, 0.05], [-0.05, -L * 0.62, -0.03], [0.03, -L, 0.02]], 0.04, 0.012, 16, 6), glow(i % 2 ? 0xbff6ff : 0xffb6e6, 0.85));
      addGlow(t, c.glow, 0.25, [0.03, -L, 0.02], 0.9);
    }
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const t = grp(grp(ten, '', [Math.cos(a) * 0.14, 0, Math.sin(a) * 0.14], [0, -a, 0]), 'arm' + i);
      part(t, tube('jlArm', [[0, 0, 0], [0.08, -0.3, 0], [-0.04, -0.6, 0], [0.06, -0.85, 0]], 0.09, 0.025, 16, 7), rimMat(0xff9ad8, 0xffc0f0), [0, 0, 0], 1, [0, 0, 0], { outline: true, ow: 0.02 });
    }
  },

  owl(root, c) {
    const T = (x) => rimMat(x, c.rim);
    const body = grp(root, 'body', [0, -0.15, 0]);
    part(body, SPH(), T(0x2a9a8a), [0, 0, 0], [0.6, 0.68, 0.55], [0, 0, 0], { outline: true });
    part(body, SPH(), T(0xf2ecd8), [0, -0.1, 0.24], [0.44, 0.52, 0.36]);
    for (let i = 0; i < 3; i++) for (let k = -1; k <= 1; k++) part(body, CONE(3), T(0xbdb49a), [k * 0.14, 0.08 - i * 0.18, 0.56 - Math.abs(k) * 0.04], [0.04, 0.06, 0.02], [Math.PI, 0, 0]);
    part(body, TOR(0.14), glow(0xfff27a), [0, 0.05, 0.6], 0.15, [0, 0, 0.7]);
    addGlow(body, 0xfff27a, 0.6, [0, 0.05, 0.62]);
    for (const sx of [-1, 1]) part(body, CONE(4), T(0xffc23a), [sx * 0.16, -0.68, 0.18], [0.04, 0.14, 0.04], [1.2, 0, 0]);
    const head = grp(root, 'head', [0, 0.6, 0.05]);
    part(head, SPH(), T(0x2a9a8a), [0, 0, 0], [0.52, 0.42, 0.46], [0, 0, 0], { outline: true });
    for (const sx of [-1, 1]) {
      part(head, SPH(12), T(0xf2ecd8), [sx * 0.19, -0.01, 0.34], [0.2, 0.2, 0.08]);
      part(head, CYL(18), T(0x10131c), [sx * 0.19, 0, 0.41], [0.13, 0.03, 0.13], [Math.PI / 2, 0, 0]);
      part(head, CYL(18), glow(c.eye), [sx * 0.19, 0, 0.43], [0.09, 0.02, 0.09], [Math.PI / 2, 0, 0]);
      part(head, flat('owlTuft', [[-0.08, 0], [0.08, 0], [0.02, 0.42]], 0.05, 0.015), T(0x1d6f63), [sx * 0.3, 0.3, 0], 1, [-Math.PI / 2, 0, sx * -0.5], { outline: true, ow: 0.02 });
    }
    part(head, CONE(5), T(0xffc23a), [0, -0.12, 0.44], [0.065, 0.15, 0.065], [Math.PI / 2 + 0.6, 0, 0]);
    pair(root, 'wingL', 'wingR', [0.52, 0.28, -0.02], (w) => {
      const f = grp(w, '', [0, 0, 0], [0, Math.PI / 2, 0]);
      part(f, flat('owlWing', [[-0.3, 0.22], [0.25, 0.3], [0.46, -0.2], [0.38, -0.55], [0.2, -0.42], [0.12, -0.66], [-0.06, -0.48], [-0.18, -0.62], [-0.32, -0.2]], 0.07, 0.02), T(0x1d6f63), [0, 0, 0], 1, [-Math.PI / 2, 0, 0], { outline: true, ow: 0.02 });
      part(f, tube('owlEdge', [[-0.3, 0.2, 0.05], [0.25, 0.28, 0.05], [0.46, -0.2, 0.05]], 0.018, 0.008, 14, 6), glow(c.glow));
    });
  },

  lion(root, c) {
    const T = (x) => rimMat(x, c.rim);
    const body = grp(root, 'body', [0, 0.12, 0]);
    part(body, SPH(), T(0xf0a02a), [0, 0, -0.1], [0.46, 0.42, 0.85], [0, 0, 0], { outline: true });
    part(body, SPH(), T(0xf0a02a), [0, 0.06, 0.45], [0.46, 0.48, 0.45], [0, 0, 0], { outline: true });
    part(body, tube('lnSpine', [[0, 0.44, 0.5], [0, 0.42, 0], [0, 0.36, -0.7]], 0.03, 0.02, 14, 6), glow(c.glow));
    const legs = grp(root, 'legs', [0, 0.12, 0]);
    for (const [x, z, n, back] of [[-0.28, 0.55, 'legFL', 0], [0.28, 0.55, 'legFR', 0], [-0.28, -0.6, 'legBL', 1], [0.28, -0.6, 'legBR', 1]]) {
      const l = grp(legs, n, [x, -0.12, z]);
      part(l, tube(back ? 'lnLegB' : 'lnLegF', back ? [[0, 0.1, 0], [0, -0.25, -0.12], [0, -0.62, -0.02]] : [[0, 0.1, 0], [0, -0.3, 0.05], [0, -0.62, 0.02]], 0.17, 0.11), T(0xe8962a), [0, 0, 0], 1, [0, 0, 0], { outline: true });
      part(l, SPH(10), T(0xffe0a0), [0, -0.66, 0.06], [0.14, 0.08, 0.18], [0, 0, 0], { outline: true });
    }
    const head = grp(root, 'head', [0, 0.52, 0.98]);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      part(head, CONE(4), T(i % 2 ? c.body : c.body2), [Math.cos(a) * 0.4, Math.sin(a) * 0.4, -0.14], [0.15, 0.55, 0.1], [0, 0, a - Math.PI / 2], { outline: true, ow: 0.02 });
    }
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + 0.3;
      part(head, CONE(4), T(c.accent), [Math.cos(a) * 0.3, Math.sin(a) * 0.3, -0.04], [0.1, 0.32, 0.08], [0, 0, a - Math.PI / 2]);
    }
    addGlow(head, c.glow, 2.2, [0, 0, -0.25], 0.55);
    part(head, SPH(), T(0xf7b545), [0, 0, 0.08], [0.34, 0.32, 0.32], [0, 0, 0], { outline: true });
    part(head, SPH(10), T(0xffe0a0), [0, -0.1, 0.33], [0.17, 0.12, 0.13]);
    part(head, SPH(8), T(0x3a1a10), [0, -0.03, 0.43], [0.06, 0.04, 0.04]);
    for (const sx of [-1, 1]) {
      part(head, BOX(), glow(c.eye), [sx * 0.14, 0.08, 0.33], [0.11, 0.035, 0.05], [0, 0, sx * -0.25]);
      part(head, SPH(8), T(0xe8962a), [sx * 0.22, 0.24, 0.02], [0.08, 0.08, 0.04], [0, 0, 0], { outline: true, ow: 0.015 });
    }
    const jaw = grp(head, 'jaw', [0, -0.17, 0.27]);
    part(jaw, SPH(8), T(0x8a2a14), [0, -0.02, 0.05], [0.12, 0.05, 0.1]);
    const tail = grp(root, 'tail', [0, 0.25, -0.85]);
    part(tail, tube('lnTail', [[0, 0, 0], [0, -0.2, -0.35], [0, 0.05, -0.68], [0, 0.35, -0.78]], 0.07, 0.04), T(0xe8962a), [0, 0, 0], 1, [0, 0, 0], { outline: true });
    part(tail, CONE(5), T(c.body), [0, 0.42, -0.8], [0.09, 0.26, 0.09], [0, 0, 0], { outline: true, ow: 0.015 });
    addGlow(tail, c.glow, 0.8, [0, 0.45, -0.8]);
  },

  cheetah(root, c) {
    const T = (x) => rimMat(x, c.rim);
    const Y = 0xe9f45a;
    const body = grp(root, 'body', [0, 0.18, 0]);
    part(body, SPH(), T(Y), [0, 0, -0.15], [0.3, 0.28, 0.85], [0, 0, 0], { outline: true });
    part(body, SPH(), T(Y), [0, 0.03, 0.48], [0.3, 0.32, 0.36], [0, 0, 0], { outline: true });
    for (let i = 0; i < 8; i++) part(body, SPH(6), T(0x16301e), [(i % 2 ? 0.17 : -0.17), 0.2 - (i % 3) * 0.04, -0.8 + i * 0.2], [0.06, 0.04, 0.08]);
    for (const sx of [-1, 1]) {
      const b = grp(body, '', [sx * 0.29, 0.03, -0.1], [0, 0, Math.PI / 2], sx);
      part(b, flat('chBolt', [[0.02, 0.45], [0.14, 0.45], [0.05, 0.1], [0.16, 0.1], [-0.06, -0.45], [0, -0.04], [-0.1, -0.04]], 0.02, 0.006), glow(c.glow));
    }
    const legs = grp(root, 'legs', [0, 0.18, 0]);
    for (const [x, z, n, back] of [[-0.18, 0.5, 'legFL', 0], [0.18, 0.5, 'legFR', 0], [-0.18, -0.7, 'legBL', 1], [0.18, -0.7, 'legBR', 1]]) {
      const l = grp(legs, n, [x, -0.1, z]);
      part(l, tube(back ? 'chLegB' : 'chLegF', back ? [[0, 0.1, 0], [0, -0.22, -0.15], [0, -0.5, 0.02], [0, -0.66, -0.02]] : [[0, 0.1, 0], [0, -0.3, 0.04], [0, -0.66, 0.0]], 0.1, 0.055), T(0xd6e14a), [0, 0, 0], 1, [0, 0, 0], { outline: true });
      part(l, SPH(8), glow(c.glow), [0, -0.68, 0.04], [0.07, 0.04, 0.1]);
    }
    const head = grp(root, 'head', [0, 0.42, 0.98]);
    part(head, SPH(), T(Y), [0, 0, 0], [0.22, 0.2, 0.25], [0, 0, 0], { outline: true });
    part(head, SPH(8), T(0xf9fbd0), [0, -0.07, 0.19], [0.13, 0.09, 0.11]);
    part(head, SPH(6), T(0x16301e), [0, -0.03, 0.29], [0.04, 0.03, 0.03]);
    for (const sx of [-1, 1]) {
      part(head, CONE(4), T(Y), [sx * 0.13, 0.2, -0.04], [0.07, 0.14, 0.04], [0, 0, sx * -0.3], { outline: true, ow: 0.015 });
      part(head, BOX(), glow(c.eye), [sx * 0.1, 0.06, 0.21], [0.09, 0.03, 0.04], [0, 0, sx * -0.25]);
      part(head, BOX(), T(0x16301e), [sx * 0.1, -0.03, 0.22], [0.02, 0.12, 0.02], [0, 0, sx * 0.25]);
    }
    const tail = grp(root, 'tail', [0, 0.28, -0.95]);
    part(tail, tube('chTail', [[0, 0, 0], [0, -0.12, -0.45], [0, 0.04, -0.88], [0, 0.24, -1.02]], 0.065, 0.03), T(0xd6e14a), [0, 0, 0], 1, [0, 0, 0], { outline: true });
    addGlow(tail, c.glow, 0.5, [0, 0.26, -1.04]);
  },

  tortoise(root, c) {
    const T = (x) => rimMat(x, c.rim);
    const body = grp(root, 'body', [0, 0.05, 0]);
    part(body, ICO(), T(c.body), [0, 0.12, 0], [0.95, 0.55, 1.1], [0, 0, 0], { outline: true });
    const edges = G('icoEdges', () => new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(1.01, 1)));
    const lines = new THREE.LineSegments(edges, glow(c.glow));
    lines.scale.set(0.95, 0.55, 1.1);
    lines.position.y = 0.12;
    body.add(lines);
    part(body, CYL(6), glow(c.glow, 0.9), [0, 0.68, 0], [0.22, 0.02, 0.22]);
    addGlow(body, c.glow, 1.0, [0, 0.72, 0], 0.6);
    part(body, CYL(18), T(c.dark), [0, -0.2, 0], [0.97, 0.18, 1.07]);
    part(body, CYL(18), T(0xd8c58a), [0, -0.3, 0], [0.8, 0.08, 0.92]);
    const head = grp(root, 'head', [0, 0.02, 1.05]);
    part(head, tube('ttNeck', [[0, -0.05, -0.2], [0, 0, 0.05], [0, 0.04, 0.18]], 0.16, 0.13), T(0x6fc7a8), [0, 0, 0], 1, [0, 0, 0], { outline: true });
    part(head, SPH(), T(0x6fc7a8), [0, 0.06, 0.25], [0.24, 0.21, 0.28], [0, 0, 0], { outline: true });
    for (const sx of [-1, 1]) part(head, BOX(), glow(c.eye), [sx * 0.12, 0.12, 0.44], [0.08, 0.035, 0.05]);
    const legs = grp(root, 'legs', [0, 0.05, 0]);
    for (const [x, z, n] of [[-0.72, 0.55, 'legFL'], [0.72, 0.55, 'legFR'], [-0.72, -0.55, 'legBL'], [0.72, -0.55, 'legBR']]) {
      const l = grp(legs, n, [x, -0.25, z]);
      part(l, tube('ttLeg', [[0, 0.1, 0], [0, -0.12, 0.02], [0, -0.32, 0.04]], 0.17, 0.15), T(0x5aae92), [0, 0, 0], 1, [0, 0, 0], { outline: true });
      for (let k = -1; k <= 1; k++) part(l, CONE(4), T(0xeaf6ff), [k * 0.07, -0.34, 0.14], [0.03, 0.08, 0.03], [1.4, 0, 0]);
    }
    part(body, CONE(5), T(0x5aae92), [0, -0.12, -1.12], [0.1, 0.3, 0.1], [-Math.PI / 2, 0, 0]);
  },

  beetle(root, c) {
    const T = (x) => rimMat(x, c.rim);
    const body = grp(root, 'body', [0, 0.05, 0]);
    part(body, SPH(), T(0x8a1020), [0, 0.05, -0.18], [0.55, 0.38, 0.75], [0, 0, 0], { outline: true });
    part(body, BOX(), T(0x1a0a10), [0, 0.42, -0.18], [0.03, 0.02, 1.3]);
    for (const sx of [-1, 1]) part(body, tube('btStripe', [[0.2, 0.36, 0.4], [0.32, 0.28, -0.2], [0.22, 0.18, -0.75]], 0.02, 0.012, 14, 6), glow(c.glow), [0, 0, 0], [sx, 1, 1]);
    part(body, SPH(), T(0x5a0d18), [0, 0.08, 0.48], [0.42, 0.3, 0.32], [0, 0, 0], { outline: true });
    part(body, SPH(12), glow(0xffd04a), [0, 0.42, -0.25], 0.17);
    addGlow(body, c.glow, 1.4, [0, 0.5, -0.25]);
    part(body, tube('btFuse', [[0, 0.5, -0.25], [0.05, 0.68, -0.32], [0.12, 0.78, -0.25]], 0.03, 0.02, 10, 6), T(0x3a2d38));
    addGlow(body, 0xfff1a0, 0.45, [0.12, 0.8, -0.25], 1);
    part(body, tube('btHorn2', [[0, 0, 0], [0, 0.12, 0.2], [0, 0.08, 0.38]], 0.07, 0.012), T(0x2a0a10), [0, 0.3, 0.55], 1, [0, 0, 0], { outline: true, ow: 0.015 });
    const head = grp(root, 'head', [0, -0.02, 0.78]);
    part(head, SPH(), T(0x1a0a10), [0, 0, 0], [0.24, 0.2, 0.2], [0, 0, 0], { outline: true });
    part(head, tube('btHorn', [[0, 0, 0], [0, 0.15, 0.3], [0, 0.45, 0.48], [0, 0.68, 0.4]], 0.1, 0.015), T(c.accent), [0, 0.05, 0.08], 1, [0, 0, 0], { outline: true, ow: 0.02 });
    for (const sx of [-1, 1]) part(head, BOX(), glow(c.eye), [sx * 0.12, 0.05, 0.17], [0.07, 0.035, 0.04]);
    const legs = grp(root, 'legs', [0, 0.05, 0]);
    for (let i = 0; i < 3; i++)
      for (const sx of [-1, 1]) {
        const l = grp(legs, '', [sx * 0.35, -0.08, 0.35 - i * 0.42], [0, sx * (0.6 - i * 0.6), 0], sx);
        part(l, tube('btLeg', [[0, 0, 0], [0.3, 0.06, 0], [0.5, -0.2, 0.04], [0.62, -0.42, 0.1]], 0.05, 0.02, 14, 6), T(0x1a0a10), [0, 0, 0], 1, [0, 0, 0], { outline: true, ow: 0.015 });
      }
  },

  octopus(root, c) {
    const T = (x) => rimMat(x, c.rim);
    const P = 0x6a4fd8;
    const body = grp(root, 'body', [0, 0.25, -0.05]);
    part(body, SPH(), T(P), [0, 0.3, -0.12], [0.55, 0.72, 0.6], [-0.35, 0, 0], { outline: true });
    const edges = G('octEdges', () => new THREE.EdgesGeometry(new THREE.SphereGeometry(1.01, 8, 6), 1));
    const lines = new THREE.LineSegments(edges, glow(c.glow));
    lines.scale.set(0.55, 0.72, 0.6);
    lines.position.set(0, 0.3, -0.12);
    lines.rotation.x = -0.35;
    body.add(lines);
    for (const sx of [-1, 1]) {
      part(body, SPH(12), T(0xeaf6ff), [sx * 0.24, -0.05, 0.42], [0.14, 0.13, 0.12], [0, 0, 0], { outline: true, ow: 0.02 });
      part(body, BOX(), glow(c.eye), [sx * 0.24, -0.05, 0.54], [0.12, 0.04, 0.02], [0, 0, sx * -0.2]);
    }
    const ten = grp(root, 'tail', [0, 0.05, 0]);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const t = grp(grp(ten, '', [Math.cos(a) * 0.26, 0, Math.sin(a) * 0.26], [0, -a, 0]), 'ten' + i);
      part(t, tube('octTen', [[0, 0, 0], [0.38, -0.28, 0], [0.78, -0.42, 0], [1.08, -0.28, 0], [1.14, 0.02, 0], [1.0, 0.16, 0]], 0.12, 0.02, 26, 8), T(0x5a3fc0), [0, 0, 0], 1, [0, 0, 0], { outline: true, ow: 0.02 });
      addGlow(t, c.glow, 0.28, [1.0, 0.16, 0], 0.95);
      for (let k = 0; k < 3; k++) part(t, SPH(6), glow(c.glow, 0.9), [0.3 + k * 0.25, -0.33 - (k === 1 ? 0.1 : 0), 0], 0.025);
    }
  },

  fox(root, c) {
    const T = (x) => rimMat(x, c.rim);
    const body = grp(root, 'body', [0, 0.1, 0]);
    part(body, SPH(), T(c.body), [0, 0, -0.05], [0.3, 0.3, 0.72], [0, 0, 0], { outline: true });
    part(body, SPH(), T(0xf4fff6), [0, -0.1, 0.1], [0.24, 0.22, 0.55]);
    part(body, tube('fxNeck', [[0, 0.05, 0.45], [0, 0.22, 0.7], [0, 0.3, 0.82]], 0.17, 0.13), T(c.body), [0, 0, 0], 1, [0, 0, 0], { outline: true });
    const legs = grp(root, 'legs', [0, 0.1, 0]);
    for (const [x, z, n, back] of [[-0.15, 0.42, 'legFL', 0], [0.15, 0.42, 'legFR', 0], [-0.15, -0.5, 'legBL', 1], [0.15, -0.5, 'legBR', 1]]) {
      const l = grp(legs, n, [x, -0.12, z]);
      part(l, tube(back ? 'fxLegB' : 'fxLegF', back ? [[0, 0.1, 0], [0, -0.18, -0.12], [0, -0.42, 0.02], [0, -0.56, -0.02]] : [[0, 0.1, 0], [0, -0.26, 0.03], [0, -0.56, 0]], 0.085, 0.05), T(0xdff7e6), [0, 0, 0], 1, [0, 0, 0], { outline: true });
    }
    const head = grp(root, 'head', [0, 0.45, 0.9]);
    part(head, SPH(), T(c.body), [0, 0, 0], [0.24, 0.22, 0.24], [0, 0, 0], { outline: true });
    part(head, CONE(8), T(0xf4fff6), [0, -0.06, 0.26], [0.12, 0.32, 0.1], [Math.PI / 2, 0, 0], { outline: true, ow: 0.015 });
    part(head, SPH(6), T(0x0c2a1d), [0, -0.05, 0.43], 0.035);
    for (const sx of [-1, 1]) {
      part(head, CONE(4), T(c.body), [sx * 0.14, 0.3, -0.03], [0.1, 0.34, 0.05], [0, 0, sx * -0.25], { outline: true, ow: 0.015 });
      part(head, CONE(4), T(0xf4fff6), [sx * 0.135, 0.27, 0.0], [0.055, 0.22, 0.03], [0, 0, sx * -0.25]);
      part(head, BOX(), glow(c.eye), [sx * 0.11, 0.06, 0.2], [0.1, 0.028, 0.04], [0, 0, sx * -0.3]);
    }
    const tail = grp(root, 'tail', [0, 0.2, -0.65]);
    for (let i = -1; i <= 1; i++) {
      const t = grp(tail, 'tl' + i, [i * 0.1, 0, 0], [0, 0, i * 0.55]);
      part(t, tube('fxTail', [[0, 0, 0], [0, 0.22, -0.42], [0, 0.6, -0.62], [0, 0.92, -0.55]], 0.15, 0.04, 20), T(i ? c.body : c.body2), [0, 0, 0], 1, [0, 0, 0], { outline: true });
      part(t, SPH(8), T(0xf4fff6), [0, 0.88, -0.57], [0.08, 0.1, 0.08]);
      addGlow(t, c.glow, 0.6, [0, 0.95, -0.55]);
    }
    const orbs = grp(root, 'orbs', [0, 0.4, 0]);
    addGlow(orbs, c.glow, 0.55, [0.55, 0, 0.3], 0.95);
    addGlow(orbs, c.glow, 0.45, [-0.55, 0.2, -0.2], 0.95);
  },

  firefly(root, c) {
    const T = (x) => rimMat(x, c.rim);
    const body = grp(root, 'body');
    part(body, SPH(), T(0x24304f), [0, 0.1, 0.32], [0.24, 0.24, 0.3], [0, 0, 0], { outline: true });
    part(body, SPH(), T(0x24304f), [0, 0.05, 0.05], [0.22, 0.2, 0.22], [0, 0, 0], { outline: true });
    part(body, SPH(), glow(0xc8ff6a), [0, -0.05, -0.38], [0.34, 0.32, 0.46]);
    addGlow(body, 0xc8ff7a, 2.4, [0, -0.05, -0.38], 0.8);
    for (const sx of [-1, 1]) {
      part(body, BOX(), glow(c.eye), [sx * 0.1, 0.16, 0.58], [0.08, 0.04, 0.04]);
      part(body, tube('ffAnt', [[0, 0, 0], [0.04, 0.25, 0.1], [0.12, 0.42, 0.06]], 0.018, 0.012, 10, 5), T(0x24304f), [sx * 0.08, 0.3, 0.5], [sx, 1, 1]);
      addGlow(body, c.glow, 0.25, [sx * 0.2, 0.72, 0.56], 1);
      for (let k = 0; k < 3; k++) part(body, tube('ffLeg', [[0, 0, 0], [0.15, -0.1, 0], [0.22, -0.26, 0.05]], 0.02, 0.012, 8, 5), T(0x24304f), [sx * 0.12, -0.1, 0.2 - k * 0.12], [sx, 1, 1]);
    }
    const wm = rimMat(0xbfefff, 0x9af6ff, { opacity: 0.55, side: THREE.DoubleSide });
    pair(root, 'wingL', 'wingR', [0.12, 0.3, 0.12], (w) => {
      part(w, flat('ffWing', [[0, 0.06], [0.45, 0.16], [0.85, 0.02], [0.72, -0.16], [0.2, -0.12]], 0.01, 0.004), wm);
      part(w, flat('ffWing2', [[0, -0.1], [0.5, -0.14], [0.7, -0.32], [0.4, -0.42], [0.05, -0.24]], 0.01, 0.004), wm, [0, -0.03, 0]);
    });
    const ring = grp(root, 'ring', [0, -0.05, -0.38]);
    part(ring, TOR(0.05), glow(c.glow), [0, 0, 0], [0.62, 0.62, 0.62], [Math.PI / 2 - 0.3, 0, 0]);
    part(ring, TOR(0.05), glow(0xc8ff6a), [0, 0, 0], [0.7, 0.7, 0.7], [Math.PI / 2 + 0.5, 0.6, 0]);
  },

  boar(root, c) {
    const T = (x) => rimMat(x, c.rim);
    const body = grp(root, 'body', [0, 0.1, 0]);
    part(body, SPH(), T(0x8a3a2a), [0, 0, 0], [0.55, 0.5, 0.85], [0, 0, 0], { outline: true });
    for (let i = 0; i < 6; i++) part(body, CONE(4), T(c.body), [0, 0.48 - i * 0.03, 0.55 - i * 0.22], [0.08, 0.28, 0.12], [-0.6, 0, 0]);
    const rk = grp(body, 'rocket', [0, 0.58, -0.25]);
    part(rk, CYL(14), T(0x3a3f52), [0, 0, 0], [0.2, 0.75, 0.2], [Math.PI / 2, 0, 0], { outline: true });
    part(rk, CONE(14), T(c.accent), [0, 0, 0.5], [0.2, 0.26, 0.2], [Math.PI / 2, 0, 0], { outline: true });
    part(rk, CONE(14), T(0x23283a), [0, 0, -0.48], [0.17, 0.2, 0.17], [-Math.PI / 2, 0, 0]);
    for (const sx of [-1, 1]) part(rk, flat('bfFin', [[0, 0.1], [0.22, -0.1], [0.22, -0.25], [0, -0.15]], 0.03, 0.01), T(c.body), [sx * 0.18, 0, -0.25], [sx, 1, 1], [0, 0, 0], { outline: true, ow: 0.015 });
    part(rk, BOX(), glow(c.glow), [0, 0.2, 0.05], [0.04, 0.02, 0.55]);
    const flame = grp(root, 'flame', [0, 0.68, -0.95]);
    part(flame, CONE(10), glow(0xffa23a, 0.8), [0, 0, -0.25], [0.15, 0.5, 0.15], [-Math.PI / 2, 0, 0]);
    addGlow(flame, 0xffa23a, 1.4, [0, 0, -0.1]);
    addGlow(flame, 0xfff1a0, 0.7, [0, 0, 0.02]);
    const legs = grp(root, 'legs', [0, 0.1, 0]);
    for (const [x, z, n] of [[-0.3, 0.45, 'legFL'], [0.3, 0.45, 'legFR'], [-0.3, -0.45, 'legBL'], [0.3, -0.45, 'legBR']]) {
      const l = grp(legs, n, [x, -0.3, z]);
      part(l, tube('bfLeg', [[0, 0.1, 0], [0, -0.15, 0.02], [0, -0.36, 0]], 0.14, 0.1), T(0x5a2418), [0, 0, 0], 1, [0, 0, 0], { outline: true });
      part(l, CYL(8), T(0x1a0a08), [0, -0.38, 0.02], [0.11, 0.06, 0.12]);
    }
    const head = grp(root, 'head', [0, 0.15, 0.85]);
    part(head, SPH(), T(0x8a3a2a), [0, 0, 0], [0.34, 0.3, 0.32], [0, 0, 0], { outline: true });
    part(head, CYL(14), T(0xffb0a0), [0, -0.06, 0.33], [0.15, 0.12, 0.15], [Math.PI / 2, 0, 0], { outline: true, ow: 0.015 });
    for (const sx of [-1, 1]) {
      part(head, SPH(6), T(0x5a2418), [sx * 0.06, -0.06, 0.4], 0.03);
      part(head, tube('bfTusk', [[0, 0, 0], [0.02, 0.06, 0.1], [0.0, 0.2, 0.14]], 0.04, 0.008, 10, 6), T(0xfff4e0), [sx * 0.15, -0.16, 0.28], [sx, 1, 1], [0, 0, 0], { outline: true, ow: 0.01 });
      part(head, BOX(), glow(c.eye), [sx * 0.14, 0.1, 0.26], [0.1, 0.035, 0.04], [0, 0, sx * -0.3]);
      part(head, CONE(4), T(0x5a2418), [sx * 0.22, 0.28, -0.05], [0.09, 0.2, 0.05], [0, 0, sx * -0.5], { outline: true, ow: 0.015 });
    }
  },

  swallow(root, c) {
    const T = (x) => rimMat(x, c.rim);
    const N = 0x16224a;
    const body = grp(root, 'body');
    part(body, SPH(), T(N), [0, 0, 0], [0.26, 0.24, 0.7], [0, 0, 0], { outline: true });
    part(body, SPH(), T(0xf4f8ff), [0, -0.08, 0.1], [0.2, 0.18, 0.56]);
    part(body, SPH(8), T(0xff5a4a), [0, -0.03, 0.55], [0.13, 0.11, 0.11]);
    const head = grp(root, 'head', [0, 0.1, 0.62]);
    part(head, SPH(), T(N), [0, 0, 0], [0.2, 0.18, 0.21], [0, 0, 0], { outline: true });
    part(head, CONE(5), T(0x2a2f40), [0, -0.02, 0.24], [0.045, 0.12, 0.045], [Math.PI / 2, 0, 0]);
    part(head, BOX(), glow(c.eye), [0, 0.05, 0.15], [0.32, 0.045, 0.06]);
    pair(root, 'wingL', 'wingR', [0.2, 0.06, 0.12], (w) => {
      part(w, flat('swWing', [[0, 0.14], [0.8, 0.17], [1.6, -0.03], [2.35, -0.58], [1.5, -0.32], [0.8, -0.3], [0, -0.2]], 0.04, 0.014), T(N), [0, 0, 0], 1, [0, 0, 0], { outline: true, ow: 0.02 });
      part(w, flat('swWing2', [[0.05, 0.02], [0.7, 0.05], [1.2, -0.12], [0.7, -0.24], [0.05, -0.16]], 0.03, 0.01), T(0x2c3f80), [0, -0.035, 0]);
      part(w, tube('swEdge', [[0.02, 0.05, 0.16], [0.8, 0.05, 0.2], [1.6, 0.04, 0.0], [2.33, 0.03, -0.55]], 0.02, 0.008, 24, 6), glow(c.glow));
    });
    const tail = grp(root, 'tail', [0, 0, -0.62]);
    part(tail, flat('swTail', [[-0.12, 0.1], [0.12, 0.1], [0.32, -0.95], [0.08, -0.32], [-0.08, -0.32], [-0.32, -0.95]], 0.035, 0.012), T(N), [0, 0, 0], 1, [0, 0, 0], { outline: true, ow: 0.02 });
    for (const sx of [-1, 1]) part(tail, tube('swTailE', [[0.1, 0.03, 0.05], [0.3, 0.03, -0.9]], 0.014, 0.008, 8, 5), glow(c.glow), [0, 0, 0], [sx, 1, 1]);
  },
};

// ---- 作る（同じ種類は型を1回だけ作って、使うたびに複製）----
const tplCache = new Map();
export function buildMonster(id) {
  const key = MONSTERS[id] ? id : 'drake';
  const def = MONSTERS[key];
  if (!tplCache.has(key)) {
    const root = new THREE.Group();
    root.name = 'monster';
    BUILD[key](root, PAL[def.elem]);
    root.traverse((o) => {
      if (o.geometry) o.geometry.userData.shared = true;
      if (o.material) o.material.userData.shared = true;
    });
    tplCache.set(key, root);
  }
  const g = tplCache.get(key).clone(true);
  const parts = {};
  g.traverse((o) => {
    if (o.name && !parts[o.name]) parts[o.name] = o;
  });
  for (const k of Object.keys(parts)) {
    const o = parts[k];
    o.userData.p0 = o.position.clone();
  }
  g.userData = { id: key, parts, def, push: 0, dive: 0, lift: 0, tilt: 0 };
  g.scale.setScalar(def.scale);
  return g;
}

// ---- 動き ----
// phase: 'appear' | 'charge' | 'act' | 'idle' ／ k：そのフェーズの進み（0〜1）／t：経過秒
// つばさ：右は +a、左は -a で「上（外）」へ
function wings(P, a) {
  if (P.wingR) P.wingR.rotation.z = a;
  if (P.wingL) P.wingL.rotation.z = -a;
}
export function poseMonster(g, phase, k, t) {
  const U = g.userData, P = U.parts;
  const a = U.def.anim;
  const act = phase === 'act' ? Math.sin(Math.min(1, k * 1.5) * Math.PI) : 0; // 0→1→0
  const hit = phase === 'act' ? Math.min(1, k * 3) : 0; // 技を出す瞬間までの進み
  const pre = phase === 'charge' ? Math.min(1, k * 1.4) : phase === 'act' ? 1 - hit : 0; // 溜め
  U.push = 0;
  U.dive = 0;
  U.lift = 0;
  U.tilt = 0;
  if (P.body) P.body.position.y = P.body.userData.p0.y + Math.sin(t * 3.2) * 0.05;
  if (P.head) P.head.rotation.set(0, 0, 0);
  if (P.jaw) P.jaw.rotation.x = 0;
  switch (a) {
    case 'breath':
      wings(P, 0.25 + Math.sin(t * 7) * 0.45 * (1 - act * 0.5) + act * 0.3);
      if (P.head) {
        P.head.rotation.x = -0.45 * pre + 0.25 * act;
        P.head.position.z = P.head.userData.p0.z - 0.12 * pre + 0.15 * act;
      }
      if (P.jaw) P.jaw.rotation.x = 0.2 * pre + 0.65 * act;
      if (P.tail) P.tail.rotation.y = Math.sin(t * 2.6) * 0.25;
      U.lift = 0.1 * Math.sin(t * 7);
      break;
    case 'swing':
      wings(P, 0.15 + Math.sin(t * 9) * 0.25 * (1 - pre) + 0.85 * pre - 1.1 * act);
      U.tilt = -0.25 * act;
      if (P.tail) P.tail.rotation.x = Math.sin(t * 5) * 0.1;
      break;
    case 'thrust':
      if (P.tail) P.tail.rotation.x = Math.sin(t * 7) * 0.3;
      if (P.finL) P.finL.rotation.x = Math.sin(t * 5) * 0.3;
      if (P.finR) P.finR.rotation.x = Math.sin(t * 5) * 0.3;
      U.push = -0.5 * pre + 1.5 * act;
      break;
    case 'pulse': {
      const s = Math.sin(t * 4.5);
      if (P.body) P.body.scale.set(1 + 0.08 * s + 0.25 * act, 1 - 0.07 * s - 0.18 * act, 1 + 0.08 * s + 0.25 * act);
      for (let i = 0; i < 8; i++) if (P['ten' + i]) P['ten' + i].rotation.z = Math.sin(t * 3.5 + i * 0.8) * 0.22 + act * 0.5;
      for (let i = 0; i < 4; i++) if (P['arm' + i]) P['arm' + i].rotation.z = Math.sin(t * 3 + i * 1.3) * 0.15 + act * 0.3;
      U.lift = 0.15 * s;
      break;
    }
    case 'spread':
      wings(P, 0.05 + 0.15 * Math.sin(t * 3) + 0.55 * pre + 1.3 * act);
      if (P.head) P.head.rotation.y = Math.sin(t * 1.8) * 0.35 * (1 - act);
      break;
    case 'roar':
      if (P.body) P.body.rotation.x = -0.15 * pre - 0.35 * act;
      if (P.head) P.head.rotation.x = 0.15 * pre - 0.3 * act;
      if (P.jaw) P.jaw.rotation.x = 0.1 * pre + 0.75 * act;
      if (P.tail) P.tail.rotation.x = Math.sin(t * 4) * 0.2 - 0.3 * act;
      U.lift = 0.25 * act;
      break;
    case 'run': {
      const sp = phase === 'act' ? 20 : 10;
      const s = Math.sin(t * sp) * (phase === 'act' ? 0.9 : 0.55);
      if (P.legFL) P.legFL.rotation.x = s;
      if (P.legBR) P.legBR.rotation.x = s;
      if (P.legFR) P.legFR.rotation.x = -s;
      if (P.legBL) P.legBL.rotation.x = -s;
      if (P.tail) P.tail.rotation.x = Math.sin(t * sp * 0.5) * 0.2;
      if (P.flame) P.flame.scale.setScalar(1 + 0.3 * Math.sin(t * 31) + act * 1.2);
      if (P.body) P.body.rotation.x = Math.sin(t * sp) * 0.05;
      U.push = 2.5 * act;
      break;
    }
    case 'guard':
      if (P.head) P.head.position.z = P.head.userData.p0.z - 0.38 * Math.max(pre, act);
      if (P.legs) P.legs.position.y = P.legs.userData.p0.y + 0.15 * act;
      U.lift = 0.1 * Math.sin(t * 2.5);
      break;
    case 'plant':
      if (P.legs) P.legs.children.forEach((l, i) => (l.rotation.x = Math.sin(t * 14 + i) * 0.25));
      U.dive = act;
      break;
    case 'slam':
      for (let i = 0; i < 8; i++) if (P['ten' + i]) P['ten' + i].rotation.z = Math.sin(t * 3 + i * 0.9) * 0.12 + 0.45 * pre - 0.6 * act;
      if (P.body) P.body.scale.set(1 + 0.12 * act, 1 - 0.1 * act, 1 + 0.12 * act);
      break;
    case 'dash': {
      const s = Math.sin(t * 12) * 0.5;
      if (P.legFL) P.legFL.rotation.x = s;
      if (P.legBR) P.legBR.rotation.x = s;
      if (P.legFR) P.legFR.rotation.x = -s;
      if (P.legBL) P.legBL.rotation.x = -s;
      if (P.tail) P.tail.rotation.x = Math.sin(t * 4) * 0.12 - 0.2 * act;
      if (P.orbs) P.orbs.rotation.y = t * 2.2;
      U.push = 3.5 * act;
      break;
    }
    case 'gate':
      wings(P, 0.3 + Math.sin(t * 34) * 0.5);
      if (P.ring) {
        P.ring.rotation.y = t * 2.5;
        P.ring.scale.setScalar(1 + act * 2.2);
      }
      U.lift = 0.12 * Math.sin(t * 2.4);
      break;
    case 'swoop':
      wings(P, 0.1 + Math.sin(t * 8) * 0.3 * (1 - act) - 0.4 * act);
      U.push = 3 * act;
      U.lift = -0.6 * act;
      break;
  }
}

// モンスターは少し内側（画面のまん中の先）を向く。カメラから横顔とせなかが見える
export const SUMMON_TURN = 0.4;
// 呼び出したときの大きさ（図鑑の大きさにかける）
export const SUMMON_SCALE = 0.62;
// プレイヤーのそばの、モンスターが出る場所（右ななめ前・少し上）。縦長の画面でも見える位置
export function summonSpot(p, out) {
  out.copy(p.pos).addScaledVector(p.right, 1.35).addScaledVector(p.flatFwd, 2.1);
  out.y += 1.2;
  return out;
}
// 技が出る場所（見た目がなくても計算できる）
const _o = new THREE.Vector3();
export function monsterMouth(p, monId, out) {
  const def = MONSTERS[monId] || MONSTERS.drake;
  summonSpot(p, out);
  const m = def.mouth, s = def.scale * SUMMON_SCALE;
  const yaw = p.yaw + SUMMON_TURN;
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  _o.set(m[0] * s, m[1] * s, m[2] * s);
  out.x += _o.x * cy + _o.z * sy;
  out.y += _o.y;
  out.z += -_o.x * sy + _o.z * cy;
  return out;
}
