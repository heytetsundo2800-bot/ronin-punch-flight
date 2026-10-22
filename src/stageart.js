// ステージの見た目の部品（岩・草・雲・空・雲海のシェーダー、島の形、草むら・つる、手描き風テクスチャ）
//  ・シェーダーは「画面に出る色（sRGB）」で色を決めて、最後に linear にもどして three.js に渡す
//    （あとで入る後処理の linear なレンダーターゲットでも、そのままの画面でも同じ色になる）
//  ・乱数はかならずステージの rnd か、決まった種の mulberry32 を使う（全員に同じ見た目）
import * as THREE from 'three';
import { canvasTex } from './gfx.js';
import { mulberry32, TAU } from './util.js';

// ---------- 色の小道具 ----------
// 0xRRGGBB を「画面の色」のまま vec3 に（シェーダーの中で linear にする）
export function hx(hex) {
  return new THREE.Vector3(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);
}
export const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
// 画面の色の倍率 → 頂点カラー（linear）
const toLin = (x) => Math.pow(Math.max(0, x), 2.2);

// ---------- GLSL の共通部品 ----------
const GL_COMMON = /* glsl */ `
vec3 srgb2lin(vec3 c){ return mix(pow((c + 0.055) / 1.055, vec3(2.4)), c / 12.92, step(c, vec3(0.04045))); }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3){ p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float vnoise2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y); }
float vnoise3(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = hash13(i), b = hash13(i + vec3(1.0, 0.0, 0.0)), c = hash13(i + vec3(0.0, 1.0, 0.0)), d = hash13(i + vec3(1.0, 1.0, 0.0));
  float e = hash13(i + vec3(0.0, 0.0, 1.0)), g = hash13(i + vec3(1.0, 0.0, 1.0)), h = hash13(i + vec3(0.0, 1.0, 1.0)), k = hash13(i + vec3(1.0, 1.0, 1.0));
  return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y), mix(mix(e, g, f.x), mix(h, k, f.x), f.y), f.z); }
`;

// 2色のセル影（光の側は暖かく、影の側は青むらさき）＋雲海からの照り返し＋ふちの光
const GL_CEL = /* glsl */ `
uniform vec3 uSunDir; uniform vec3 uLit; uniform vec3 uShade; uniform vec3 uRim; uniform vec3 uBounce;
vec3 celShade(vec3 base, vec3 n, vec3 v, float ao, float rimK){
  float nl = dot(n, uSunDir);
  float lit = smoothstep(-0.04, 0.1, nl);
  vec3 c = base * mix(uShade, uLit, lit);
  c *= 0.93 + 0.07 * clamp(n.y, 0.0, 1.0);
  c += base * uBounce * clamp(-n.y, 0.0, 1.0);
  float fr = 1.0 - clamp(dot(n, v), 0.0, 1.0);
  c += uRim * (fr * fr * fr * fr) * rimK * (0.3 + 0.7 * lit);
  return c * ao;
}
`;

const VS_WORLD = /* glsl */ `
#include <fog_pars_vertex>
varying vec3 vWP; varying vec3 vN; varying vec2 vUv;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWP = wp.xyz; vN = normalize(mat3(modelMatrix) * normal); vUv = uv;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FS_END = /* glsl */ `
  #include <fog_fragment>
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
`;

function lightUniforms(L) {
  return {
    uSunDir: { value: L.sunDir.clone() },
    uLit: { value: v3(L.lit) },
    uShade: { value: v3(L.shade) },
    uRim: { value: v3(L.rim) },
    uBounce: { value: v3(L.bounce) },
  };
}
// env から光の向きと色合いを作る（match.js が置く太陽と同じ向き）
export function lightOf(env) {
  const s = env.sun[2];
  return { sunDir: new THREE.Vector3(s[0], s[1], s[2]).normalize(), ...env.light };
}

function shaderMat(uniforms, fs, extra = {}) {
  return new THREE.ShaderMaterial({
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, uniforms]),
    vertexShader: extra.vs || VS_WORLD,
    fragmentShader: fs,
    ...(extra.side ? { side: extra.side } : {}),
  });
}

// ---------- 島の岩（地層・ひび・色むら・土の層・コケ）----------
//  uv.x = 島の深さ、uv.y = 島の上面からの深さ（ワールドの長さ）。小石は uv.y を大きくする
export function rockMaterial(env, pal) {
  const L = lightOf(env);
  const u = {
    ...lightUniforms(L),
    uRockA: { value: hx(pal.rockA) },
    uRockB: { value: hx(pal.rockB) },
    uRockC: { value: hx(pal.rockC) },
    uCrack: { value: hx(pal.crack) },
    uSoil: { value: hx(pal.soil) },
    uMoss: { value: hx(pal.moss) },
  };
  const vs = /* glsl */ `
  #include <fog_pars_vertex>
  varying vec3 vWP; varying vec3 vN; varying vec2 vUv; varying float vBig; varying vec3 vArc;
  ${GL_COMMON}
  void main(){
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWP = wp.xyz; vN = normalize(mat3(modelMatrix) * normal); vUv = uv;
    vArc = color;
    vBig = vnoise3(wp.xyz * 0.055);
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;
  const fs = /* glsl */ `
  #include <fog_pars_fragment>
  ${GL_COMMON}
  ${GL_CEL}
  uniform vec3 uRockA; uniform vec3 uRockB; uniform vec3 uRockC; uniform vec3 uCrack; uniform vec3 uSoil; uniform vec3 uMoss;
  varying vec3 vWP; varying vec3 vN; varying vec2 vUv; varying float vBig; varying vec3 vArc;
  void main(){
    vec3 n = normalize(vN);
    vec3 v = normalize(cameraPosition - vWP);
    vec3 p = vWP;
    float d = vUv.y, D = max(vUv.x, 1.0);
    float med = vnoise3(p * vec3(0.21, 0.32, 0.21) + 7.1);
    float fine = vnoise2(vec2(p.x + p.z, p.y) * 0.85 + 3.3);
    // 地層（ゆがんだ横じま）を、たての目地で石のかたまりに分ける
    float sy = p.y * 0.42 + (vBig - 0.5) * 2.2 + (med - 0.5) * 0.6;
    float bi = floor(sy), bf = fract(sy);
    float tone = hash12(vec2(bi, 3.7));
    float useB = step(2.0, vArc.z);
    float nb = max(3.0, floor(vArc.y * (0.45 + 0.4 * hash12(vec2(bi, 9.1)))));
    float sx = vArc.x * nb + hash12(vec2(bi, 5.3)) + (med - 0.5) * 0.3;
    float bj = floor(sx), bx = fract(sx);
    float btone = mix(0.5, hash12(vec2(bi, bj) + 0.37), useB);
    vec3 col = mix(uRockA, uRockB, smoothstep(0.15, 0.85, tone * 0.55 + btone * 0.45));
    col = mix(col, uRockC, smoothstep(0.55, 0.8, vBig) * 0.5);
    float jw = 0.11 * nb / max(vArc.z, 1.0);
    float jd = min(bx, 1.0 - bx);
    float joint = (1.0 - smoothstep(jw * 0.5, jw * 1.5, jd)) * step(0.22, hash12(vec2(bi + 0.5, bj))) * useB;
    col *= 1.0 + useB * (0.09 * (1.0 - smoothstep(0.0, jw * 5.0, bx)) - 0.09 * (1.0 - smoothstep(0.0, jw * 5.0, 1.0 - bx)));
    float hj = 1.0 - smoothstep(0.035, 0.085, bf);
    col = mix(col, uCrack, max(joint, hj) * 0.78);
    col *= mix(1.0, 1.1, smoothstep(0.84, 0.97, bf));
    // こまかいひび
    float ck2 = abs(vnoise3(p * vec3(0.9, 0.35, 0.9) + 5.3) - 0.5);
    col *= mix(0.84, 1.0, smoothstep(0.004, 0.02, ck2));
    col *= 0.9 + 0.2 * fine;
    // 上を向いた所にはコケ
    float moss = smoothstep(0.5, 0.85, n.y) * smoothstep(0.3, 0.55, med + (vBig - 0.5) * 0.4);
    col = mix(col, uMoss * (0.85 + 0.3 * fine), moss * 0.9);
    // 草の下の土の層（ぎざぎざの境目）
    float soilH = 1.15 + (med - 0.5) * 1.1 + (fine - 0.5) * 0.35;
    float soil = 1.0 - smoothstep(soilH - 0.12, soilH + 0.12, d);
    vec3 soilC = uSoil * (0.82 + 0.3 * fine) * (0.9 + 0.2 * med);
    col = mix(col, soilC, soil);
    // くぼみ・草のかげ・とがった先ほど暗い
    float ao = mix(0.5, 1.0, smoothstep(0.05, 0.8, d));
    ao *= mix(1.0, 0.72, smoothstep(0.35, 1.0, d / D));
    vec3 c = celShade(col, n, v, ao, 0.55);
    gl_FragColor = vec4(srgb2lin(c), 1.0);
    ${FS_END}
  }`;
  const m = shaderMat(u, fs, { vs });
  m.vertexColors = true; // color 属性に「島のまわりの角度・石の数・まわりの長さ」を入れている
  return m;
}

