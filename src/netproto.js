// オンライン対戦のデータの形（バイナリの読み書き・状態の番号・できごとの変換）
import * as THREE from 'three';
import { OMAMORI, OMAMORI_IDS } from './characters.js';
import { ELEM } from './config.js';

export const PROTO = 2; // 形を変えたら上げる（ちがう版どうしでは遊べない）

// 状態の番号
export const STATES = ['hover', 'fly', 'dash', 'cruise', 'step', 'roll', 'brake', 'uturn', 'hurt', 'stun', 'ko', 'special', 'skill'];
const STATE_NO = Object.fromEntries(STATES.map((s, i) => [s, i]));
export const stateNo = (s) => (STATE_NO[s] == null ? 0 : STATE_NO[s]);
export const ELEMS = Object.keys(ELEM);
export const PHASES = ['wait', 'intro', 'play', 'finish', 'result'];
export const PROJ_KINDS = ['ink', 'akahon', 'tangocho', 'pencil', 'guardianShot', 'other'];
export const MSG_SNAP = 1;
export const MSG_ME = 2;

const ANG = 32767 / Math.PI;
const wrap = (a) => {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
};
const i16 = (v) => (v > 32767 ? 32767 : v < -32768 ? -32768 : Math.round(v));
const u8c = (v) => (v > 255 ? 255 : v < 0 ? 0 : Math.round(v));
const i8c = (v) => (v > 127 ? 127 : v < -128 ? -128 : Math.round(v));

// ===== 書く =====
export class Writer {
  constructor(n = 1536) {
    this.buf = new ArrayBuffer(n);
    this.dv = new DataView(this.buf);
    this.o = 0;
  }
  need(k) {
    if (this.o + k <= this.buf.byteLength) return;
    const nb = new ArrayBuffer(Math.max(this.buf.byteLength * 2, this.o + k + 256));
    new Uint8Array(nb).set(new Uint8Array(this.buf, 0, this.o));
    this.buf = nb;
    this.dv = new DataView(nb);
  }
  reset() {
    this.o = 0;
    return this;
  }
  u8(v) {
    this.need(1);
    this.dv.setUint8(this.o, u8c(v));
    this.o += 1;
  }
  i8(v) {
    this.need(1);
    this.dv.setInt8(this.o, i8c(v));
    this.o += 1;
  }
  u16(v) {
    this.need(2);
    this.dv.setUint16(this.o, v > 65535 ? 65535 : v < 0 ? 0 : Math.round(v));
    this.o += 2;
  }
  i16(v) {
    this.need(2);
    this.dv.setInt16(this.o, i16(v));
    this.o += 2;
  }
  f32(v) {
    this.need(4);
    this.dv.setFloat32(this.o, v);
    this.o += 4;
  }
  vec(v) {
    this.f32(v.x);
    this.f32(v.y);
    this.f32(v.z);
  }
  vel(v, s = 50) {
    this.i16(v.x * s);
    this.i16(v.y * s);
    this.i16(v.z * s);
  }
  ang(a) {
    this.i16(wrap(a) * ANG);
  }
  done() {
    return this.buf.slice(0, this.o);
  }
}

// ===== 読む =====
export class Reader {
  constructor(buf) {
    this.dv = new DataView(buf);
    this.o = 0;
    this.n = buf.byteLength;
  }
  get left() {
    return this.n - this.o;
  }
  u8() {
    return this.dv.getUint8(this.o++);
  }
  i8() {
    return this.dv.getInt8(this.o++);
  }
  u16() {
    const v = this.dv.getUint16(this.o);
    this.o += 2;
    return v;
  }
  i16() {
    const v = this.dv.getInt16(this.o);
    this.o += 2;
    return v;
  }
  f32() {
    const v = this.dv.getFloat32(this.o);
    this.o += 4;
    return v;
  }
  vec(out) {
    out.x = this.f32();
    out.y = this.f32();
    out.z = this.f32();
    return out;
  }
  vel(out, s = 50) {
    out.x = this.i16() / s;
    out.y = this.i16() / s;
    out.z = this.i16() / s;
    return out;
  }
  ang() {
    return this.i16() / ANG;
  }
}

// ===== できごとの引数を JSON にする（人・ダルマ・ベクトル・お守りを番号に）=====
export function ser(v, M) {
  if (v == null || typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return typeof v === 'number' ? Math.round(v * 1000) / 1000 : v;
  if (v.isVector3) return { v: [Math.round(v.x * 100) / 100, Math.round(v.y * 100) / 100, Math.round(v.z * 100) / 100] };
  if (v.isColor) return v.getHex();
  if (v.def && v.netId != null) return { p: v.netId };
  if (v.isGuardian) return { g: v.team };
  if (v.id && OMAMORI[v.id] === v) return { o: v.id };
  if (Array.isArray(v)) return v.map((x) => ser(x, M));
  if (typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v)) {
      const x = v[k];
      if (typeof x === 'function') continue;
      o[k] = ser(x, M);
    }
    return { j: o };
  }
  return null;
}
export function deser(v, M) {
  if (v == null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map((x) => deser(x, M));
  if (v.v) return new THREE.Vector3(v.v[0], v.v[1], v.v[2]);
  if (v.p != null) return M.punchers[v.p] || null;
  if (v.g != null) return M.guardians[v.g] || null;
  if (v.o) return OMAMORI[v.o] || null;
  if (v.j) {
    const o = {};
    for (const k of Object.keys(v.j)) o[k] = deser(v.j[k], M);
    return o;
  }
  return null;
}

// 相手の番号（人は 0〜7、ダルマは 100＋チーム）
export const refOf = (t) => (!t ? -1 : t.isGuardian ? 100 + t.team : t.netId != null ? t.netId : -1);
export const fromRef = (M, r) => (r == null || r < 0 ? null : r >= 100 ? M.guardians[r - 100] || null : M.punchers[r] || null);
export const omIndex = (id) => {
  const i = OMAMORI_IDS.indexOf(id);
  return i < 0 ? 255 : i;
};
export const omFromIndex = (i) => (i === 255 ? null : OMAMORI_IDS[i] || null);
