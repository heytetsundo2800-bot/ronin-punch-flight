// うしろから追いかけるカメラ
import * as THREE from 'three';
import { damp, clamp } from './util.js';

const _v = new THREE.Vector3();
const _look = new THREE.Vector3();
const _want = new THREE.Vector3();
const _dir = new THREE.Vector3();

export class FollowCam {
  constructor(cam, world) {
    this.cam = cam;
    this.world = world;
    this.dist = 5.3;
    this.height = 1.45;
    this.lookAhead = 4.2;
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.shakeT = 0;
    this.shakeA = 0;
    this.fovBase = 70;
    this.fovKick = 0;
    this.distScale = 1;
    this.first = true;
  }
  setAspect(aspect) {
    // たて長の画面では上下を広めに見せる
    this.fovBase = aspect < 0.75 ? 70 : aspect < 1.1 ? 64 : 56;
    this.cam.aspect = aspect;
  }
  shake(a, t) {
    this.shakeA = Math.max(this.shakeA, a);
    this.shakeT = Math.max(this.shakeT, t);
  }
  update(p, dt, opts = {}) {
    // カメラの向きはキャラの向きを少し遅れて追う
    const k = opts.snap || this.first ? 1000 : p.lock ? 7 : 6;
    let yawDiff = p.yaw - this.yaw;
    while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
    while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
    this.yaw += yawDiff * (1 - Math.exp(-k * dt));
    // 上下はキャラの向きの7割
    const wantPitch = clamp(p.pitch * 0.72, -1.05, 1.05);
    this.pitch = damp(this.pitch, wantPitch, k, dt);
    const big = p.buffs && p.buffs.big > 0 ? 1.8 : 1;
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    _dir.set(Math.sin(this.yaw) * cp, sp, Math.cos(this.yaw) * cp);
    const speed = p.vel.length();
    const zoom = clamp((speed - 14) / 30, 0, 1);
    const dist = (this.dist + zoom * 1.4) * big * this.distScale;
    // 目標の位置：キャラのうしろ、少し上
    _want.copy(p.pos).addScaledVector(_dir, -dist);
    _want.y += this.height * big * (1 - Math.abs(sp) * 0.35) + Math.max(0, -sp) * 1.2;
    // かべにめりこまないように
    _v.subVectors(_want, p.pos);
    const len = _v.length();
    _v.divideScalar(len);
    const pivot = _look.copy(p.pos);
    pivot.y += 0.6;
    const hit = this.world.raycast(pivot, _v, len);
    if (hit < len) _want.copy(pivot).addScaledVector(_v, Math.max(1.2, hit - 0.6));
    if (_want.y < 1.2) _want.y = 1.2;
    const snapNow = this.first || opts.snap;
    if (snapNow) {
      this.pos.copy(_want);
    } else {
      const kp = 14;
      this.pos.x = damp(this.pos.x, _want.x, kp, dt);
      this.pos.y = damp(this.pos.y, _want.y, kp, dt);
      this.pos.z = damp(this.pos.z, _want.z, kp, dt);
    }
    // 見る点：キャラより少し前（キャラが画面の下寄りに来る）
    _look.copy(p.pos).addScaledVector(_dir, this.lookAhead);
    _look.y += 1.1 * big;
    if (p.lock && p.lock.alive !== false) {
      // ロック中は相手も入るように
      _v.copy(p.lock.pos);
      _look.lerp(_v, 0.35);
    }
    if (snapNow) {
      this.look.copy(_look);
      this.first = false;
    } else this.look.lerp(_look, 1 - Math.exp(-18 * dt));
    this.cam.position.copy(this.pos);
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const a = this.shakeA * Math.min(1, this.shakeT * 3);
      this.cam.position.x += (Math.random() - 0.5) * a;
      this.cam.position.y += (Math.random() - 0.5) * a;
      this.cam.position.z += (Math.random() - 0.5) * a;
    }
    this.cam.up.set(0, 1, 0);
    this.cam.lookAt(this.look);
    // ダッシュのときは視野を広げて速さを出す
    const dash = p.state === 'dash' || p.state === 'skill' ? 1 : 0;
    this.fovKick = damp(this.fovKick, dash * 9 + zoom * 4, 8, dt);
    const fov = this.fovBase + this.fovKick;
    if (Math.abs(this.cam.fov - fov) > 0.05) {
      this.cam.fov = fov;
      this.cam.updateProjectionMatrix();
    }
  }
}