// ---------- 島の草（色むら・明るい所・落ちた花びら／葉っぱ）----------
//  uv.y = 0（上面）〜 1（ふちから垂れた草の先）
export function grassMaterial(env, pal) {
  const L = lightOf(env);
  const u = {
    ...lightUniforms(L),
    uG1: { value: hx(pal.g1) },
    uG2: { value: hx(pal.g2) },
    uG3: { value: hx(pal.g3) },
    uPetal: { value: hx(pal.petal) },
    uPetal2: { value: hx(pal.petal2 || pal.petal) },
    uPetalAmt: { value: pal.petalAmt || 0 },
  };
  const fs = /* glsl */ `
  #include <fog_pars_fragment>
  ${GL_COMMON}
  ${GL_CEL}
  uniform vec3 uG1; uniform vec3 uG2; uniform vec3 uG3; uniform vec3 uPetal; uniform vec3 uPetal2; uniform float uPetalAmt;
  varying vec3 vWP; varying vec3 vN; varying vec2 vUv;
  void main(){
    vec3 n = normalize(vN);
    vec3 v = normalize(cameraPosition - vWP);
    vec2 p = vWP.xz;
    float big = vnoise2(p * 0.075);
    float med = vnoise2(p * 0.27 + 11.0);
    vec3 col = mix(uG1, uG2, smoothstep(0.3, 0.72, big));
    col = mix(col, uG3, smoothstep(0.58, 0.85, med) * 0.75);
    // 筆で描いたような短いすじ
    float st = vnoise2(vec2(p.x * 2.4 + p.y * 1.3, p.y * 0.55 - p.x * 0.35));
    col *= 0.93 + 0.15 * st;
    // 落ちた花びら（イチョウなら葉っぱ）
    vec2 cp = p * 1.25;
    vec2 ci = floor(cp);
    vec2 o = hash22(ci);
    vec2 dd = fract(cp) - (0.22 + 0.56 * o);
    float a = o.y * 6.2831;
    dd = vec2(cos(a) * dd.x - sin(a) * dd.y, sin(a) * dd.x + cos(a) * dd.y);
    float pr = length(dd * vec2(1.0, 1.7));
    float dens = uPetalAmt * smoothstep(0.25, 0.75, med * 0.7 + big * 0.5);
    float keep = step(1.0 - dens, hash12(ci + 17.0));
    float petal = (1.0 - smoothstep(0.075, 0.105, pr)) * keep * (1.0 - vUv.y);
    col = mix(col, mix(uPetal, uPetal2, o.x), petal);
    // ふちから垂れた草：先ほど暗く
    float sk = vUv.y;
    col *= mix(1.0, 0.6, sk);
    vec3 c = celShade(col, n, v, 1.0, 0.18 * sk);
    gl_FragColor = vec4(srgb2lin(c), 1.0);
    ${FS_END}
  }`;
  return shaderMat(u, fs);
}

