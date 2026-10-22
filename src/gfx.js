// 見た目の共通部品（トゥーンの色、ふちどり、テクスチャ）
import * as THREE from 'three';

let _grad = null;
export function toonGradient() {
  if (_grad) return _grad;
  const data = new Uint8Array([90, 90, 90, 255, 175, 175, 175, 255, 255, 255, 255, 255]);
  const tex = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  tex.userData.shared = true;
  _grad = tex;
  return tex;
}

// ===== セル（アニメ塗り）の材質 =====
// キックフライト・#コンパス・バウンティラッシュの調査から：
//  ・影は「暗くする」のではなく「影の色をのせる」（服は青みがかった影、肌は赤みのある影）
//  ・明暗の境目はくっきり（キャラ）。ステージは少しやわらかく
//  ・キャラはステージの太陽ではなく「キャラ用の光」（カメラから見て右上前）で照らす＝顔がいつも明るい
//  ・ふちに細い光（リムライト）を入れて、背景から浮き立たせる
const SHADE = {
  cool: new THREE.Color(0.6, 0.62, 0.82), // 服・物（青紫の影）
  skin: new THREE.Color(0.9, 0.68, 0.66), // 肌（赤みの影）
  hair: new THREE.Color(0.55, 0.55, 0.74),
  leaf: new THREE.Color(0.58, 0.7, 0.74),
  stone: new THREE.Color(0.64, 0.66, 0.8),
  warm: new THREE.Color(0.78, 0.62, 0.66), // 夕焼けの物
};
export { SHADE };

const CEL_VERT = /* glsl */ `
#include <common>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <skinning_pars_vertex>
varying vec3 vN;
varying vec3 vV;
varying vec2 vUv;
void main() {
  #include <color_vertex>
  vUv = uv;
  #include <beginnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
  vN = normalize(normalMatrix * objectNormal);
  vV = -mvPosition.xyz;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const CEL_FRAG = /* glsl */ `
