// ディスクのモンスター（キックフライトのディスクと同じく、使うとキャラのよこに現れて技を出す）
// すべてこのゲームのオリジナル。丸・円すい・曲がった管・切りぬいた板を組み合わせる。
// ふちが属性の色に光る（呼び出された感じ）
import * as THREE from 'three';
import { toonGradient, addOutline, glowTex, shareMark, canvasTex, roundedBox, outlineMat } from './gfx.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

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
  const key = color + '|' + rim + '|' + (o.side || 0) + '|' + (o.opacity || 1) + '|' + (o.map ? o.map.uuid : '') + '|' + (o.alphaTest || 0);
  let m = matCache.get(key);
  if (m) return m;
  m = new THREE.MeshToonMaterial({ color, gradientMap: toonGradient() });
  if (o.map) m.map = o.map; // 字や模様の絵（大学のディスク）
  if (o.alphaTest) m.alphaTest = o.alphaTest; // 絵のすき間をぬく（丸いマークなど）
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
// 細かすぎない輪（マフラー・えり・首輪）と、ろくろの形（皿・どんぶり・ロケット）
const RING = (t = 0.3) => G('ring' + t, () => new THREE.TorusGeometry(1, t, 6, 18));
const LATHE = (key, prof, seg = 24) => G('la_' + key, () => new THREE.LatheGeometry(prof.map((q) => new THREE.Vector2(q[0], q[1])), seg));

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
  // ---- 大学のディスク（キャンパスの人・犬・学食など。人はぜんぶ作った架空の人）----
  eigo: { name: 'でっかい英語の先生', motif: '大声の英語の先生', elem: 'wind', mouth: [0, 0.12, 0.72], scale: 1.12, anim: 'shout' },
  rocker: { name: '革ジャンの先生', motif: 'ロックな先生', elem: 'fire', mouth: [-0.13, -0.38, 0.5], scale: 0.95, anim: 'strum' },
  curry: { name: '学食カレー', motif: '学食のカレーライス', elem: 'fire', mouth: [-0.36, 0.48, 0.1], scale: 0.95, anim: 'fling' },
  cookie: { name: 'うんち出る出るクッキー', motif: '手づくりクッキー', elem: 'water', mouth: [0, -0.05, 0.3], scale: 1.0, anim: 'hop' },
  obachan: { name: '購買のおばちゃん', motif: '購買のおばちゃん', elem: 'water', mouth: [-0.2, 0.15, 0.5], scale: 0.95, anim: 'offer' },
  yasashi: { name: 'やさしい英語の先生', motif: 'やさしい先生', elem: 'wind', mouth: [0, -0.03, 0.62], scale: 0.95, anim: 'palms' },
  eki: { name: '駅で助ける先生', motif: '困った人を助ける先生', elem: 'wind', mouth: [0.3, -0.2, 0.5], scale: 0.95, anim: 'help' },
  mameta: { name: 'まめた', motif: '小さい豆柴', elem: 'water', mouth: [0, 0.23, 0.79], scale: 1.0, anim: 'wiggle' },
  ramen: { name: '学食ラーメン大盛り', motif: 'もやし山もりのラーメン', elem: 'fire', mouth: [0, 0.98, 0.2], scale: 0.95, anim: 'steamBurst' },
  kantoku: { name: '駅伝カントク', motif: '駅伝のカントク', elem: 'fire', mouth: [0, 0.2, 0.8], scale: 0.95, anim: 'megaphone' },
  rockets: { name: 'ロケッツ', motif: 'バンドのロケット', elem: 'wind', mouth: [0, 1.05, 0], scale: 0.95, anim: 'blast' },
  sanshin: { name: '楽器の先生', motif: '三線をひく先生', elem: 'water', mouth: [-0.08, -0.21, 0.43], scale: 0.95, anim: 'pluck' },
  shusseki: { name: '出席にきびしい先生', motif: '出席ぼと赤ペンの先生', elem: 'wind', mouth: [0, -1, 0.2], scale: 0.95, anim: 'stamp' },
  tani: { name: '単位くれそうな先生', motif: 'にこにこ先生', elem: 'water', mouth: [0, -0.95, 0.35], scale: 0.95, anim: 'drop' },
  aburasoba: { name: '学食の油そば', motif: 'つやつやの油そば', elem: 'fire', mouth: [0, -0.78, 0.25], scale: 0.95, anim: 'splash' },
  shuden: { name: '終電', motif: '最後の電車', elem: 'wind', mouth: [0, 0.06, 1.1], scale: 0.9, anim: 'depart' },
  seimon: { name: '正門ゲート', motif: '大学の正門', elem: 'water', mouth: [0, 0, 0.1], scale: 0.85, anim: 'open' },
  kiichiro: { name: 'きーちろう', motif: 'ピンクの髪のギタリスト', elem: 'fire', mouth: [0, 0, 0.8], scale: 0.95, anim: 'slide' },
  taka: { name: '青い鷹', motif: '青と白の鷹', elem: 'wind', mouth: [0, 0.25, 1.17], scale: 0.95, anim: 'circle' },
  screw: { name: 'スクリュー先生', motif: 'めがねの先生', elem: 'fire', mouth: [0, 1.25, 0], scale: 0.95, anim: 'corkscrew' },
  book: { name: 'ブック', motif: 'ボストンテリア', elem: 'water', mouth: [0, 0.27, 0.84], scale: 1.0, anim: 'zoom' },
};

// ---- それぞれの形（体のまん中が原点、前が +Z）----
const BUILD = {
};

// =====================================================================
// 大学のディスク：キャンパスの人（ぜんぶ作った架空の人）・犬・学食など
// 人は頭の大きい「ちびキャラ」。顔は、頭の表面にビーズの目・弧の口・まゆを置いて作る
// 前が +Z なので、本人の右手は -X 側（armR / handR は -X）
// 技が出る所には、からっぽのグループ「emit」を置く（mouth の値はここから測った）
// =====================================================================
const INK = 0x1c1626; // 目・まゆ・線の色
const JPF = '"Hiragino Sans","Hiragino Kaku Gothic ProN","Yu Gothic","Noto Sans JP","Noto Sans CJK JP",sans-serif';

// 字や模様の絵（同じ物は1回だけ作る）
const texCache = new Map();
function ctex(key, w, h, draw) {
  let t = texCache.get(key);
  if (!t) {
    t = shareMark(canvasTex(w, h, draw));
    texCache.set(key, t);
  }
  return t;
}
// うすく重ねる色（ほっぺ・湯気）。足し算ではなく、ふつうに重ねる
const softCache = new Map();
function soft(color, opacity) {
  const key = color + '|' + opacity;
  if (!softCache.has(key)) softCache.set(key, shareMark(new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false })));
  return softCache.get(key);
}
// 筆の線（まん中が太く、はしが細い管）。目を閉じた笑顔・口・まゆ・湯気など
function stroke(pts, r, seg = 10, rad = 5) {
  const key = 'st' + r + '|' + seg + '|' + rad + '|' + pts.map((p) => p.map((v) => v.toFixed(3)).join(',')).join(';');
  return G(key, () => {
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
    const g = new THREE.TubeGeometry(curve, seg, 1, rad, false);
    const pos = g.attributes.position;
    const v = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      const t = Math.floor(i / (rad + 1)) / seg;
      curve.getPointAt(t, c);
      v.fromBufferAttribute(pos, i).sub(c).multiplyScalar(r * (0.35 + 0.65 * Math.sin(Math.PI * t))).add(c);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    return g;
  });
}
// 物の前の面に、部品を表面の向きにそろえて置く道具（z：前の面の奥行き、rot：面の向き）
// put：部品を置く／arc：面にそった弧（中心 cx,cy2・半径 rr・角度 a0→a1、sy はたての伸び）／line：面にそった線
// gy：部品を入れるグループの高さ（そのグループの中の位置に直す）
function surfOf(z, rot) {
  const put = (par, geo, mat, x, y, s, push = 0, rz = 0, gy = 0) => {
    const r = rot(x, y);
    return part(par, geo, mat, [x, y - gy, z(x, y) + push], s, [r[0], r[1], rz]);
  };
  const arc = (cx, cy2, rr, a0, a1, r, sy = 1, lift = 0.006, gy = 0) => {
    const pts = [];
    for (let i = 0; i <= 6; i++) {
      const a = a0 + ((a1 - a0) * i) / 6;
      const x = cx + Math.cos(a) * rr, y = cy2 + Math.sin(a) * rr * sy;
      pts.push([x, y - gy, z(x, y) + lift]);
    }
    return stroke(pts, r);
  };
  const line = (pts2, r, lift = 0.006, gy = 0) => stroke(pts2.map(([x, y]) => [x, y - gy, z(x, y) + lift]), r);
  return { z, put, arc, line };
}
// だ円（半径 R、中心の高さ cy）の前の面
function surface(R, cy = 0) {
  const z = (x, y) => R[2] * Math.sqrt(Math.max(0.03, 1 - (x / R[0]) ** 2 - ((y - cy) / R[1]) ** 2));
  const S = surfOf(z, (x, y) => {
    const zz = z(x, y);
    return [-Math.atan2((y - cy) / (R[1] * R[1]), zz / (R[2] * R[2])), Math.atan2(x / (R[0] * R[0]), zz / (R[2] * R[2]))];
  });
  S.R = R;
  S.cy = cy;
  return S;
}
// 平らな面（クッキーの顔など）
function flatFace(z0) {
  return surfOf(() => z0, () => [0, 0]);
}
// ろくろの形（どんぶりなど）の前の面。prof：[半径, 高さ] の列
function latheFace(prof) {
  const rAt = (y) => {
    for (let i = 1; i < prof.length; i++) {
      const [r0, y0] = prof[i - 1], [r1, y1] = prof[i];
      if ((y - y0) * (y - y1) <= 0 && y1 !== y0) return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0);
    }
    return prof[prof.length - 1][0];
  };
  const z = (x, y) => Math.sqrt(Math.max(0.0001, rAt(y) ** 2 - x * x));
  // かべが上へ開いているほど、面は下を向く（その分だけ部品もかたむける）
  const slope = (y) => (rAt(y + 0.02) - rAt(y - 0.02)) / 0.04;
  return surfOf(z, (x, y) => [Math.atan(slope(y)), Math.atan2(x, z(x, y))]);
}

// 顔をつくる（目・まゆ・口・鼻・ほっぺ）。F：表面（surface / flatFace）
//  eye: 'bead'（黒いビーズ）| 'smile'（とじた笑顔 ^^）| 'none'（サングラスなど）
//  mouth: 'smile' | 'grin'（歯の見える笑い）| 'flat' | 'smirk' | 'cat'（ω）| 'none'
//  brow: [外はしの上がり, 高さ, 長さ, 太さ, 山なり]
function makeFace(head, F, T, o) {
  const N = (s) => (o.pre || '') + s; // 部品の名前（同じ体に顔が2つあるとき用）
  const ex = o.ex != null ? o.ex : 0.135, ey = o.ey != null ? o.ey : -0.03, es = o.es || 1;
  const my = o.my != null ? o.my : -0.17, ms = o.ms || 1;
  const eyes = grp(head, N('eyes'), [0, ey, 0]);
  if (!o.eye || o.eye === 'bead') {
    for (const sx of [-1, 1]) {
      F.put(eyes, SPH(7), glow(o.eyeCol || INK), sx * ex, ey, [0.05 * es, 0.066 * es * (o.eyeH || 1), 0.03], -0.01, 0, ey);
      F.put(eyes, SPH(5), glow(0xffffff), sx * ex + 0.017 * es, ey + 0.026 * es * (o.eyeH || 1), 0.018 * es, 0.013, 0, ey);
      // まつげ（目じりに1本）
      if (o.lash) part(eyes, F.line([[sx * (ex + 0.03 * es), ey + 0.045 * es], [sx * (ex + 0.07 * es), ey + 0.07 * es]], 0.012, 0.004, ey), glow(INK));
    }
  }
  // とじた笑顔の目（^^）。ふだんは見えない人もいる（技のときだけ笑う）
  const eyesC = grp(head, N('eyesC'), [0, ey, 0]);
  for (const sx of [-1, 1]) part(eyesC, F.arc(sx * ex, ey - 0.03 * es, 0.05 * es, 0.4, Math.PI - 0.4, 0.018 * es, 1.1, 0.006, ey), glow(INK));
  eyesC.visible = o.eye === 'smile';
  if (o.brow) {
    const [up, bh, bl, bw, bend] = o.brow;
    const brows = grp(head, N('brows'));
    for (const sx of [-1, 1]) {
      const xi = sx * (ex - bl * 0.5), xo = sx * (ex + bl * 0.5);
      part(brows, F.line([[xi, bh - up * bl * 0.5], [sx * ex, bh + (bend || 0)], [xo, bh + up * bl * 0.5]], bw), glow(o.browCol || INK));
    }
  }
  // 口（犬は、口だけ鼻づらの面に置く：mpar・MF）
  const MP = o.mpar || head, MF = o.MF || F;
  const mc = o.mouthCol || 0x5a1c26;
  if (o.mouth === 'smile') part(MP, MF.arc(0, my + 0.05 * ms, 0.07 * ms, Math.PI + 0.6, Math.PI * 2 - 0.6, 0.017, 1, 0.006), glow(mc), [0, 0, 0], 1, [0, 0, 0], { name: N('mouthS') });
  else if (o.mouth === 'flat') part(MP, MF.line([[-0.05 * ms, my], [0, my - 0.004], [0.05 * ms, my]], 0.016), glow(mc), [0, 0, 0], 1, [0, 0, 0], { name: N('mouthS') });
  else if (o.mouth === 'smirk') part(MP, MF.line([[-0.055 * ms, my + 0.01], [0, my - 0.012], [0.06 * ms, my + 0.03]], 0.016), glow(mc), [0, 0, 0], 1, [0, 0, 0], { name: N('mouthS') });
  else if (o.mouth === 'cat') {
    const g = grp(MP, N('mouthS'));
    for (const sx of [-1, 1]) part(g, MF.arc(sx * 0.034 * ms, my + 0.016 * ms, 0.034 * ms, Math.PI + 0.2, Math.PI * 2 - 0.2, 0.014), glow(o.mouthCol || 0x3a1418));
  } else if (o.mouth === 'grin') part(MP, MF.line([[-0.06 * ms, my + 0.01], [0, my - 0.01], [0.06 * ms, my + 0.01]], 0.018), glow(mc), [0, 0, 0], 1, [0, 0, 0], { name: N('mouthS') });
  // 開いた口（さけぶ・食べる）。たての大きさで開き方を変える
  const mz = MF.z(0, my);
  const mo = grp(MP, N('mouthO'), [0, my, mz - 0.008]);
  if (MF.R) mo.rotation.x = -Math.atan2((my - MF.cy) / (MF.R[1] * MF.R[1]), mz / (MF.R[2] * MF.R[2]));
  part(mo, HEMI(), glow(0x5a1822), [0, 0, 0], [0.085 * ms, 0.075 * ms, 0.03], [Math.PI, 0, 0]);
  part(mo, SPH(6), glow(0xff7f90), [0, -0.042 * ms, 0.012], [0.05 * ms, 0.022 * ms, 0.02]);
  if (o.teeth) part(mo, BOX(), glow(0xffffff), [0, -0.012 * ms, 0.017], [0.13 * ms, 0.024 * ms, 0.01]);
  mo.visible = o.mouth === 'grin' && o.grinOpen !== false;
  if (o.mouth === 'grin' && MP.getObjectByName(N('mouthS'))) MP.getObjectByName(N('mouthS')).visible = !mo.visible;
  if (o.nose) F.put(head, SPH(6), T(o.nose), 0, (ey + my) / 2 - 0.012, [0.032, 0.026, 0.03], -0.012);
  if (o.blush) for (const sx of [-1, 1]) F.put(head, SPH(6), soft(0xff6f8e, 0.42), sx * (ex + 0.085), my + 0.07, [0.06, 0.034, 0.02], 0.003);
}

// 髪のぼうし形（頭の上と後ろをおおう半球）。tilt：大きいほど おでこが広い
function hairCap(head, R, mat, tilt = 0.5, k = 1.06, lift = 0.01, back = -0.01) {
  // 小さい頭（肩の学生など）は、あらい半球で十分
  const geo = R[0] < 0.2 ? G('hemiLo', () => new THREE.SphereGeometry(1, 14, 5, 0, Math.PI * 2, 0, Math.PI / 2)) : HEMI();
  return part(head, geo, mat, [0, lift, back], [R[0] * k, R[1] * k, R[2] * k], [-tilt, 0, 0], { outline: true });
}
// めがね。kind：'round'（丸）| 'brow'（上がふといサーモント）| 'sun'（サングラス）
function glasses(head, F, color, kind, ex = 0.135, ey = -0.03, r = 0.085) {
  const g = grp(head, 'glasses');
  const z0 = (x) => F.z(x, ey) + 0.03;
  for (const sx of [-1, 1]) {
    const x = sx * ex;
    if (kind === 'round') {
      part(g, TOR(0.12), glow(color), [x, ey, z0(x)], r, [0, sx * 0.3, 0]);
      part(g, BOX(), glow(0xffffff, 0.55), [x + 0.02, ey + 0.03, z0(x) + 0.004], [0.05, 0.012, 0.004], [0, sx * 0.3, 0.6]);
    } else if (kind === 'brow') {
      part(g, BOX(), glow(color), [x, ey + r * 0.62, z0(x)], [r * 2.3, 0.04, 0.03], [0, sx * 0.3, 0]);
      part(g, BOX(), glow(color), [x, ey - r * 0.62, z0(x) - 0.004], [r * 2.1, 0.014, 0.014], [0, sx * 0.3, 0]);
      for (const k of [-1, 1]) part(g, BOX(), glow(color), [x + k * r * 1.08, ey, z0(x) - k * sx * 0.012], [0.014, r * 1.25, 0.014], [0, sx * 0.3, 0]);
      part(g, BOX(), glow(0xffffff, 0.6), [x + 0.025, ey + 0.012, z0(x) + 0.004], [0.06, 0.013, 0.004], [0, sx * 0.3, 0.55]);
    } else {
      part(g, SPH(8), T2(0x15151c), [x, ey + 0.005, z0(x) - 0.01], [r * 1.25, r * 0.9, 0.03], [0, sx * 0.3, 0], { outline: true, ow: 0.015 });
      part(g, BOX(), glow(0xffffff, 0.7), [x + 0.03, ey + 0.03, z0(x) + 0.016], [0.055, 0.014, 0.004], [0, sx * 0.3, 0.6]);
    }
    // つる（耳まで）
    part(g, BOX(), glow(color), [sx * (F.R[0] * 0.92), ey + 0.02, -0.02 + F.R[2] * 0.25], [0.014, 0.014, F.R[2] * 0.75], [0, sx * -0.15, 0]);
  }
  part(g, F.line([[-ex + r, ey + 0.01], [0, ey + 0.025], [ex - r, ey + 0.01]], 0.012, 0.03), glow(color));
  return g;
}
// サングラスの色（ふちの光なしのトゥーン）
function T2(color) {
  return rimMat(color, 0x000000);
}