// ---------- 雲（球をまとめた形。2色のセル影＋ふちの光＋地平線にとける）----------
//  uv.y = 雲の中の高さ 0（底）〜 1（てっぺん）
export function cloudMaterial(env, o) {
  const L = lightOf(env);
  const u = {
    uSunDir: { value: (o.sunDir ? v3(o.sunDir).normalize() : L.sunDir.clone()) },
    uLitC: { value: hx(o.lit) },
    uShadeC: { value: hx(o.shade) },
    uCoreC: { value: hx(o.core) },
    uRimC: { value: hx(o.rim) },
    uHorizon: { value: hx(o.horizon) },
    uFar: { value: o.far ? 1 : 0 },
  };
  const fs = /* glsl */ `
  #include <fog_pars_fragment>
  ${GL_COMMON}
  uniform vec3 uSunDir; uniform vec3 uLitC; uniform vec3 uShadeC; uniform vec3 uCoreC; uniform vec3 uRimC; uniform vec3 uHorizon; uniform float uFar;
  varying vec3 vWP; varying vec3 vN; varying vec2 vUv;
  void main(){
    vec3 n = normalize(vN);
    vec3 v = normalize(cameraPosition - vWP);
    float nl = dot(n, uSunDir);
    float lit = smoothstep(-0.03, 0.09, nl);
    vec3 c = mix(uShadeC, uLitC, lit);
    c = mix(c, mix(uLitC, vec3(1.0), 0.35), smoothstep(0.5, 0.62, nl) * 0.7);
    c = mix(uCoreC, c, smoothstep(0.05, 0.3, vUv.y + n.y * 0.3));
    float fr = 1.0 - clamp(dot(n, v), 0.0, 1.0);
    float back = 0.5 - 0.5 * dot(v, uSunDir);
    c += uRimC * (fr * fr) * (0.12 + 0.88 * back * back) * 0.7 * (0.4 + 0.6 * smoothstep(-0.2, 0.4, n.y + 0.3));
    // 遠い雲：下のほうと遠い所は地平線の色にとける
    vec3 dir = normalize(vWP - cameraPosition);
    float dist = length(vWP - cameraPosition);
    float hz = (1.0 - smoothstep(-0.03, 0.035, dir.y)) * 0.8 + smoothstep(420.0, 900.0, dist) * 0.3;
    c = mix(c, uHorizon, clamp(hz * uFar, 0.0, 0.9));
    gl_FragColor = vec4(srgb2lin(c), 1.0);
    // 霧（遠い雲は霧をかけない。同じシェーダーを使い回すため、ここで切りかえる）
    #ifdef USE_FOG
      float fogFactor = smoothstep(fogNear, fogFar, vFogDepth) * (1.0 - uFar);
      gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
    #endif
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;
  return shaderMat(u, fs);
}

// ---------- 空（グラデーション・太陽の光・うすい筋雲）----------
export function skyMaterial(o) {
  const u = {
    uZen: { value: hx(o.zen) },
    uUp: { value: hx(o.up) },
    uHor: { value: hx(o.hor) },
    uHorSun: { value: hx(o.horSun) },
    uFogC: { value: hx(o.fog) },
    uSun: { value: v3(o.sun).normalize() },
    uSunC: { value: hx(o.sunCol) },
    uGlowC: { value: hx(o.glowCol) },
    uGlow: { value: o.glow },
    uHalo: { value: o.halo },
    uCirrus: { value: o.cirrus || 0 },
    uCirrusC: { value: hx(o.cirrusCol || 0xffffff) },
  };
  const vs = 'varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }';
  const fs = /* glsl */ `
  ${GL_COMMON}
  uniform vec3 uZen; uniform vec3 uUp; uniform vec3 uHor; uniform vec3 uHorSun; uniform vec3 uFogC; uniform vec3 uSun; uniform vec3 uSunC; uniform vec3 uGlowC;
  uniform float uGlow; uniform float uHalo; uniform float uCirrus; uniform vec3 uCirrusC;
  varying vec3 vDir;
  void main(){
    vec3 d = normalize(vDir);
    float h = d.y;
    float sd = dot(d, uSun);
    // 太陽のほうの地平線は暖かい
    vec2 hz = normalize(d.xz + vec2(1e-4)); vec2 sz = normalize(uSun.xz + vec2(1e-4));
    float az = dot(hz, sz) * 0.5 + 0.5;
    vec3 hor = mix(uHor, uHorSun, az * az);
    vec3 c = mix(hor, uUp, smoothstep(0.02, 0.3, h));
    c = mix(c, uZen, smoothstep(0.25, 0.9, h));
    // 地平線の下と地平線ちょうどは霧の色（雲海とのさかいめを消す）
    c = mix(uFogC, c, smoothstep(-0.02, 0.09, h));
    // 筋雲
    if (uCirrus > 0.0 && h > 0.04 && h < 0.62) {
      vec2 q = d.xz / (h + 0.12);
      float s = vnoise2(q * vec2(1.4, 5.0) + 3.0) * 0.6 + vnoise2(q * vec2(3.3, 11.0) + 9.0) * 0.4;
      float m = smoothstep(0.58, 0.86, s) * smoothstep(0.05, 0.2, h) * (1.0 - smoothstep(0.3, 0.6, h));
      c = mix(c, uCirrusC, m * uCirrus);
    }
    // 太陽の光
    float s = max(sd, 0.0);
    c += uGlowC * (pow(s, 5.0) * uGlow + pow(s, 48.0) * uHalo);
    c = mix(c, uSunC, smoothstep(0.99905, 0.99935, s));
    c += uSunC * pow(s, 900.0) * 0.6;
    gl_FragColor = vec4(srgb2lin(c), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;
  return new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false, uniforms: u, vertexShader: vs, fragmentShader: fs });
}

// 雲海の「もこもこ」の形（重なった球を上から見た法線と高さ）を、最初に1回だけ絵にしておく
//  R,G＝法線の x,z（0〜1）、B＝高さ。くりかえし貼れる（8×8 のマス）
let _puff = null;
export function puffTex() {
  if (_puff) return _puff;
  const N = 128, C = 8;
  const data = new Uint8Array(N * N * 4);
  const r = mulberry32(808);
  const cell = [];
  for (let i = 0; i < C * C; i++) cell.push([r(), r(), r(), r()]);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const px = ((x + 0.5) / N) * C, py = ((y + 0.5) / N) * C;
      const ix = Math.floor(px), iy = Math.floor(py), fx = px - ix, fy = py - iy;
      let sx = 0, sy = 0, sz = 0, hm = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const q = cell[((iy + dy + C) % C) * C + ((ix + dx + C) % C)];
          const vx = fx - (dx + 0.5 + (q[0] - 0.5) * 0.75), vy = fy - (dy + 0.5 + (q[1] - 0.5) * 0.75);
          const rad = 0.72 + 0.42 * q[2];
          const k2 = rad * rad - vx * vx - vy * vy;
          if (k2 > 0) {
            const sq = Math.sqrt(k2);
            const hh = sq + q[3] * 0.3;
            const w = Math.exp(7 * hh);
            sx += (w * vx) / rad;
            sy += (w * sq) / rad;
            sz += (w * vy) / rad;
            if (hh > hm) hm = hh;
          }
        }
      const l = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1;
      const k = (y * N + x) * 4;
      data[k] = Math.round((sx / l) * 127.5 + 127.5);
      data[k + 1] = Math.round((sz / l) * 127.5 + 127.5);
      data[k + 2] = Math.round(Math.min(1, hm / 1.5) * 255);
      data[k + 3] = 255;
    }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  t.userData.shared = true;
  _puff = t;
  return t;
}

// ---------- 雲海（ぽこぽこした雲の頭を上から見た形。セル影で立体に）----------
export function seaMaterial(env, o) {
  const L = lightOf(env);
  const u = {
    uTime: { value: 0 },
    uSunDir: { value: o.sunDir ? v3(o.sunDir).normalize() : L.sunDir.clone() },
    uLitC: { value: hx(o.lit) },
    uShadeC: { value: hx(o.shade) },
    uDeepC: { value: hx(o.deep) },
    uFlatC: { value: hx(o.flat) },
    uPuff: { value: puffTex() },
  };
  const vs = /* glsl */ `
  #include <fog_pars_vertex>
  varying vec3 vWP;
  void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vWP = wp.xyz; vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
  }`;
  const fs = /* glsl */ `
  #include <fog_pars_fragment>
  vec3 srgb2lin(vec3 c){ return mix(pow((c + 0.055) / 1.055, vec3(2.4)), c / 12.92, step(c, vec3(0.04045))); }
  uniform float uTime; uniform vec3 uSunDir; uniform vec3 uLitC; uniform vec3 uShadeC; uniform vec3 uDeepC; uniform vec3 uFlatC;
  varying vec3 vWP;
  uniform sampler2D uPuff;
  vec3 puffN(vec4 t){ vec2 xz = t.rg * 2.0 - 1.0; return vec3(xz.x, sqrt(max(0.0, 1.0 - dot(xz, xz))), xz.y); }
  void main(){
    float dist = length(vWP - cameraPosition);
    vec3 c = uFlatC;
    // 遠くは平らな色だけ
    if (dist < 420.0) {
      vec2 p = vWP.xz + vec2(uTime * 0.6, uTime * 0.25);
      vec4 a = texture2D(uPuff, p * (0.028 / 8.0));
      vec4 b = texture2D(uPuff, p * (0.085 / 8.0) + 0.37);
      vec3 n = normalize(puffN(a) * vec3(1.0, 0.8, 1.0) + vec3(b.r * 2.0 - 1.0, 0.0, b.g * 2.0 - 1.0) * 0.45);
      float nl = dot(n, uSunDir);
      // 3段のセル（影・中間・光）
      vec3 midC = mix(uShadeC, uLitC, 0.55);
      vec3 cc = mix(uShadeC, midC, smoothstep(0.18, 0.3, nl));
      cc = mix(cc, uLitC, smoothstep(0.55, 0.68, nl));
      cc = mix(cc, mix(uLitC, vec3(1.0), 0.4), smoothstep(0.86, 0.95, nl) * 0.45);
      // 球と球のすき間（くぼみ）は深い色
      float gap = 1.0 - smoothstep(0.08, 0.5, a.b * 1.5);
      cc = mix(cc, uDeepC, gap * 0.8);
      // 遠くはなめらかに（細かいもようのチラつきをおさえる）
      c = mix(cc, uFlatC, smoothstep(140.0, 420.0, dist));
    }
    gl_FragColor = vec4(srgb2lin(c), 1.0);
    ${FS_END}
  }`;
  return shaderMat(u, fs, { vs });
}

