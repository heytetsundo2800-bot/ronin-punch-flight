// 仕上げ（ポストエフェクト）：ブルーム（光のにじみ）・色の仕上げ・周辺を少し暗く
// ・#コンパスやキックフライトの「光るものがにじむ」見た目。HDR（1より明るい色）で描いた光だけがにじむ
// ・ブルームは「デュアルフィルタ」（縮小→拡大でぼかす。スマホでも軽い）
// ・場面は線形の色で描き、最後に画面の色（sRGB）にする
import * as THREE from 'three';

const QUAD_VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

// 明るいところだけを取り出して半分の大きさに（13点で縮小してちらつきを防ぐ）
const BRIGHT_FRAG = /* glsl */ `
uniform sampler2D src; uniform vec2 texel; uniform float threshold; uniform float knee;
varying vec2 vUv;
vec3 bright(vec3 c){
  float l = max(c.r, max(c.g, c.b));
  float soft = clamp(l - threshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee + 1e-4);
  float w = max(soft, l - threshold) / max(l, 1e-4);
  return c * clamp(w, 0.0, 4.0);
}
void main(){
  vec2 d = texel;
  vec3 c = texture2D(src, vUv).rgb * 0.5;
  c += texture2D(src, vUv + vec2(-d.x, -d.y)).rgb * 0.125;
  c += texture2D(src, vUv + vec2( d.x, -d.y)).rgb * 0.125;
  c += texture2D(src, vUv + vec2(-d.x,  d.y)).rgb * 0.125;
  c += texture2D(src, vUv + vec2( d.x,  d.y)).rgb * 0.125;
  gl_FragColor = vec4(min(bright(c), vec3(16.0)), 1.0);
}`;

const DOWN_FRAG = /* glsl */ `
uniform sampler2D src; uniform vec2 texel; varying vec2 vUv;
void main(){
  vec2 d = texel * 0.5;
  vec3 c = texture2D(src, vUv).rgb * 4.0;
  c += texture2D(src, vUv - d).rgb;
  c += texture2D(src, vUv + d).rgb;
  c += texture2D(src, vUv + vec2(d.x, -d.y)).rgb;
  c += texture2D(src, vUv + vec2(-d.x, d.y)).rgb;
  gl_FragColor = vec4(c / 8.0, 1.0);
}`;

const UP_FRAG = /* glsl */ `
uniform sampler2D src; uniform sampler2D add; uniform vec2 texel; uniform float addK; varying vec2 vUv;
void main(){
  vec2 d = texel * 0.5;
  vec3 c = texture2D(src, vUv + vec2(-d.x * 2.0, 0.0)).rgb;
  c += texture2D(src, vUv + vec2(-d.x, d.y)).rgb * 2.0;
  c += texture2D(src, vUv + vec2(0.0, d.y * 2.0)).rgb;
  c += texture2D(src, vUv + vec2(d.x, d.y)).rgb * 2.0;
  c += texture2D(src, vUv + vec2(d.x * 2.0, 0.0)).rgb;
  c += texture2D(src, vUv + vec2(d.x, -d.y)).rgb * 2.0;
  c += texture2D(src, vUv + vec2(0.0, -d.y * 2.0)).rgb;
  c += texture2D(src, vUv + vec2(-d.x, -d.y)).rgb * 2.0;
  c /= 12.0;
  gl_FragColor = vec4(c + texture2D(add, vUv).rgb * addK, 1.0);
}`;

