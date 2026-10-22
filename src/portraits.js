// キャラの顔アイコン・全身の絵を3Dモデルから作る
import * as THREE from 'three';
import { buildPuncher, poseModel, FACES } from './model.js';
import { buildMonster, poseMonster } from './monsters.js';
import { disposeDeep, OUTLINE } from './gfx.js';
import { PUNCHERS } from './characters.js';
import { TEAM } from './config.js';

export class Portraits {
  constructor(renderer) {
    this.renderer = renderer;
    this.cache = new Map();
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8899bb, 1.7));
    const sun = new THREE.DirectionalLight(0xffffff, 2.0);
    sun.position.set(2, 4, 5);
    this.scene.add(sun);
    this.cam = new THREE.PerspectiveCamera(30, 1, 0.05, 50);
  }
  render(id, team, kind, w0, h0, facing = 1) {
    const key = id + '|' + team + '|' + kind + '|' + w0 + '|' + facing;
    if (this.cache.has(key)) return this.cache.get(key);
    const w = w0 * 2, h = h0 * 2; // 2倍で描いて縮める（ギザギザを消す）
    const R = this.renderer;
    const model = buildPuncher(PUNCHERS[id], team);
    this.scene.add(model);
    const calm = kind === 'face' || kind === 'bust';
    const hero = kind.startsWith('hero:'); // 結果画面の大きな絵（ひざから上）
    const mode = calm ? 'hover' : kind === 'cut' ? 'cutin' : hero ? kind.slice(5) : kind;
    // 顔アイコンは目を開けたふつうの顔（まばたきの途中で撮らない）
    const st = { mode, t: 0.6, speed01: 0, turn: 0, punchSide: 1, punchPhase: 0.35, heavy: false, runPhase: 0, snap: true, face: calm ? FACES.neutral : -1 };
    poseModel(model, st, 1);
    if (kind === 'cut' && model.userData.glasses) model.userData.glasses.visible = false; // アオッチ：メガネを外したところ
    model.updateMatrixWorld(true);
    const head = model.userData.parts.head;
    const hp = new THREE.Vector3();
    head.getWorldPosition(hp);
    const cam = this.cam;
    cam.aspect = w / h;
    if (kind === 'face') {
      cam.fov = 26;
      cam.position.set(hp.x + 0.35, hp.y + 0.05, hp.z + 1.55);
      cam.lookAt(hp.x, hp.y - 0.02, hp.z);
    } else if (kind === 'bust') {
      cam.fov = 30;
      cam.position.set(hp.x + 0.6, hp.y - 0.1, hp.z + 2.4);
      cam.lookAt(hp.x, hp.y - 0.35, hp.z);
    } else if (hero) {
      model.rotation.y = -0.32;
      model.updateMatrixWorld(true);
      head.getWorldPosition(hp);
      cam.fov = 34;
      cam.position.set(hp.x + 0.18, hp.y - 0.3, hp.z + 2.6);
      cam.lookAt(hp.x, hp.y - 0.32, hp.z);
    } else if (kind === 'cut') {
      // カットイン：上半身を少し下から（強そうに見える）。体は画面の内がわを向く
      model.rotation.y = -0.42 * facing;
      model.updateMatrixWorld(true);
      head.getWorldPosition(hp);
      cam.fov = 34;
      cam.position.set(hp.x - 0.2 * facing, hp.y - 0.24, hp.z + 1.5);
      cam.lookAt(hp.x - 0.05 * facing, hp.y - 0.17, hp.z);
    } else {
      // 全身（スペシャル・勝ちポーズなど）
      model.rotation.y = 0.35;
      model.updateMatrixWorld(true);
      cam.fov = 30;
      cam.position.set(0.3, 0.15, 4.4);
      cam.lookAt(0, 0.05, 0);
    }
    cam.updateProjectionMatrix();
    const url = this.snap(model, w, h, w0, h0);
    disposeDeep(model);
    this.cache.set(key, url);
    return url;
  }
  // 3Dの物を写真にする（2倍で描いて縮める）
  snap(model, w, h, w0, h0) {
    const R = this.renderer;
    const cam = this.cam;
    const rt = new THREE.WebGLRenderTarget(w, h, { samples: 0 });
    // 線の太さは、この絵の大きさで決める（画面の大きさのままだと細くなりすぎる）
    const oRes = OUTLINE.res.value.clone(), oPx = OUTLINE.px.value;
    OUTLINE.res.value.set(w, h);
    OUTLINE.px.value = 2.4;
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    const prevT = R.getRenderTarget();
    const prevC = R.getClearColor(new THREE.Color());
    const prevA = R.getClearAlpha();
    R.setRenderTarget(rt);
    R.setClearColor(0x000000, 0);
    R.clear();
    R.render(this.scene, cam);
    const px = new Uint8Array(w * h * 4);
    R.readRenderTargetPixels(rt, 0, 0, w, h, px);
    OUTLINE.res.value.copy(oRes);
    OUTLINE.px.value = oPx;
    R.setRenderTarget(prevT);
    R.setClearColor(prevC, prevA);
    rt.dispose();
    this.scene.remove(model);
    // 上下を反転してキャンバスへ
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      const src = (h - 1 - y) * w * 4;
      img.data.set(px.subarray(src, src + w * 4), y * w * 4);
    }
    // 色空間：WebGL2 ではGPUが sRGB にしてくれる。WebGL1 のときだけ自分で直す
    if (!R.capabilities.isWebGL2) {
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        d[i] = lin2srgb(d[i]);
        d[i + 1] = lin2srgb(d[i + 1]);
        d[i + 2] = lin2srgb(d[i + 2]);
      }
    }
    ctx.putImageData(img, 0, 0);
    const c2 = document.createElement('canvas');
    c2.width = w0;
    c2.height = h0;
    const ctx2 = c2.getContext('2d');
    ctx2.imageSmoothingEnabled = true;
    ctx2.imageSmoothingQuality = 'high';
    ctx2.drawImage(c, 0, 0, w0, h0);
    let url = '';
    try {
      url = c2.toDataURL('image/png');
    } catch (e) {}
    return url;
  }
  // ディスクのモンスターの絵（ななめ前から全身）
  monster(monId, size = 160) {
    const key = 'mon|' + monId + '|' + size;
    if (this.cache.has(key)) return this.cache.get(key);
    const m = buildMonster(monId);
    m.rotation.y = 0.75;
    poseMonster(m, 'idle', 0, 0.55);
    this.scene.add(m);
    m.updateMatrixWorld(true);
    const box = new THREE.Box3();
    // 光の板（スプライト）は大きさに入れない
    m.traverse((o) => {
      if (o.isMesh && o.name !== 'outline') {
        o.geometry.computeBoundingBox();
        const b = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
        box.union(b);
      }
    });
    const c = box.getCenter(new THREE.Vector3());
    const sz = box.getSize(new THREE.Vector3());
    const r = Math.max(sz.x, sz.y * 1.1, sz.z) * 0.5;
    const cam = this.cam;
    cam.aspect = 1;
    cam.fov = 28;
    const dist = (r / Math.tan((cam.fov * Math.PI) / 360)) * 1.08;
    cam.position.set(c.x + dist * 0.12, c.y + dist * 0.26, c.z + dist);
    cam.lookAt(c.x, c.y - r * 0.04, c.z);
    cam.updateProjectionMatrix();
    const url = this.snap(m, size * 2, size * 2, size, size);
    this.cache.set(key, url);
    return url;
  }
  get(id, team) {
    return this.render(id, team, 'face', 128, 128);
  }
  bust(id, team) {
    return this.render(id, team, 'bust', 256, 320);
  }
  full(id, team, pose = 'special') {
    return this.render(id, team, pose, 384, 512);
  }
  // 大きく見せる絵は、こまかい画面（iPhone など）では少し大きく作る（ぼやけないように。作る時間とのかねあいで 1.3 倍まで）
  big(n) {
    const k = typeof window !== 'undefined' && (window.devicePixelRatio || 1) >= 2 ? 1.3 : 1;
    return Math.round(n * k);
  }
  // 結果画面の絵（pose: win / lose / hover）
  hero(id, team, pose = 'win') {
    return this.render(id, team, 'hero:' + pose, this.big(320), this.big(400));
  }
  // スペシャルのカットインの絵（上半身。facing: 1 = 左を向く / -1 = 右を向く）
  cut(id, team, facing = 1) {
    return this.render(id, team, 'cut', this.big(420), this.big(360), facing);
  }
}

const LUT = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  LUT[i] = Math.round(Math.max(0, Math.min(1, s)) * 255);
}
function lin2srgb(v) {
  return LUT[v];
}