// ======================================================================
// 形づくり
// ======================================================================

// なめらかな角度のゆらぎ（島ごとに3つの波を足す）
function angWave(rnd) {
  const w = [];
  for (let i = 0; i < 3; i++) w.push([2 + Math.floor(rnd() * 4) + i * 2, rnd() * TAU, (0.5 + rnd() * 0.5) / (i + 1)]);
  return (a) => {
    let s = 0;
    for (const [k, ph, amp] of w) s += Math.sin(a * k + ph) * amp;
    return s / 1.8;
  };
}

// 浮島の岩（上が広く、下がとがる。段と出っぱり）。ワールド座標の非インデックス形状を返す
export function islandRock(rnd, x, top, z, R, depth) {
  const seg = R > 14 ? 44 : R > 9 ? 32 : 26;
  // f＝上からの割合、k＝半径の割合
  const prof = [[0, 1.0], [0.035, 0.985], [0.09, 0.93], [0.18, 0.84], [0.3, 0.75], [0.42, 0.65], [0.55, 0.53], [0.67, 0.41], [0.78, 0.3], [0.88, 0.19], [0.95, 0.1]];
  const y0 = top - 0.25;
  const H = depth + 2.0;
  const wav = angWave(rnd), wav2 = angWave(rnd);
  const rings = [];
  for (let j = 0; j < prof.length; j++) {
    const [f, k] = prof[j];
    const ring = [];
    const twist = (rnd() - 0.5) * 0.12;
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * TAU + twist + (j > 0 ? (rnd() - 0.5) * (0.5 / seg) * TAU : 0);
      let kk = k;
      if (j > 0) kk *= 1 + wav(a) * 0.09 * Math.min(1, f * 4) + wav2(a + f * 2) * 0.05 + (rnd() - 0.5) * 0.07;
      else kk *= 0.985 + (rnd() - 0.5) * 0.01;
      const yy = y0 - f * H + (j > 0 ? (rnd() - 0.5) * H * 0.035 : 0);
      ring.push([x + Math.cos(a) * R * kk, yy, z + Math.sin(a) * R * kk]);
    }
    rings.push(ring);
  }
  // とがった先（まん中から少しずらす）
  const tip = [x + (rnd() - 0.5) * R * 0.12, y0 - H, z + (rnd() - 0.5) * R * 0.12];
  const spikesN = R > 14 ? 4 : R > 9 ? 3 : 2;
  const pos = new Float32Array(((rings.length - 1) * seg * 2 + seg + spikesN * 18) * 9);
  pos.n = 0;
  const tri = (a, b, c) => {
    let k = pos.n;
    pos[k++] = a[0]; pos[k++] = a[1]; pos[k++] = a[2];
    pos[k++] = b[0]; pos[k++] = b[1]; pos[k++] = b[2];
    pos[k++] = c[0]; pos[k++] = c[1]; pos[k++] = c[2];
    pos.n = k;
  };
  for (let j = 0; j < rings.length - 1; j++) {
    const A = rings[j], B = rings[j + 1];
    for (let i = 0; i < seg; i++) {
      const i2 = (i + 1) % seg;
      // 外から見て反時計回り
      tri(A[i], A[i2], B[i]);
      tri(A[i2], B[i2], B[i]);
    }
  }
  const last = rings[rings.length - 1];
  for (let i = 0; i < seg; i++) tri(last[i], last[(i + 1) % seg], tip);
  // 下にぶら下がる小さなとがり岩
  for (let s = 0; s < spikesN; s++) {
    const a = rnd() * TAU, rr = R * (0.18 + rnd() * 0.22);
    const f0 = 0.5 + rnd() * 0.25;
    const k0 = profAt(prof, f0) * 0.75;
    const bx = x + Math.cos(a) * Math.min(rr, R * k0), bz = z + Math.sin(a) * Math.min(rr, R * k0);
    const by = y0 - f0 * H + 0.5;
    const len = H * (0.22 + rnd() * 0.22), w = R * (0.1 + rnd() * 0.06);
    spike(tri, rnd, bx, by, bz, w, len);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.computeVertexNormals();
  setDepthUV(g, top, H);
  // 色の属性に：x＝まわりの角度（0〜1）、y＝1周の石の数、z＝まわりの長さ
  const n = pos.length / 3;
  const col = new Float32Array(n * 3);
  const circ = TAU * R;
  const N = Math.max(6, Math.round(circ / 4));
  const a = [0, 0, 0];
  for (let t = 0; t < n; t += 3) {
    for (let k = 0; k < 3; k++) {
      const i = t + k;
      a[k] = Math.atan2(pos[i * 3 + 2] - z, pos[i * 3] - x) / TAU;
      if (a[k] < 0) a[k] += 1;
    }
    if (Math.max(a[0], a[1], a[2]) - Math.min(a[0], a[1], a[2]) > 0.5) for (let k = 0; k < 3; k++) if (a[k] < 0.5) a[k] += 1;
    for (let k = 0; k < 3; k++) col.set([a[k], N, circ], (t + k) * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
function profAt(prof, f) {
  for (let j = 0; j < prof.length - 1; j++) if (f <= prof[j + 1][0]) {
    const t = (f - prof[j][0]) / (prof[j + 1][0] - prof[j][0]);
    return prof[j][1] + (prof[j + 1][1] - prof[j][1]) * t;
  }
  return 0.1;
}
// 下向きのとがった岩（6角）
function spike(tri, rnd, x, y, z, w, len) {
  const n = 6;
  const top = [], mid = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rnd() * 0.3;
    top.push([x + Math.cos(a) * w, y, z + Math.sin(a) * w]);
    const k = 0.55 + rnd() * 0.15;
    mid.push([x + Math.cos(a) * w * k + (rnd() - 0.5) * w * 0.2, y - len * (0.45 + rnd() * 0.1), z + Math.sin(a) * w * k]);
  }
  const tip = [x + (rnd() - 0.5) * w * 0.6, y - len, z + (rnd() - 0.5) * w * 0.6];
  for (let i = 0; i < n; i++) {
    const i2 = (i + 1) % n;
    tri(top[i], top[i2], mid[i]);
    tri(top[i2], mid[i2], mid[i]);
    tri(mid[i], mid[i2], tip);
  }
}
// 岩の uv：x＝島の深さ、y＝上面からの深さ
export function setDepthUV(g, top, D) {
  const p = g.attributes.position;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    uv[i * 2] = D;
    uv[i * 2 + 1] = Math.max(0, top - p.getY(i));
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}
export function setConstUV(g, u, v) {
  const n = g.attributes.position.count;
  const uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    uv[i * 2] = u;
    uv[i * 2 + 1] = v;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

// 島の草：上の面（平ら）＋ふちから垂れるぎざぎざの草。ふちの点も返す（つるを下げる場所）
export function islandGrass(rnd, x, top, z, R) {
  const seg = R > 14 ? 84 : R > 9 ? 56 : 44;
  const yT = top + 0.15;
  const wav = angWave(rnd);
  const edge = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * TAU;
    const rr = R * (1.025 + wav(a) * 0.012);
    edge.push([a, rr]);
  }
  const pos = [], uv = [];
  const P = (a, r, y) => [x + Math.cos(a) * r, y, z + Math.sin(a) * r];
  const tri = (a, b, c, ua, ub, uc) => {
    pos.push(...a, ...b, ...c);
    uv.push(0, ua, 0, ub, 0, uc);
  };
  // 上の面（まん中から扇形）
  const C = [x, yT, z];
  for (let i = 0; i < seg; i++) {
    const [a0, r0] = edge[i], [a1, r1] = edge[(i + 1) % seg];
    tri(C, P(a1, r1, yT), P(a0, r0, yT), 0, 0, 0);
  }
  // ふち：少し外にふくらんでから、ぎざぎざに垂れる
  const lipY = top - 0.22;
  for (let i = 0; i < seg; i++) {
    const [a0, r0] = edge[i], [a1raw, r1] = edge[(i + 1) % seg];
    const a1 = i === seg - 1 ? a1raw + TAU : a1raw;
    const t0 = P(a0, r0, yT), t1 = P(a1, r1, yT);
    const l0 = P(a0, r0 + 0.28, lipY), l1 = P(a1, r1 + 0.28, lipY);
    tri(t0, t1, l0, 0, 0, 0.18);
    tri(t1, l1, l0, 0, 0.18, 0.18);
    // 垂れた草の先（1つか2つ）
    const n2 = rnd() < 0.45 ? 2 : 1;
    for (let k = 0; k < n2; k++) {
      const s0 = k / n2, s1 = (k + 1) / n2;
      const am = a0 + (a1 - a0) * ((s0 + s1) / 2 + (rnd() - 0.5) * 0.25 / n2);
      const long = rnd() < 0.12 ? 1.9 + rnd() * 1.0 : 0.55 + rnd() * 0.95;
      const rm = (r0 + r1) / 2 + 0.2 + rnd() * 0.15;
      const tip = P(am, rm, lipY - long);
      const la = P(a0 + (a1 - a0) * s0, r0 + 0.28, lipY), lb = P(a0 + (a1 - a0) * s1, r1 + 0.28, lipY);
      tri(la, lb, tip, 0.18, 0.18, 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  // 上の面の法線はまっすぐ上
  const nr = g.attributes.normal;
  for (let i = 0; i < seg * 3; i++) nr.setXYZ(i, 0, 1, 0);
  return g;
}


// ======================================================================
// たくさんの小さな部品を、形を1つずつ作らずに直接ためていく入れ物（ステージを作る時間を短く）
// ======================================================================
const unitCache = new Map();
// 半径1の形（インデックスなし）の position / normal をおぼえておく
export function unit(kind, detail = 0) {
  const key = kind + detail;
  if (unitCache.has(key)) return unitCache.get(key);
  let g = kind === 'oct' ? new THREE.OctahedronGeometry(1, 0) : kind === 'dod' ? new THREE.DodecahedronGeometry(1, 0) : new THREE.IcosahedronGeometry(1, detail);
  if (g.index) {
    const q = g.toNonIndexed();
    g.dispose();
    g = q;
  }
  const u = { pos: g.attributes.position.array.slice(), nor: g.attributes.normal.array.slice(), n: g.attributes.position.count };
  g.dispose();
  unitCache.set(key, u);
  return u;
}
const _nm = new THREE.Matrix3();
const _c3 = [1, 1, 1];
export class Raw {
  constructor(cap = 2048) {
    this.n = 0;
    this.cap = cap;
    this.pos = new Float32Array(cap * 3);
    this.nor = new Float32Array(cap * 3);
    this.col = new Float32Array(cap * 3);
    this.uv = new Float32Array(cap * 2);
  }
  reserve(k) {
    if (this.n + k <= this.cap) return;
    let c = this.cap;
    while (c < this.n + k) c *= 2;
    const grow = (a, w) => {
      const b = new Float32Array(c * w);
      b.set(a);
      return b;
    };
    this.pos = grow(this.pos, 3);
    this.nor = grow(this.nor, 3);
    this.col = grow(this.col, 3);
    this.uv = grow(this.uv, 2);
    this.cap = c;
  }
  vert(x, y, z, nx, ny, nz, r, g, b, u = 0, v = 0) {
    this.reserve(1);
    const k = this.n++;
    this.pos[k * 3] = x;
    this.pos[k * 3 + 1] = y;
    this.pos[k * 3 + 2] = z;
    this.nor[k * 3] = nx;
    this.nor[k * 3 + 1] = ny;
    this.nor[k * 3 + 2] = nz;
    this.col[k * 3] = r;
    this.col[k * 3 + 1] = g;
    this.col[k * 3 + 2] = b;
    this.uv[k * 2] = u;
    this.uv[k * 2 + 1] = v;
  }
  // 単位形状を行列 m で置く。col は [r,g,b] か (x, y, z, out) => out
  put(u, m, col, uvx = 0, uvy = 0) {
    const e = m.elements;
    const q = _nm.getNormalMatrix(m).elements;
    this.reserve(u.n);
    const P = this.pos, N = this.nor, C = this.col, U = this.uv, up = u.pos, un = u.nor;
    const fn = typeof col === 'function';
    for (let i = 0; i < u.n; i++) {
      const x = up[i * 3], y = up[i * 3 + 1], z = up[i * 3 + 2];
      const k = (this.n + i) * 3;
      const wx = e[0] * x + e[4] * y + e[8] * z + e[12], wy = e[1] * x + e[5] * y + e[9] * z + e[13], wz = e[2] * x + e[6] * y + e[10] * z + e[14];
      P[k] = wx;
      P[k + 1] = wy;
      P[k + 2] = wz;
      const nx = un[i * 3], ny = un[i * 3 + 1], nz = un[i * 3 + 2];
      const ax = q[0] * nx + q[3] * ny + q[6] * nz, ay = q[1] * nx + q[4] * ny + q[7] * nz, az = q[2] * nx + q[5] * ny + q[8] * nz;
      const l = Math.sqrt(ax * ax + ay * ay + az * az) || 1;
      N[k] = ax / l;
      N[k + 1] = ay / l;
      N[k + 2] = az / l;
      const c = fn ? col(wx, wy, wz, _c3) : col;
      C[k] = c[0];
      C[k + 1] = c[1];
      C[k + 2] = c[2];
      U[(this.n + i) * 2] = uvx;
      U[(this.n + i) * 2 + 1] = uvy;
    }
    this.n += u.n;
  }
  geometry() {
    if (!this.n) return null;
    // 写さずに、使った分だけを見る（作るときのごみを減らす）
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.subarray(0, this.n * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nor.subarray(0, this.n * 3), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uv.subarray(0, this.n * 2), 2));
    g.setAttribute('color', new THREE.BufferAttribute(this.col.subarray(0, this.n * 3), 3));
    return g;
  }
}
// 高さで色を変える関数（lo→mid→hi）
export function gradY(y0, y1, lo, mid, hi) {
  return (x, y, z, out) => {
    let t = (y - y0) / (y1 - y0);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    let a = lo, b = hi, u = t;
    if (mid) {
      if (t < 0.5) (b = mid), (u = t * 2);
      else (a = mid), (u = (t - 0.5) * 2);
    }
    u = u * u * (3 - 2 * u);
    out[0] = a[0] + (b[0] - a[0]) * u;
    out[1] = a[1] + (b[1] - a[1]) * u;
    out[2] = a[2] + (b[2] - a[2]) * u;
    return out;
  };
}

// 雲のかたまり（球をまとめて、底を平らに。法線は全体の丸みとまぜてやわらかく）
//  返す形はワールド座標。uv.y＝雲の中の高さ
// 入れ物 raw に直接ためる版（ステージはこちらを使う）
export function cloudInto(raw, rnd, cx, cy, cz, size, o = {}) {
  const parts = [];
  const flatY = o.flat !== undefined ? o.flat : 1;
  const n = o.n || 5 + Math.floor(rnd() * 3);
  const len = size * (o.len || 1.7 + rnd() * 0.9);
  const yaw = o.yaw !== undefined ? o.yaw : rnd() * TAU;
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1) - 0.5;
    const r = size * (0.42 + 0.42 * (1 - Math.abs(t) * 1.5) + rnd() * 0.16);
    parts.push([t * len + (rnd() - 0.5) * size * 0.2, r * 0.15, (rnd() - 0.5) * size * 0.45, r]);
  }
  const nt = Math.max(1, Math.round(n * 0.6));
  for (let i = 0; i < nt; i++) {
    const t = (nt === 1 ? 0 : i / (nt - 1) - 0.5) * 0.75 + (rnd() - 0.5) * 0.12;
    const r = size * (0.34 + rnd() * 0.26) * (1 - Math.abs(t) * 0.6);
    parts.push([t * len, size * (0.42 + rnd() * 0.32) * (1 - Math.abs(t)), (rnd() - 0.5) * size * 0.3, r]);
  }
  if (o.tower) parts.push([(rnd() - 0.5) * len * 0.3, size * 0.95, 0, size * 0.42]);
  const nb = o.bumps !== undefined ? o.bumps : Math.round(n * 0.5);
  for (let i = 0; i < nb; i++) {
    const t = (rnd() - 0.5) * 0.9;
    parts.push([t * len, size * (0.15 + rnd() * 0.35), (rnd() < 0.5 ? -1 : 1) * size * (0.35 + rnd() * 0.15), size * (0.2 + rnd() * 0.14)]);
  }
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  const ex = len * 0.5 + size * 0.6, ey = size * 0.9, ez = size * 0.7;
  const detail = o.detail !== undefined ? o.detail : 2;
  const small = o.smallDetail !== undefined ? o.smallDetail : detail;
  const bottom = -size * 0.12;
  const topY = size * 1.15;
  const bl = o.blend !== undefined ? o.blend : 0.28;
  for (const [px, py, pz, r] of parts) {
    const u = unit('ico', r < size * (o.smallR || 0.3) ? small : detail);
    const up = u.pos;
    for (let i = 0; i < u.n; i++) {
      const ux = up[i * 3], uy = up[i * 3 + 1], uz = up[i * 3 + 2];
      let lx = ux * r + px, ly = (uy * r + py) * flatY, lz = uz * r + pz;
      let sx = ux, sy = uy, sz = uz;
      if (ly < bottom * flatY) {
        ly = bottom * flatY;
        sy = -1;
      }
      // 全体の丸みの法線
      const qx = lx / ex, qy = (ly / flatY - size * 0.25) / ey, qz = lz / ez;
      const ql = Math.sqrt(qx * qx + qy * qy + qz * qz) || 1;
      let nx = sx * (1 - bl) + (qx / ql) * bl, ny = sy * (1 - bl) + (qy / ql) * bl, nz = sz * (1 - bl) + (qz / ql) * bl;
      const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= nl;
      ny /= nl;
      nz /= nl;
      const hv = Math.max(0, Math.min(1, (ly / flatY - bottom) / (topY - bottom)));
      raw.vert(cx + lx * cs - lz * sn, cy + ly, cz + lx * sn + lz * cs, nx * cs - nz * sn, ny, nx * sn + nz * cs, 1, 1, 1, 0, hv);
    }
  }
}

// 1つの形として返す版（ロビーの背景など。position / normal / uv）
export function cloudCluster(rnd, cx, cy, cz, size, o = {}) {
  const raw = new Raw(1024);
  cloudInto(raw, rnd, cx, cy, cz, size, o);
  const g = raw.geometry();
  g.deleteAttribute('color');
  return g;
}

// 草の束（細い三角の葉）。頂点カラー：根元は暗く、先は明るい
// 入れ物 raw に直接ためる版
export function tuftInto(raw, rnd, x, y, z, s, colBase, colTip) {
  const blades = 5 + Math.floor(rnd() * 3);
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * TAU + rnd() * 0.8;
    const lean = 0.25 + rnd() * 0.35;
    const h = s * (0.55 + rnd() * 0.6);
    const w = s * 0.13;
    const ca = Math.cos(a), sa = Math.sin(a);
    const bx = x + ca * s * 0.12, bz = z + sa * s * 0.12;
    const px = -sa, pz = ca;
    const tx = bx + ca * h * lean, tz = bz + sa * h * lean;
    const nx = ca * 0.3, ny = 0.95, nz = sa * 0.3;
    const tint = 0.9 + rnd() * 0.2;
    const r0 = colTip[0] * tint, g0 = colTip[1] * tint, b0 = colTip[2] * tint;
    // 表と裏（材質を両面にしなくてすむように、三角を2枚）
    raw.vert(bx - px * w, y, bz - pz * w, nx, ny, nz, colBase[0], colBase[1], colBase[2]);
    raw.vert(bx + px * w, y, bz + pz * w, nx, ny, nz, colBase[0], colBase[1], colBase[2]);
    raw.vert(tx, y + h, tz, nx, ny, nz, r0, g0, b0);
    raw.vert(bx + px * w, y, bz + pz * w, nx, ny, nz, colBase[0], colBase[1], colBase[2]);
    raw.vert(bx - px * w, y, bz - pz * w, nx, ny, nz, colBase[0], colBase[1], colBase[2]);
    raw.vert(tx, y + h, tz, nx, ny, nz, r0, g0, b0);
  }
}

// 1つの形として返す版（position / normal / color）
export function tuftGeo(rnd, x, y, z, s, colBase, colTip) {
  const raw = new Raw(32);
  tuftInto(raw, rnd, x, y, z, s, colBase, colTip);
  const g = raw.geometry();
  g.deleteAttribute('uv');
  return g;
}

// たれ下がるつる（細い管）。頂点カラーつき
export function vineGeo(rnd, x, y, z, ox, oz, len, rad, colA, colB) {
  const pts = [];
  const n = 5;
  const sway = (rnd() - 0.5) * 1.2;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const out = 0.25 + Math.sin(t * Math.PI) * 0.6 + t * 0.3;
    pts.push(new THREE.Vector3(x + ox * out + -oz * sway * t * t, y - t * len, z + oz * out + ox * sway * t * t));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const g = new THREE.TubeGeometry(curve, 8, rad, 3, false);
  // 先を細く
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  const ring = 4; // radialSegments + 1
  for (let i = 0; i < p.count; i++) {
    const seg = Math.floor(i / ring);
    const t = seg / 8;
    const c = curve.getPointAt(Math.min(1, t));
    const k = 1 - t * 0.75;
    p.setXYZ(i, c.x + (p.getX(i) - c.x) * k, c.y + (p.getY(i) - c.y) * k, c.z + (p.getZ(i) - c.z) * k);
    for (let j = 0; j < 3; j++) col[i * 3 + j] = colA[j] + (colB[j] - colA[j]) * t;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return { geo: g, curve };
}

// 小さな葉っぱ・花（8面）
export function bit(r) {
  return new THREE.OctahedronGeometry(r, 0);
}
// 頂点カラーをつける（全部同じ色）
export function paint(g, c) {
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = c[0];
    col[i * 3 + 1] = c[1];
    col[i * 3 + 2] = c[2];
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
// 高さで色を変える（下＝lo、上＝hi。y0〜y1 の間でなめらかに）
export function paintY(g, y0, y1, lo, hi) {
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    let t = (p.getY(i) - y0) / (y1 - y0);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    t = t * t * (3 - 2 * t);
    for (let j = 0; j < 3; j++) col[i * 3 + j] = lo[j] + (hi[j] - lo[j]) * t;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
// 画面の色の倍率 [r,g,b] → 頂点カラー
export const vc = (r, g, b) => [toLin(r), toLin(g), toLin(b)];

// ======================================================================
// 手描き風テクスチャ（決まった種で作る。くりかえし貼れる）
// ======================================================================
const texCache = new Map();
function tiled(key, w, h, draw) {
  if (texCache.has(key)) return texCache.get(key);
  const t = canvasTex(w, h, draw);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.userData.shared = true;
  // toon() のキャッシュの名前を作るとき、絵の中身まで文字にしないように
  t.toJSON = function () {
    return 'tex:' + key;
  };
  texCache.set(key, t);
  return t;
}
const g255 = (v) => {
  const k = Math.max(0, Math.min(255, Math.round(v * 255)));
  return `rgb(${k},${k},${k})`;
};
// ざらざら（点を散らす）
function speckle(ctx, w, h, r, n, lo, hi, size = 2) {
  for (let i = 0; i < n; i++) {
    const v = lo + r() * (hi - lo);
    ctx.fillStyle = `rgba(${v > 0.5 ? 255 : 0},${v > 0.5 ? 255 : 0},${v > 0.5 ? 255 : 0},${Math.abs(v - 0.5) * 0.5})`;
    const s = size * (0.5 + r());
    ctx.fillRect(r() * w, r() * h, s, s);
  }
}
// 端がつながるように四角をかく
function wrapRect(ctx, w, h, x, y, rw, rh) {
  for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) {
    const X = x + dx, Y = y + dy;
    if (X + rw < 0 || X > w || Y + rh < 0 || Y > h) continue;
    ctx.fillRect(X, Y, rw, rh);
  }
}

// 石の切り石（灰色。材質の色をかけて使う）
export function stoneTex() {
  return tiled('stone', 512, 512, (ctx, w, h) => {
    const r = mulberry32(101);
    ctx.fillStyle = g255(0.55);
    ctx.fillRect(0, 0, w, h);
    const rows = 8, rh = h / rows;
    for (let j = 0; j < rows; j++) {
      let x = r() * 60;
      const x0 = x;
      while (x < x0 + w) {
        const bw = 70 + r() * 110;
        const tone = 0.8 + r() * 0.2;
        ctx.fillStyle = g255(tone);
        wrapRect(ctx, w, h, x + 3, j * rh + 3, bw - 6, rh - 6);
        // 上は明るく、下は暗く（立体感）
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        wrapRect(ctx, w, h, x + 3, j * rh + 3, bw - 6, 5);
        ctx.fillStyle = 'rgba(0,0,0,0.16)';
        wrapRect(ctx, w, h, x + 3, j * rh + rh - 9, bw - 6, 6);
        // 角の欠け
        if (r() < 0.35) {
          ctx.fillStyle = g255(0.6);
          wrapRect(ctx, w, h, x + 3 + r() * (bw - 20), j * rh + 3, 8 + r() * 8, 4 + r() * 5);
        }
        x += bw;
      }
    }
    speckle(ctx, w, h, r, 2600, 0.2, 0.8, 3);
    // ひび
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 14; i++) {
      let x = r() * w, y = r() * h;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let k = 0; k < 4; k++) {
        x += (r() - 0.5) * 30;
        y += 6 + r() * 12;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  });
}

// れんが（長手積み）
export function brickTex() {
  return tiled('brick', 512, 512, (ctx, w, h) => {
    const r = mulberry32(202);
    ctx.fillStyle = g255(0.72);
    ctx.fillRect(0, 0, w, h);
    const rows = 16, rh = h / rows, bw = w / 8;
    for (let j = 0; j < rows; j++) {
      const off = j % 2 ? bw / 2 : 0;
      for (let i = -1; i < 9; i++) {
        const tone = 0.78 + r() * 0.22 - (r() < 0.12 ? 0.12 : 0);
        ctx.fillStyle = g255(tone);
        wrapRect(ctx, w, h, i * bw + off + 2.5, j * rh + 2.5, bw - 5, rh - 5);
        ctx.fillStyle = 'rgba(255,255,255,0.14)';
        wrapRect(ctx, w, h, i * bw + off + 2.5, j * rh + 2.5, bw - 5, 3);
        ctx.fillStyle = 'rgba(0,0,0,0.12)';
        wrapRect(ctx, w, h, i * bw + off + 2.5, j * rh + rh - 6, bw - 5, 3.5);
      }
    }
    speckle(ctx, w, h, r, 1800, 0.25, 0.75, 2.5);
  });
}

// 屋根がわら（横の段＋たての溝）
export function tileTex() {
  return tiled('tile', 256, 256, (ctx, w, h) => {
    const r = mulberry32(303);
    const rows = 8, rh = h / rows, cols = 10, cw = w / cols;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const g = ctx.createLinearGradient(i * cw, 0, (i + 1) * cw, 0);
        const t = 0.86 + r() * 0.1;
        g.addColorStop(0, g255(t * 0.72));
        g.addColorStop(0.45, g255(t));
        g.addColorStop(1, g255(t * 0.78));
        ctx.fillStyle = g;
        ctx.fillRect(i * cw, j * rh, cw, rh);
      }
      // 段の下のかげ
      const sg = ctx.createLinearGradient(0, j * rh + rh - 9, 0, j * rh + rh);
      sg.addColorStop(0, 'rgba(0,0,0,0)');
      sg.addColorStop(1, 'rgba(0,0,0,0.45)');
      ctx.fillStyle = sg;
      ctx.fillRect(0, j * rh + rh - 9, w, 9);
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(0, j * rh, w, 2);
    }
    speckle(ctx, w, h, r, 500, 0.3, 0.7, 2);
  });
}

// 木の板（たての木目）
export function woodTex() {
  return tiled('wood', 256, 256, (ctx, w, h) => {
    const r = mulberry32(404);
    const planks = 4, pw = w / planks;
    for (let i = 0; i < planks; i++) {
      ctx.fillStyle = g255(0.82 + r() * 0.16);
      ctx.fillRect(i * pw, 0, pw, h);
      ctx.strokeStyle = 'rgba(0,0,0,0.16)';
      ctx.lineWidth = 1.2;
      for (let k = 0; k < 7; k++) {
        let x = i * pw + 4 + r() * (pw - 8);
        ctx.beginPath();
        ctx.moveTo(x, 0);
        for (let y = 0; y <= h; y += 32) {
          x += (r() - 0.5) * 3;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(i * pw, 0, 2.5, h);
    }
    speckle(ctx, w, h, r, 300, 0.3, 0.7, 2);
  });
}

// うるし・しっくい（うすいむら。ほとんど白）
export function mottleTex() {
  return tiled('mottle', 256, 256, (ctx, w, h) => {
    const r = mulberry32(505);
    ctx.fillStyle = g255(0.95);
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) {
      const x = r() * w, y = r() * h, rad = 10 + r() * 34;
      const dark = r() < 0.6;
      for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) {
        const g = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, rad);
        g.addColorStop(0, dark ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.08)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x + dx - rad, y + dy - rad, rad * 2, rad * 2);
      }
    }
    speckle(ctx, w, h, r, 700, 0.35, 0.65, 2);
  });
}