// ---- ちびキャラの人 ----
// 体のまん中が原点。o: skin（肌）, top（上着）, sleeve（'long'|'short'）, sleeveCol, pants, shoes, gw（横はば）, gd（あつみ）, R（頭の半径）
function person(root, c, o) {
  const T = (x) => rimMat(x, c.rim);
  const gw = o.gw || 1, gd = o.gd || 1;
  const body = grp(root, 'body');
  // 足（すこしぶらさがる。うかんでいるので）
  const legs = grp(body, 'legs', [0, -0.46, 0]);
  for (const sx of [-1, 1]) {
    const l = grp(legs, sx < 0 ? 'legR' : 'legL', [sx * 0.135 * gw, 0, 0]);
    part(l, tube('pLeg', [[0, 0.06, 0], [0, -0.14, 0.01], [0, -0.3, 0]], 0.1, 0.085, 6, 8), T(o.legCol || o.pants), [0, 0, 0], 1, [0, 0, 0], { outline: true });
    part(l, SPH(7), T(o.shoes), [0, -0.34, 0.05], [0.1, 0.07, 0.15], [0, 0, 0], { outline: true });
  }
  // 胴（腰が回る所が原点）
  const torso = grp(body, 'torso', [0, -0.46, 0]);
  const TR = [0.31 * gw, 0.33, 0.25 * gd];
  const top = o.topMat || T(o.top); // 柄のある服は topMat（絵を貼った材料）
  part(torso, SPH(12), top, [0, 0.25, 0], TR, [0, 0, 0], { outline: true, name: 'chest' });
  const B = surface(TR, 0.25);
  // スカート・ズボンの上（腰まわり）
  if (o.skirt) part(torso, CYL(16), T(o.skirt), [0, -0.02, 0], [0.3 * gw, 0.26, 0.25 * gd], [0, 0, 0], { outline: true });
  // 頭（まん中が回る所）
  const R = o.R || [0.4, 0.38, 0.37];
  const head = grp(torso, 'head', [0, 0.9, 0.02]);
  part(head, SPH(14), T(o.skin), [0, 0, 0], R, [0, 0, 0], { outline: true });
  const F = surface(R);
  for (const sx of [-1, 1]) part(head, SPH(6), T(o.skin), [sx * R[0] * 0.95, -0.04, -0.02], [0.055, 0.08, 0.05], [0, 0, 0], { outline: true, ow: 0.02 });
  // 髪の材料は、ふちの光を弱く（こい色の髪がヘルメットのように光らないように）
  const dim = new THREE.Color(c.rim).multiplyScalar(0.4).getHex();
  const HT = (x) => rimMat(x, dim);
  const P = { T, HT, body, legs, torso, head, R, F, B, TR, gw };
  // 腕（肩が回る所）。手のグループに持ち物を付ける
  for (const sx of [-1, 1]) {
    const nm = sx < 0 ? 'R' : 'L';
    const a = grp(torso, 'arm' + nm, [sx * 0.27 * gw, 0.42, 0], [0, 0, sx * 0.12]);
    if (o.sleeve === 'short') {
      part(a, tube('pSlvS', [[0, 0.04, 0], [0, -0.07, 0.005], [0, -0.16, 0.01]], 0.1, 0.092, 4, 8), top, [0, 0, 0], 1, [0, 0, 0], { outline: true });
      part(a, tube('pArmS', [[0, -0.1, 0.005], [0, -0.22, 0.015], [0, -0.32, 0.02]], 0.066, 0.06, 4, 7), T(o.skin), [0, 0, 0], 1, [0, 0, 0], { outline: true });
    } else part(a, tube('pArm', [[0, 0.04, 0], [0, -0.15, 0.01], [0, -0.31, 0.02]], 0.092, 0.078, 6, 8), T(o.sleeveCol || o.top), [0, 0, 0], 1, [0, 0, 0], { outline: true });
    const h = grp(a, 'hand' + nm, [0, -0.36, 0.025]);
    part(h, SPH(6), T(o.skin), [0, 0, 0], 0.08, [0, 0, 0], { outline: true, ow: 0.02 });
    P['arm' + nm] = a;
    P['hand' + nm] = h;
  }
  return P;
}

// ---- 持ち物 ----
// 本・板など：まん中の箱（side）と、前と後ろの板（front は字の絵を貼る）
function paperBox(par, name, p, s, r, front, side, back) {
  const g = grp(par, name, p, r);
  part(g, BOX(), side, [0, 0, 0], [s[0] * 0.97, s[1] * 0.97, s[2]], [0, 0, 0], { outline: true, ow: 0.015 });
  part(g, BOX(), front, [0, 0, s[2] / 2], [s[0], s[1], 0.012], [0, 0, 0], { outline: true, ow: 0.015 });
  if (back) part(g, BOX(), back, [0, 0, -s[2] / 2], [s[0], s[1], 0.012], [0, 0, 0], { outline: true, ow: 0.015 });
  return g;
}
// エレキギター（体の前、右の腰にボディ、ネックは左上へ）。色：ボディ・ピックガード
function guitar(par, c, T, body, guard, p, r) {
  const g = grp(par, 'guitar', p, r);
  part(g, flat('gtBody', [[-0.2, -0.24], [0, -0.28], [0.2, -0.24], [0.24, -0.06], [0.17, 0.06], [0.2, 0.2], [0.12, 0.22], [0.06, 0.1], [-0.06, 0.1], [-0.13, 0.25], [-0.21, 0.2], [-0.17, 0.05], [-0.24, -0.08]], 0.08, 0.03), T(body), [0, 0, 0], 1, [-Math.PI / 2, 0, 0], { outline: true, ow: 0.02 });
  part(g, flat('gtGuard', [[-0.14, -0.16], [0.06, -0.2], [0.15, -0.08], [0.05, 0.06], [-0.04, 0.06], [-0.15, 0.0]], 0.01, 0.004), T(guard), [0, 0, 0.066], 1, [-Math.PI / 2, 0, 0]);
  part(g, BOX(), T(0x2a1d18), [0, 0.42, 0.03], [0.065, 0.62, 0.035], [0, 0, 0], { outline: true, ow: 0.015 });
  part(g, BOX(), T(0x1c1418), [0, 0.8, 0.02], [0.1, 0.17, 0.03], [0, 0, 0], { outline: true, ow: 0.015 });
  for (let i = 0; i < 3; i++) for (const sx of [-1, 1]) part(g, CYL(6), T(0xd8dde6), [sx * 0.065, 0.74 + i * 0.05, 0.02], [0.015, 0.03, 0.015], [0, 0, Math.PI / 2]);
  part(g, BOX(), T(0x15151a), [0, -0.02, 0.075], [0.13, 0.04, 0.02]);
  part(g, BOX(), T(0x15151a), [0, -0.12, 0.075], [0.13, 0.04, 0.02]);
  part(g, BOX(), T(0xd8dde6), [0, -0.19, 0.076], [0.12, 0.025, 0.02]);
  for (const sx of [-1, 1]) part(g, CYL(8), T(0xd8dde6), [0.1 + sx * 0.03, -0.18 - sx * 0.03, 0.07], [0.022, 0.03, 0.022], [Math.PI / 2, 0, 0]);
  // 弦（属性の色に光る）
  for (let i = -1; i <= 1; i++) part(g, BOX(), glow(c.glow), [i * 0.018, 0.3, 0.086], [0.005, 0.98, 0.005]);
  addGlow(g, c.glow, 0.7, [0, -0.08, 0.1], 0.55);
  return g;
}
// 音符（技のときに飛ぶ。ふだんは見えない）。足し算の光なので、ディスクの画面の大きさ合わせには入らない
function notes(par, color, n = 3) {
  const g = grp(par, 'notes');
  const m = glow(color, 0.95);
  for (let i = 0; i < n; i++) {
    const q = grp(g, 'note' + i, [0, 0, 0]);
    part(q, SPH(6), m, [0, 0, 0], [0.07, 0.055, 0.04], [0, 0, 0.4]);
    part(q, BOX(), m, [0.055, 0.12, 0], [0.018, 0.24, 0.018]);
    part(q, BOX(), m, [0.09, 0.22, 0], [0.07, 0.03, 0.018], [0, 0, -0.5]);
  }
  g.visible = false;
  return g;
}
// 湯気（ゆらゆらの白い線）。足し算の光なので、ディスクの画面の大きさ合わせには入らない
function steam(par, n, spread, h, name = 'steam') {
  const g = grp(par, name);
  for (let i = 0; i < n; i++) {
    const x = (i - (n - 1) / 2) * spread;
    const w = grp(g, name + i, [x, 0, (i % 2) * 0.08 - 0.04]);
    part(w, stroke([[0, 0, 0], [0.06, h * 0.3, 0], [-0.05, h * 0.62, 0], [0.04, h, 0]], 0.045, 12, 6), glow(0xffffff, 0.55));
  }
  return g;
}