uniform vec3 diffuse;
uniform vec3 shade;
uniform vec3 emissive;
uniform vec3 rimColor;
uniform float opacity;
uniform float thresh;
uniform float feather;
uniform float rim;
uniform float charLight;
uniform float ambient;
#ifdef USE_CMAP
uniform sampler2D cmap;
#endif
#include <common>
#include <color_pars_fragment>
#include <fog_pars_fragment>
#include <lights_pars_begin>
varying vec3 vN;
varying vec3 vV;
varying vec2 vUv;
void main() {
  vec3 N = normalize(vN);
  N = gl_FrontFacing ? N : -N;
  vec3 V = normalize(vV);
  vec3 base = diffuse;
  float a = opacity;
  #ifdef USE_CMAP
    vec4 tx = texture2D(cmap, vUv);
    base *= tx.rgb;
    a *= tx.a;
  #endif
  #ifdef USE_COLOR
    base *= vColor.rgb;
  #endif
  vec3 L = normalize(vec3(0.35, 0.8, 0.45));
  vec3 lc = vec3(1.0);
  #if NUM_DIR_LIGHTS > 0
    L = directionalLights[0].direction;
    lc = directionalLights[0].color;
  #endif
  // キャラ用の光：カメラから見て右上・手前（顔がいつも明るく見える）
  L = normalize(mix(L, vec3(0.42, 0.62, 0.66), charLight));
  float ndl = dot(N, L);
  float lit = smoothstep(thresh - feather, thresh + feather, ndl);
  float lm = max(max(lc.r, lc.g), lc.b);
  vec3 lt = lm > 0.0 ? lc / lm : vec3(1.0);
  vec3 amb = vec3(1.0);
  #if NUM_HEMI_LIGHTS > 0
    vec3 hs = hemisphereLights[0].skyColor;
    vec3 hg = hemisphereLights[0].groundColor;
    float hm = max(max(max(hs.r, hs.g), hs.b), 1e-3);
    float up = dot(N, hemisphereLights[0].direction) * 0.5 + 0.5;
    amb = mix(hg / hm, hs / hm, up);
  #endif
  vec3 litCol = base * mix(vec3(1.0), lt, 0.4);
  vec3 shdCol = base * shade * mix(vec3(1.0), amb, ambient);
  vec3 col = mix(shdCol, litCol, lit);
  float fr = 1.0 - clamp(dot(N, V), 0.0, 1.0);
  fr = fr * fr * fr * fr;
  col += rimColor * fr * rim * (0.45 + 0.55 * lit);
  col += emissive;
  gl_FragColor = vec4(col, a);
  #include <fog_fragment>
  #include <colorspace_fragment>
}`;

// opts: map, vertexColors, shade（影の色をかける色 or 'skin' などの名前）, rim, rimColor, char（キャラ用の光）,
//       thresh, feather, emissive, side, transparent, opacity, ambient, unique, polygonOffset(+Factor/Units), depthWrite
export function cel(color, opts = {}) {
  const shade = typeof opts.shade === 'string' ? SHADE[opts.shade] || SHADE.cool : opts.shade ? new THREE.Color(opts.shade) : opts.char ? SHADE.cool : SHADE.stone;
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.lights, THREE.UniformsLib.fog]);
  Object.assign(uniforms, {
    diffuse: { value: new THREE.Color(color) },
    shade: { value: shade.clone() },
    emissive: { value: new THREE.Color(opts.emissive || 0x000000) },
    rimColor: { value: new THREE.Color(opts.rimColor != null ? opts.rimColor : 0xdff2ff) },
    opacity: { value: opts.opacity != null ? opts.opacity : 1 },
    thresh: { value: opts.thresh != null ? opts.thresh : opts.char ? -0.12 : 0.02 },
    feather: { value: opts.feather != null ? opts.feather : opts.char ? 0.035 : 0.16 },
    rim: { value: opts.rim != null ? opts.rim : opts.char ? 0.45 : 0.18 },
    charLight: { value: opts.char ? 1 : 0 },
    ambient: { value: opts.ambient != null ? opts.ambient : 0.35 },
  });
  const m = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: CEL_VERT,
    fragmentShader: CEL_FRAG,
    lights: true,
    fog: true,
    vertexColors: !!opts.vertexColors,
    side: opts.side || THREE.FrontSide,
    transparent: !!opts.transparent,
  });
  // 重ねて貼る板（床の模様など）がちらつかないように
  if (opts.polygonOffset) {
    m.polygonOffset = true;
    m.polygonOffsetFactor = opts.polygonOffsetFactor || 0;
    m.polygonOffsetUnits = opts.polygonOffsetUnits || 0;
  }
  if (opts.depthWrite === false) m.depthWrite = false;
  if (opts.map) {
    m.defines = { USE_CMAP: '' };
    uniforms.cmap = { value: opts.map };
    m.map = opts.map; // 片づけ（disposeDeep）のため
  }
  m.customProgramCacheKey = () => 'cel';
  m.userData.celOpts = opts; // キャラの部品をまとめるとき、同じ設定の材質を作り直すため（model.js）
  // ほかの材質と同じように .color で色を変えられるように
  m.color = uniforms.diffuse.value;
  m.gradientMap = toonGradient(); // 古いコードとの互換（使わない）
  return m;
}

const matCache = new Map();
// 昔からの入口。いまはセルの材質を返す（同じ色・同じ設定は使い回す）
export function toon(color, opts = {}) {
  const key = color + '|' + JSON.stringify(opts, (k, v) => (v && v.isTexture ? v.uuid : v));
  if (!opts.unique && matCache.has(key)) return matCache.get(key);
  const m = cel(color, opts);
  if (!opts.unique) {
    m.userData.shared = true;
    matCache.set(key, m);
  }
  return m;
}

// ふちどり（裏面を少しふくらませて描く「押し出し線」）
// 太さは「世界での太さ」から画面の何ピクセルかを出し、細すぎ・太すぎにならないように上下を決める
// （遠くのキャラは線が消えず、近くのキャラは線が太くなりすぎない）。色は部品ごとの濃い色（色トレス）
export const OUTLINE = {
  res: { value: new THREE.Vector2(1280, 720) }, // 描く画面の大きさ（ピクセル）
  px: { value: 1 }, // 1 CSS ピクセルが何ピクセルか（devicePixelRatio）
};
export function setOutlineViewport(w, h, dpr) {
  OUTLINE.res.value.set(w, h);
  OUTLINE.px.value = dpr || 1;
}
const outlineCache = new Map();
export function outlineMat(color = 0x14161c, width = 0.022, minPx = 0.7, maxPx = 2.6, vc = false) {
  const key = color + '|' + width + '|' + minPx + '|' + maxPx + (vc ? '|vc' : '');
  if (outlineCache.has(key)) return outlineCache.get(key);
  // vc：線の色を頂点ごとに持つ（キャラの部品をまとめたとき、色ちがいの線を1回で描く）
  const m = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide, vertexColors: vc });
  m.userData.outline = [width, minPx, maxPx];
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uOutline = { value: width };
    shader.uniforms.uMinPx = { value: minPx };
    shader.uniforms.uMaxPx = { value: maxPx };
    shader.uniforms.uRes = OUTLINE.res;
    shader.uniforms.uPx = OUTLINE.px;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uOutline;\nuniform float uMinPx;\nuniform float uMaxPx;\nuniform vec2 uRes;\nuniform float uPx;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        {
          #ifdef USE_SKINNING
          vec3 nV = normalize(normalMatrix * objectNormal);
          #else
          vec3 nV = normalize(normalMatrix * normal);
          #endif
          vec2 dir = (projectionMatrix * vec4(nV, 0.0)).xy;
          float dl = length(dir);
          dir = dl > 1e-5 ? dir / dl : vec2(0.0);
          float sc = length(modelMatrix[0].xyz);
          float w = max(gl_Position.w, 1e-3);
          float px = uOutline * sc * projectionMatrix[1][1] * 0.5 * uRes.y / w;
          px = clamp(px, uMinPx * uPx, uMaxPx * uPx);
          gl_Position.xy += dir * px * 2.0 / uRes * w;
        }`
      );
  };
  // 太さは uniform なので、シェーダーは全部の太さで1つを使い回す（材質ごとに uniform は別）
  m.customProgramCacheKey = () => 'outline2';
  m.userData.shared = true;
  outlineCache.set(key, m);
  return m;
}
// 色を暗くして、少し青紫に寄せる（ふちどりの色トレス用）
export function lineColor(color, k = 0.42) {
  const c = new THREE.Color(color);
  const hsl = {};
  c.getHSL(hsl);
  hsl.l = Math.max(0.05, hsl.l * k);
  hsl.s = Math.min(1, hsl.s * 0.9 + 0.08);
  c.setHSL(hsl.h, hsl.s, hsl.l);
  c.lerp(new THREE.Color(0x1a1530), 0.25);
  return c.getHex();
}