// 障子（木のわく＋紙）。uv はそのまま 0〜1
export function shojiTex() {
  return tiled('shoji', 256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#e8ddc3';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#7a4a26';
    const n = 4, m = 6;
    for (let i = 0; i <= n; i++) ctx.fillRect((i / n) * (w - 10), 0, 10, h);
    for (let j = 0; j <= m; j++) ctx.fillRect(0, (j / m) * (h - 8), w, 8);
    ctx.fillStyle = '#5c3519';
    ctx.fillRect(0, h - 40, w, 40);
  });
}

// 帯の飾り（赤地に金の青海波＝波のもよう）
export function friezeTex(base = '#c8321f', line = '#ffd36a') {
  return tiled('frieze' + base + line, 512, 128, (ctx, w, h) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = line;
    ctx.fillRect(0, 6, w, 7);
    ctx.fillRect(0, h - 13, w, 7);
    ctx.strokeStyle = line;
    ctx.lineWidth = 4;
    const R = 26, y0 = h / 2 + 22;
    for (let row = 0; row < 2; row++) {
      for (let i = -1; i <= 10; i++) {
        const cx = i * R * 2 + (row ? R : 0), cy = y0 - row * 22;
        for (let k = 3; k >= 1; k--) {
          ctx.beginPath();
          ctx.arc(cx, cy, (R * k) / 3, Math.PI, 0);
          ctx.fillStyle = base;
          ctx.fill();
          ctx.stroke();
        }
      }
    }
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, 0, w, 4);
    ctx.fillRect(0, h - 4, w, 4);
  });
}

