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

const matCache = new Map();
export function toon(color, opts = {}) {
  const key = color + '|' + JSON.stringify(opts);
  if (!opts.unique && matCache.has(key)) return matCache.get(key);
  const m = new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(), ...stripOpts(opts) });
  if (!opts.unique) {
    m.userData.shared = true;
    matCache.set(key, m);
  }
  return m;
}
function stripOpts(o) {
  const r = { ...o };
  delete r.unique;
  return r;
}

// ふちどり（法線方向に少しふくらませた裏面を黒く描く）
const outlineCache = new Map();
export function outlineMat(color = 0x14161c, width = 0.022) {
  const key = color + '|' + width;
  if (outlineCache.has(key)) return outlineCache.get(key);
  const m = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uOutline = { value: width };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uOutline;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normalize(normal) * uOutline;');
  };
  m.customProgramCacheKey = () => 'outline' + width;
  m.userData.shared = true;
  outlineCache.set(key, m);
  return m;
}

export function addOutline(mesh, color, width) {
  const o = new THREE.Mesh(mesh.geometry, outlineMat(color, width));
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