// まとめ：場面＋にじみ → 明るすぎるところをやわらかく → 画面の色に → 色の仕上げ → 周辺を少し暗く
const COMP_FRAG = /* glsl */ `
uniform sampler2D scene; uniform sampler2D bloom; uniform float strength; uniform float useBloom;
uniform float sat; uniform float contrast; uniform vec3 lift; uniform vec3 gain; uniform float vig; uniform vec2 aspect;
varying vec2 vUv;
vec3 lin2srgb(vec3 c){ return mix(pow(max(c, 0.0), vec3(0.41666)) * 1.055 - vec3(0.055), c * 12.92, vec3(lessThanEqual(c, vec3(0.0031308)))); }
vec3 roll(vec3 x){
  // 0.8 までそのまま、それより上はなめらかに 1 へ（白とびをやわらげる）
  vec3 t = max(x - 0.8, 0.0);
  return min(x, 0.8) + 0.2 * (1.0 - exp(-t / 0.2));
}
void main(){
  vec3 c = texture2D(scene, vUv).rgb;
  if (useBloom > 0.5) c += texture2D(bloom, vUv).rgb * strength;
  c = roll(c);
  vec3 d = lin2srgb(c);
  float l = dot(d, vec3(0.299, 0.587, 0.114));
  d = mix(vec3(l), d, sat);
  d = (d - 0.5) * contrast + 0.5;
  d = d * gain + lift * (1.0 - d);
  vec2 p = (vUv - 0.5) * aspect;
  d *= 1.0 - vig * smoothstep(0.35, 0.95, length(p));
  gl_FragColor = vec4(clamp(d, 0.0, 1.0), 1.0);
}`;