// ---- 大学のディスクの形 ----
Object.assign(BUILD, {
  // でっかい英語の先生（ポロシャツ・教科書）
  eigo(root, c) {
    const p = person(root, c, { skin: 0xf3c69c, top: 0x2fb36a, sleeve: 'short', pants: 0xc9b48a, shoes: 0xf2f2ee, gw: 1.4, gd: 1.2, R: [0.44, 0.41, 0.4] });
    const { T, torso, head, F, B } = p;
    // ポロシャツ：白いえり・前立て・ボタン
    for (const sx of [-1, 1]) part(torso, flat('eiCollar', [[0, 0.03], [0.19, 0.05], [0.07, -0.12]], 0.03, 0.012), T(0xffffff), [sx * 0.01, 0.51, B.z(0, 0.51) - 0.02], [sx, 1, 1], [-Math.PI / 2 + 0.55, 0, 0], { outline: true, ow: 0.015 });
    B.put(torso, BOX(), T(0xf4f4f4), 0, 0.4, [0.06, 0.15, 0.02], -0.004);
    for (let i = 0; i < 2; i++) B.put(torso, SPH(5), T(0xbfc4cc), 0, 0.44 - i * 0.07, 0.016, 0.008);
    // 髪（みじかい黒。生えぎわは少しギザギザ、もみあげ）
    const H = p.HT(0x23202a);
    hairCap(head, p.R, H, 0.5, 1.05);
    for (let i = -3; i <= 3; i++) part(head, CONE(4), H, [i * 0.075, 0.24 - Math.abs(i) * 0.025, F.z(i * 0.075, 0.24) - 0.03], [0.06, 0.09, 0.04], [Math.PI - 0.5, 0, i * 0.12]);
    for (const sx of [-1, 1]) part(head, BOX(), H, [sx * 0.4, 0.02, 0.06], [0.05, 0.16, 0.07], [0, sx * 0.3, 0]);
    makeFace(head, F, T, { es: 1.12, ey: -0.02, my: -0.18, ms: 1.25, brow: [0.25, 0.1, 0.12, 0.024, 0.025], mouth: 'grin', teeth: true, nose: 0xe8b088 });
    // 教科書（左手で胸の前に）。表紙に ENGLISH
    const cover = ctex('eiBook', 128, 160, (x, w, h) => {
      x.fillStyle = '#2b5fd9';
      x.fillRect(0, 0, w, h);
      x.fillStyle = '#ffd23a';
      x.fillRect(0, 18, w, 30);
      x.fillStyle = '#fff';
      x.font = '900 26px ' + JPF;
      x.textAlign = 'center';
      x.fillText('ENGLISH', w / 2, 92);
      x.font = '700 16px ' + JPF;
      x.fillText('A B C', w / 2, 122);
      x.strokeStyle = '#ffffff';
      x.lineWidth = 3;
      x.strokeRect(8, 6, w - 16, h - 12);
    });
    p.armL.rotation.set(-0.8, 0, -0.5);
    const bk = grp(p.handL, 'book', [-0.08, 0.08, 0.07], [0.8, 0.25, 0.5]);
    paperBox(bk, '', [0, 0, 0], [0.36, 0.46, 0.08], [0, 0, 0], rimMat(0xffffff, c.rim, { map: cover }), T(0xf6f1e2), T(0x2b5fd9));
    part(bk, BOX(), T(0x1d47a8), [-0.18, 0, 0], [0.025, 0.465, 0.085]);
    p.armR.rotation.set(-0.15, 0, -0.18);
    grp(head, 'emit', [0, -0.18, 0.46]);
  },

  // 革ジャンの先生（ロックな先生・エレキギター）
  rocker(root, c) {
    const p = person(root, c, { skin: 0xf0c39a, top: 0x26262e, pants: 0x34446c, shoes: 0x18181c, gw: 1.08, R: [0.4, 0.38, 0.37] });
    const { T, torso, head, F, B } = p;
    // 赤いTシャツと、革ジャンのえり・ファスナー
    B.put(torso, SPH(10), T(0xd8323a), 0, 0.3, [0.13, 0.25, 0.05], -0.03);
    for (const sx of [-1, 1]) {
      part(torso, flat('rkLapel', [[0, 0.1], [0.12, 0.08], [0.06, -0.26], [0.0, -0.3]], 0.03, 0.01), T(0x34343e), [sx * 0.13, 0.5, B.z(0.13, 0.4) - 0.01], [sx, 1, 1], [-Math.PI / 2 + 0.35, sx * 0.35, 0], { outline: true, ow: 0.015 });
      part(torso, B.line([[sx * 0.13, 0.44], [sx * 0.11, 0.2], [sx * 0.12, -0.02]], 0.012, 0.012), glow(0xd8dde6));
    }
    // 長めの髪（白髪まじり）とあごひげ
    const H = p.HT(0x2e2630);
    hairCap(head, p.R, H, 0.45, 1.07);
    part(head, SPH(10), H, [0, -0.17, -0.2], [0.38, 0.34, 0.2], [0.3, 0, 0], { outline: true });
    for (const sx of [-1, 1]) part(head, tube('rkLock', [[0, 0, 0], [sx * 0.04, -0.2, 0.02], [sx * 0.02, -0.42, -0.04]], 0.09, 0.03, 8, 7), sx > 0 ? T(0x9a96a2) : H, [sx * 0.33, 0.06, 0.05], 1, [0, 0, 0], { outline: true, ow: 0.02 });
    // 前髪（とがった毛のたば）
    for (let i = -2; i <= 2; i++) part(head, tube('rkBang' + (i & 1), [[0, 0, 0], [0.01, -0.07, 0.03], [0.03 * (i & 1 ? 1 : -1), -0.15, 0.02]], 0.065, 0.012, 6, 6), H, [i * 0.1, 0.3 - Math.abs(i) * 0.03, F.z(i * 0.1, 0.3) - 0.04], 1, [0, 0, -i * 0.15], { outline: true, ow: 0.015 });
    makeFace(head, F, T, { eye: 'none', brow: [0.2, 0.1, 0.12, 0.022], my: -0.19, mouth: 'smirk', nose: 0xe2ad86 });
    glasses(head, F, 0x2a2a30, 'sun');
    part(head, SPH(6), T(0x55505a), [0, -0.3, F.z(0, -0.3) - 0.03], [0.06, 0.05, 0.04], [0, 0, 0], { outline: true, ow: 0.015 });
    part(head, F.line([[-0.07, -0.135], [0, -0.125], [0.07, -0.135]], 0.016), glow(0x55505a));
    // ギター（ボディは右の腰、ネックは左上）。ストラップは左の肩へ
    guitar(torso, c, T, 0xd8262c, 0xf4f1ea, [-0.1, 0.17, 0.3], [0.1, 0, -0.95]);
    part(torso, tube('rkStrap', [[-0.24, 0.02, 0.2], [-0.05, 0.3, 0.26], [0.2, 0.56, 0.12], [0.26, 0.52, -0.12]], 0.025, 0.025, 10, 5), T(0x15151a));
    p.armR.rotation.set(-0.85, 0, 0.45);
    p.armL.rotation.set(-1.4, 0, -0.15);
    grp(torso.getObjectByName('guitar'), 'emit', [0, -0.05, 0.2]);
  },

  // 学食カレー（大きいスプーンでカレーを飛ばす）
  curry(root, c) {
    const T = (x) => rimMat(x, c.rim);
    // 皿は少し前へかたむける（下から見るディスクの画面でも、上にのった物が見える）
    const body = grp(root, 'body', [0, 0.1, 0], [0.28, 0, 0]);
    // 皿（だ円の浅い皿）
    part(body, G('cuPlate', () => new THREE.LatheGeometry([[0, -0.05], [0.72, -0.05], [0.86, 0], [0.96, 0.07], [0.98, 0.09], [0.96, 0.1], [0.84, 0.03], [0, 0.03]].map((q) => new THREE.Vector2(q[0], q[1])), 28)), T(0xfaf8f2), [0, -0.5, 0], [1, 1, 0.74], [0, 0, 0], { outline: true });
    part(body, TOR(0.05), T(0x3d9bd8), [0, -0.415, 0], [0.9, 0.9 * 0.74, 0.9], [Math.PI / 2, 0, 0]);
    // ごはん（顔がある）
    const rice = grp(body, 'rice', [0.22, -0.47, -0.08]);
    const RR = [0.46, 0.52, 0.4];
    part(rice, HEMI(), T(0xfffbf0), [0, 0, 0], RR, [0, 0, 0], { outline: true });
    for (let i = 0; i < 9; i++) {
      const a = i * 2.4, rr = 0.15 + (i % 3) * 0.1;
      part(rice, SPH(4), T(0xf2ecd8), [Math.cos(a) * rr, Math.sqrt(Math.max(0, 1 - (rr / 0.46) ** 2)) * 0.5, Math.sin(a) * rr * 0.8 - 0.05], [0.035, 0.018, 0.025], [0, a, 0]);
    }
    const F = surface(RR);
    makeFace(rice, F, T, { ex: 0.12, ey: 0.27, es: 1.05, my: 0.13, mouth: 'smile', blush: true });
    // カレー（つやつや）と具
    const cu = grp(body, 'roux', [-0.25, -0.44, 0.12]);
    part(cu, SPH(12), T(0xb8571a), [0, 0, 0], [0.62, 0.17, 0.44], [0, 0.4, 0], { outline: true });
    part(cu, stroke([[-0.3, 0.15, 0.12], [-0.1, 0.17, 0.22], [0.12, 0.155, 0.24]], 0.03, 8, 4), soft(0xffffff, 0.55));
    const bits = [[0.18, 0.13, 0.05, 0xf3c65a, 0.12], [-0.22, 0.13, -0.08, 0xff8a2a, 0.1], [-0.05, 0.14, 0.22, 0x6a321a, 0.11], [-0.38, 0.1, 0.12, 0xf3c65a, 0.1], [0.04, 0.14, -0.16, 0x6a321a, 0.1]];
    for (const [x, y, z, col, s] of bits) part(cu, BOX(), T(col), [x, y, z], s, [0.5, x * 4, 0.3], { outline: true, ow: 0.012 });
    // 福神漬け
    for (let i = 0; i < 4; i++) part(body, BOX(), T(0xe0283a), [0.62 + (i % 2) * 0.07, -0.43, 0.2 + i * 0.07], [0.05, 0.03, 0.04], [0, i, 0]);
    // 大きいスプーン（にぎりは皿のおく、すくう所が上でカレーをのせる）
    const sp = grp(body, 'spoon', [-0.2, -0.42, -0.25], [-0.5, 0, 0.18]);
    part(sp, tube('cuSpoon', [[0, 0, 0], [0, 0.35, 0.03], [0, 0.66, 0.0]], 0.065, 0.045, 8, 7), T(0xdfe6ef), [0, 0, 0], 1, [0, 0, 0], { outline: true, ow: 0.02 });
    part(sp, SPH(10), T(0xdfe6ef), [0, 0.84, 0.03], [0.18, 0.23, 0.06], [0, 0, 0], { outline: true, ow: 0.02 });
    part(sp, SPH(8), T(0xb8571a), [0, 0.84, 0.07], [0.13, 0.16, 0.06], [0, 0, 0], { name: 'scoop' });
    addGlow(sp, c.glow, 0.6, [0, 0.82, 0.1], 0.6);
    grp(sp, 'emit', [0, 0.85, 0.1]);
    // 湯気
    const st = steam(body, 3, 0.26, 0.55);
    st.position.set(-0.2, -0.3, 0.1);
  },

  // うんち出る出るクッキー（手づくりの丸いクッキー）
  cookie(root, c) {
    const T = (x) => rimMat(x, c.rim);
    const body = grp(root, 'body');
    const ck = grp(body, 'ck');
    // ふちがでこぼこの丸（手づくり）
    const pts = [];
    for (let i = 0; i < 30; i++) {
      const a = (i / 30) * Math.PI * 2;
      const r = 0.6 * (1 + 0.035 * Math.sin(3 * a + 0.5) + 0.03 * Math.sin(7 * a + 1.3) + 0.02 * Math.sin(11 * a + 2.1));
      pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    const slab = (key, k, d, b) =>
      G(key, () => {
        const s = new THREE.Shape();
        s.moveTo(pts[0][0] * k, pts[0][1] * k);
        for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0] * k, pts[i][1] * k);
        s.closePath();
        const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 3, curveSegments: 4 });
        g.translate(0, 0, -d / 2);
        g.computeVertexNormals();
        return g;
      });
    part(ck, slab('ckBody', 1, 0.16, 0.07), T(0xdc9d52), [0, 0, 0], 1, [0, 0, 0], { outline: true });
    part(ck, slab('ckEdge', 1.02, 0.08, 0.06), T(0xa9652a), [0, 0, -0.03]);
    // チョコチップ・ひび・砂糖
    const chips = [[-0.38, 0.22], [0.36, 0.28], [-0.26, -0.36], [0.4, -0.2], [0.05, 0.43], [-0.45, -0.05], [0.18, -0.44]];
    for (const [x, y] of chips) part(ck, SPH(5), T(0x4a2618), [x, y, 0.15], [0.065, 0.055, 0.04], [0, 0, x * 5], { outline: true, ow: 0.012 });
    for (const [x, y] of [[-0.2, 0.3], [0.3, -0.38]]) part(ck, BOX(), T(0xfff6e0), [x, y, 0.155], [0.025, 0.025, 0.01], [0, 0, 0.7]);
    part(ck, stroke([[0.3, 0.42, 0.15], [0.36, 0.33, 0.152], [0.47, 0.3, 0.15]], 0.012, 6, 4), glow(0x8a4a1c));
    part(ck, stroke([[-0.42, -0.3, 0.15], [-0.34, -0.26, 0.152], [-0.33, -0.17, 0.15]], 0.012, 6, 4), glow(0x8a4a1c));
    for (const [x, y] of [[-0.3, 0.1], [0.25, 0.35], [0.1, -0.3]]) part(ck, SPH(5), T(0x4a2618), [x, y, -0.15], [0.06, 0.05, 0.035]);
    const F = flatFace(0.145);
    makeFace(ck, F, T, { ex: 0.16, ey: 0.06, es: 1.15, my: -0.13, ms: 1.1, mouth: 'smile', blush: true, brow: [-0.15, 0.17, 0.08, 0.016] });
    // 小さい手と足
    for (const sx of [-1, 1]) {
      const a = grp(ck, sx < 0 ? 'armR' : 'armL', [sx * 0.6, -0.06, 0], [0, 0, sx * 0.5]);
      part(a, SPH(7), T(0xdc9d52), [0, -0.1, 0], [0.085, 0.13, 0.085], [0, 0, 0], { outline: true, ow: 0.02 });
      const l = grp(body, sx < 0 ? 'legR' : 'legL', [sx * 0.2, -0.6, 0]);
      part(l, SPH(7), T(0xb8763a), [0, -0.05, 0.03], [0.1, 0.07, 0.13], [0, 0, 0], { outline: true, ow: 0.02 });
    }
    grp(ck, 'emit', [0, 0, 0.3]);
  },

  // 購買のおばちゃん（エプロン・三角巾・ソフトクリーム）
  obachan(root, c) {
    const p = person(root, c, { skin: 0xf6cfaa, top: 0xf2a2b6, pants: 0x6d5c56, shoes: 0xf4f0ea, gw: 1.24, gd: 1.18, R: [0.41, 0.39, 0.38] });
    const { T, torso, head, F, B, TR } = p;
    // エプロン（胸から下の前だけの布）＋ポケット＋かたひも。横からピンクの服が見える
    part(torso, G('obApron', () => new THREE.SphereGeometry(1, 12, 8, Math.PI / 2 - 0.72, 1.44, 1.0, Math.PI - 1.0)), T(0x4fb0e8), [0, 0.25, 0], [TR[0] * 1.05, TR[1] * 1.05, TR[2] * 1.08], [0, 0, 0], { outline: true });
    B.put(torso, BOX(), T(0x9ad6ff), 0, 0.02, [0.2, 0.1, 0.03], 0.025);
    for (const sx of [-1, 1]) part(torso, B.line([[sx * 0.12, 0.36], [sx * 0.16, 0.5], [sx * 0.2, 0.56]], 0.028, 0.02), T(0x4fb0e8));
    part(torso, B.line([[-0.2, 0.36], [0, 0.375], [0.2, 0.36]], 0.03, 0.025), T(0x4fb0e8));
    // パーマの髪（前と横に見える）
    const H = p.HT(0x5a3a32);
    hairCap(head, p.R, H, 0.42, 1.04);
    // 耳の上と後ろに、パーマのふくらみ
    for (const [x, y, z, s] of [[0.36, 0.0, 0.0, 0.12], [-0.36, 0.0, 0.0, 0.12], [0.3, -0.06, -0.22, 0.13], [-0.3, -0.06, -0.22, 0.13], [0, -0.06, -0.33, 0.15]]) part(head, SPH(7), H, [x, y, z], s, [0, 0, 0], { outline: true, ow: 0.02 });
    // 赤い水玉の三角巾（頭のてっぺんから後ろ。うしろで結ぶ）
    const K = T(0xf05a6e);
    part(head, HEMI(), K, [0, 0.08, -0.03], [0.45, 0.42, 0.43], [-0.85, 0, 0], { outline: true });
    for (let i = 0; i < 7; i++) {
      const a = i * 0.95 + 0.2;
      part(head, SPH(4), glow(0xffffff), [Math.cos(a) * 0.24, 0.42 - (i % 2) * 0.06, Math.sin(a) * 0.22 - 0.1], 0.04);
    }
    part(head, flat('obTail', [[-0.12, 0], [0.12, 0], [0.0, -0.26]], 0.03, 0.012), K, [0, -0.1, -0.44], 1, [-Math.PI / 2 - 0.25, 0, 0], { outline: true, ow: 0.015 });
    for (const sx of [-1, 1]) part(head, SPH(6), K, [sx * 0.06, -0.1, -0.44], [0.06, 0.05, 0.05], [0, 0, 0], { outline: true, ow: 0.015 });
    makeFace(head, F, T, { eye: 'smile', es: 1.05, my: -0.17, ms: 1.15, mouth: 'smile', blush: true, nose: 0xeab08e, brow: [-0.12, 0.1, 0.1, 0.016] });
    // ソフトクリーム（右手で前に）
    p.armR.rotation.set(-0.95, 0, 0.32);
    const ic = grp(p.handR, 'icecream', [0.02, 0.05, 0.04], [0.95, 0, -0.32]);
    part(ic, CONE(10), T(0xe0a45a), [0, -0.02, 0], [0.075, 0.24, 0.075], [Math.PI, 0, 0], { outline: true, ow: 0.015 });
    for (let i = 0; i < 2; i++) part(ic, stroke([[-0.06 + i * 0.03, 0.09, 0.04], [0.0 + i * 0.02, -0.06, 0.04]], 0.01, 4, 4), glow(0x9a5a22));
    // ソフトクリームのうずまき（ろくろの形で、だんだんにくびれる）
    const swirl = G('obSwirl', () => {
      const q = [[0, 0.06]];
      for (let i = 0; i <= 12; i++) {
        const y = 0.07 + i * 0.022, f = 1 - i / 13;
        q.push([(0.03 + 0.085 * f) * (0.82 + 0.18 * Math.cos(i * 1.6)), y]);
      }
      q.push([0, 0.36]);
      return new THREE.LatheGeometry(q.map((v) => new THREE.Vector2(v[0], v[1])), 14);
    });
    part(ic, swirl, T(0xfff4dc), [0, 0, 0], 1, [0, 0, 0], { outline: true, ow: 0.012 });
    addGlow(ic, c.glow, 0.7, [0, 0.2, 0.02], 0.6);
    grp(ic, 'emit', [0, 0.2, 0.05]);
    p.armL.rotation.set(0.1, 0, 0.32);
  },

  // やさしい英語の先生（はげ頭・カーディガン・丸めがね）
  yasashi(root, c) {
    const p = person(root, c, { skin: 0xf5cba5, top: 0x7aa65e, pants: 0x6a6d78, shoes: 0x6a4a34, gw: 1.1, R: [0.41, 0.4, 0.38] });
    const { T, torso, head, F, B } = p;
    // カーディガンの前（白いシャツ・ネクタイ・ボタン）
    B.put(torso, SPH(10), T(0xfafafa), 0, 0.36, [0.12, 0.22, 0.05], -0.03);
    part(torso, flat('ysTie', [[-0.035, 0.0], [0.035, 0.0], [0.05, -0.2], [0, -0.25], [-0.05, -0.2]], 0.02, 0.008), T(0x9a4a2a), [0, 0.52, B.z(0, 0.4) + 0.02], 1, [-Math.PI / 2 + 0.3, 0, 0]);
    for (const sx of [-1, 1]) part(torso, B.line([[sx * 0.12, 0.52], [sx * 0.08, 0.3], [sx * 0.06, 0.0]], 0.025, 0.014), T(0x5d8848));
    for (let i = 0; i < 3; i++) B.put(torso, SPH(5), T(0xe8d8b0), 0.075, 0.24 - i * 0.1, 0.02, 0.01);
    // はげ頭（光る）と横の白い髪
    F.put(head, SPH(8), soft(0xffffff, 0.55), 0.1, 0.27, [0.08, 0.045, 0.02], 0.002, -0.4);
    const W = T(0xe4e0d8);
    for (const sx of [-1, 1]) part(head, SPH(8), W, [sx * 0.36, 0.02, -0.1], [0.1, 0.15, 0.17], [0, 0, 0], { outline: true, ow: 0.02 });
    part(head, SPH(10), W, [0, -0.02, -0.3], [0.3, 0.15, 0.12], [0, 0, 0], { outline: true, ow: 0.02 });
    makeFace(head, F, T, { eye: 'smile', es: 1.0, my: -0.17, mouth: 'smile', blush: true, nose: 0xeab08e, brow: [-0.3, 0.1, 0.1, 0.02], browCol: 0xb8b2a8 });
    glasses(head, F, 0xc8a04a, 'round', 0.135, -0.04, 0.09);
    // 両手をおなかの前で組む
    p.armL.rotation.set(-0.55, 0, -0.45);
    p.armR.rotation.set(-0.55, 0, 0.45);
    // 手のあいだの光（技のとき大きくなる）
    const orb = grp(torso, 'orb', [0, 0.42, 0.62]);
    part(orb, SPH(10), glow(0xf6ffe8), [0, 0, 0], 0.075);
    addGlow(orb, c.glow, 0.6, [0, 0, 0], 0.7);
    addGlow(orb, 0xffffff, 0.3, [0, 0, 0], 0.8);
    orb.visible = false;
    grp(orb, 'emit');
  },

  // 駅で助ける先生（ショートヘア・マフラー・コート。右の肩に小さい学生がすわっている）
  eki(root, c) {
    const p = person(root, c, { skin: 0xf6d0ae, top: 0xc99a62, pants: 0x4a4a58, shoes: 0x3a2a24, gw: 1.05, skirt: 0xc99a62, R: [0.4, 0.38, 0.37] });
    const { T, torso, head, F, B } = p;
    // コートのえりとボタン
    for (const sx of [-1, 1]) part(torso, flat('ekLapel', [[0, 0.08], [0.11, 0.06], [0.05, -0.2], [0, -0.24]], 0.03, 0.01), T(0xb58650), [sx * 0.1, 0.44, B.z(0.1, 0.36) - 0.01], [sx, 1, 1], [-Math.PI / 2 + 0.3, sx * 0.3, 0], { outline: true, ow: 0.015 });
    for (let i = 0; i < 2; i++) B.put(torso, SPH(5), T(0x4a3020), 0.07, 0.2 - i * 0.12, 0.022, 0.01);
    // マフラー（からし色に赤いしま）
    const SC = T(0xe8b43a);
    part(torso, RING(0.42), SC, [0, 0.6, 0.02], [0.24, 0.24, 0.22], [Math.PI / 2 + 0.15, 0, 0], { outline: true, ow: 0.02 });
    const tl = grp(torso, 'scarf', [0.08, 0.52, B.z(0.08, 0.5) + 0.03], [0.15, 0, 0.12]);
    part(tl, BOX(), SC, [0, -0.15, 0], [0.11, 0.3, 0.035], [0, 0, 0], { outline: true, ow: 0.015 });
    for (const y of [-0.22, -0.27]) part(tl, BOX(), T(0xc8303a), [0, y, 0], [0.112, 0.02, 0.037]);
    // ショートボブの髪
    const H = p.HT(0x4a2f26);
    hairCap(head, p.R, H, 0.3, 1.07, 0.0);
    for (const sx of [-1, 1]) part(head, SPH(7), H, [sx * 0.33, -0.1, -0.03], [0.13, 0.22, 0.22], [0, 0, sx * 0.1], { outline: true, ow: 0.02 });
    part(head, SPH(8), H, [0, -0.08, -0.2], [0.36, 0.28, 0.22], [0, 0, 0], { outline: true });
    for (let i = -1; i <= 1; i++) part(head, tube('ekBang', [[0, 0, 0], [0.03, -0.06, 0.02], [0.08, -0.1, 0.0]], 0.07, 0.015, 6, 6), H, [i * 0.13 - 0.01, 0.27 - Math.abs(i) * 0.03, F.z(i * 0.13, 0.27) - 0.03], 1, [0, 0, 0.2], { outline: true, ow: 0.015 });
    makeFace(head, F, T, { lash: true, es: 1.0, brow: [-0.15, 0.1, 0.1, 0.017], my: -0.17, mouth: 'smile', mouthCol: 0xb8323e, blush: true, nose: 0xecb592 });
    p.armR.rotation.set(-0.2, 0, -0.35);
    p.armL.rotation.set(-0.25, 0, 0.15);
    grp(p.handL, 'emit', [0, -0.05, 0.06]);
    // 右の肩の小さい学生（オレンジのパーカー）
    const hp = grp(torso, 'helper', [-0.42, 0.53, 0.02]);
    const hb = grp(hp, 'hBody');
    part(hb, SPH(8), T(0xff9f2e), [0, 0.08, 0], [0.1, 0.1, 0.085], [0, 0, 0], { outline: true, ow: 0.015 });
    part(hb, SPH(6), T(0xe88a20), [0, 0.17, -0.06], [0.09, 0.06, 0.05]);
    for (const sx of [-1, 1]) {
      const lg = grp(hb, '', [sx * 0.045, 0.02, 0.03]);
      part(lg, tube('hLeg', [[0, 0, 0], [0, -0.01, 0.08], [0, -0.08, 0.13]], 0.035, 0.03, 4, 6), T(0x2c3550), [0, 0, 0], 1, [0, 0, 0], { outline: true, ow: 0.012 });
      part(lg, SPH(5), T(0xf2f2f2), [0, -0.1, 0.15], [0.035, 0.03, 0.045]);
      const ha = grp(hb, sx < 0 ? 'hArmR' : 'hArmL', [sx * 0.09, 0.13, 0], [0, 0, sx * 0.4]);
      part(ha, tube('hArm', [[0, 0, 0], [0, -0.06, 0.005], [0, -0.11, 0.01]], 0.03, 0.026, 4, 6), T(0xff9f2e), [0, 0, 0], 1, [0, 0, 0], { outline: true, ow: 0.012 });
      part(ha, SPH(5), T(0xf6d0ae), [0, -0.13, 0.01], 0.03);
    }
    const hh = grp(hb, 'hHead', [0, 0.3, 0.01]);
    const hr = [0.13, 0.125, 0.12];
    part(hh, SPH(8), T(0xf6d0ae), [0, 0, 0], hr, [0, 0, 0], { outline: true, ow: 0.015 });
    hairCap(hh, hr, p.HT(0x1e1a22), 0.5, 1.1);
    makeFace(hh, surface(hr), T, { pre: 'h', ex: 0.045, ey: -0.01, es: 0.36, my: -0.06, ms: 0.35, mouth: 'grin', teeth: true });
  },

  // まめた（小さい豆柴。茶色とクリーム色、赤い首輪）
  mameta(root, c) {
    const T = (x) => rimMat(x, c.rim);
    const TAN = 0xdc8a3c, CRM = 0xfff0d8;
    const body = grp(root, 'body', [0, -0.05, -0.05]);
    part(body, SPH(12), T(TAN), [0, 0, 0], [0.34, 0.31, 0.48], [0, 0, 0], { outline: true });
    part(body, SPH(10), T(CRM), [0, -0.1, 0.12], [0.26, 0.22, 0.38]);
    part(body, RING(0.3), T(0xe0283a), [0, 0.13, 0.4], [0.19, 0.19, 0.19], [Math.PI / 2 - 0.6, 0, 0], { outline: true, ow: 0.015 });
    part(body, SPH(6), T(0xffd23a), [0, 0.0, 0.53], 0.04);
    const head = grp(body, 'head', [0, 0.37, 0.47]);
    const HR = [0.34, 0.3, 0.3];
    part(head, SPH(14), T(TAN), [0, 0, 0], HR, [0, 0, 0], { outline: true });
    const F = surface(HR);
    // ほっぺとマズル（クリーム色）・黒い鼻
    for (const sx of [-1, 1]) F.put(head, SPH(8), T(CRM), sx * 0.13, -0.11, [0.14, 0.11, 0.1], -0.05);
    const mz = grp(head, 'muzzle', [0, -0.1, 0.2]);
    const MR = [0.17, 0.12, 0.14];
    part(mz, SPH(10), T(CRM), [0, 0, 0], MR, [0, 0, 0], { outline: true, ow: 0.015 });
    const MF = surface(MR);
    MF.put(mz, SPH(6), glow(0x1a1216), 0, 0.06, [0.05, 0.036, 0.04], -0.012);
    MF.put(mz, SPH(4), glow(0xffffff), 0.015, 0.075, 0.012, 0.02);
    makeFace(head, F, T, { ex: 0.125, ey: 0.05, es: 1.0, mpar: mz, MF, my: -0.035, ms: 0.75, mouth: 'cat' });
    // まろまゆ（目の上のクリーム色の点）
    for (const sx of [-1, 1]) F.put(head, SPH(6), T(CRM), sx * 0.12, 0.155, [0.04, 0.026, 0.02], -0.004);
    // 立った三角の耳
    for (const sx of [-1, 1]) {
      const e = grp(head, sx < 0 ? 'earR' : 'earL', [sx * 0.19, 0.22, -0.05], [0, 0, sx * -0.32]);
      part(e, CONE(4), T(TAN), [0, 0.09, 0], [0.11, 0.2, 0.06], [0, Math.PI / 4, 0], { outline: true, ow: 0.015 });
      part(e, CONE(4), T(0xffd6c0), [0, 0.07, 0.03], [0.065, 0.13, 0.03], [0, Math.PI / 4, 0]);
    }
    // 足（先がクリーム色）
    const legs = grp(body, 'legs');
    for (const [x, z, n] of [[-0.17, 0.3, 'legFR'], [0.17, 0.3, 'legFL'], [-0.17, -0.3, 'legBR'], [0.17, -0.3, 'legBL']]) {
      const l = grp(legs, n, [x, -0.2, z]);
      part(l, tube('mmLeg', [[0, 0.12, 0], [0, -0.06, 0.01], [0, -0.2, 0]], 0.085, 0.075, 5, 7), T(TAN), [0, 0, 0], 1, [0, 0, 0], { outline: true });
      part(l, SPH(6), T(CRM), [0, -0.21, 0.03], [0.075, 0.055, 0.095], [0, 0, 0], { outline: true, ow: 0.015 });
    }
    // くるっと巻いたしっぽ
    const tail = grp(body, 'tail', [0, 0.21, -0.43]);
    part(tail, tube('mmTail', [[0, 0, 0], [0, 0.14, -0.07], [0, 0.28, -0.02], [0, 0.29, 0.12], [0, 0.18, 0.14]], 0.085, 0.04, 12, 7), T(TAN), [0, 0, 0], 1, [0, 0, 0], { outline: true });
    part(tail, SPH(6), T(CRM), [0, 0.19, 0.13], 0.045);
    grp(mz, 'emit', [0, -0.04, 0.16]);
  },

  // 学食ラーメン大盛り（もやしの山・チャーシュー・湯気。どんぶりに顔）
  ramen(root, c) {
    const T = (x) => rimMat(x, c.rim);
    const body = grp(root, 'body', [0, 0, 0], [0.2, 0, 0]);
    const bowl = grp(body, 'bowl', [0, -0.3, 0]);
    // どんぶり：外がわ（下から上）→ ふち → 内がわ（上から下）の順で、面が正しく外を向く
    const prof = [[0, -0.5], [0.4, -0.5], [0.42, -0.42], [0.6, -0.34], [0.8, 0.0], [0.85, 0.17], [0.79, 0.22], [0.72, 0.14], [0.5, -0.26], [0, -0.34]];
    const tex = ctex('rmBowl', 512, 256, (x, w, h) => {
      x.fillStyle = '#fbfaf6';
      x.fillRect(0, 0, w, h);
      x.fillStyle = '#d8283a';
      x.fillRect(0, 57, w, 57);
      x.fillRect(0, 144, w, 4);
      // 雷紋（四角いうずまき）
      x.strokeStyle = '#d8283a';
      x.lineWidth = 3;
      const n = 20, cw = w / n;
      const sp = [[0.5, 0.5], [0.65, 0.5], [0.65, 0.35], [0.35, 0.35], [0.35, 0.65], [0.8, 0.65], [0.8, 0.2], [0.2, 0.2], [0.2, 0.8], [0.95, 0.8]];
      for (let i = 0; i < n; i++) {
        x.beginPath();
        sp.forEach(([u, v], j) => (j ? x.lineTo(i * cw + 1 + u * 24, 116 + v * 24) : x.moveTo(i * cw + 1 + u * 24, 116 + v * 24)));
        x.stroke();
      }
    });
    part(bowl, LATHE('rmBowl', prof, 28), rimMat(0xffffff, c.rim, { map: tex }), [0, 0, 0], 1, [0, 0, 0], { outline: true });
    // スープ・あぶら・めん
    part(bowl, CYL(24), T(0xa8622c), [0, 0.13, 0], [0.71, 0.02, 0.71]);
    for (let i = 0; i < 6; i++) part(bowl, SPH(4), soft(0xffe8a0, 0.75), [Math.cos(i * 1.1) * 0.58, 0.145, Math.sin(i * 1.1) * 0.58], [0.05, 0.008, 0.04]);
    for (let i = 0; i < 4; i++) {
      const a = 0.9 + i * 0.45;
      part(bowl, stroke([[Math.cos(a) * 0.5, 0.15, Math.sin(a) * 0.5], [Math.cos(a + 0.12) * 0.6, 0.16, Math.sin(a + 0.12) * 0.6], [Math.cos(a) * 0.68, 0.15, Math.sin(a) * 0.68]], 0.03, 6, 4), T(0xf6d77c));
    }
    // もやしの山（白い山に、もやしとキャベツ）
    part(bowl, SPH(10), T(0xf6f2dc), [0, 0.13, -0.03], [0.55, 0.78, 0.5], [0, 0, 0], { outline: true });
    for (let i = 0; i < 16; i++) {
      const ph = i * 2.4, th = 0.2 + (i % 5) * 0.22;
      const px = 0.56 * Math.sin(th) * Math.cos(ph), py = 0.13 + 0.79 * Math.cos(th), pz = 0.51 * Math.sin(th) * Math.sin(ph) - 0.03;
      const dx = Math.cos(ph + 1.7) * 0.12, dz = Math.sin(ph + 1.7) * 0.12;
      part(bowl, stroke([[px, py, pz], [px + dx * 0.5, py + 0.03, pz + dz * 0.5], [px + dx, py - 0.02, pz + dz]], 0.018, 4, 4), T(0xfffdf2));
      part(bowl, SPH(4), T(0xeedc7a), [px + dx, py - 0.02, pz + dz], 0.022);
    }
    for (let i = 0; i < 5; i++) {
      const ph = i * 1.3 + 0.4, th = 0.5 + (i % 2) * 0.35;
      part(bowl, BOX(), T(0xc6e6a0), [0.57 * Math.sin(th) * Math.cos(ph), 0.13 + 0.8 * Math.cos(th), 0.52 * Math.sin(th) * Math.sin(ph) - 0.03], [0.11, 0.015, 0.09], [th, ph, 0.3]);
    }
    // チャーシュー（2まい）と味玉
    for (const sx of [-1, 1]) {
      const cs = grp(bowl, '', [sx * 0.3, 0.3, 0.44], [1.25, sx * -0.45, 0]);
      part(cs, CYL(16), T(0xe9a990), [0, 0, 0], [0.24, 0.04, 0.19], [0, 0, 0], { outline: true, ow: 0.015 });
      part(cs, CYL(16), T(0xa0522e), [0, -0.014, 0], [0.255, 0.035, 0.205]);
    }
    const eg = grp(bowl, '', [0.02, 0.2, 0.55], [1.0, 0.1, 0]);
    part(eg, SPH(8), T(0xfffaf0), [0, 0, 0], [0.1, 0.06, 0.08], [0, 0, 0], { outline: true, ow: 0.012 });
    part(eg, CYL(10), T(0xffa02a), [0, 0.05, 0], [0.055, 0.012, 0.045]);
    // どんぶりの顔
    const F = latheFace(prof.slice(2, 6));
    makeFace(bowl, F, T, { ex: 0.18, ey: -0.06, es: 1.15, my: -0.18, ms: 1.1, mouth: 'smile', blush: true });
    // 湯気（ふだん）と、技のときの大きな湯気
    const st = steam(body, 3, 0.32, 0.6);
    st.position.set(0, 0.62, 0);
    const pf = grp(body, 'puffs', [0, 0.7, 0]);
    for (let i = 0; i < 3; i++) part(pf, SPH(8), glow(0xffffff, 0.5), [(i - 1) * 0.22, i === 1 ? 0.1 : 0, 0], 0.12, [0, 0, 0], { name: 'puff' + i });
    pf.visible = false;
    grp(body, 'emit', [0, 1.0, 0]);
  },

  // 駅伝カントク（チームのジャージ・ぼうし・メガホン）。どこかの本当のチームの人ではない
  kantoku(root, c) {
    const p = person(root, c, { skin: 0xeec09a, top: 0xd8303a, pants: 0xd8303a, shoes: 0xf4f4f4, gw: 1.15, R: [0.41, 0.39, 0.38] });
    const { T, torso, head, F, B } = p;
    const W = T(0xffffff);
    // ジャージの白い線（うで・足）・ファスナー・胸の線・立ちえり
    for (const sx of [-1, 1]) {
      part(sx < 0 ? p.armR : p.armL, tube('ktArmS' + sx, [[sx * 0.088, 0.02, 0], [sx * 0.085, -0.15, 0.012], [sx * 0.074, -0.3, 0.02]], 0.018, 0.016, 6, 4), W);
      part(p.legs.getObjectByName(sx < 0 ? 'legR' : 'legL'), tube('ktLegS' + sx, [[sx * 0.098, 0.04, 0], [sx * 0.092, -0.14, 0.01], [sx * 0.082, -0.29, 0]], 0.018, 0.016, 6, 4), W);
    }
    part(torso, B.line([[0, 0.56], [0, 0.3], [0, 0.0]], 0.012, 0.012), glow(0xe8ecf2));
    part(torso, B.line([[-0.32, 0.34], [0, 0.38], [0.32, 0.34]], 0.03, 0.01), W);
    part(torso, RING(0.3), T(0xd8303a), [0, 0.6, 0.0], [0.2, 0.2, 0.18], [Math.PI / 2 + 0.1, 0, 0], { outline: true, ow: 0.015 });
    // 首からさげた笛
    for (const sx of [-1, 1]) part(torso, B.line([[sx * 0.13, 0.57], [sx * 0.04, 0.38], [0, 0.31]], 0.008, 0.03), W);
    B.put(torso, CYL(8), T(0xd8dde6), 0, 0.28, [0.03, 0.07, 0.03], 0.04, Math.PI / 2);
    // ぼうし（赤。前に白い星）
    const CAP = T(0xc82632);
    part(head, HEMI(), CAP, [0, 0.07, -0.01], [0.43, 0.36, 0.42], [-0.12, 0, 0], { outline: true });
    part(head, flat('ktBrim', [[-0.26, 0], [0.26, 0], [0.22, 0.14], [0.1, 0.22], [-0.1, 0.22], [-0.22, 0.14]], 0.025, 0.01), CAP, [0, 0.12, 0.3], 1, [0.12, 0, 0], { outline: true, ow: 0.015 });
    const star = [];
    for (let i = 0; i < 10; i++) {
      const a = Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 0.035 : 0.08;
      star.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    part(head, flat('ktStar', star, 0.01, 0.004), W, [0, 0.27, F.z(0, 0.27) + 0.035], 1, [-Math.PI / 2 + 0.55, 0, 0]);
    for (const sx of [-1, 1]) part(head, BOX(), T(0x6a6670), [sx * 0.39, 0.0, 0.06], [0.05, 0.14, 0.08], [0, sx * 0.3, 0]);
    makeFace(head, F, T, { es: 0.95, brow: [0.3, 0.11, 0.12, 0.026], my: -0.19, mouth: 'flat', nose: 0xe2ad86 });
    for (const sx of [-1, 1]) part(head, F.line([[sx * 0.085, -0.125], [sx * 0.02, -0.108]], 0.02), glow(0x3a3438));
    // メガホン：ふだんは右手に、技のときは口の前に（2つを入れかえる）
    const meg = (par, name, p0, r0) => {
      const g = grp(par, name, p0, r0);
      part(g, CONE(14), T(0xf6f6f2), [0, 0, 0.15], [0.1, 0.3, 0.1], [-Math.PI / 2, 0, 0], { outline: true, ow: 0.015 });
      part(g, RING(0.22), T(0xd8303a), [0, 0, 0.25], 0.085);
      part(g, CYL(14), glow(0x2a2a34), [0, 0, 0.3], [0.095, 0.01, 0.095], [Math.PI / 2, 0, 0]);
      part(g, BOX(), T(0x2a2a34), [0, -0.06, 0.09], [0.035, 0.1, 0.04], [0.3, 0, 0], { outline: true, ow: 0.012 });
      part(g, CYL(8), T(0x2a2a34), [0, 0, 0.0], [0.03, 0.04, 0.03], [Math.PI / 2, 0, 0]);
      addGlow(g, c.glow, 0.5, [0, 0, 0.32], 0.5);
      return g;
    };
    p.armR.rotation.set(-0.55, 0, 0.1);
    meg(p.handR, 'megH', [0, 0.02, 0.04], [0.3, 0, -0.1]);
    const mm = meg(head, 'megM', [0, -0.19, F.z(0, -0.19)], [0.1, 0, 0]);
    mm.visible = false;
    grp(mm, 'emit', [0, 0, 0.32]);
  },

  // ロケッツ（鉄人さんのバンド。顔のあるロケットに、ドラムとギターのマーク）
  rockets(root, c) {
    const T = (x) => rimMat(x, c.rim);
    const body = grp(root, 'body');
    const rk = grp(body, 'rk');
    const BR = [0.44, 0.62, 0.44];
    part(rk, LATHE('rkBody', [[0, -0.62], [0.24, -0.6], [0.37, -0.45], [0.44, -0.15], [0.44, 0.15], [0.4, 0.36], [0.34, 0.5], [0, 0.5]], 24), T(0xfaf6ee), [0, 0, 0], 1, [0, 0, 0], { outline: true });
    part(rk, LATHE('rkNose', [[0, 0.44], [0.35, 0.46], [0.3, 0.62], [0.2, 0.76], [0.08, 0.86], [0, 0.89]], 20), T(0xff4f9a), [0, 0, 0], 1, [0, 0, 0], { outline: true });
    part(rk, RING(0.3), T(0xffd23a), [0, 0.46, 0], 0.36, [Math.PI / 2, 0, 0]);
    part(rk, RING(0.25), T(0xffd23a), [0, -0.42, 0], 0.39, [Math.PI / 2, 0, 0]);
    // 羽（ななめ4まい）
    for (let i = 0; i < 4; i++) {
      const fg = grp(rk, '', [0, -0.32, 0], [0, Math.PI / 4 + (i * Math.PI) / 2, 0]);
      part(fg, flat('rkFin', [[0, 0.22], [0.12, 0.05], [0.24, -0.2], [0.26, -0.36], [0.12, -0.3], [0, -0.26]], 0.05, 0.02), T(0xff4f9a), [0.34, 0, 0], 1, [-Math.PI / 2, 0, 0], { outline: true, ow: 0.015 });
    }
    // ふん射口と火（風の色）
    part(rk, CYL(12), T(0x4a4f5e), [0, -0.66, 0], [0.2, 0.1, 0.2], [0, 0, 0], { outline: true, ow: 0.015 });
    const fl = grp(rk, 'flame', [0, -0.72, 0]);
    part(fl, CONE(10), glow(c.glow, 0.85), [0, -0.22, 0], [0.16, 0.44, 0.16], [Math.PI, 0, 0]);
    part(fl, CONE(8), glow(0xfff6c0, 0.9), [0, -0.14, 0], [0.08, 0.26, 0.08], [Math.PI, 0, 0]);
    addGlow(fl, c.glow, 1.1, [0, -0.15, 0], 0.8);
    // 顔
    const F = surface(BR);
    makeFace(rk, F, T, { ex: 0.14, ey: 0.17, es: 1.1, my: 0.03, mouth: 'smile', blush: true, brow: [0.1, 0.27, 0.09, 0.018] });
    // おなかのマーク（ドラム＋ギター＋ROCKETs）。胴の丸みにそわせた板に貼る
    const em = ctex('rkEmblem', 256, 256, (x, w, h) => {
      x.clearRect(0, 0, w, h);
      x.beginPath();
      x.arc(128, 128, 124, 0, Math.PI * 2);
      x.fillStyle = '#ffd23a';
      x.fill();
      x.beginPath();
      x.arc(128, 128, 110, 0, Math.PI * 2);
      x.fillStyle = '#1d2550';
      x.fill();
      // ギター（ななめ、うしろ）
      x.save();
      x.translate(150, 112);
      x.rotate(0.7);
      x.fillStyle = '#f4f1ea';
      x.fillRect(-5, -82, 10, 70);
      x.fillStyle = '#ff4f9a';
      x.beginPath();
      x.ellipse(0, 0, 26, 32, 0, 0, Math.PI * 2);
      x.fill();
      x.restore();
      // ドラムのスティック（交差）
      x.strokeStyle = '#f4d9a8';
      x.lineWidth = 9;
      x.lineCap = 'round';
      x.beginPath();
      x.moveTo(62, 58);
      x.lineTo(150, 136);
      x.moveTo(194, 58);
      x.lineTo(106, 136);
      x.stroke();
      // スネアドラム
      x.fillStyle = '#ff4f9a';
      x.fillRect(80, 112, 96, 46);
      x.fillStyle = '#ffffff';
      for (let i = 0; i < 5; i++) x.fillRect(86 + i * 20, 118, 6, 34);
      x.beginPath();
      x.ellipse(128, 112, 48, 13, 0, 0, Math.PI * 2);
      x.fill();
      x.fillStyle = '#ffd23a';
      x.fillRect(40, 170, 176, 40);
      x.fillStyle = '#1d2550';
      x.font = '900 34px ' + JPF;
      x.textAlign = 'center';
      x.fillText('ROCKETs', 128, 202);
    });
    const bw = 0.42, bR = 0.446;
    part(rk, G('rkBadge', () => new THREE.CylinderGeometry(bR, bR, bw, 10, 1, true, -bw / bR / 2, bw / bR)), rimMat(0xffffff, c.rim, { map: em, alphaTest: 0.5 }), [0, -0.2, 0]);
    notes(rk, c.glow);
    grp(rk, 'emit', [0, 0.95, 0]);
  },

  // 楽器の先生（三線のような三本弦の楽器。胴はへびの皮のもよう）・かりゆし風の花がらシャツ
  sanshin(root, c) {
    const shirt = ctex('ssShirt', 256, 128, (x, w, h) => {
      x.fillStyle = '#2f86d8';
      x.fillRect(0, 0, w, h);
      const flower = (fx, fy, r) => {
        x.fillStyle = '#3fae6a';
        for (const a of [0.6, 2.6]) {
          x.beginPath();
          x.ellipse(fx + Math.cos(a) * r * 1.2, fy + Math.sin(a) * r * 1.2, r * 0.8, r * 0.35, a, 0, Math.PI * 2);
          x.fill();
        }
        x.fillStyle = '#f4fbff';
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          x.beginPath();
          x.ellipse(fx + Math.cos(a) * r * 0.55, fy + Math.sin(a) * r * 0.55, r * 0.55, r * 0.38, a, 0, Math.PI * 2);
          x.fill();
        }
        x.fillStyle = '#ffd23a';
        x.beginPath();
        x.arc(fx, fy, r * 0.22, 0, Math.PI * 2);
        x.fill();
      };
      for (const [fx, fy, r] of [[40, 34, 18], [128, 82, 20], [210, 30, 16], [70, 108, 13], [236, 104, 15], [168, 14, 11]]) flower(fx, fy, r);
    });
    shirt.wrapS = shirt.wrapT = THREE.RepeatWrapping;
    shirt.repeat.set(2, 1);
    const p = person(root, c, { skin: 0xefc49e, topMat: rimMat(0xffffff, c.rim, { map: shirt }), sleeve: 'short', pants: 0xe6dcc6, shoes: 0x7a5a3a, gw: 1.12, R: [0.41, 0.39, 0.38] });
    const { T, torso, head, F } = p;
    // ふわふわの白い髪・白いまゆ・白いひげ
    const Wh = T(0xf2efe8);
    hairCap(head, p.R, Wh, 0.62, 1.05);
    for (const [x, y, z, s] of [[0.3, 0.12, -0.05, 0.13], [-0.3, 0.12, -0.05, 0.13], [0.15, 0.3, -0.12, 0.14], [-0.15, 0.3, -0.12, 0.14], [0, 0.2, -0.3, 0.16]]) part(head, SPH(7), Wh, [x, y, z], s, [0, 0, 0], { outline: true, ow: 0.02 });
    makeFace(head, F, T, { es: 0.85, brow: [0.1, 0.11, 0.13, 0.032], browCol: 0xf4f2ec, my: -0.205, mouth: 'smile', blush: true, nose: 0xe2ad86 });
    for (const sx of [-1, 1]) part(head, F.line([[sx * 0.095, -0.14], [sx * 0.035, -0.115], [0, -0.125]], 0.022), T(0xf4f2ec));
    // 三線（胴は右の腰、さおは左上）
    const skin = ctex('ssSkin', 128, 128, (x, w, h) => {
      x.fillStyle = '#d8c08a';
      x.fillRect(0, 0, w, h);
      x.strokeStyle = 'rgba(90,64,30,0.35)';
      x.lineWidth = 1;
      for (let i = -8; i < 16; i++) {
        x.beginPath();
        x.moveTo(i * 12, 0);
        x.lineTo(i * 12 + 128, 128);
        x.moveTo(i * 12 + 128, 0);
        x.lineTo(i * 12, 128);
        x.stroke();
      }
      x.fillStyle = '#3a2614';
      for (const [bx, by, r] of [[30, 28, 15], [92, 22, 12], [64, 64, 18], [24, 98, 13], [104, 96, 16], [60, 118, 9], [118, 54, 9]]) {
        x.beginPath();
        for (let i = 0; i < 9; i++) {
          const a = (i / 9) * Math.PI * 2, rr = r * (0.75 + 0.35 * Math.sin(i * 2.3 + bx));
          x.lineTo(bx + Math.cos(a) * rr, by + Math.sin(a) * rr * 0.8);
        }
        x.closePath();
        x.fill();
      }
      x.fillStyle = '#efe0b4';
      for (const [bx, by] of [[30, 28], [64, 64], [104, 96], [24, 98]]) {
        x.beginPath();
        x.arc(bx, by, 4, 0, Math.PI * 2);
        x.fill();
      }
    });
    const ss = grp(torso, 'sanshin', [-0.1, 0.24, 0.29], [0.05, 0, -0.6]);
    part(ss, G('ssFrame', () => roundedBox(0.3, 0.32, 0.1, 0.045, 2)), T(0x2a1a16), [0, 0, 0], 1, [0, 0, 0], { outline: true, ow: 0.015 });
    part(ss, G('ssTiege', () => roundedBox(0.33, 0.35, 0.05, 0.022, 2)), T(0xd8a03a), [0, 0, 0]);
    for (const z of [0.052, -0.052]) part(ss, BOX(), rimMat(0xffffff, c.rim, { map: skin }), [0, 0, z], [0.27, 0.29, 0.01]);
    part(ss, BOX(), T(0x1e1214), [0, 0.56, 0], [0.045, 0.78, 0.04], [0, 0, 0], { outline: true, ow: 0.012 });
    part(ss, tube('ssTenjin', [[0, 0, 0], [0, 0.1, -0.02], [0, 0.17, -0.09]], 0.028, 0.02, 6, 6), T(0x1e1214), [0, 0.94, 0], 1, [0, 0, 0], { outline: true, ow: 0.012 });
    for (const [sx, y] of [[-1, 0.84], [-1, 0.92], [1, 0.88]]) part(ss, CYL(6), T(0xf1e6cc), [sx * 0.05, y, 0], [0.012, 0.1, 0.012], [0, 0, Math.PI / 2], { outline: true, ow: 0.01 });
    part(ss, BOX(), T(0xf1e6cc), [0, -0.06, 0.066], [0.05, 0.015, 0.02]);
    for (let i = -1; i <= 1; i++) part(ss, BOX(), glow(c.glow), [i * 0.012, 0.42, 0.064], [0.004, 1.0, 0.004]);
    addGlow(ss, c.glow, 0.6, [0, 0, 0.1], 0.5);
    grp(ss, 'emit', [0, 0, 0.14]);
    // 右手のばち、左手はさおを持つ
    p.armR.rotation.set(-0.98, 0, 0.55);
    p.armL.rotation.set(-2.27, 0, -0.33);
    part(p.handR, CONE(4), T(0xf1e6cc), [0.03, -0.02, 0.06], [0.03, 0.14, 0.015], [0.5, 0, 0.8], { outline: true, ow: 0.01 });
    const nt = notes(torso, c.glow);
    nt.position.set(-0.1, 0.45, 0.4);
  },

  // 出席にきびしい先生（スーツ・サーモントのめがね・出席ぼ・大きな赤ペン。ペンのおしりは「欠席」のはんこ）
  shusseki(root, c) {
    const p = person(root, c, { skin: 0xf0c8a4, top: 0x3c4150, pants: 0x3c4150, shoes: 0x1c1c22, gw: 1.0, R: [0.39, 0.39, 0.37] });
    const { T, torso, head, F, B } = p;
    B.put(torso, SPH(10), T(0xf6f6f6), 0, 0.36, [0.1, 0.22, 0.05], -0.03);
    part(torso, flat('ysTie', [[-0.035, 0.0], [0.035, 0.0], [0.05, -0.2], [0, -0.25], [-0.05, -0.2]], 0.02, 0.008), T(0x23366e), [0, 0.52, B.z(0, 0.4) + 0.02], 1, [-Math.PI / 2 + 0.3, 0, 0]);
    for (const sx of [-1, 1]) part(torso, flat('rkLapel', [[0, 0.1], [0.12, 0.08], [0.06, -0.26], [0.0, -0.3]], 0.03, 0.01), T(0x30343f), [sx * 0.12, 0.5, B.z(0.12, 0.4) - 0.01], [sx, 1, 1], [-Math.PI / 2 + 0.35, sx * 0.35, 0], { outline: true, ow: 0.015 });
    // きっちり七三分けの黒い髪（つや）
    const H = p.HT(0x1a1820);
    hairCap(head, p.R, H, 0.55, 1.05);
    part(head, SPH(8), H, [0.1, 0.27, 0.12], [0.26, 0.1, 0.24], [0.35, 0, -0.25], { outline: true, ow: 0.02 });
    part(head, F.line([[-0.06, 0.33], [-0.1, 0.25], [-0.16, 0.2]], 0.012, 0.04), T(0xe8c0a0));
    part(head, stroke([[-0.2, 0.33, 0.12], [0, 0.4, 0.1], [0.2, 0.35, 0.1]], 0.025, 8, 4), soft(0xffffff, 0.5));
    makeFace(head, F, T, { es: 0.85, eyeH: 0.7, brow: [0.45, 0.085, 0.12, 0.024], my: -0.19, mouth: 'flat', nose: 0xe2b08c });
    glasses(head, F, 0x1a1a22, 'brow', 0.135, -0.03, 0.08);
    // 出席ぼ（左手）
    const sheet = ctex('ssAtt', 128, 160, (x, w, h) => {
      x.fillStyle = '#ffffff';
      x.fillRect(0, 0, w, h);
      x.fillStyle = '#222';
      x.font = '900 26px ' + JPF;
      x.textAlign = 'center';
      x.fillText('出席', w / 2, 30);
      x.strokeStyle = '#8a8f9a';
      x.lineWidth = 2;
      for (let i = 0; i < 6; i++) {
        x.strokeRect(10, 42 + i * 18, 108, 18);
        x.fillStyle = '#9aa0aa';
        x.fillRect(16, 49 + i * 18, 44, 4);
      }
      x.strokeStyle = '#e0283a';
      x.lineWidth = 3;
      for (let i = 0; i < 6; i++) {
        const cx = 96, cy = 51 + i * 18;
        x.beginPath();
        if (i === 2 || i === 4) {
          x.moveTo(cx - 6, cy - 6);
          x.lineTo(cx + 6, cy + 6);
          x.moveTo(cx + 6, cy - 6);
          x.lineTo(cx - 6, cy + 6);
        } else x.arc(cx, cy, 6, 0, Math.PI * 2);
        x.stroke();
      }
    });
    p.armL.rotation.set(-0.75, 0, -0.5);
    const cb = grp(p.handL, 'clip', [-0.07, 0.07, 0.06], [0.75, 0.2, 0.5]);
    part(cb, BOX(), T(0x9a6a3a), [0, 0, 0], [0.3, 0.4, 0.025], [0, 0, 0], { outline: true, ow: 0.015 });
    part(cb, BOX(), rimMat(0xffffff, c.rim, { map: sheet }), [0, -0.02, 0.016], [0.26, 0.33, 0.006]);
    part(cb, BOX(), T(0xd8dde6), [0, 0.18, 0.026], [0.12, 0.05, 0.03], [0, 0, 0], { outline: true, ow: 0.012 });
    // 大きな赤ペン（右手）。ペン先は上、おしりの白いところが はんこ
    p.armR.rotation.set(-0.45, 0, 0.1);
    const pen = grp(p.handR, 'pen', [0, 0.02, 0.05], [0.45, 0, -0.1]);
    part(pen, CYL(10), T(0xe0283a), [0, 0.12, 0], [0.05, 0.46, 0.05], [0, 0, 0], { outline: true, ow: 0.015 });
    part(pen, CONE(10), T(0xf4f4f4), [0, 0.4, 0], [0.05, 0.1, 0.05], [0, 0, 0], { outline: true, ow: 0.012 });
    part(pen, CONE(6), T(0xe0283a), [0, 0.47, 0], [0.015, 0.05, 0.015]);
    part(pen, BOX(), T(0xd8dde6), [0.055, 0.22, 0], [0.012, 0.2, 0.025]);
    part(pen, CYL(10), T(0xf4f4f4), [0, -0.14, 0], [0.065, 0.08, 0.065], [0, 0, 0], { outline: true, ow: 0.015 });
    part(pen, CYL(10), glow(0xff3048), [0, -0.185, 0], [0.058, 0.012, 0.058]);
    // 床の「欠席」のはんこのあと（技のとき）
    const mk = ctex('ssMark', 128, 128, (x, w, h) => {
      x.clearRect(0, 0, w, h);
      x.strokeStyle = '#ff2a40';
      x.lineWidth = 9;
      x.beginPath();
      x.arc(64, 64, 56, 0, Math.PI * 2);
      x.stroke();
      x.fillStyle = '#ff2a40';
      x.font = '900 40px ' + JPF;
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.fillText('欠席', 64, 66);
    });
    const mark = grp(root, 'mark', [0, -1.02, 0.2]);
    part(mark, G('circ24', () => new THREE.CircleGeometry(1, 24)), decal(mk), [0, 0, 0], 0.56, [-Math.PI / 2, 0, 0]);
    addGlow(mark, c.glow, 1.2, [0, 0.05, 0], 0.5);
    mark.visible = false;
    grp(root, 'emit', [0, -1.0, 0.2]);
  },

  // 単位くれそうな先生（にこにこ。ツイードの上着・ちょうネクタイ・「単位」の紙）
  tani(root, c) {
    const p = person(root, c, { skin: 0xf3cba6, top: 0x8a6a4a, pants: 0x5a5148, shoes: 0x4a3426, gw: 1.2, gd: 1.12, R: [0.42, 0.39, 0.38] });
    const { T, torso, head, F, B } = p;
    B.put(torso, SPH(10), T(0xbfe0ff), 0, 0.36, [0.11, 0.22, 0.05], -0.03);
    for (const sx of [-1, 1]) part(torso, CONE(4), T(0xd8303a), [sx * 0.045, 0.52, B.z(0, 0.52) + 0.02], [0.05, 0.08, 0.025], [0, 0, sx * Math.PI / 2]);
    part(torso, SPH(5), T(0xb8202a), [0, 0.52, B.z(0, 0.52) + 0.03], 0.025);
    for (const sx of [-1, 1]) part(torso, B.line([[sx * 0.11, 0.54], [sx * 0.08, 0.3], [sx * 0.06, 0.0]], 0.022, 0.014), T(0x6e5238));
    for (let i = 0; i < 2; i++) B.put(torso, SPH(5), T(0x3a2a1e), 0.075, 0.18 - i * 0.12, 0.02, 0.01);
    // 白髪まじりの髪（おでこは広め）
    const H = p.HT(0x55505a);
    hairCap(head, p.R, H, 0.85, 1.05);
    for (const sx of [-1, 1]) part(head, SPH(8), T(0x8a8690), [sx * 0.37, 0.06, -0.06], [0.1, 0.16, 0.18], [0, 0, 0], { outline: true, ow: 0.02 });
    makeFace(head, F, T, { es: 1.12, eyeH: 0.92, brow: [-0.25, 0.115, 0.12, 0.022, 0.02], browCol: 0x55505a, my: -0.2, ms: 1.25, mouth: 'smile', blush: true, nose: 0xeab08e });
    for (const sx of [-1, 1]) part(head, F.line([[sx * 0.1, -0.15], [sx * 0.04, -0.125], [0, -0.135]], 0.02), T(0x6a6670));
    // 「単位」の紙（両手で胸の前に）
    const cert = ctex('tnCert', 256, 180, (x, w, h) => {
      x.fillStyle = '#fff8e6';
      x.fillRect(0, 0, w, h);
      x.strokeStyle = '#d8a02a';
      x.lineWidth = 8;
      x.strokeRect(8, 8, w - 16, h - 16);
      x.lineWidth = 2;
      x.strokeRect(20, 20, w - 40, h - 40);
      x.fillStyle = '#222';
      x.font = '900 72px ' + JPF;
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.fillText('単位', w / 2, h / 2 + 4);
      x.fillStyle = '#e0283a';
      x.beginPath();
      x.arc(206, 136, 20, 0, Math.PI * 2);
      x.fill();
      x.fillStyle = '#fff';
      x.font = '900 22px ' + JPF;
      x.fillText('優', 206, 138);
    });
    const ce = grp(torso, 'cert', [0, 0.24, 0.42], [0.1, 0, 0]);
    part(ce, BOX(), rimMat(0xffffff, c.rim, { map: cert }), [0, 0, 0], [0.46, 0.32, 0.012], [0, 0, 0], { outline: true, ow: 0.015 });
    addGlow(ce, c.glow, 0.8, [0, 0, -0.05], 0.4);
    p.armL.rotation.set(-0.75, 0, -0.55);
    p.armR.rotation.set(-0.75, 0, 0.55);
    grp(root, 'emit', [0, -0.95, 0.35]);
  },

  // 学食の油そば（つやつやの太めん・あぶら。どんぶりに顔）
  aburasoba(root, c) {
    const T = (x) => rimMat(x, c.rim);
    const body = grp(root, 'body', [0, 0.05, 0], [0.14, 0, 0]);
    const bowl = grp(body, 'bowl', [0, -0.15, 0]);
    const prof = [[0, -0.42], [0.38, -0.42], [0.42, -0.36], [0.66, -0.22], [0.82, 0.02], [0.86, 0.14], [0.8, 0.17], [0.74, 0.08], [0.5, -0.18], [0, -0.24]];
    const tex = ctex('abBowl', 64, 256, (x, w, h) => {
      x.fillStyle = '#b8222c';
      x.fillRect(0, 114, w, 142);
      x.fillStyle = '#f2c14a';
      x.fillRect(0, 85, w, 29);
      x.fillRect(0, 118, w, 4);
      x.fillStyle = '#1e1a1e';
      x.fillRect(0, 0, w, 85);
    });
    part(bowl, LATHE('abBowl', prof, 28), rimMat(0xffffff, c.rim, { map: tex }), [0, 0, 0], 1, [0, 0, 0], { outline: true });
    // たれ（こい茶色のつや）
    part(bowl, CYL(24), T(0x7a3a12), [0, -0.06, 0], [0.62, 0.02, 0.62]);
    // 太いめん（黄色くつやつや）
    const NO = T(0xf4c858);
    for (let i = 0; i < 9; i++) {
      const a = i * 0.7, r0 = 0.12 + (i % 3) * 0.14;
      const pts = [];
      for (let j = 0; j <= 5; j++) {
        const b = a + j * 0.55;
        pts.push([Math.cos(b) * (r0 + j * 0.05), -0.02 + Math.sin(j * 1.3 + i) * 0.04 + (i % 2) * 0.05 + 0.08 * Math.sin((j / 5) * Math.PI), Math.sin(b) * (r0 + j * 0.05)]);
      }
      part(bowl, stroke(pts, 0.05, 16, 6), NO, [0, 0, 0], 1, [0, 0, 0], { outline: i % 3 === 0, ow: 0.012 });
    }
    for (let i = 0; i < 4; i++) part(bowl, stroke([[-0.3 + i * 0.18, 0.11, 0.1 + (i % 2) * 0.1], [-0.24 + i * 0.18, 0.13, 0.16], [-0.18 + i * 0.18, 0.11, 0.12]], 0.016, 6, 4), soft(0xffffff, 0.75));
    // 具：チャーシュー・メンマ・ねぎ・のり・たまごの黄身
    for (const sx of [-1, 1]) {
      const cs = grp(bowl, '', [sx * 0.33, 0.12, -0.12], [0.9, sx * -0.6, 0]);
      part(cs, CYL(14), T(0xe9a990), [0, 0, 0], [0.19, 0.035, 0.15], [0, 0, 0], { outline: true, ow: 0.012 });
      part(cs, CYL(14), T(0xa0522e), [0, -0.012, 0], [0.2, 0.03, 0.16]);
    }
    for (let i = 0; i < 4; i++) part(bowl, BOX(), T(0xc8963e), [0.32 + (i % 2) * 0.07, 0.11, 0.16 + i * 0.05], [0.04, 0.035, 0.14], [0.3, 0.8 + i * 0.3, 0.2], { outline: true, ow: 0.01 });
    for (let i = 0; i < 7; i++) part(bowl, CYL(6), T(0x5ccf4a), [-0.32 + Math.cos(i * 1.7) * 0.1, 0.12, 0.18 + Math.sin(i * 1.7) * 0.1], [0.03, 0.025, 0.03], [0.4, 0, i]);
    part(bowl, BOX(), T(0x1c3324), [0, 0.3, -0.42], [0.36, 0.34, 0.012], [-0.25, 0, 0], { outline: true, ow: 0.012 });
    part(bowl, SPH(10), T(0xffa024), [0, 0.15, 0.02], [0.11, 0.08, 0.11], [0, 0, 0], { outline: true, ow: 0.015 });
    part(bowl, SPH(5), glow(0xffffff), [0.03, 0.21, 0.06], 0.022);
    // どんぶりの顔
    const F = latheFace(prof.slice(2, 6));
    makeFace(bowl, F, T, { ex: 0.19, ey: -0.04, es: 1.1, my: -0.16, ms: 1.05, mouth: 'smile', blush: true });
    // 下にこぼれる、あぶらの水たまり（技のとき）と、とぶしずく
    const pd = grp(root, 'puddle', [0, -0.78, 0.25]);
    part(pd, G('circ24', () => new THREE.CircleGeometry(1, 24)), soft(0xffb02a, 0.85), [0, 0, 0], [0.55, 0.42, 1], [-Math.PI / 2, 0, 0]);
    for (const [x, z, s] of [[0.15, 0.08, 0.08], [-0.2, -0.05, 0.05], [0.02, -0.15, 0.04]]) part(pd, G('circ24', () => new THREE.CircleGeometry(1, 24)), glow(0xffffff, 0.8), [x, 0.01, z], s, [-Math.PI / 2, 0, 0]);
    addGlow(pd, c.glow, 1.3, [0, 0.05, 0], 0.5);
    pd.visible = false;
    for (let i = 0; i < 3; i++) {
      const d = part(root, SPH(6), T(0xffb02a), [0, -0.2, 0.3], 0.06, [0, 0, 0], { name: 'drop' + i });
      d.visible = false;
    }
    grp(root, 'emit', [0, -0.78, 0.25]);
  },

  // 終電（まるっこい通勤電車。行き先は「終電」、まどは夜の明かり）
  shuden(root, c) {
    const T = (x) => rimMat(x, c.rim);
    const body = grp(root, 'body');
    const car = grp(body, 'car');
    part(car, G('sdBody', () => roundedBox(1.0, 1.0, 1.75, 0.22, 3)), T(0xe4e8ef), [0, 0, 0], 1, [0, 0, 0], { outline: true });
    part(car, G('sdSkirt', () => roundedBox(1.02, 0.22, 1.7, 0.08, 2)), T(0x9aa3b2), [0, -0.42, 0]);
    // 緑の線（横と前）
    for (const sx of [-1, 1]) part(car, BOX(), T(0x2fb36a), [sx * 0.505, -0.16, 0], [0.02, 0.09, 1.5]);
    part(car, BOX(), T(0x2fb36a), [0, -0.16, 0.88], [0.7, 0.09, 0.02]);
    // 前の顔：まど2まい（目のよう）・ライト・行き先
    const glass = T(0x1c2a44);
    for (const sx of [-1, 1]) {
      part(car, BOX(), glass, [sx * 0.2, 0.12, 0.876], [0.32, 0.3, 0.02], [0, 0, 0], { outline: true, ow: 0.012 });
      part(car, BOX(), glow(0xffffff, 0.75), [sx * 0.2 + 0.06, 0.2, 0.888], [0.1, 0.03, 0.004], [0, 0, 0.5]);
      part(car, BOX(), glow(0xfff3b0), [sx * 0.33, -0.3, 0.876], [0.12, 0.07, 0.02]);
      addGlow(car, 0xfff3b0, 0.45, [sx * 0.33, -0.3, 0.95], 0.8);
    }
    part(car, stroke([[-0.09, -0.04, 0.89], [0, -0.075, 0.89], [0.09, -0.04, 0.89]], 0.018, 6, 4), glow(0x3a2a3a));
    const sign = ctex('sdSign', 128, 40, (x, w, h) => {
      x.fillStyle = '#121418';
      x.fillRect(0, 0, w, h);
      x.fillStyle = '#ff9a1a';
      x.font = '900 30px ' + JPF;
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.fillText('終電', w / 2, h / 2 + 2);
    });
    part(car, BOX(), rimMat(0xffffff, 0x000000, { map: sign }), [0, 0.38, 0.878], [0.46, 0.13, 0.02], [0, 0, 0], { outline: true, ow: 0.012 });
    // 横：明るいまど（夜）と、開くドア
    const lit = glow(0xffe9a0);
    for (const sx of [-1, 1]) {
      for (const z of [-0.6, 0.6]) part(car, BOX(), lit, [sx * 0.505, 0.16, z], [0.02, 0.28, 0.34]);
      part(car, BOX(), glow(0xfff6d0), [sx * 0.49, 0.0, 0], [0.02, 0.7, 0.4]);
      for (const dz of [-1, 1]) {
        const d = grp(car, 'door' + (sx < 0 ? 'R' : 'L') + (dz < 0 ? 0 : 1), [sx * 0.51, 0.0, dz * 0.1]);
        part(d, BOX(), T(0xcfd5df), [0, 0, 0], [0.025, 0.72, 0.2], [0, 0, 0], { outline: true, ow: 0.01 });
        part(d, BOX(), lit, [sx * 0.014, 0.12, 0], [0.01, 0.28, 0.13]);
      }
    }
    // パンタグラフ・車輪
    part(car, BOX(), T(0x5a606e), [0, 0.52, -0.1], [0.4, 0.05, 0.5]);
    for (const sx of [-1, 1]) part(car, BOX(), T(0x2a2e38), [0, 0.66, -0.1 + sx * 0.12], [0.03, 0.3, 0.03], [sx * 0.7, 0, 0]);
    part(car, BOX(), T(0x2a2e38), [0, 0.78, -0.1], [0.5, 0.03, 0.05]);
    for (const sx of [-1, 1]) for (const z of [-0.55, 0.55]) part(car, CYL(12), T(0x2a2e38), [sx * 0.38, -0.56, z], [0.14, 0.08, 0.14], [0, 0, Math.PI / 2], { outline: true, ow: 0.012 });
    addGlow(car, c.glow, 1.0, [0, 0.0, 1.0], 0.0);
    grp(car, 'emit', [0, 0, 1.0]);
  },

  // 正門ゲート（どこかの本当の大学ではない、れんがの門柱と鉄の門）
  seimon(root, c) {
    const T = (x) => rimMat(x, c.rim);
    const body = grp(root, 'body');
    const brick = ctex('smBrick', 64, 256, (x, w, h) => {
      x.fillStyle = '#d9cab4';
      x.fillRect(0, 0, w, h);
      const cols = ['#b0482e', '#a03e28', '#bc5a38', '#98402c'];
      for (let r = 0; r < 16; r++) for (let i = -1; i < 3; i++) {
        x.fillStyle = cols[(r * 3 + i + 4) % 4];
        x.fillRect(i * 32 + (r % 2) * 16 + 1, r * 16 + 1, 30, 14);
      }
    });
    const BR = rimMat(0xffffff, c.rim, { map: brick });
    const STONE = T(0xdedad2);
    const plate = ctex('smPlate', 64, 160, (x, w, h) => {
      x.fillStyle = '#3a2c1e';
      x.fillRect(0, 0, w, h);
      x.strokeStyle = '#d8b25a';
      x.lineWidth = 4;
      x.strokeRect(5, 5, w - 10, h - 10);
      x.fillStyle = '#f4dca0';
      x.font = '900 44px ' + JPF;
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.fillText('正', w / 2, 52);
      x.fillText('門', w / 2, 110);
    });
    for (const sx of [-1, 1]) {
      part(body, BOX(), BR, [sx * 0.85, -0.05, 0], [0.42, 1.6, 0.42], [0, 0, 0], { outline: true });
      part(body, BOX(), STONE, [sx * 0.85, 0.8, 0], [0.52, 0.1, 0.52], [0, 0, 0], { outline: true, ow: 0.015 });
      part(body, BOX(), STONE, [sx * 0.85, -0.82, 0], [0.5, 0.1, 0.5], [0, 0, 0], { outline: true, ow: 0.015 });
      // 門柱の上のあかり
      part(body, CYL(8), T(0x2a2e36), [sx * 0.85, 0.9, 0], [0.05, 0.12, 0.05]);
      part(body, SPH(8), glow(0xfff2c0), [sx * 0.85, 1.03, 0], [0.11, 0.13, 0.11]);
      part(body, CONE(8), T(0x2a2e36), [sx * 0.85, 1.19, 0], [0.15, 0.12, 0.15], [0, 0, 0], { outline: true, ow: 0.012 });
      addGlow(body, 0xfff2c0, 0.7, [sx * 0.85, 1.03, 0.05], 0.8);
    }
    part(body, BOX(), rimMat(0xffffff, c.rim, { map: plate }), [-0.85, 0.15, 0.215], [0.2, 0.5, 0.02], [0, 0, 0], { outline: true, ow: 0.012 });
    part(body, BOX(), STONE, [0, -0.86, 0.05], [2.3, 0.06, 0.7]);
    // 鉄の門（左右2まい。ちょうつがいは門柱のそば）
    const IR = T(0x22262e);
    for (const sx of [-1, 1]) {
      const d = grp(body, sx < 0 ? 'doorR' : 'doorL', [sx * 0.63, 0, 0]);
      const k = -sx; // ちょうつがいから、まん中への向き
      part(d, BOX(), IR, [k * 0.31, 0.5, 0], [0.62, 0.04, 0.04]);
      part(d, BOX(), IR, [k * 0.31, -0.7, 0], [0.62, 0.04, 0.04]);
      part(d, BOX(), IR, [k * 0.31, -0.25, 0], [0.62, 0.03, 0.03]);
      for (let i = 0; i <= 5; i++) {
        const x = k * (0.02 + i * 0.118);
        part(d, BOX(), IR, [x, -0.08, 0], [0.025, 1.28, 0.025]);
        part(d, CONE(4), T(0xd8b25a), [x, 0.6 + (i % 2) * 0.04, 0], [0.035, 0.1, 0.035]);
      }
      part(d, stroke([[0, 0.3, 0], [k * 0.3, 0.4, 0], [k * 0.6, 0.48, 0]], 0.018, 8, 4), T(0xd8b25a));
      part(d, TOR(0.12), T(0xd8b25a), [k * 0.32, -0.25, 0.02], 0.08);
    }
    // 門のあいだの光（技のとき）
    const lt = grp(body, 'light', [0, -0.08, -0.05]);
    part(lt, G('plane1', () => new THREE.PlaneGeometry(1, 1)), glow(c.glow, 0.7), [0, 0, 0], [1.2, 1.35, 1]);
    part(lt, G('plane1', () => new THREE.PlaneGeometry(1, 1)), glow(0xffffff, 0.6), [0, 0, 0.01], [0.6, 1.1, 1]);
    addGlow(lt, c.glow, 2.2, [0, 0, 0.1], 0.9);
    lt.visible = false;
    grp(body, 'emit', [0, 0, 0.1]);
  },

  // きーちろう（ピンクの髪のかっこいいギタリスト。友だちのバンド仲間）
  kiichiro(root, c) {
    const p = person(root, c, { skin: 0xf6cfae, top: 0x26262e, sleeve: 'short', pants: 0x1e2230, shoes: 0xf2f2f2, gw: 0.98, R: [0.4, 0.38, 0.37] });
    const { T, torso, head, F, B } = p;
    // 黒いシャツを前で開けて、白いTシャツ・銀のチェーン
    B.put(torso, SPH(10), T(0xf6f6f2), 0, 0.3, [0.14, 0.26, 0.05], -0.03);
    for (const sx of [-1, 1]) part(torso, flat('kiCol', [[0, 0.06], [0.13, 0.03], [0.04, -0.14]], 0.025, 0.01), T(0x34343e), [sx * 0.1, 0.53, B.z(0.1, 0.5) - 0.01], [sx, 1, 1], [-Math.PI / 2 + 0.5, sx * 0.3, 0], { outline: true, ow: 0.012 });
    part(torso, B.line([[-0.1, 0.5], [0, 0.4], [0.1, 0.5]], 0.012, 0.03), glow(0xd8dde6));
    // ピンクのとがった髪
    const H = p.HT(0xff5fa8);
    hairCap(head, p.R, H, 0.42, 1.07);
    const sp = [[0, 0.36, -0.05, -0.3, 0], [0.18, 0.3, -0.08, -0.3, -0.6], [-0.18, 0.3, -0.08, -0.3, 0.6], [0.3, 0.12, -0.12, -0.2, -1.2], [-0.3, 0.12, -0.12, -0.2, 1.2], [0.1, 0.26, -0.28, -1.1, -0.3], [-0.1, 0.26, -0.28, -1.1, 0.3]];
    for (const [x, y, z, rx, rz] of sp) part(head, CONE(5), H, [x, y, z], [0.09, 0.26, 0.09], [rx, 0, rz], { outline: true, ow: 0.015 });
    for (let i = -2; i <= 1; i++) part(head, tube('kiBang', [[0, 0, 0], [0.04, -0.07, 0.03], [0.1, -0.14, 0.01]], 0.07, 0.015, 6, 6), H, [i * 0.1 + 0.03, 0.29 - Math.abs(i + 0.5) * 0.03, F.z(i * 0.1, 0.29) - 0.03], 1, [0, 0, 0.3], { outline: true, ow: 0.015 });
    makeFace(head, F, T, { es: 0.95, eyeH: 0.72, ey: -0.04, brow: [0.15, 0.065, 0.12, 0.02], my: -0.18, mouth: 'smirk', nose: 0xecb592 });
    for (const sx of [-1, 1]) part(head, F.line([[sx * 0.09, 0.0], [sx * 0.135, 0.012], [sx * 0.18, 0.004]], 0.016, 0.008), glow(INK));
    part(head, TOR(0.2), glow(0xd8dde6), [0.4, -0.12, 0.0], 0.03, [0, Math.PI / 2, 0]);
    // ギター（水色）
    guitar(torso, c, T, 0x3fd0c8, 0xf4f1ea, [-0.1, 0.17, 0.3], [0.1, 0, -0.95]);
    part(torso, tube('rkStrap', [[-0.24, 0.02, 0.2], [-0.05, 0.3, 0.26], [0.2, 0.56, 0.12], [0.26, 0.52, -0.12]], 0.025, 0.025, 10, 5), T(0x15151a));
    p.armR.rotation.set(-0.85, 0, 0.45);
    p.armL.rotation.set(-1.4, 0, -0.15);
    grp(root, 'emit', [0, 0, 0.8]);
  },

  // 青い鷹（オリジナルの、青と白のするどい鷹）
  taka(root, c) {
    const T = (x) => rimMat(x, c.rim);
    const BL = 0x2a64d8, BD = 0x183c92, WT = 0xf6f8ff, YE = 0xffc23a;
    const fly = grp(root, 'fly');
    const body = grp(fly, 'body');
    part(body, SPH(), T(BL), [0, 0, 0], [0.38, 0.36, 0.8], [0, 0, 0], { outline: true });
    part(body, SPH(), T(WT), [0, -0.11, 0.12], [0.3, 0.28, 0.62]);
    for (let i = 0; i < 4; i++) part(body, stroke([[-0.12, -0.2 - i * 0.03, 0.42 - i * 0.16], [0, -0.23 - i * 0.03, 0.46 - i * 0.16], [0.12, -0.2 - i * 0.03, 0.42 - i * 0.16]], 0.016, 6, 4), T(0x9ab8ee));
    for (const sx of [-1, 1]) part(body, CONE(4), T(YE), [sx * 0.1, -0.33, 0.1], [0.04, 0.16, 0.04], [0.5, 0, 0]);
    const head = grp(fly, 'head', [0, 0.25, 0.72]);
    part(head, SPH(), T(WT), [0, 0, 0], [0.28, 0.26, 0.3], [0, 0, 0], { outline: true });
    part(head, SPH(), T(BL), [0, 0.08, -0.04], [0.29, 0.2, 0.3]);
    part(head, tube('tkBeak', [[0, 0.04, 0.17], [0, 0.03, 0.33], [0, -0.09, 0.42]], 0.08, 0.01), T(YE), [0, 0, 0], 1, [0, 0, 0], { outline: true, ow: 0.015 });
    part(head, SPH(6), T(0x2a2a34), [0, -0.0, 0.36], [0.03, 0.02, 0.03]);
    for (const sx of [-1, 1]) {
      part(head, BOX(), glow(c.eye), [sx * 0.13, 0.04, 0.17], [0.11, 0.045, 0.06], [0, sx * 0.45, sx * -0.15]);
      part(head, BOX(), T(BD), [sx * 0.13, 0.09, 0.18], [0.14, 0.035, 0.07], [0, sx * 0.45, sx * -0.3]);
    }
    for (let i = -1; i <= 1; i++) part(head, CONE(4), T(BD), [i * 0.07, 0.12, -0.2], [0.04, 0.3, 0.03], [-1.95, 0, i * 0.3]);
    // つばさ（はばの広い鷹のつばさ。先が指のように分かれる）
    pair(fly, 'wingL', 'wingR', [0.3, 0.1, 0.12], (w0) => {
      const w = grp(w0, '');
      w.scale.setScalar(0.8);
      part(w, flat('tkWing', [[0, 0.24], [0.6, 0.34], [1.15, 0.3], [1.65, 0.16], [1.95, 0.0], [2.0, -0.12], [1.82, -0.18], [1.9, -0.3], [1.68, -0.32], [1.72, -0.46], [1.48, -0.44], [1.48, -0.58], [1.22, -0.52], [0.8, -0.5], [0.4, -0.48], [0, -0.32]], 0.045, 0.016), T(BL), [0, 0, 0], 1, [0, 0, 0], { outline: true, ow: 0.02 });
      part(w, flat('tkWing2', [[0.05, 0.12], [0.75, 0.18], [1.3, 0.08], [1.25, -0.32], [0.6, -0.4], [0.05, -0.26]], 0.03, 0.01), T(WT), [0, -0.05, 0]);
      part(w, flat('tkWing3', [[1.5, 0.12], [1.95, -0.02], [1.9, -0.3], [1.5, -0.44], [1.3, -0.3]], 0.03, 0.01), T(BD), [0, 0.03, 0]);
      part(w, tube('tkEdge', [[0.02, 0.05, 0.26], [0.6, 0.05, 0.37], [1.15, 0.05, 0.33], [1.65, 0.04, 0.19], [1.95, 0.03, 0.03]], 0.02, 0.008, 24, 6), glow(c.glow));
    });
    const tail = grp(fly, 'tail', [0, 0.02, -0.68]);
    part(tail, flat('tkTail', [[-0.16, 0.12], [0.16, 0.12], [0.36, -0.55], [0.12, -0.62], [-0.12, -0.62], [-0.36, -0.55]], 0.04, 0.015), T(BL), [0, 0, 0], 1, [0, 0, 0], { outline: true, ow: 0.02 });
    for (const z of [-0.3, -0.48]) part(tail, BOX(), T(WT), [0, 0.035, z], [0.5 + z * 0.3, 0.012, 0.05]);
    grp(head, 'emit', [0, 0, 0.45]);
  },

  // スクリュー先生（めがねの頭のいい先生。赤いジャケット・高いポニーテール）
  screw(root, c) {
    const p = person(root, c, { skin: 0xf6d2b2, top: 0xd8303a, pants: 0x3a3440, shoes: 0x1a1a20, gw: 0.95, skirt: 0x23232c, R: [0.39, 0.38, 0.37] });
    const { T, torso, head, F, B } = p;
    B.put(torso, SPH(10), T(0xfafafa), 0, 0.38, [0.1, 0.18, 0.05], -0.03);
    for (const sx of [-1, 1]) part(torso, flat('rkLapel', [[0, 0.1], [0.12, 0.08], [0.06, -0.26], [0.0, -0.3]], 0.03, 0.01), T(0xb8202a), [sx * 0.11, 0.5, B.z(0.11, 0.4) - 0.01], [sx, 1, 1], [-Math.PI / 2 + 0.35, sx * 0.35, 0], { outline: true, ow: 0.015 });
    B.put(torso, SPH(5), T(0x2a2a30), 0.0, 0.12, 0.024, 0.012);
    // 黒い長い髪：ぱっつんの前髪・横の髪・高いポニーテール
    const H = p.HT(0x1c1a24);
    hairCap(head, p.R, H, 0.36, 1.06);
    part(head, flat('scBang', [[-0.3, 0.02], [0.3, 0.02], [0.3, -0.1], [-0.3, -0.1]], 0.05, 0.02), H, [0, 0.24, F.z(0, 0.24) - 0.01], 1, [-Math.PI / 2 + 0.45, 0, 0], { outline: true, ow: 0.015 });
    for (const sx of [-1, 1]) part(head, tube('scSide', [[0, 0, 0], [0, -0.16, 0.02], [0.0, -0.3, 0]], 0.07, 0.04, 6, 6), H, [sx * 0.34, 0.08, 0.06], 1, [0, 0, 0], { outline: true, ow: 0.015 });
    const pony = grp(head, 'pony', [0, 0.3, -0.26], [0.2, 0, 0]);
    part(pony, RING(0.4), T(0xd8303a), [0, 0, 0], [0.055, 0.055, 0.055], [Math.PI / 2 - 0.3, 0, 0]);
    part(pony, tube('scPony', [[0, 0, 0], [0, 0.05, -0.15], [0, -0.1, -0.3], [0, -0.42, -0.32], [0, -0.62, -0.24]], 0.085, 0.02, 14, 7), H, [0, 0, 0], 1, [0, 0, 0], { outline: true, ow: 0.015 });
    makeFace(head, F, T, { lash: true, es: 0.95, brow: [0.12, 0.085, 0.11, 0.018], my: -0.18, mouth: 'smirk', nose: 0xeab896, blush: true });
    glasses(head, F, 0x8a1f2a, 'round', 0.135, -0.03, 0.085);
    // 技のときの、うずまきの光
    const sw = grp(root, 'swirl');
    const hel = [];
    for (let i = 0; i <= 24; i++) {
      const u = i / 24;
      hel.push([Math.cos(u * Math.PI * 4) * 0.62, -0.9 + u * 2.1, Math.sin(u * Math.PI * 4) * 0.62]);
    }
    part(sw, stroke(hel, 0.05, 48, 5), glow(c.glow, 0.85));
    sw.visible = false;
    grp(root, 'emit', [0, 1.25, 0]);
  },

  // ブック（鉄人さんのボストンテリア。黒と白、大きな茶色の目、コウモリみたいな耳、黒いハーネス）
  book(root, c) {
    const T = (x) => rimMat(x, c.rim);
    const BK = 0x231d22, WH = 0xfaf8f4;
    const body = grp(root, 'body', [0, -0.08, -0.05]);
    part(body, SPH(12), T(BK), [0, 0, 0], [0.34, 0.32, 0.5], [0, 0, 0], { outline: true });
    part(body, SPH(10), T(WH), [0, -0.07, 0.3], [0.22, 0.24, 0.2]);
    // ハーネス（黒に、光る銀のふち）・Dカン・オレンジのリード
    const HN = T(0x111116), RF = glow(0xc8ccd6);
    part(body, RING(0.14), HN, [0, 0.0, 0.1], [0.35, 0.33, 0.35], [0, 0, 0], { outline: true, ow: 0.015 });
    for (const dz of [-0.045, 0.045]) part(body, RING(0.05), RF, [0, 0.0, 0.1 + dz], [0.36, 0.34, 0.36]);
    part(body, RING(0.14), HN, [0, 0.12, 0.36], [0.22, 0.2, 0.22], [-0.5, 0, 0], { outline: true, ow: 0.015 });
    part(body, BOX(), HN, [0, 0.32, 0.08], [0.16, 0.05, 0.24], [0, 0, 0], { outline: true, ow: 0.012 });
    part(body, TOR(0.18), T(0xc8ccd6), [0, 0.38, 0.02], 0.045, [0, Math.PI / 2, 0]);
    const ls = grp(body, 'leash', [0, 0.4, 0.0]);
    part(ls, tube('bkLeash', [[0, 0, 0], [0, 0.12, -0.15], [0, 0.18, -0.4], [0, 0.12, -0.62]], 0.028, 0.024, 10, 6), T(0xff7a1a), [0, 0, 0], 1, [0, 0, 0], { outline: true, ow: 0.012 });
    // 頭（まるくて大きい）・白い鼻すじ・白いマズル・大きな鼻
    const head = grp(body, 'head', [0, 0.34, 0.44]);
    const HR = [0.36, 0.33, 0.32];
    part(head, SPH(14), T(BK), [0, 0, 0], HR, [0, 0, 0], { outline: true });
    const F = surface(HR);
    F.put(head, SPH(8), T(WH), 0, 0.12, [0.055, 0.17, 0.03], -0.012);
    const mz = grp(head, 'muzzle', [0, -0.12, 0.21]);
    const MR = [0.18, 0.12, 0.13];
    part(mz, SPH(10), T(WH), [0, 0, 0], MR, [0, 0, 0], { outline: true, ow: 0.015 });
    const MF = surface(MR);
    MF.put(mz, SPH(8), glow(0x141014), 0, 0.055, [0.07, 0.045, 0.045], -0.012);
    MF.put(mz, SPH(4), glow(0xffffff), 0.02, 0.075, 0.013, 0.025);
    makeFace(head, F, T, { ex: 0.15, ey: 0.03, es: 1.4, eyeH: 0.82, eyeCol: 0x5a3418, mpar: mz, MF, my: -0.04, ms: 0.8, mouth: 'cat' });
    const ey = head.getObjectByName('eyes');
    for (const sx of [-1, 1]) F.put(ey, SPH(6), glow(0x120c10), sx * 0.155, 0.02, [0.04, 0.042, 0.03], 0.004, 0, 0.03);
    // コウモリのような大きい耳（内がわはピンク）
    for (const sx of [-1, 1]) {
      const e = grp(head, sx < 0 ? 'earR' : 'earL', [sx * 0.2, 0.22, -0.04], [-0.1, sx * 0.25, sx * -0.38]);
      part(e, flat('bkEar', [[-0.11, 0], [0.11, 0], [0.1, 0.16], [0.04, 0.32], [-0.02, 0.34], [-0.09, 0.2]], 0.04, 0.015), T(BK), [0, 0, 0], [sx, 1, 1], [-Math.PI / 2, 0, 0], { outline: true, ow: 0.015 });
      part(e, flat('bkEarIn', [[-0.07, 0.03], [0.07, 0.03], [0.06, 0.15], [0.02, 0.26], [-0.05, 0.16]], 0.01, 0.005), T(0xf2a0a8), [0, 0, 0.03], [sx, 1, 1], [-Math.PI / 2, 0, 0]);
    }
    // 足（前足の先は白）・みじかいしっぽ
    const legs = grp(body, 'legs');
    for (const [x, z, n, front] of [[-0.18, 0.3, 'legFR', 1], [0.18, 0.3, 'legFL', 1], [-0.18, -0.3, 'legBR', 0], [0.18, -0.3, 'legBL', 0]]) {
      const l = grp(legs, n, [x, -0.2, z]);
      part(l, tube('bkLeg', [[0, 0.12, 0], [0, -0.06, 0.01], [0, -0.2, 0]], 0.09, 0.078, 5, 7), T(BK), [0, 0, 0], 1, [0, 0, 0], { outline: true });
      if (front) part(l, tube('bkSock', [[0, -0.05, 0.0], [0, -0.13, 0.01], [0, -0.2, 0]], 0.082, 0.078, 3, 7), T(WH));
      part(l, SPH(6), T(front ? WH : BK), [0, -0.21, 0.03], [0.08, 0.055, 0.1], [0, 0, 0], { outline: true, ow: 0.015 });
    }
    const tail = grp(body, 'tail', [0, 0.16, -0.48]);
    part(tail, CONE(6), T(BK), [0, 0.04, -0.03], [0.05, 0.14, 0.05], [-0.7, 0, 0], { outline: true, ow: 0.012 });
    grp(mz, 'emit', [0, 0, 0.2]);
  },
});