// まるい石だたみの広場（まん中にもん）。uv 0〜1 をそのまま使う
export function plazaTex(kind) {
  return tiled('plaza' + kind, 1024, 1024, (ctx, w, h) => {
    const r = mulberry32(kind === 'sakura' ? 606 : 707);
    const cx = w / 2, cy = h / 2;
    const base = kind === 'sakura' ? [0.86, 0.84, 0.8] : [0.88, 0.8, 0.7];
    const rgb = (k, tint = 0) => `rgb(${Math.round(base[0] * k * 255 + tint)},${Math.round(base[1] * k * 255)},${Math.round(base[2] * k * 255 - tint * 0.5)})`;
    ctx.clearRect(0, 0, w, h);
    // 目地
    ctx.fillStyle = rgb(0.55);
    ctx.beginPath();
    ctx.arc(cx, cy, w / 2 - 2, 0, TAU);
    ctx.fill();
    // 輪になった石
    const rings = 9;
    for (let j = 0; j < rings; j++) {
      const r0 = 70 + j * 48, r1 = r0 + 44;
      const n = Math.max(6, Math.round((TAU * (r0 + 22)) / (60 + r() * 20)));
      const off = r() * TAU;
      for (let i = 0; i < n; i++) {
        const a0 = off + (i / n) * TAU + 0.012, a1 = off + ((i + 1) / n) * TAU - 0.012;
        const k = 0.82 + r() * 0.18;
        const ri = r0 + 2, ro = Math.min(r1 - 2, w / 2 - 6);
        ctx.beginPath();
        ctx.arc(cx, cy, ro, a0, a1);
        ctx.arc(cx, cy, ri, a1, a0, true);
        ctx.closePath();
        ctx.fillStyle = rgb(k, kind === 'sakura' ? 0 : (r() - 0.5) * 30);
        ctx.fill();
      }
      // 刻まれた線（金色っぽい溝）
      if (j === 2 || j === 6) {
        ctx.strokeStyle = 'rgba(90,70,50,0.55)';
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc(cx, cy, r1 - 1, 0, TAU);
        ctx.stroke();
      }
    }
    // まん中のもん
    ctx.fillStyle = rgb(0.95);
    ctx.beginPath();
    ctx.arc(cx, cy, 68, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(80,60,45,0.7)';
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.save();
    ctx.translate(cx, cy);
    ctx.fillStyle = kind === 'sakura' ? 'rgba(214,90,120,0.85)' : 'rgba(150,70,45,0.85)';
    if (kind === 'sakura') {
      for (let i = 0; i < 5; i++) {
        ctx.save();
        ctx.rotate((i / 5) * TAU);
        ctx.beginPath();
        ctx.moveTo(0, -8);
        ctx.bezierCurveTo(-26, -20, -20, -50, -5, -54);
        ctx.lineTo(0, -46);
        ctx.lineTo(5, -54);
        ctx.bezierCurveTo(20, -50, 26, -20, 0, -8);
        ctx.fill();
        ctx.restore();
      }
    } else {
      for (let i = 0; i < 8; i++) {
        ctx.save();
        ctx.rotate((i / 8) * TAU);
        ctx.beginPath();
        ctx.moveTo(0, -58);
        ctx.lineTo(9, -10);
        ctx.lineTo(-9, -10);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }
    ctx.restore();
    // 古びたよごれ
    for (let i = 0; i < 160; i++) {
      const x = r() * w, y = r() * h, rad = 6 + r() * 30;
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, 'rgba(60,50,40,0.08)');
      g.addColorStop(1, 'rgba(60,50,40,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    // ふち（外の輪は少し暗く）
    ctx.globalCompositeOperation = 'destination-in';
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(cx, cy, w / 2 - 2, 0, TAU);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  });
}

// まっ白（模様なしの部品も、模様ありと同じシェーダーを使えるように）
export function whiteTex() {
  return tiled('white', 4, 4, (ctx, w, h) => {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
  });
}

// 足もとのかげ（白い丸。色は材質で付ける）
export function blobTex() {
  return tiled('blob', 64, 64, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.75)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}