function quadMat(frag, uniforms) {
  return new THREE.ShaderMaterial({ vertexShader: QUAD_VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
}

// ステージごとの色の仕上げ（にじみの強さ・しきい値・彩度・コントラスト・暗部の色・明部の色・周辺減光）
export const GRADES = {
  lobby: { strength: 0.55, threshold: 0.95, knee: 0.3, sat: 1.1, contrast: 1.05, lift: [0.0, 0.0, 0.02], gain: [1.0, 1.0, 1.0], vig: 0.18 },
  // ディスク画面：モンスターをくっきり（にじみ弱め・周辺を暗くしない）
  disc: { strength: 0.3, threshold: 0.98, knee: 0.25, sat: 1.06, contrast: 1.05, lift: [0.0, 0.0, 0.0], gain: [1.0, 1.0, 1.0], vig: 0.0 },
  sakura: { strength: 0.6, threshold: 0.95, knee: 0.3, sat: 1.1, contrast: 1.05, lift: [0.0, 0.005, 0.025], gain: [1.0, 1.0, 1.0], vig: 0.2 },
  campus: { strength: 0.7, threshold: 0.93, knee: 0.32, sat: 1.07, contrast: 1.08, lift: [0.02, 0.0, 0.035], gain: [1.03, 0.99, 0.95], vig: 0.26 },
};

export class Post {
  constructor(renderer) {
    this.r = renderer;
    this.enabled = true; // false のときはそのまま画面に描く（いちばん軽い）
    this.bloomOn = true;
    const caps = renderer.capabilities;
    this.webgl2 = !!caps.isWebGL2;
    const ext = renderer.extensions;
    this.hdr = this.webgl2 && (ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float'));
    this.type = this.hdr ? THREE.HalfFloatType : THREE.UnsignedByteType;
    this.grade = { ...GRADES.sakura };
    const opt = (extra) => ({ type: this.type, depthBuffer: false, stencilBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, ...extra });
    this.main = new THREE.WebGLRenderTarget(4, 4, opt({ depthBuffer: true, samples: this.webgl2 ? 4 : 0 }));
    this.down = [0, 1, 2, 3].map(() => new THREE.WebGLRenderTarget(4, 4, opt()));
    this.up = [0, 1, 2].map(() => new THREE.WebGLRenderTarget(4, 4, opt()));
    for (const t of [this.main, ...this.down, ...this.up]) t.texture.generateMipmaps = false;
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.qs = new THREE.Scene();
    this.qs.add(this.quad);
    this.mBright = quadMat(BRIGHT_FRAG, { src: { value: null }, texel: { value: new THREE.Vector2() }, threshold: { value: 0.9 }, knee: { value: 0.35 } });
    this.mDown = quadMat(DOWN_FRAG, { src: { value: null }, texel: { value: new THREE.Vector2() } });
    this.mUp = quadMat(UP_FRAG, { src: { value: null }, add: { value: null }, texel: { value: new THREE.Vector2() }, addK: { value: 1 } });
    this.mComp = quadMat(COMP_FRAG, {
      scene: { value: null },
      bloom: { value: null },
      strength: { value: 0.85 },
      useBloom: { value: 1 },
      sat: { value: 1.1 },
      contrast: { value: 1.06 },
      lift: { value: new THREE.Vector3() },
      gain: { value: new THREE.Vector3(1, 1, 1) },
      vig: { value: 0.22 },
      aspect: { value: new THREE.Vector2(1, 1) },
    });
    this.w = 0;
    this.h = 0;
    this.failed = false;
  }
  // 色の仕上げ（ステージごとに変える）
  setGrade(g) {
    Object.assign(this.grade, g || {});
  }
  setSize(w, h, dpr) {
    const W = Math.max(1, Math.round(w * dpr)), H = Math.max(1, Math.round(h * dpr));
    if (W === this.w && H === this.h) return;
    this.w = W;
    this.h = H;
    // 高い解像度では MSAA を少なめに（メモリと速さ）
    this.main.samples = this.webgl2 ? (dpr >= 1.75 ? 2 : 4) : 0;
    this.main.setSize(W, H);
    let dw = Math.max(1, W >> 1), dh = Math.max(1, H >> 1);
    for (let i = 0; i < this.down.length; i++) {
      this.down[i].setSize(dw, dh);
      if (i < this.up.length) this.up[i].setSize(dw, dh);
      dw = Math.max(1, dw >> 1);
      dh = Math.max(1, dh >> 1);
    }
    const a = W / H;
    this.mComp.uniforms.aspect.value.set(a > 1 ? a : 1, a > 1 ? 1 : 1 / a);
  }
  pass(mat, target) {
    this.quad.material = mat;
    this.r.setRenderTarget(target);
    this.r.render(this.qs, this.cam);
  }
  render(scene, camera) {
    const R = this.r;
    if (!this.enabled || this.failed) {
      R.setRenderTarget(null);
      R.render(scene, camera);
      return;
    }
    try {
      R.setRenderTarget(this.main);
      R.render(scene, camera);
      const g = this.grade;
      let bloomTex = null;
      if (this.bloomOn) {
        const B = this.mBright.uniforms;
        B.src.value = this.main.texture;
        B.texel.value.set(1 / this.w, 1 / this.h);
        B.threshold.value = g.threshold;
        B.knee.value = g.knee;
        this.pass(this.mBright, this.down[0]);
        for (let i = 1; i < this.down.length; i++) {
          const s = this.down[i - 1];
          this.mDown.uniforms.src.value = s.texture;
          this.mDown.uniforms.texel.value.set(1 / s.width, 1 / s.height);
          this.pass(this.mDown, this.down[i]);
        }
        // 小さい方から拡大しながら足していく（広いにじみ＋芯のにじみ）
        let src = this.down[this.down.length - 1];
        for (let i = this.up.length - 1; i >= 0; i--) {
          const U = this.mUp.uniforms;
          U.src.value = src.texture;
          U.add.value = this.down[i].texture;
          U.texel.value.set(1 / src.width, 1 / src.height);
          U.addK.value = 1;
          this.pass(this.mUp, this.up[i]);
          src = this.up[i];
        }
        bloomTex = this.up[0].texture;
      }
      const C = this.mComp.uniforms;
      C.scene.value = this.main.texture;
      C.bloom.value = bloomTex || this.main.texture;
      C.useBloom.value = bloomTex ? 1 : 0;
      C.strength.value = g.strength / 4;
      C.sat.value = g.sat;
      C.contrast.value = g.contrast;
      C.lift.value.set(...g.lift);
      C.gain.value.set(...g.gain);
      C.vig.value = g.vig;
      this.pass(this.mComp, null);
    } catch (e) {
      // うまく描けない端末では、ふつうの描き方にもどす
      this.failed = true;
      R.setRenderTarget(null);
      R.render(scene, camera);
    }
  }
  dispose() {
    for (const t of [this.main, ...this.down, ...this.up]) t.dispose();
    for (const m of [this.mBright, this.mDown, this.mUp, this.mComp]) m.dispose();
    this.quad.geometry.dispose();
  }
}