// 床などに貼る絵（光の当たり方に関係なく、すき間はぬく）
const decalCache = new Map();
function decal(tex) {
  if (!decalCache.has(tex.uuid)) decalCache.set(tex.uuid, shareMark(new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide })));
  return decalCache.get(tex.uuid);
}

// ---- 動かない部品を、材質ごとに1つにまとめる（描く回数をへらす）----
// 名前のある部品（動く・消える）と、すき通る材質はそのまま。グループの中の、名前のない部品だけをまとめる
// ふちどりの太さは部品の大きさで変わるので、「太さ×大きさ」ごとにまとめる（見た目は変わらない）
function prepGeo(src, m) {
  const n = src.attributes.position.count;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', src.attributes.position.clone());
  g.setAttribute('uv', src.attributes.uv ? src.attributes.uv.clone() : new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
  const idx = src.index ? Array.from(src.index.array) : Array.from({ length: n }, (_, i) => i);
  // 鏡うつしの部品は、三角形の向きを反転（表と裏がひっくり返らないように）
  if (m.determinant() < 0) for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
  g.setIndex(idx);
  if (src.attributes.normal) g.setAttribute('normal', src.attributes.normal.clone());
  else g.computeVertexNormals();
  g.applyMatrix4(m);
  return g;
}
const _sc = new THREE.Vector3();
function bake(root) {
  const all = [];
  root.traverse((o) => all.push(o));
  for (const g of all) {
    const buckets = new Map();
    for (const m of g.children) {
      if (!m.isMesh || m.name || !m.visible || Array.isArray(m.material) || m.material.transparent) continue;
      if (m.children.some((ch) => ch.name !== 'outline')) continue;
      if (!buckets.has(m.material)) buckets.set(m.material, []);
      buckets.get(m.material).push(m);
    }
    for (const [mat, list] of buckets) {
      if (list.length < 2) continue;
      const geos = [], lines = new Map();
      for (const m of list) {
        m.updateMatrix();
        const pg = prepGeo(m.geometry, m.matrix);
        geos.push(pg);
        const ol = m.children.find((ch) => ch.name === 'outline');
        if (ol && ol.material.userData.outline) {
          const [w, a, b] = ol.material.userData.outline;
          const ew = +(w * _sc.setFromMatrixColumn(m.matrix, 0).length()).toPrecision(2);
          const col = ol.material.color.getHex();
          const k = col + '|' + ew + '|' + a + '|' + b;
          if (!lines.has(k)) lines.set(k, { mat: outlineMat(col, ew, a, b), geos: [] });
          lines.get(k).geos.push(pg);
        }
      }
      let merged = null;
      try {
        merged = mergeGeometries(geos, false);
      } catch (e) {}
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      g.add(mesh);
      for (const L of lines.values()) {
        const lg = L.geos.length > 1 ? mergeGeometries(L.geos, false) : L.geos[0].clone();
        if (!lg) continue;
        const o = new THREE.Mesh(lg, L.mat);
        o.name = 'outline';
        o.renderOrder = -1;
        o.raycast = () => {};
        mesh.add(o);
      }
      for (const m of list) g.remove(m);
      for (const pg of geos) pg.dispose();
    }
  }
}

// ---- 作る（同じ種類は型を1回だけ作って、使うたびに複製）----
const tplCache = new Map();
export function buildMonster(id) {
  const key = MONSTERS[id] ? id : 'rocker';
  const def = MONSTERS[key];
  if (!tplCache.has(key)) {
    const root = new THREE.Group();
    root.name = 'monster';
    BUILD[key](root, PAL[def.elem]);
    if (ANIM2[def.anim]) bake(root); // 大学のディスクは、動かない部品をまとめる
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
    // 大学のディスクは、毎回もとの形にもどしてから動かす（回転・大きさ・見える/見えない）
    o.userData.r0 = o.rotation.clone();
    o.userData.s0 = o.scale.clone();
    o.userData.v0 = o.visible;
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
  // 大学のディスク（人・犬・学食など）は、もとの形にもどしてから別の表（ANIM2）で動かす
  const f2 = ANIM2[a];
  if (f2) {
    rest(P);
    if (P.body) P.body.position.y += Math.sin(t * 3.2) * 0.05;
    f2(P, U, phase, k, t, act, hit, pre);
    return;
  }
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

// ===== 大学のディスクの動き =====
// もとの形にもどす（名前のある部品の、位置・回転・大きさ・見える/見えない）
function rest(P) {
  for (const k in P) {
    if (k === 'outline') continue;
    const o = P[k], u = o.userData;
    if (!u.r0) continue;
    o.position.copy(u.p0);
    o.rotation.copy(u.r0);
    o.scale.copy(u.s0);
    o.visible = u.v0;
  }
}
const sm = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x)); // なめらかな 0→1
// 腕：fwd（前へ上げる）・out（外へ開く。マイナスで内へ）・tw（ひねり）。side：左 +1／右 -1
function arm(P, side, fwd, out, tw = 0) {
  const a = side > 0 ? P.armL : P.armR;
  if (a) a.rotation.set(-fwd, side * tw, side * out);
}
// まばたき（ときどき目をとじる）
function blink(P, t, off = 0) {
  if (P.eyes && (t + off) % 3.4 > 3.25) P.eyes.scale.y = 0.12;
}
// 口を開ける（0 でとじる）
function mouth(P, v) {
  if (!P.mouthO) return;
  P.mouthO.visible = v > 0.06;
  P.mouthO.scale.y = Math.max(0.06, v);
  if (P.mouthS) P.mouthS.visible = !P.mouthO.visible;
}
// 息（胸が少しふくらむ）
function breathe(P, t, k = 1) {
  if (P.chest) P.chest.scale.y = P.chest.userData.s0.y * (1 + Math.sin(t * 2.6) * 0.025 * k);
}
// 湯気がゆらゆら上る
function steamUp(P, name, t, n, k = 1) {
  for (let i = 0; i < n; i++) {
    const w = P[name + i];
    if (!w) continue;
    const q = (t * 0.45 * k + i * 0.37) % 1;
    w.position.y = w.userData.p0.y + q * 0.22 * k;
    w.rotation.z = Math.sin(t * 2.2 + i * 1.7) * 0.18;
    w.scale.setScalar(Math.sin(q * Math.PI) * (0.7 + 0.5 * k));
  }
}
// 引数：P 部品 / U userData / ph フェーズ / k 進み / t 秒 / act 技の山（0→1→0）/ hit 技の出だし（0→1）/ pre 溜め
const ANIM2 = {
  // 英語の先生：のけぞって息を吸う → 前へのりだして大声
  shout(P, U, ph, k, t, act, hit, pre) {
    breathe(P, t, 1 + pre * 2);
    blink(P, t);
    P.torso.rotation.x = -0.2 * pre + 0.4 * act + Math.sin(t * 2) * 0.02;
    P.head.rotation.x = -0.15 * pre - 0.12 * act;
    P.head.rotation.z = Math.sin(t * 1.6) * 0.05 * (1 - act);
    mouth(P, ph === 'charge' ? 0 : ph === 'act' ? 0.8 + 1.1 * act : 0.8);
    if (P.brows) P.brows.position.y = 0.025 * act - 0.02 * pre;
    arm(P, -1, 0.15 + 0.3 * pre + 1.75 * act, 0.18 + 0.55 * act);
    arm(P, 1, 0.8 - 0.15 * pre + 0.7 * act, -0.42 + 0.25 * act);
    if (P.book) P.book.rotation.x = P.book.userData.r0.x - 0.15 * pre + 0.5 * act;
    U.push = 0.25 * act;
  },
  // ロックな先生：ふだんは小きざみ。溜めで右うでを大きく上げて、技で ふりおろす（パワーコード）
  strum(P, U, ph, k, t, act, hit, pre) {
    breathe(P, t);
    blink(P, t);
    const up = ph === 'charge' ? sm(pre) : ph === 'act' ? 1 - sm(k * 3) : 0;
    const beat = ph === 'idle' ? Math.sin(t * 9) : 0;
    // 腕が短いので、頭のうしろにかくれないよう横へ大きく上げる
    arm(P, -1, 0.85 + 0.14 * beat + 1.55 * up, -0.45 + 1.5 * up);
    arm(P, 1, 1.4 + 0.1 * act, -0.15);
    P.torso.rotation.x = -0.15 * up + 0.18 * act;
    P.torso.rotation.z = 0.08 * up - 0.06 * act;
    P.head.rotation.x = 0.3 * act - 0.1 * up + 0.06 * beat;
    mouth(P, 0.9 * act + 0.3 * up);
    if (P.legL) P.legL.rotation.x = -0.5 * act;
    U.lift = 0.12 * act;
  },
  // 学食カレー：スプーンを後ろへ引いて → 前へはじいてカレーを飛ばす
  fling(P, U, ph, k, t, act, hit, pre) {
    blink(P, t);
    const back = ph === 'charge' ? sm(pre) : 0;
    const fl = ph === 'act' ? Math.sin(Math.min(1, k * 2.4) * Math.PI * 0.5) * (1 - sm((k - 0.5) * 2) * 0.6) : 0;
    P.spoon.rotation.x = P.spoon.userData.r0.x - 0.5 * back + 1.05 * fl;
    P.spoon.position.y = P.spoon.userData.p0.y + 0.05 * back;
    if (P.scoop) P.scoop.visible = !(ph === 'act' && k > 0.15);
    P.body.scale.set(1 + 0.05 * act - 0.03 * back, 1 - 0.06 * act + 0.03 * back, 1);
    mouth(P, ph === 'act' ? 0.9 * act : 0);
    if (P.rice) P.rice.rotation.z = -0.08 * back + 0.06 * act + Math.sin(t * 2.4) * 0.03;
    steamUp(P, 'steam', t, 3);
  },
  // クッキー：ちぢんで右手を後ろへ → ぴょんと跳んで投げる
  hop(P, U, ph, k, t, act, hit, pre) {
    blink(P, t);
    const sq = ph === 'charge' ? sm(pre) : 0;
    const jump = ph === 'act' ? Math.sin(Math.min(1, k * 1.25) * Math.PI) : 0;
    const ck = P.ck;
    ck.scale.set(1 + 0.12 * sq - 0.06 * jump, 1 - 0.14 * sq + 0.1 * jump, 1);
    ck.position.y = ck.userData.p0.y - 0.08 * sq;
    ck.rotation.x = -0.22 * sq + 0.3 * act;
    ck.rotation.z = Math.sin(t * 3) * 0.06 * (1 - act);
    const thr = ph === 'act' ? sm(k * 3) : 0;
    if (P.armR) P.armR.rotation.x = 2.4 * sq * (1 - thr) - 2.4 * thr * (1 - sm((k - 0.5) * 2));
    if (P.armL) P.armL.rotation.x = Math.sin(t * 3) * 0.2 - 0.6 * sq + 0.5 * act;
    if (P.legL) P.legL.rotation.x = -0.6 * jump;
    if (P.legR) P.legR.rotation.x = 0.3 * jump;
    mouth(P, ph === 'act' ? 0.8 * act : ph === 'charge' ? 0 : 0);
    U.lift = 0.5 * jump;
  },
  // 購買のおばちゃん：ソフトクリームを「はい、どうぞ」と前へ
  offer(P, U, ph, k, t, act, hit, pre) {
    breathe(P, t);
    const o = Math.max(0.25 * sm(pre), act);
    arm(P, -1, 0.95 + 0.6 * o, -0.32 + 0.25 * o);
    arm(P, 1, -0.1 + 0.15 * Math.sin(t * 2), 0.32 + 0.1 * Math.sin(t * 2.4));
    if (P.icecream) {
      P.icecream.rotation.x = P.icecream.userData.r0.x + 0.6 * o;
      P.icecream.scale.setScalar(1 + 0.25 * act);
    }
    P.torso.rotation.x = 0.22 * o;
    P.head.rotation.z = Math.sin(t * 1.5) * 0.08 + 0.14 * act;
    P.head.rotation.x = 0.1 * o;
    mouth(P, 0.55 * act);
  },
  // やさしい先生：両手を前に開いて、手のあいだが光る
  palms(P, U, ph, k, t, act, hit, pre) {
    breathe(P, t);
    const o = Math.max(0.55 * sm(pre), act);
    arm(P, 1, 0.55 + 0.85 * o, -0.45 + 0.75 * o);
    arm(P, -1, 0.55 + 0.85 * o, -0.45 + 0.75 * o);
    if (o > 0.3) for (const h of [P.handL, P.handR]) h.scale.set(1.15, 1.15, 0.65);
    if (P.orb) {
      P.orb.visible = o > 0.08;
      P.orb.scale.setScalar(0.2 + 1.1 * o + 0.08 * Math.sin(t * 9));
    }
    P.head.rotation.z = Math.sin(t * 1.3) * 0.08;
    P.head.rotation.x = 0.06 + 0.06 * Math.sin(t * 2);
    mouth(P, 0.4 * act);
  },
  // 駅の先生：手をさしのべて「大丈夫ですか？」。肩の学生は手をふり、ときどき ぐらっとする
  help(P, U, ph, k, t, act, hit, pre) {
    breathe(P, t);
    blink(P, t);
    const o = Math.max(0.35 * sm(pre), act);
    arm(P, 1, 0.25 + 1.05 * o, 0.15 - 0.1 * o);
    arm(P, -1, 0.2 + 0.1 * Math.sin(t * 1.7), 0.35);
    P.torso.rotation.x = 0.28 * o;
    P.head.rotation.x = 0.12 * o;
    P.head.rotation.z = -0.12 * o + Math.sin(t * 1.4) * 0.04;
    if (P.brows) P.brows.position.y = 0.015 * o;
    mouth(P, ph === 'act' ? 0.35 + 0.25 * Math.abs(Math.sin(t * 11)) : 0);
    if (P.scarf) P.scarf.rotation.z = P.scarf.userData.r0.z + Math.sin(t * 3) * 0.08 + 0.2 * o;
    // 肩の学生：2.9秒ごとに うしろへぐらっ → 手をばたばた → もどる
    const q = t % 2.9;
    const wob = q > 2.0 ? Math.sin(((q - 2.0) / 0.9) * Math.PI) : 0;
    if (P.hBody) {
      P.hBody.rotation.z = 0.45 * wob;
      P.hBody.rotation.x = -0.3 * wob + 0.1 * o;
    }
    const wv = Math.sin(t * (ph === 'act' ? 16 : 9));
    if (P.hArmR) P.hArmR.rotation.z = -2.5 - 0.35 * wv + 0.6 * wob;
    if (P.hArmL) P.hArmL.rotation.z = 0.4 + 2.0 * wob * (0.7 + 0.3 * Math.sin(t * 20));
    if (P.hHead) P.hHead.rotation.z = Math.sin(t * 2.3) * 0.12 - 0.2 * wob;
  },
  // まめた：うれしくて体をくねくね、しっぽをぶんぶん、もぐもぐ
  wiggle(P, U, ph, k, t, act, hit, pre) {
    blink(P, t);
    const b = ph === 'charge' ? sm(pre) : 0;
    P.tail.rotation.z = Math.sin(t * (ph === 'act' ? 30 : 10 + 8 * b)) * (0.35 + 0.25 * act + 0.15 * b);
    P.body.rotation.z = Math.sin(t * 20) * 0.16 * act;
    P.body.rotation.y = Math.sin(t * 10) * 0.12 * act;
    P.body.rotation.x = 0.14 * b;
    P.head.rotation.z = Math.sin(t * 1.5) * 0.12 + Math.sin(t * 20) * 0.1 * act;
    P.head.rotation.x = -0.15 * act + 0.12 * b;
    if (ph === 'act') {
      if (P.eyes) P.eyes.visible = false;
      if (P.eyesC) P.eyesC.visible = true;
    }
    mouth(P, ph === 'act' ? (Math.sin(t * 26) > 0 ? 0.6 : 0.15) * (0.4 + act) : 0);
    for (const [n, s] of [['legFL', 1], ['legFR', -1], ['legBL', -1], ['legBR', 1]]) if (P[n]) P[n].rotation.x = Math.sin(t * 20) * 0.35 * s * act - 0.25 * b * (n[3] === 'F' ? 1 : -1);
    for (const n of ['earL', 'earR']) if (P[n]) P[n].rotation.x = Math.sin(t * 12) * 0.1 * act;
    U.lift = 0.12 * act * Math.abs(Math.sin(t * 10));
  },
  // ラーメン：ぶるぶる → 湯気がぼわっと大きく上がる
  steamBurst(P, U, ph, k, t, act, hit, pre) {
    blink(P, t);
    const b = ph === 'charge' ? sm(pre) : 0;
    P.body.position.x = Math.sin(t * 45) * 0.018 * b;
    P.bowl.scale.set(1 + 0.06 * act, 1 - 0.07 * act + 0.03 * b, 1 + 0.06 * act);
    steamUp(P, 'steam', t, 3, 1 + b * 0.8 + act * 1.5);
    if (P.puffs) {
      P.puffs.visible = ph === 'act';
      for (let i = 0; i < 3; i++) {
        const q = P['puff' + i];
        if (!q) continue;
        const kk = Math.min(1, k * 1.6 + i * 0.08);
        q.position.set(q.userData.p0.x * (1 + kk), q.userData.p0.y + kk * 0.55, q.userData.p0.z);
        q.scale.setScalar(q.userData.s0.x * (0.5 + 1.6 * Math.sin(kk * Math.PI * 0.85)));
      }
    }
    if (b > 0.3) {
      if (P.eyes) P.eyes.visible = false;
      if (P.eyesC) P.eyesC.visible = true;
    }
    mouth(P, ph === 'act' ? 0.8 * act : 0);
    U.lift = 0.15 * act;
  },
  // 駅伝カントク：メガホンを口へ → 大声＋ガッツポーズ
  megaphone(P, U, ph, k, t, act, hit, pre) {
    breathe(P, t);
    blink(P, t);
    const up = ph === 'charge' ? sm(pre * 1.4) : ph === 'act' ? 1 : 0;
    if (up > 0.5) {
      P.megH.visible = false;
      P.megM.visible = true;
    }
    // 口の前のメガホンは左手でささえて、右手でガッツポーズ（ディスクの画面でこちらに見える手）
    const pump = ph === 'act' ? Math.abs(Math.sin(k * Math.PI * 2.5)) : 0;
    const raise = Math.max(act, 0.3 * up);
    arm(P, 1, 0.25 + 1.85 * up, 0.12 - 0.62 * up);
    // こぶしは頭の横へ（腕が短いので、上へまっすぐだと頭にかくれる）
    if (up > 0.5) arm(P, -1, 0.15 + 0.2 * raise, 0.12 + (2.1 + 0.4 * pump) * raise);
    else arm(P, -1, 0.55 - 0.4 * up, 0.1);
    P.torso.rotation.x = -0.1 * up + 0.2 * act;
    P.head.rotation.x = -0.08 * act;
    mouth(P, ph === 'act' ? 0.9 : 0);
    if (P.megM) P.megM.scale.setScalar(1 + 0.15 * act);
    if (P.brows) P.brows.position.y = -0.015 * up;
  },
  // ロケッツ：ちぢんで火が強くなる → ぴょんと上がって、てっぺんから音符
  blast(P, U, ph, k, t, act, hit, pre) {
    blink(P, t);
    const b = ph === 'charge' ? sm(pre) : 0;
    const jump = ph === 'act' ? Math.sin(Math.min(1, k * 1.3) * Math.PI) : 0;
    P.rk.scale.set(1 + 0.08 * b - 0.05 * jump, 1 - 0.1 * b + 0.12 * jump, 1 + 0.08 * b - 0.05 * jump);
    P.rk.rotation.z = Math.sin(t * 2.1) * 0.08 * (1 - jump) + Math.sin(t * 50) * 0.02 * b;
    P.rk.rotation.x = Math.sin(t * 1.7) * 0.05;
    if (P.flame) P.flame.scale.set(1 + 0.2 * b, 0.8 + 0.25 * Math.sin(t * 30) + 0.8 * b + 1.4 * act, 1 + 0.2 * b);
    if (P.notes) {
      P.notes.visible = ph === 'act';
      const kk = Math.min(1, k * 1.5);
      for (let i = 0; i < 3; i++) {
        const n = P['note' + i];
        if (!n) continue;
        const a = (i - 1) * 0.9;
        n.position.set(Math.sin(a) * kk * 0.7, 0.95 + kk * 0.6 + (i === 1 ? 0.15 : 0), Math.cos(a) * 0.2 * kk);
        n.rotation.z = Math.sin(t * 8 + i) * 0.3;
        n.scale.setScalar(0.6 + 0.9 * Math.sin(Math.min(1, k * 1.2) * Math.PI * 0.9));
      }
    }
    if (b > 0.4) {
      if (P.eyes) P.eyes.visible = false;
      if (P.eyesC) P.eyesC.visible = true;
    }
    mouth(P, ph === 'act' ? 0.7 * act : 0);
    U.lift = 0.4 * jump;
  },
  // 楽器の先生：目をとじて聞きいる → かき鳴らして、音符がふわふわ
  pluck(P, U, ph, k, t, act, hit, pre) {
    breathe(P, t);
    const b = ph === 'charge' ? sm(pre) : 0;
    const st = Math.sin(t * (ph === 'act' ? 22 : 6));
    arm(P, -1, 0.98 + st * (ph === 'act' ? 0.26 : 0.08), -0.55);
    P.head.rotation.z = Math.sin(t * 2.2) * (0.06 + 0.1 * Math.max(b, act));
    P.head.rotation.x = 0.06 * b;
    P.torso.rotation.z = Math.sin(t * 2.2 + 0.5) * 0.04 * (1 + act);
    P.torso.rotation.x = -0.08 * b;
    if (b > 0.3 || ph === 'act') {
      if (P.eyes) P.eyes.visible = false;
      if (P.eyesC) P.eyesC.visible = true;
    } else blink(P, t);
    mouth(P, ph === 'act' ? 0.35 : 0);
    if (P.notes) {
      P.notes.visible = ph === 'act' || b > 0.5;
      for (let i = 0; i < 3; i++) {
        const n = P['note' + i];
        if (!n) continue;
        const q = (t * 0.9 + i * 0.33) % 1;
        n.position.set((i - 1) * 0.25 + Math.sin(t * 3 + i * 2) * 0.08, q * 0.8, 0.05 * i);
        n.rotation.z = Math.sin(t * 4 + i) * 0.35;
        n.scale.setScalar(Math.sin(q * Math.PI) * (0.8 + 0.4 * act));
      }
    }
  },
  // 出席にきびしい先生：赤ペンを高く上げて、くるっと返し → 下へ「欠席」のはんこ
  stamp(P, U, ph, k, t, act, hit, pre) {
    breathe(P, t, 0.6);
    blink(P, t);
    const up = ph === 'charge' ? sm(pre) : ph === 'act' ? 1 - sm(k * 3.5) : 0;
    const down = ph === 'act' ? sm(k * 3.5) * (1 - sm((k - 0.6) * 2.5)) : 0;
    arm(P, -1, 0.45 + 1.9 * up - 0.05 * down, 0.1 + 0.9 * up + 0.2 * down);
    if (P.pen) P.pen.rotation.x = P.pen.userData.r0.x + Math.PI * Math.max(up, down > 0 ? 1 : 0);
    arm(P, 1, 0.75 + 0.2 * up, -0.5);
    P.torso.rotation.x = -0.12 * up + 0.45 * down;
    P.head.rotation.x = 0.25 * down - 0.05 * up;
    if (P.mark) {
      P.mark.visible = ph === 'act' && k > 0.22;
      const q = sm((k - 0.22) * 5);
      P.mark.scale.setScalar(q * (1 + 0.25 * Math.sin(q * Math.PI)));
    }
    if (P.glasses) P.glasses.position.y = P.glasses.userData.p0.y + 0.01 * Math.sin(t * 3);
    U.dive = 0.25 * down;
  },
  // 単位くれそうな先生：にっこり笑って、「単位」の紙を下へ落とす（わなです）
  drop(P, U, ph, k, t, act, hit, pre) {
    breathe(P, t);
    blink(P, t);
    const b = ph === 'charge' ? sm(pre) : 0;
    const fall = ph === 'act' ? sm(k * 1.7) : 0;
    const smile = Math.max(b, ph === 'act' ? 1 : 0);
    if (smile > 0.3) {
      if (P.eyes) P.eyes.visible = false;
      if (P.eyesC) P.eyesC.visible = true;
    }
    // 溜め：紙を少し上へ見せる → 技：手をはなして、紙が下へ
    arm(P, 1, 0.75 + 0.35 * b - 0.3 * fall, -0.55 + 0.75 * fall);
    arm(P, -1, 0.75 + 0.35 * b - 0.3 * fall, -0.55 + 0.75 * fall);
    if (P.cert) {
      P.cert.position.y = P.cert.userData.p0.y + 0.1 * b - 0.78 * fall;
      P.cert.position.z = P.cert.userData.p0.z + 0.05 * b + 0.05 * fall;
      P.cert.rotation.x = P.cert.userData.r0.x - 1.47 * fall;
      P.cert.rotation.z = Math.sin(fall * Math.PI) * 0.4;
    }
    P.head.rotation.z = Math.sin(t * 1.6) * 0.06 + 0.12 * b;
    P.head.rotation.x = 0.12 * fall;
    mouth(P, ph === 'act' ? 0.45 * act : 0);
  },
  // 油そば：ぶるっ → 前へかたむいて、下にあぶらの水たまり
  splash(P, U, ph, k, t, act, hit, pre) {
    blink(P, t);
    const b = ph === 'charge' ? sm(pre) : 0;
    P.body.position.x = Math.sin(t * 40) * 0.015 * b;
    P.body.rotation.x = P.body.userData.r0.x - 0.15 * b + 0.55 * act;
    P.bowl.scale.set(1 + 0.05 * b, 1 - 0.06 * b, 1 + 0.05 * b);
    mouth(P, ph === 'act' ? 0.7 * act : 0);
    if (b > 0.4) {
      if (P.eyes) P.eyes.visible = false;
      if (P.eyesC) P.eyesC.visible = true;
    }
    if (P.puddle) {
      P.puddle.visible = ph === 'act' && k > 0.15;
      const q = sm((k - 0.15) * 3);
      P.puddle.scale.set(q * (1 + 0.15 * Math.sin(t * 6)), 1, q);
    }
    for (let i = 0; i < 3; i++) {
      const d = P['drop' + i];
      if (!d) continue;
      const q = ph === 'act' ? Math.min(1, k * 2.2 - i * 0.12) : 0;
      d.visible = q > 0 && q < 1;
      d.position.set((i - 1) * 0.25 * q, -0.1 + 0.25 * Math.sin(q * Math.PI) - 0.6 * q * q, 0.4 + 0.15 * q);
    }
    U.lift = 0.2 * act;
  },
  // 終電：ドアが開く → しまって、前へびゅん
  depart(P, U, ph, k, t, act, hit, pre) {
    const b = ph === 'charge' ? sm(pre) : 0;
    const shut = ph === 'act' ? 1 - sm(k * 5) : 0;
    const open = Math.max(b, shut);
    for (const s of ['L', 'R'])
      for (const i of [0, 1]) {
        const d = P['door' + s + i];
        if (d) d.position.z = d.userData.p0.z + (i ? 1 : -1) * 0.18 * open;
      }
    const run = ph === 'act' ? sm(k * 2) : 0;
    P.car.position.y = P.car.userData.p0.y + Math.abs(Math.sin(t * 9)) * 0.02 * (1 - run) + 0.02 * Math.sin(t * 30) * run;
    P.car.rotation.x = -0.06 * act;
    P.car.scale.set(1, 1, 1 + 0.12 * act);
    U.push = 3.2 * act;
  },
  // 正門：門がゆれて → ぎいっと開いて、光があふれる
  open(P, U, ph, k, t, act, hit, pre) {
    const b = ph === 'charge' ? sm(pre) : 0;
    const op = ph === 'act' ? sm(k * 2.5) : 0;
    const jig = Math.sin(t * 30) * 0.04 * b;
    if (P.doorL) P.doorL.rotation.y = -1.35 * op - jig;
    if (P.doorR) P.doorR.rotation.y = 1.35 * op + jig;
    if (P.light) {
      P.light.visible = b > 0.2 || ph === 'act';
      P.light.scale.set(0.3 + 0.7 * Math.max(op, 0.3 * b), 1, 1);
    }
    U.lift = 0.12 * act + 0.03 * Math.sin(t * 2);
  },
  // きーちろう：かがんで → ギターをかかえて、ひざでスライディング（前へ）
  slide(P, U, ph, k, t, act, hit, pre) {
    breathe(P, t);
    blink(P, t);
    const b = ph === 'charge' ? sm(pre) : 0;
    const beat = ph === 'idle' ? Math.sin(t * 9) : 0;
    arm(P, -1, 0.85 + 0.12 * beat + 1.4 * act, -0.45 + 1.1 * act);
    arm(P, 1, 1.4 + 0.2 * act, -0.15);
    P.torso.rotation.x = 0.25 * b - 0.45 * act;
    P.head.rotation.x = 0.1 * b - 0.25 * act + 0.05 * beat;
    for (const n of ['legL', 'legR']) if (P[n]) P[n].rotation.x = -0.5 * b - 1.3 * act;
    P.body.position.y += -0.08 * b - 0.18 * act;
    mouth(P, 0.75 * act);
    U.push = 3.0 * act;
    U.tilt = -0.08 * act;
  },
  // 青い鷹：つばさを大きく広げて、くるっと円をえがいて飛ぶ
  circle(P, U, ph, k, t, act, hit, pre) {
    const b = ph === 'charge' ? sm(pre) : 0;
    const flap = ph === 'act' ? 0.08 * Math.sin(t * 8) : Math.sin(t * 9) * 0.3;
    wings(P, 0.15 + flap + 0.75 * b - 0.25 * act);
    if (P.fly) {
      const th = ph === 'act' ? Math.PI * 2 * sm(k * 1.15) : 0;
      const R = 0.75;
      P.fly.position.set(R * (1 - Math.cos(th)), 0.15 * Math.sin(th) + 0.05 * b, R * Math.sin(th));
      P.fly.rotation.set(-0.15 * b, th, -0.55 * act);
    }
    if (P.head) P.head.rotation.y = Math.sin(t * 1.5) * 0.25 * (1 - act);
    if (P.tail) P.tail.rotation.x = Math.sin(t * 5) * 0.1;
    U.push = 1.2 * act;
  },
  // スクリュー先生：しずんで → こぶしを上に、くるくる回りながら上へ（アッパー）
  corkscrew(P, U, ph, k, t, act, hit, pre) {
    breathe(P, t);
    blink(P, t);
    const b = ph === 'charge' ? sm(pre) : 0;
    const spin = ph === 'act' ? Math.PI * 4 * sm(k * 1.2) : 0;
    P.body.rotation.y = spin - 0.4 * b;
    P.body.position.y += -0.1 * b;
    arm(P, -1, 0.2 - 0.3 * b + 2.75 * act, 0.15 + 0.3 * b - 0.1 * act);
    arm(P, 1, 0.3 + 0.5 * b + 0.4 * act, -0.4 * b - 0.3 * act);
    P.torso.rotation.x = 0.25 * b - 0.1 * act;
    P.torso.rotation.z = -0.1 * act;
    for (const n of ['legL', 'legR']) if (P[n]) P[n].rotation.x = -0.4 * b + 0.25 * act;
    if (P.pony) P.pony.rotation.x = P.pony.userData.r0.x + Math.sin(t * 3) * 0.1 - 1.0 * act;
    if (P.brows) P.brows.position.y = -0.02 * Math.max(b, act);
    mouth(P, ph === 'act' ? 0.9 * act : 0);
    if (P.swirl) {
      P.swirl.visible = ph === 'act' && k < 0.8;
      P.swirl.rotation.y = -spin * 0.8;
      P.swirl.scale.set(1, 0.4 + 0.8 * sm(k * 2), 1);
    }
    U.lift = 0.6 * act;
  },
  // ブック：しっぽをふって、ぐっとかがんで → 前へダッシュ（耳はうしろへ）
  zoom(P, U, ph, k, t, act, hit, pre) {
    blink(P, t);
    const b = ph === 'charge' ? sm(pre) : 0;
    const sp = ph === 'act' ? 24 : 0;
    const g = Math.sin(t * sp) * 0.75 * act;
    if (P.legFL) P.legFL.rotation.x = g - 0.3 * b;
    if (P.legFR) P.legFR.rotation.x = g * 0.8 - 0.3 * b;
    if (P.legBL) P.legBL.rotation.x = -g + 0.3 * b;
    if (P.legBR) P.legBR.rotation.x = -g * 0.8 + 0.3 * b;
    P.tail.rotation.z = Math.sin(t * (12 + 10 * b)) * 0.5;
    P.body.rotation.x = 0.15 * b - 0.08 * act + Math.sin(t * sp) * 0.04 * act;
    P.body.scale.set(1, 1, 1 + 0.08 * act);
    P.head.rotation.x = 0.1 * b - 0.12 * act;
    P.head.rotation.z = Math.sin(t * 1.4) * 0.15 * (1 - act - b);
    for (const n of ['earL', 'earR']) if (P[n]) P[n].rotation.x = P[n].userData.r0.x - 0.8 * act;
    if (P.leash) P.leash.rotation.x = Math.sin(t * 6) * 0.15 + 0.4 * act;
    mouth(P, ph === 'act' ? 0.5 + 0.2 * Math.sin(t * 24) : 0);
    U.push = 3.2 * act;
  },
};

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
  const def = MONSTERS[monId] || MONSTERS.rocker;
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