export function addOutline(mesh, color, width, minPx, maxPx) {
  const o = new THREE.Mesh(mesh.geometry, outlineMat(color, width, minPx, maxPx));
  o.name = 'outline';
  o.renderOrder = -1;
  o.raycast = () => {};
  mesh.add(o);
  return o;
}

// 角の丸い箱
export function roundedBox(w, h, d, r = 0.05, seg = 3) {
  const g = new THREE.BoxGeometry(w, h, d, seg * 2, seg * 2, seg * 2);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  const hw = w / 2 - r, hh = h / 2 - r, hd = d / 2 - r;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const cx = Math.max(-hw, Math.min(hw, v.x));
    const cy = Math.max(-hh, Math.min(hh, v.y));
    const cz = Math.max(-hd, Math.min(hd, v.z));
    const dx = v.x - cx, dy = v.y - cy, dz = v.z - cz;
    const len = Math.hypot(dx, dy, dz) || 1;
    p.setXYZ(i, cx + (dx / len) * r, cy + (dy / len) * r, cz + (dz / len) * r);
  }
  g.computeVertexNormals();
  return g;
}

export function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  draw(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// やわらかい丸（光や影の板に使う）
let _glow = null;
export function glowTex() {
  if (_glow) return _glow;
  _glow = canvasTex(128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
  _glow.userData.shared = true;
  return _glow;
}
let _shadow = null;
export function shadowTex() {
  if (_shadow) return _shadow;
  _shadow = canvasTex(64, 64, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(0,0,0,0.42)');
    g.addColorStop(0.6, 'rgba(0,0,0,0.25)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
  _shadow.userData.shared = true;
  return _shadow;
}

// サクラの花びら形（ひし形の結晶にサクラの模様）
let _sakura = null;
export function sakuraTex() {
  if (_sakura) return _sakura;
  _sakura = canvasTex(128, 128, (ctx, w, h) => {
    ctx.translate(w / 2, h / 2);
    for (let i = 0; i < 5; i++) {
      ctx.save();
      ctx.rotate((i / 5) * Math.PI * 2);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.bezierCurveTo(-26, -18, -22, -52, -6, -58);
      ctx.lineTo(0, -50);
      ctx.lineTo(6, -58);
      ctx.bezierCurveTo(22, -52, 26, -18, 0, 0);
      ctx.fillStyle = '#ffd1e3';
      ctx.fill();
      ctx.strokeStyle = '#ff7fb0';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();
    }
    ctx.beginPath();
    ctx.arc(0, 0, 9, 0, Math.PI * 2);
    ctx.fillStyle = '#ffef7a';
    ctx.fill();
  });
  _sakura.userData.shared = true;
  return _sakura;
}

// 使い終わった物を GPU から消す（キャッシュしていて使い回す物＝userData.shared は残す）
const TEX_KEYS = ['map', 'gradientMap', 'alphaMap', 'emissiveMap', 'normalMap', 'aoMap', 'lightMap', 'bumpMap', 'specularMap', 'envMap'];
export function shareMark(o) {
  if (o) o.userData.shared = true;
  return o;
}
export function disposeDeep(root) {
  if (!root) return;
  const seen = new Set();
  const tex = (t) => {
    if (!t || !t.isTexture || seen.has(t) || t.userData.shared) return;
    seen.add(t);
    t.dispose();
  };
  root.traverse((o) => {
    if (o.isSkinnedMesh && o.skeleton && !seen.has(o.skeleton)) {
      seen.add(o.skeleton);
      o.skeleton.dispose();
    }
    const g = o.geometry;
    if (g && !seen.has(g) && !g.userData.shared) {
      seen.add(g);
      g.dispose();
    }
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      if (seen.has(m)) continue;
      seen.add(m);
      for (const k of TEX_KEYS) tex(m[k]);
      if (m.uniforms) for (const k of Object.keys(m.uniforms)) tex(m.uniforms[k] && m.uniforms[k].value);
      if (!m.userData.shared) m.dispose();
    }
  });
}
