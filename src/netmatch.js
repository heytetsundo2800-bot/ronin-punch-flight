// オンライン対戦の試合
//   HostMatch：部屋をつくった人の端末。CPU・当たり判定・ルールを全部ここで計算して、みんなに送る
//   ClientMatch：入った人の端末。自分のキャラはその場で動かし（操作のおくれをなくす）、ほかは送られた状態を表示する
import * as THREE from 'three';
import { Match } from './match.js';
import { Combat } from './combat.js';
import { Skills } from './skills.js';
import { Brain } from './ai.js';
import { OMAMORI } from './characters.js';
import { MOVE, RESPAWN_TIME, TEAM } from './config.js';
import { sound } from './audio.js';
import { clamp, angleDamp, lerp, damp, wrapAngle } from './util.js';
import { Writer, Reader, ser, deser, refOf, fromRef, STATES, stateNo, ELEMS, PHASES, PROJ_KINDS, AREA_KINDS, MSG_SNAP, MSG_ME, omIndex, omFromIndex } from './netproto.js';
import { clientKit, clientSpecial } from './kits.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

const SNAP_HZ = 20; // ホストが状態を送る回数（1秒あたり）
const ME_HZ = 30; // 入った人が自分の位置を送る回数
const INTERP = 0.11; // ほかの人を何秒おくれて表示するか（なめらかにするため）
const READY_WAIT = 12; // みんなの準備を待つ最長（秒）

// 記録して、みんなの画面でも同じように見せるもの
const FX_REC = new Set(['hit', 'healNum', 'miss', 'shieldHit', 'shock', 'boom', 'puff', 'pickup', 'scatter', 'deposit', 'wallKick', 'flash', 'dizzy', 'hearts', 'sparkle', 'laughs', 'healFx', 'buffFx', 'warpFx', 'elemSwitch', 'chargeIcon', 'chargeBreak', 'skillName', 'summonAct',
  // v1.5 の仲間の技（kits.js）
  'say', 'notes', 'zzz', 'breath', 'beam', 'tornado', 'stink', 'bike', 'drums', 'phoneRing', 'kick', 'donuts', 'confetti', 'ring']);
const REPLAY = new Set(['koFeedback', 'respawnFeedback', 'justFeedback', 'hitFeedback', 'announce', 'alertGuardian', 'cutin', 'sfx', 'shake']);
// 本人の端末ではすでに出しているので、もう一度は出さないもの
const SELF_SKIP = new Set(['sfx:charge', 'fx.chargeIcon', 'fx.summonAct', 'sfx:elem', 'fx.elemSwitch', 'sfx:shot', 'fx.bike']);
// ホストの本人にだけ出る音（ほかの人の画面では出さない）
const PERSONAL_SFX = new Set(['lock', 'land', 'spReady', 'respawn']);

const nowS = () => performance.now() / 1000;
// ほかの人の「動く技」のあいだに出す光のすじ（自分の端末で計算していない人用）
const TRAIL_COLOR = { goggleDive: 0x7af0ff, bikeDash: 0x7dff9a, flyKick: 0xff6a3a, desires: 0xffb0e0 };

// 動きの変わり目の音（ほかの人のダッシュ・回避など。自分の端末で計算していない人用）
function stateSound(M, p, prev) {
  const s = p.state;
  if (s === prev) return;
  if (s === 'dash') M.sfxLocal('dash', p);
  else if (s === 'roll') M.sfxLocal('roll', p);
  else if (s === 'step') M.sfxLocal('step', p);
  else if (s === 'uturn') M.sfxLocal('uturn', p);
  else if (s === 'brake') M.sfxLocal('brake', p);
}

// ===== ホスト =====
export class HostMatch extends Match {
  constructor(app, opts, room) {
    super(app, { ...opts, online: true, room });
    this.room = room;
    this.online = true;
    this.isHost = true;
    this.evq = []; // ここから先のできごとを送る（作っている途中のものは、それぞれの端末で出している）
    this.origin = -1;
    this._mute = 0;
    this.phase = 'wait';
    this.phaseT = 0;
    this.input.enabled = false;
    this.ready = new Set();
    this.snapW = new Writer(2048);
    this.snapAcc = 0;
    this.seq = 0;
    this.t0 = nowS();
    for (const p of this.punchers) {
      if (p.human && !p.isPlayer) {
        p.remote = true;
        p.netIn = null;
      }
    }
    // えフェクトの呼び出しを記録して送る
    const real = this.fx;
    const self = this;
    this.fxReal = real;
    this.fx = new Proxy(real, {
      get(t, k) {
        const v = t[k];
        if (typeof v !== 'function') return v;
        if (!FX_REC.has(k)) return v.bind(t);
        return (...a) => {
          self.rec('fx.' + k, a);
          self._mute = (self._mute || 0) + 1;
          try {
            return v.apply(t, a);
          } finally {
            self._mute--;
          }
        };
      },
    });
    room.binHandler = (from, buf) => this.onBin(from, buf);
  }

  // ===== 記録 =====
  rec(name, args) {
    if (this._mute || !this.evq) return;
    const a = [name, this.origin];
    for (const x of args) a.push(ser(x, this));
    this.evq.push(a);
  }
  muted(name, args, fn) {
    this.rec(name, args);
    this._mute = (this._mute || 0) + 1;
    try {
      return fn();
    } finally {
      this._mute--;
    }
  }
  sfx(name, src, other, pos) {
    this.rec('sfx', [name, src, other, pos]);
    super.sfx(name, src, other, pos);
  }
  sfxLocal(name, src) {
    super.sfx(name, src);
  }
  announce(text, team, big) {
    this.rec('announce', [text, team, big]);
    super.announce(text, team, big);
  }
  alertGuardian(team) {
    this.rec('alertGuardian', [team]);
    super.alertGuardian(team);
  }
  cutin(p) {
    this.muted('cutin', [p], () => super.cutin(p));
  }
  shake(a, t) {
    this.rec('shake', [a, t]);
    super.shake(a, t);
  }
  koFeedback(v, k) {
    this.muted('koFeedback', [v, k], () => super.koFeedback(v, k));
  }
  respawnFeedback(p) {
    this.muted('respawnFeedback', [p], () => super.respawnFeedback(p));
  }
  justFeedback(t) {
    this.muted('justFeedback', [t], () => super.justFeedback(t));
  }
  hitFeedback(t, src, heavy, melee, stun) {
    this.muted('hitFeedback', [t, src, heavy, melee, stun], () => super.hitFeedback(t, src, heavy, melee, stun));
  }

  // ほかの端末の人にふっとび・ひるみを知らせる
  netHit(t, h) {
    if (!t.peer) return;
    const m = { t: 'hit' };
    const r2 = (v) => [Math.round(v.x * 100) / 100, Math.round(v.y * 100) / 100, Math.round(v.z * 100) / 100];
    if (h.k) m.k = r2(h.k);
    if (h.vs) m.vs = r2(h.vs);
    if (h.s) m.s = h.s;
    if (h.h) m.h = h.h;
    if (h.cc) m.cc = h.cc;
    if (h.ul) m.ul = 1;
    if (h.ap) m.ap = 1;
    if (h.dl) m.dl = h.dl;
    this.room.sendTo(t.peer, m);
  }

  // ===== 受けとる =====
  onMsg(from, o) {
    if (o.t === 'ready') {
      this.ready.add(from);
      return;
    }
    if (o.t === 'act') this.onAct(from, o);
    if (o.t === 'stamp') {
      const p = this.punchers.find((q) => q.peer === from);
      if (p) this.relayStamp(p, o.i | 0);
    }
  }
  sendStamp(i) {
    this.relayStamp(this.player, i);
  }
  relayStamp(p, i) {
    const now = nowS();
    if (now - (p.stampAt || 0) < 1.2) return; // 連打しない
    p.stampAt = now;
    this.showStamp(p, i);
    this.room.broadcast({ t: 'stamp', p: p.netId, i });
  }
  onBin(from, buf) {
    let r;
    try {
      r = new Reader(buf);
      if (r.u8() !== MSG_ME) return;
    } catch (e) {
      return;
    }
    const p = this.punchers.find((q) => q.peer === from);
    if (!p) return;
    try {
      const seq = r.u16();
      const s = p.netIn || (p.netIn = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), seq: -1 });
      // 古い順番のものは捨てる（u16 の回り込みも考える）
      if (s.seq >= 0 && ((seq - s.seq) & 0xffff) > 0x8000) return;
      s.seq = seq;
      s.life = r.u8();
      r.vec(s.pos);
      r.vel(s.vel);
      s.yaw = r.ang();
      s.pitch = r.ang();
      s.roll = r.ang();
      s.state = STATES[r.u8()] || 'hover';
      const f = r.u8();
      s.ground = !!(f & 1);
      s.just = !!(f & 2);
      s.inv = !!(f & 4);
      s.dep = !!(f & 8);
      s.atkSide = f & 16 ? 1 : 0;
      s.atkHeavy = !!(f & 32);
      s.alive = !!(f & 64);
      s.atkShot = !!(f & 128);
      const ap = r.u8();
      s.atkPhase = ap === 255 ? -1 : ap / 254;
      s.turnVis = r.i8() / 100;
      s.lock = r.i8();
      s.stateT = r.u8() / 50;
      s.at = nowS();
      if (!isFinite(s.pos.x + s.pos.y + s.pos.z)) p.netIn = null;
    } catch (e) {}
  }
  onAct(from, o) {
    const p = this.punchers.find((q) => q.peer === from);
    if (!p || !p.alive || this.phase !== 'play') return;
    this.origin = p.netId;
    try {
      const a = o.a;
      if (a === 'mh' || a === 'sh' || a === 'dh') {
        const t = fromRef(this, o.r);
        if (!t || t.team === p.team || t.alive === false || (t.attackable && !t.attackable())) return;
        const d = t.pos.distanceTo(p.pos);
        const atk = p.def.attack;
        const idx = clamp(o.i | 0, 0, atk.dmg.length - 1);
        if (a === 'sh' && o.k === 1) {
          // 遠くへの弾（てつんどのビートショット）。何発目かと撃つ間かくは、ホストで数える（改造した端末でも連射できない）
          if (!atk.shot || d > atk.shot.range + (t.radius || 0.8) + 12) return;
          if (this.time - (p.altShotT == null ? -9 : p.altShotT) < Math.min(...atk.shot.gap) * 0.5) return;
          p.altShotT = this.time;
          const i2 = (p.altShotN || 0) % atk.shot.dmg.length;
          p.altShotN = (p.altShotN || 0) + 1;
          p.atk.hitIdx = i2;
          this.combat.shootAlt(p, t, i2);
        } else if (a === 'mh') {
          // 本人の画面で当たったパンチ（ずれを考えて少しゆるく見る）
          if (d > atk.range + (t.radius || 0.8) + 0.9 + (p.buffs.big > 0 ? 2.5 : 0) + 6) return;
          p.atk.hitIdx = idx;
          this.combat.meleeHit(p, t, idx);
          if (p.buffs.big > 0) this.combat.bigSplash(p, t);
        } else if (a === 'sh') {
          if (d > atk.range + (t.radius || 0.8) + 12) return;
          p.atk.hitIdx = idx; // 何発目か（エブンの歌声の3発目＝大きな声）
          this.combat.shoot(p, t, atk.dmg[idx]);
        } else {
          if (d > 12) return;
          this.combat.dashHit(p, t);
        }
      } else if (a === 'ks') {
        if (o.d != null && p.def.skill.id === 'desires') p.desireIdx = clamp(o.d | 0, 0, 2);
        if (this.skills.useKS(p)) {
          p.stats.ks++;
          p.ksCd = p.def.skill.cd;
          p.invuln = Math.max(p.invuln, 0.25);
        }
      } else if (a === 'om') {
        const i = clamp(o.s | 0, 0, 3);
        const id = p.omamori[i];
        const om = OMAMORI[id];
        if (!om || p.charge) return;
        const total = this.skills.chargeTime(p, om);
        p.charge = { id, slot: i, t: total, total };
        const lv = (p.omLv && p.omLv[i]) || 1;
        p.omCd[i] = om.cd * (1 - (lv - 1) * 0.04);
        this.sfx('charge', p);
        this.fx.chargeIcon && this.fx.chargeIcon(p, om);
      } else if (a === 'el') {
        const om = OMAMORI[p.omamori[clamp(o.s | 0, 0, 3)]];
        if (!om || om.elem === p.elem) return;
        p.elem = om.elem;
        p.elemCd = 3.5;
        p.diskLock = 1.0;
        this.sfx('elem', p);
        this.fx.elemSwitch && this.fx.elemSwitch(p);
      } else if (a === 'sp') {
        if (p.sp < 0.999 || p.state === 'special' || (p.hostState && p.hostState.until > this.time)) return;
        p.sp = 0;
        p.stats.sp++;
        this.skills.useSpecial(p);
        p.hostState = { state: 'special', until: this.time + 1.05 };
        this.room.sendTo(from, { t: 'spc' });
      }
    } finally {
      this.origin = -1;
    }
  }
  onLeft(id, m) {
    const p = this.punchers.find((q) => q.peer === id);
    if (!p) return;
    // 切れた人はCPUが代わりに戦う
    p.remote = false;
    p.human = false;
    p.cpu = true;
    p.peer = null;
    p.netIn = null;
    this.setCpuLevel(p, this.diffKey);
    p.brain = new Brain(p, this, 'collector');
    p.displayName = (p.displayName || 'CPU').slice(0, 7) + '(CPU)';
    this.announce((m && m.name ? m.name : 'だれか') + ' の接続が切れた（CPUが代わりに戦う）', p.team);
  }

  // ===== 毎フレーム =====
  stepPuncher(p, dt) {
    if (p.remote) this.stepRemote(p, dt);
    else p.update(dt);
  }
  stepRemote(p, dt) {
    p.animT += dt;
    if (!p.alive) {
      p.respawnT -= dt;
      p.updateKO(dt);
      if (p.respawnT <= 0) this.respawn(p);
      return;
    }
    p.tickTimers(dt);
    // 長く止められたら旗を落とす（ホストの端末で動いている人と同じきまり）
    if (p.carry.flag && p.stunT > 0.3 && this.mode.dropFlag) this.mode.dropFlag(p);
    const s = p.netIn;
    const prev = p.state;
    if (s && s.life === p.life && s.alive) {
      const age = Math.min(0.25, Math.max(0, nowS() - s.at));
      _v.copy(s.pos).addScaledVector(s.vel, age);
      if (p.pos.distanceTo(_v) > 8) p.pos.copy(_v);
      else p.pos.lerp(_v, 1 - Math.exp(-18 * dt));
      p.vel.copy(s.vel);
      p.yaw = angleDamp(p.yaw, s.yaw, 30, dt);
      p.pitch = damp(p.pitch, s.pitch, 30, dt);
      p.roll = s.roll;
      if (p.hostState && p.hostState.until > this.time) p.state = p.hostState.state;
      else p.state = s.state;
      p.stateT = s.stateT;
      p.atk.phase = s.atkPhase;
      p.atk.side = s.atkSide;
      p.atk.heavy = s.atkHeavy;
      p.atk.shotNow = s.atkShot;
      p.turnVis = s.turnVis;
      p.ground = s.ground;
      if (s.just) p.justT = Math.max(p.justT, 0.06);
      if (s.inv) p.invuln = Math.max(p.invuln, 0.06);
      p.depositHeld = s.dep;
      const L = s.lock >= 0 ? this.punchers[s.lock] : null;
      p.lock = L && L.team !== p.team && L.alive ? L : null;
    } else {
      p.vel.multiplyScalar(Math.exp(-3 * dt));
      p.pos.addScaledVector(p.vel, dt);
    }
    // ディスクの溜め → 発動（効き目はホストで計算）
    if (p.charge) {
      p.charge.t -= dt;
      if (p.charge.t <= 0) {
        const c = p.charge;
        p.charge = null;
        this.origin = p.netId;
        try {
          this.skills.fireOmamori(p, c.id, c.slot);
        } finally {
          this.origin = -1;
        }
      }
    }
    p.addSP((p.vel.length() * dt) / 900);
    p.updateAxes();
    p.animate(dt);
    stateSound(this, p, prev);
  }

  update(dtReal) {
    if (this.phase === 'wait') {
      this.phaseT += dtReal;
      // 全員の準備ができたら（または時間切れで）始める
      const humans = this.punchers.filter((p) => p.remote).map((p) => p.peer);
      const allReady = humans.every((id) => this.ready.has(id) || !this.room.peers.has(id));
      if (allReady || this.phaseT > READY_WAIT) {
        this.phase = 'intro';
        this.phaseT = 0;
        this.room.broadcast({ t: 'go' });
      }
      for (const p of this.punchers) p.animate(dtReal);
      for (const g of this.guardians) g.update(dtReal, this.phaseT);
      this.cam.distScale = 7;
      this.cam.height = 17.45;
      this.cam.update(this.player, dtReal, { snap: true });
      this.fx.update(dtReal, this.camera);
      this.stage.update(dtReal, 0, this.camera.position);
      this.hud.update(dtReal, this.camera);
      this.sendSnap(dtReal);
      return;
    }
    super.update(dtReal);
    this.flushEvents();
    this.sendSnap(dtReal);
  }
  flushEvents() {
    if (!this.evq.length) return;
    this.room.broadcast({ t: 'ev', l: this.evq });
    this.evq = [];
  }
  finish(reason) {
    const before = this.phase;
    super.finish(reason);
    if (before === 'play' && this.phase === 'finish') {
      this.flushEvents();
      this.room.broadcast({ t: 'fin', reason: reason || '' });
    }
  }
  toResult() {
    if (this.phase === 'result') return;
    const r = this.result;
    this.room.broadcast({
      t: 'res',
      r: { winner: r.winner, scores: r.scores, unit: r.unit, reason: r.reason || '' },
      st: this.punchers.map((p) => ({ ...p.stats, n: p.displayName })),
    });
    super.toResult();
  }

  // ===== 状態を送る =====
  sendSnap(dt) {
    this.snapAcc += dt;
    if (this.snapAcc < 1 / SNAP_HZ) return;
    this.snapAcc = Math.min(this.snapAcc - 1 / SNAP_HZ, 0.1);
    if (!this.room.peers.size) return;
    const w = this.snapW.reset();
    w.u8(MSG_SNAP);
    w.u16((this.seq = (this.seq + 1) & 0xffff));
    w.f32(nowS() - this.t0);
    w.u8(Math.max(0, PHASES.indexOf(this.phase)));
    w.f32(this.timeLeft);
    w.u8((this.overtime ? 1 : 0) | (this.hurried ? 2 : 0));
    w.u8(this.punchers.length);
    for (const p of this.punchers) writePuncher(w, p, this);
    this.mode.netWrite(w);
    // 飛び道具
    const pr = this.combat.projectiles;
    const np = Math.min(60, pr.length);
    w.u8(np);
    for (let i = 0; i < np; i++) {
      const o = pr[i];
      w.u16(o.nid || 0);
      const ki = PROJ_KINDS.indexOf(o.kind);
      w.u8(ki < 0 ? PROJ_KINDS.length - 1 : ki);
      // 1バイトに「チーム（下1ビット）」と「撃った人の番号＋1（上のビット。0＝人ではない）」を入れる
      const team = (o.owner && o.owner.team != null ? o.owner.team : o.team || 0) & 1;
      const own = o.owner && o.owner.netId != null && !o.owner.isGuardian ? o.owner.netId + 1 : 0;
      w.u8(team | (own << 1));
      w.vec(o.pos);
      w.vel(o.vel, 20);
    }
    const ar = this.combat.areas;
    const na = Math.min(30, ar.length);
    w.u8(na);
    for (let i = 0; i < na; i++) {
      const a = ar[i];
      w.u16(a.nid || 0);
      const ak = AREA_KINDS.indexOf(a.kind);
      w.u8(ak < 0 ? 1 : ak);
      w.u8(a.team || 0);
      w.vec(a.pos);
      w.u8(a.r * 10);
    }
    this.room.broadcastBin(w.done());
  }

  dispose() {
    this.room.binHandler = null;
    super.dispose();
  }
}

function writePuncher(w, p, M) {
  const B = p.buffs;
  const st = p.alive ? p.state : 'ko';
  let f1 = 0;
  if (p.alive) f1 |= 1;
  if (p.ground) f1 |= 2;
  if (p.invuln > 0) f1 |= 4;
  if (p.hurtT > 0) f1 |= 8;
  if (p.atk.side) f1 |= 16;
  if (p.atk.heavy) f1 |= 32;
  if (p.friend) f1 |= 64;
  if (p.atk.shotNow && p.atk.phase >= 0) f1 |= 128; // v1.7：近接のキャラが遠くへ撃っている（撃つ動きで見せる）
  w.u8(f1);
  w.u8(stateNo(st));
  w.u8(p.life || 0);
  w.vec(p.pos);
  w.vel(p.vel);
  w.ang(p.yaw);
  w.ang(p.pitch);
  w.ang(p.roll);
  w.i8(p.turnVis * 100);
  w.u8(p.atk.phase < 0 ? 255 : Math.min(254, p.atk.phase * 254));
  w.u16(Math.max(0, p.hp));
  w.u8(p.sp * 255);
  w.u8(Math.max(0, ELEMS.indexOf(p.elem)));
  w.u8(Math.min(255, p.carry.sakura.length));
  let b = 0;
  if (B.big > 0) b |= 1;
  if (B.ikemen > 0) b |= 2;
  if (B.atkT > 0) b |= 4;
  if (B.shield > 0) b |= 8;
  if (B.spdT > 0) b |= 16;
  if (B.slowT > 0) b |= 32;
  if (B.regenT > 0) b |= 64;
  w.u8(b);
  // v1.5：状態のしるし・技の速さ・酔い
  w.u16(p.status || 0);
  w.i8((p.modSpd || 0) * 100);
  w.u8(Math.max(0, p.drunkT || 0) * 20);
  w.u8(Math.max(0, B.big) * 10);
  w.u8(B.spdT > 0 ? B.spd * 100 : 0);
  w.u8(B.spdT * 10);
  w.u8(B.slowT > 0 ? B.slow * 100 : 0);
  w.u8(B.slowT * 20);
  w.u8(Math.max(0, p.stunT) * 20);
  w.u8(Math.max(0, p.respawnT) * 10);
  w.i8(p.lock && !p.lock.isGuardian && p.lock.netId != null ? p.lock.netId : -1);
  w.i8(p.killedBy && p.killedBy.netId != null ? p.killedBy.netId : -1);
  w.u8(p.charge ? omIndex(p.charge.id) : 255);
  const S = p.stats;
  w.u16(Math.max(0, S.score));
  w.u8(S.ko);
  w.u8(S.down);
  w.u8(S.pick);
  w.u16(S.dmg / 10);
  w.u8(S.assist);
}

function readPuncher(r) {
  const o = {};
  const f1 = r.u8();
  o.alive = !!(f1 & 1);
  o.ground = !!(f1 & 2);
  o.inv = !!(f1 & 4);
  o.hurt = !!(f1 & 8);
  o.atkSide = f1 & 16 ? 1 : 0;
  o.atkHeavy = !!(f1 & 32);
  o.friend = !!(f1 & 64);
  o.atkShot = !!(f1 & 128);
  o.state = STATES[r.u8()] || 'hover';
  o.life = r.u8();
  o.pos = r.vec(new THREE.Vector3());
  o.vel = r.vel(new THREE.Vector3());
  o.yaw = r.ang();
  o.pitch = r.ang();
  o.roll = r.ang();
  o.turnVis = r.i8() / 100;
  const ap = r.u8();
  o.atkPhase = ap === 255 ? -1 : ap / 254;
  o.hp = r.u16();
  o.sp = r.u8() / 255;
  o.elem = ELEMS[r.u8()] || 'fire';
  o.sakura = r.u8();
  o.bb = r.u8();
  o.status = r.u16();
  o.modSpd = r.i8() / 100;
  o.drunkT = r.u8() / 20;
  o.big = r.u8() / 10;
  o.spd = r.u8() / 100;
  o.spdT = r.u8() / 10;
  o.slow = r.u8() / 100;
  o.slowT = r.u8() / 20;
  o.stunT = r.u8() / 20;
  o.respawnT = r.u8() / 10;
  o.lock = r.i8();
  o.killedBy = r.i8();
  o.charge = omFromIndex(r.u8());
  o.score = r.u16();
  o.ko = r.u8();
  o.down = r.u8();
  o.pick = r.u8();
  o.dmg = r.u16() * 10;
  o.assist = r.u8();
  return o;
}

// ===== 入った人の端末 =====
class ClientCombat extends Combat {
  meleeHit(p, t, idx) {
    if (p === this.match.player) this.match.act({ a: 'mh', r: refOf(t), i: idx });
  }
  bigSplash() {}
  dashHit(p, t) {
    if (p === this.match.player) this.match.act({ a: 'dh', r: refOf(t) });
  }
  shoot(p, t) {
    if (p !== this.match.player) return;
    this.match.act({ a: 'sh', r: refOf(t), i: p.atk.hitIdx || 0 });
    this.match.sfx('shot', p);
  }
  // てつんどの遠くへの弾（k:1）
  shootAlt(p, t, i) {
    if (p !== this.match.player) return;
    this.match.act({ a: 'sh', r: refOf(t), i: i || 0, k: 1 });
    this.match.sfx('shot', p);
  }
  damage() {
    return 0;
  }
  justDodge() {}
  explode() {}
  spawnProjectile(o) {
    return o;
  }
  addArea(o) {
    return o;
  }
  update() {}
}

class ClientSkills extends Skills {
  useKS(p) {
    const M = this.match;
    if (p !== M.player) return false;
    const id = p.def.skill.id;
    // トリキの三大欲求は、どれを出すかもいっしょに送る（ホストと順番がずれないように）
    M.act(id === 'desires' ? { a: 'ks', d: (p.desireIdx || 0) % 3 } : { a: 'ks' });
    if (id === 'tigerRush') {
      const t = this.aimDir(p, _v);
      p.state = 'skill';
      p.stateT = 0;
      this.active.push({ p, kind: 'rush', t: 0, dur: 0.55, dir: _v.clone(), target: t, hits: new Map(), count: 0 });
    } else if (id === 'goggleDive') {
      this.aimDir(p, _v);
      p.state = 'skill';
      p.stateT = 0;
      p.invuln = Math.max(p.invuln, 0.3);
      this.active.push({ p, kind: 'dive', t: 0, dur: 0.5, dir: _v.clone(), hit: new Set() });
    } else if (clientKit(this, p)) {
      // v1.5 の仲間：動く技だけ自分の端末ですぐに動かす（チャリはすぐ見せる）
      if (id === 'bikeDash') M.fx.bike && M.fx.bike(p, 1.05);
    }
    return true;
  }
  useSpecial(p) {
    if (p === this.match.player) this.match.act({ a: 'sp' });
  }
  fireSpecial(p) {
    p.state = 'hover';
    p.stateT = 0;
    if (p === this.match.player) clientSpecial(this, p);
  }
  endBig() {}
  endIkemen() {}
  // 動きにかかわるディスクだけ、自分の端末ですぐに動かす（効き目はホストが計算）
  fireOmamori(p, id) {
    const M = this.match;
    if (p !== M.player || !p.alive) return;
    M.fx.summonAct && M.fx.summonAct(p, id);
    if (id === 'warp') {
      _v.copy(p.forward);
      const d = M.world.raycast(p.pos, _v, 17);
      p.pos.addScaledVector(_v, Math.max(0, Math.min(16, d - 1.5)));
      p.invuln = Math.max(p.invuln, 0.35);
    } else if (id === 'homewarp') {
      const b = M.stage.bases[p.team];
      p.pos.copy(b.respawn[p.slot % b.respawn.length]);
      p.vel.set(0, 0, 0);
      p.yaw = b.faceYaw;
      p.invuln = Math.max(p.invuln, 0.6);
      p.lock = null;
      M.cam.first = true;
    } else if (id === 'jet') {
      p.state = 'skill';
      p.stateT = 0;
      p.invuln = Math.max(p.invuln, 0.6);
      this.active.push({ p, kind: 'jet', t: 0, dur: 0.6, dir: p.forward.clone() });
    } else if (id === 'fuwa') {
      p.boost = 6;
      p.invuln = Math.max(p.invuln, 1.2);
    } else if (id === 'coffee') {
      p.boost = Math.min(6, p.boost + 2);
    } else if (id === 'screw') {
      p.state = 'skill';
      p.stateT = 0;
      p.invuln = Math.max(p.invuln, 0.5);
      this.active.push({ p, kind: 'screw', t: 0, dur: 0.6, hit: new Set(), local: true });
    } else if (id === 'book') {
      p.state = 'skill';
      p.stateT = 0;
      p.invuln = Math.max(p.invuln, 0.3);
      this.aimDir(p, _v);
      this.active.push({ p, kind: 'book', t: 0, dur: 0.55, dir: _v.clone(), hit: new Set(), local: true });
    }
  }
}

export class ClientMatch extends Match {
  constructor(app, opts, room) {
    super(app, { ...opts, noBrains: true, netClient: true, online: true, room });
    this.room = room;
    this.online = true;
    this.netClient = true;
    this.phase = 'wait';
    this.phaseT = 0;
    this.input.enabled = false;
    this.combat = new ClientCombat(this);
    this.skills = new ClientSkills(this);
    if (this.mode.dropFlag) this.mode.dropFlag = () => {}; // 旗を落とすのはホストが決める
    this.snaps = [];
    this.off = null;
    this.lastSnapAt = nowS();
    this.meW = new Writer(96);
    this.meAcc = 0;
    this.seq = 0;
    this.projs = new Map();
    this.areasR = new Map();
    this.waitEl = null;
    const P = this.player;
    // 自分の操作のうち、ホストにも知らせるもの
    const om0 = P.useOmamori.bind(P);
    P.useOmamori = (i) => {
      const ok = om0(i);
      if (ok) this.act({ a: 'om', s: i });
      return ok;
    };
    const el0 = P.switchElem.bind(P);
    P.switchElem = (i) => {
      const ok = el0(i);
      if (ok) this.act({ a: 'el', s: i });
      return ok;
    };
    room.binHandler = (from, buf) => this.onBin(buf);
    room.send({ t: 'ready' });
  }
  act(o) {
    this.room.send({ t: 'act', ...o });
  }
  sendStamp(i) {
    const now = nowS();
    if (now - (this._stampAt || 0) < 1.2) return;
    this._stampAt = now;
    this.showStamp(this.player, i);
    this.room.send({ t: 'stamp', i });
  }
  sfxLocal(name, src) {
    super.sfx(name, src);
  }

  // ===== 受けとる =====
  onMsg(from, o) {
    if (o.t === 'go') {
      this.phase = 'intro';
      this.phaseT = 0;
      return;
    }
    if (o.t === 'ev') return this.onEvents(o.l || []);
    if (o.t === 'hit') return this.applyHit(o);
    if (o.t === 'spc') return this.startSpecial();
    if (o.t === 'fin') {
      if (this.phase === 'play' || this.phase === 'intro') {
        this.phase = 'finish';
        this.phaseT = 0;
        this.input.enabled = false;
        this.input.reset();
        sound.play('whistle');
        this.app.bigText(o.reason && o.reason.includes('ノックアウト') ? 'KNOCK OUT!' : 'FINISH!', 'finish');
      }
      return;
    }
    if (o.t === 'res') return this.showRes(o);
    if (o.t === 'stamp') {
      const p = this.punchers[o.p];
      if (p && p !== this.player) this.showStamp(p, o.i | 0);
    }
  }
  onEvents(list) {
    const me = this.player.netId;
    for (const e of list) {
      if (!Array.isArray(e) || typeof e[0] !== 'string') continue;
      const name = e[0], origin = e[1];
      const key = name === 'sfx' ? 'sfx:' + e[2] : name;
      if (origin === me && SELF_SKIP.has(key)) continue;
      if (name === 'sfx' && PERSONAL_SFX.has(e[2])) continue;
      let args;
      try {
        args = e.slice(2).map((a) => deser(a, this));
      } catch (err) {
        continue;
      }
      try {
        if (name.startsWith('fx.')) {
          const k = name.slice(3);
          if (!FX_REC.has(k)) continue;
          const f = this.fx[k];
          if (typeof f === 'function') f.apply(this.fx, args);
          if (k === 'hit' && args[0] && args[0].isGuardian) args[0].shakeT = 0.3;
        } else if (REPLAY.has(name)) {
          if (name === 'koFeedback' && args[0] === this.player) this.localDie(args[1]);
          // 自分の復活：状態が先に届いて、もう生き返っていたら何もしない（二重に数えない）
          if (name === 'respawnFeedback' && args[0] && (args[0] !== this.player || !this.player.alive)) this.localRespawn(args[0]);
          this[name](...args);
        }
      } catch (err) {}
    }
  }
  applyHit(h) {
    const P = this.player;
    if (!P.alive) return;
    if (h.vs) P.vel.set(h.vs[0], h.vs[1], h.vs[2]);
    if (h.k) P.vel.add(_v.set(h.k[0], h.k[1], h.k[2]));
    if (h.s) {
      P.stunT = Math.max(P.stunT, h.s);
      P.dash = null;
      if (P.state === 'dash' || P.state === 'cruise' || P.state === 'fly') P.state = 'hover';
    }
    if (h.h) P.hurtT = Math.max(P.hurtT, h.h);
    if (h.cc && P.charge) {
      P.omCd[P.charge.slot] = h.cc.cd != null ? h.cc.cd : P.omCd[P.charge.slot];
      P.charge = null;
    }
    if (h.ul) P.lock = null;
    // 欠席スタンプ：しばらくディスクが使えない
    if (h.dl) {
      P.diskLock = Math.max(P.diskLock, +h.dl || 0);
      P.charge = null;
    }
    if (h.ap) {
      P.atk.phase = -1;
      P.atk.pending = null;
    }
  }
  startSpecial() {
    const P = this.player;
    if (!P.alive) return;
    P.state = 'special';
    P.stateT = 0;
    P.invuln = Math.max(P.invuln, 1.3);
    P.vel.multiplyScalar(0.2);
    P.charge = null;
    this.skills.active.push({ p: P, kind: 'special', t: 0, dur: 1.05 });
  }
  localDie(killer) {
    const P = this.player;
    if (!P.alive) return;
    P.alive = false;
    P.respawnT = RESPAWN_TIME;
    P.killedBy = killer && killer.def ? killer : null;
    P.lock = null;
    P.charge = null;
    P.state = 'ko';
    P.vel.multiplyScalar(0.4);
    P.vel.y += 6;
    P.carry.sakura = [];
    P.carry.balls = [];
    P.carry.flag = null;
    this.skills.active = this.skills.active.filter((a) => a.p !== P);
  }
  // 復活の場所は決まっているので、自分の端末でも同じ所に出す
  localRespawn(p) {
    const b = this.stage.bases[p.team];
    const sp = b.respawn[p.slot % b.respawn.length];
    if (p === this.player) {
      p.spawnAt(sp, b.faceYaw);
      p.buffs = { atk: 0, atkT: 0, spd: 0, spdT: 0, shield: 0, shieldT: 0, slowT: 0, slow: 0, regen: 0, regenT: 0, big: 0, ikemen: 0 };
      if (p.model.userData.glasses) p.model.userData.glasses.visible = true;
      p.model.rotation.set(0, p.yaw, 0);
      p.killedBy = null;
      p.life = ((p.life || 0) + 1) & 255;
    } else p.pos.copy(sp);
  }
  respawn() {}
  ko() {}
  finish() {}

  onBin(buf) {
    let r;
    try {
      r = new Reader(buf);
      if (r.u8() !== MSG_SNAP) return;
    } catch (e) {
      return;
    }
    try {
      const snap = { seq: r.u16(), ht: r.f32() };
      if (this.lastSeq != null && ((snap.seq - this.lastSeq) & 0xffff) > 0x8000) return; // 古い
      this.lastSeq = snap.seq;
      const ph = PHASES[r.u8()] || 'play';
      const tl = r.f32();
      const fl = r.u8();
      const n = r.u8();
      snap.p = [];
      for (let i = 0; i < n; i++) snap.p.push(readPuncher(r));
      this.mode.netRead(r);
      const np = r.u8();
      snap.pr = [];
      for (let i = 0; i < np; i++) {
        const id = r.u16(), kind = PROJ_KINDS[r.u8()] || 'other', tb = r.u8();
        snap.pr.push({ id, kind, team: tb & 1, owner: (tb >> 1) - 1, pos: r.vec(new THREE.Vector3()), vel: r.vel(new THREE.Vector3(), 20) });
      }
      const na = r.u8();
      snap.ar = [];
      for (let i = 0; i < na; i++) snap.ar.push({ id: r.u16(), kind: AREA_KINDS[r.u8()] || 'field', team: r.u8(), pos: r.vec(new THREE.Vector3()), r: r.u8() / 10 });
      // 時計あわせ：いちばん早く届いたものに合わせる（ゆっくり新しい値にも寄せる）
      const now = nowS();
      const off = snap.ht - now;
      if (this.off == null || off > this.off) this.off = off;
      else this.off += (off - this.off) * 0.01;
      snap.at = now;
      this.lastSnapAt = now;
      this.snaps.push(snap);
      if (this.snaps.length > 30) this.snaps.shift();
      // すぐ反映するもの
      this.timeLeft = tl;
      this.overtime = !!(fl & 1);
      if (ph === 'play' && this.phase === 'wait') {
        this.phase = 'play';
        this.input.enabled = true;
      }
      this.applyOwn(snap.p[this.player.netId]);
      this.syncProjs(snap);
      this.syncAreas(snap);
    } catch (e) {}
  }
  // 自分のキャラのうち、ホストが決めるもの（HP・ゲージ・バフ・持ち物・記録）
  applyOwn(o) {
    const P = this.player;
    if (!o) return;
    P.hp = o.hp;
    const before = P.sp;
    P.sp = o.sp > 0.996 ? 1 : o.sp;
    if (before < 1 && P.sp >= 1) sound.play('spReady');
    if (P.carry.sakura.length !== o.sakura) P.carry.sakura = new Array(o.sakura).fill(null);
    const B = P.buffs;
    B.big = o.bb & 1 ? o.big : 0;
    B.ikemen = o.bb & 2 ? 1 : 0;
    B.atkT = o.bb & 4 ? 1 : 0;
    B.atk = B.atkT ? 0.35 : 0;
    B.shield = o.bb & 8 ? 1 : 0;
    B.shieldT = B.shield ? 1 : 0;
    B.spd = o.spd;
    B.spdT = o.bb & 16 ? o.spdT : 0;
    B.slow = o.slow;
    B.slowT = o.bb & 32 ? o.slowT : 0;
    B.regenT = o.bb & 64 ? 1 : 0;
    P.status = o.status;
    P.modSpd = o.modSpd;
    P.drunkT = o.drunkT;
    if (P.model.userData.glasses) P.model.userData.glasses.visible = !B.ikemen;
    const S = P.stats;
    S.score = o.score;
    S.ko = o.ko;
    S.down = o.down;
    S.pick = o.pick;
    S.dmg = o.dmg;
    S.assist = o.assist;
    if (!P.alive) {
      P.respawnT = o.respawnT;
      // 復活の知らせが来ないまま生き返っていたら（念のため）
      if (o.alive && o.life !== P.life) {
        this.localRespawn(P);
        P.life = o.life;
      }
    } else if (!o.alive && o.life === P.life) {
      // 倒された知らせより先に状態が届いた
      if (!this._dieWait) this._dieWait = nowS();
      else if (nowS() - this._dieWait > 0.6) {
        this.localDie(this.punchers[o.killedBy] || null);
        this._dieWait = 0;
      }
    } else this._dieWait = 0;
  }
  syncProjs(snap) {
    const seen = new Set();
    for (const o of snap.pr) {
      seen.add(o.id);
      let q = this.projs.get(o.id);
      if (!q) {
        const mesh = this.fx.projectileMesh({ kind: o.kind, owner: { team: o.team }, team: o.team, pos: o.pos });
        // t0：はじめて見えた時刻。ほかの人は少し前の姿で表示しているので、その人の弾は、その時刻になるまで見せない
        // 自分の弾（mine）は、自分と同じ「いま」の時刻で表示する（すぐ見える）
        q = { mesh, pos: o.pos.clone(), vel: o.vel.clone(), ht: snap.ht, t0: snap.ht, mine: o.owner === this.player.netId, spin: o.kind === 'tangocho' || o.kind === 'beat' ? 18 : o.kind === 'cookie' ? 9 : 0 };
        if (mesh) mesh.visible = q.mine;
        this.projs.set(o.id, q);
      }
      q.netPos = o.pos;
      q.vel.copy(o.vel);
      q.ht = snap.ht;
    }
    for (const [id, q] of this.projs) {
      if (seen.has(id)) continue;
      if (q.mesh && q.mesh.parent) q.mesh.parent.remove(q.mesh);
      this.projs.delete(id);
    }
  }
  syncAreas(snap) {
    const seen = new Set();
    for (const a of snap.ar) {
      seen.add(a.id);
      if (this.areasR.has(a.id)) continue;
      const mesh = this.fx.areaMesh({ kind: a.kind, team: a.team, pos: a.pos, r: a.r });
      this.areasR.set(a.id, { mesh });
    }
    for (const [id, a] of this.areasR) {
      if (seen.has(id)) continue;
      // その場で作った形（結界の円など）は GPU からも消す
      this.fx.disposeArea(a.mesh);
      this.areasR.delete(id);
    }
  }

  // ほかの人を、少し前の時刻の位置で表示する（2つの状態のあいだをなめらかにつなぐ）
  applyReplicas(dt, anim) {
    const S = this.snaps;
    if (!S.length || this.off == null) return;
    const rt = nowS() + this.off - INTERP;
    let a = S[0], b = S[0];
    for (let i = S.length - 1; i >= 0; i--) {
      if (S[i].ht <= rt) {
        a = S[i];
        b = S[i + 1] || S[i];
        break;
      }
    }
    const span = b.ht - a.ht;
    const k = span > 1e-4 ? clamp((rt - a.ht) / span, 0, 1) : 0;
    const extra = b === a ? clamp(rt - a.ht, 0, 0.2) : 0;
    const me = this.player;
    for (let i = 0; i < this.punchers.length; i++) {
      const p = this.punchers[i];
      if (p === me) continue;
      const A = a.p[i], B = b.p[i];
      if (!A || !B) continue;
      const prevState = p.state;
      const jump = A.life !== B.life || A.pos.distanceTo(B.pos) > 12;
      if (jump) p.pos.copy(B.pos);
      else p.pos.lerpVectors(A.pos, B.pos, k);
      if (extra > 0 && B.alive) p.pos.addScaledVector(B.vel, extra);
      p.vel.copy(B.vel);
      p.yaw = jump ? B.yaw : A.yaw + wrapAngle(B.yaw - A.yaw) * k;
      p.pitch = lerp(A.pitch, B.pitch, k);
      p.roll = B.roll;
      p.turnVis = lerp(A.turnVis, B.turnVis, k);
      p.ground = B.ground;
      p.state = B.state;
      p.atk.phase = A.atkPhase >= 0 && B.atkPhase >= A.atkPhase ? lerp(A.atkPhase, B.atkPhase, k) : B.atkPhase;
      p.atk.side = B.atkSide;
      p.atk.heavy = B.atkHeavy;
      p.atk.shotNow = B.atkShot;
      p.invuln = B.inv ? 0.5 : 0;
      p.stunT = B.stunT;
      p.hurtT = B.hurt ? 0.1 : 0;
      p.hp = B.hp;
      p.sp = B.sp > 0.996 ? 1 : B.sp;
      p.elem = B.elem;
      p.life = B.life;
      if (p.carry.sakura.length !== B.sakura) p.carry.sakura = new Array(B.sakura).fill(null);
      const bf = p.buffs;
      bf.big = B.bb & 1 ? B.big : 0;
      bf.ikemen = B.bb & 2 ? 1 : 0;
      bf.atkT = B.bb & 4 ? 1 : 0;
      bf.shield = B.bb & 8 ? 1 : 0;
      bf.spdT = B.bb & 16 ? 1 : 0;
      bf.slowT = B.bb & 32 ? 1 : 0;
      p.status = B.status;
      p.drunkT = B.drunkT;
      if (p.model.userData.glasses) p.model.userData.glasses.visible = !bf.ikemen;
      p.charge = B.charge ? { id: B.charge } : null;
      const L = B.lock >= 0 ? this.punchers[B.lock] : null;
      p.lock = L || null;
      p.killedBy = B.killedBy >= 0 ? this.punchers[B.killedBy] || null : null;
      p.respawnT = B.respawnT;
      const st = p.stats;
      st.score = B.score;
      st.ko = B.ko;
      st.down = B.down;
      st.pick = B.pick;
      st.dmg = B.dmg;
      st.assist = B.assist;
      if (B.alive && !p.alive) {
        p.alive = true;
        p.model.visible = true;
        p.model.scale.setScalar(1);
        p.model.rotation.set(0, p.yaw, 0);
      } else if (!B.alive && p.alive) {
        p.alive = false;
        p.state = 'ko';
      }
      p.updateAxes();
      if (!anim) continue;
      if (p.alive) {
        p.animT += dt;
        p.animate(dt);
        // ホストが動かしている人（CPU・ホスト本人）の音は、ホストから届く
        if (p.human && p.peer !== this.room.hostId) stateSound(this, p, prevState);
      } else this.replicaKO(p, dt);
    }
  }
  replicaKO(p, dt) {
    p.animT += dt;
    const m = p.model;
    m.position.copy(p.pos);
    m.rotation.x += dt * 4;
    m.rotation.z += dt * 2.5;
    const k = clamp(1 - (RESPAWN_TIME - p.respawnT) / 1.2, 0, 1);
    m.scale.setScalar(Math.max(0.01, k));
    m.visible = k > 0.02;
  }
  updateProjs(dt) {
    const now = nowS() + (this.off || 0);
    for (const q of this.projs.values()) {
      if (!q.netPos) continue;
      const at = q.mine ? now : now - INTERP;
      const age = clamp(at - q.ht, -0.3, 0.3);
      q.pos.copy(q.netPos).addScaledVector(q.vel, age);
      if (q.mesh) {
        // 出た時刻より前は見せない（口よりうしろに逆もどりして見えないように）
        q.mesh.visible = q.mine || at >= q.t0;
        q.mesh.position.copy(q.pos);
        if (q.spin) q.mesh.rotation.y += q.spin * dt;
        else if (q.vel.lengthSq() > 0.01) q.mesh.lookAt(_v.copy(q.pos).add(q.vel));
      }
    }
  }

  // 自分の位置を送る
  sendMe(dt) {
    this.meAcc += dt;
    if (this.meAcc < 1 / ME_HZ) return;
    this.meAcc = Math.min(this.meAcc - 1 / ME_HZ, 0.1);
    const P = this.player;
    const w = this.meW.reset();
    w.u8(MSG_ME);
    w.u16((this.seq = (this.seq + 1) & 0xffff));
    w.u8(P.life || 0);
    w.vec(P.pos);
    w.vel(P.vel);
    w.ang(P.yaw);
    w.ang(P.pitch);
    w.ang(P.roll);
    w.u8(stateNo(P.alive ? P.state : 'ko'));
    let f = 0;
    if (P.ground) f |= 1;
    if (P.justT > 0 && (P.state === 'step' || P.state === 'roll')) f |= 2;
    if (P.invuln > 0) f |= 4;
    if (P.depositHeld) f |= 8;
    if (P.atk.side) f |= 16;
    if (P.atk.heavy) f |= 32;
    if (P.alive) f |= 64;
    if (P.atk.shotNow && P.atk.phase >= 0) f |= 128;
    w.u8(f);
    w.u8(P.atk.phase < 0 ? 255 : Math.min(254, P.atk.phase * 254));
    w.i8(P.turnVis * 100);
    w.i8(P.lock && !P.lock.isGuardian && P.lock.netId != null ? P.lock.netId : -1);
    w.u8(Math.min(255, P.stateT * 50));
    this.room.sendBin(w.done());
  }

  update(dtReal) {
    let dt = Math.min(dtReal, 1 / 20);
    if (this.hitStopT > 0) {
      this.hitStopT -= dtReal;
      dt *= 0.08;
    } else if (this.slowT > 0) {
      this.slowT -= dtReal;
      dt *= this.slowScale;
    }
    this.phaseT += dtReal;
    const P = this.player;
    // ホストからしばらく何も来ない
    const silent = nowS() - this.lastSnapAt;
    this.showWait(silent > 2.5 && this.phase !== 'result' ? 'ホストの画面が止まっています…' : null);
    this.applyReplicas(dtReal, this.phase === 'play' || this.phase === 'finish');
    if (this.phase === 'wait') {
      for (const p of this.punchers) p.animate(dtReal);
      for (const g of this.guardians) g.update(dtReal, this.phaseT);
      this.cam.distScale = 7;
      this.cam.height = 17.45;
      this.cam.update(P, dtReal, { snap: true });
    } else if (this.phase === 'intro') {
      this.updateIntro(dtReal);
    } else if (this.phase === 'play' || this.phase === 'finish') {
      if (this.phase === 'play') {
        this.time += dt;
        this.timerCues();
        this.input.sample();
        const I = P.intent;
        I.hold = this.input.hold;
        I.stickX = this.input.stickX;
        I.stickY = this.input.stickY;
        I.lookX = this.input.lookX;
        I.lookY = this.input.lookY;
        I.lookActive = this.input.looking();
        for (const e of this.input.events) I.events.push((e.look && e.type === 'tap' && this.tapLock(e)) || e);
        this.input.events.length = 0;
      } else {
        P.intent.hold = false;
        P.intent.stickX = P.intent.stickY = 0;
        P.intent.lookX = P.intent.lookY = 0;
        P.intent.lookActive = false;
        P.intent.events.length = 0;
        if (this.phaseT > 6 && !this._resWait) {
          // 結果が届かない
          this._resWait = true;
          this.app.toast('結果を待っています…');
        }
      }
      P.update(dt);
      this.skills.update(dt);
      this.mode.netVisual(dt, this.time);
      for (const g of this.guardians) g.update(dt, this.time);
      this.updateProjs(dt);
      this.cam.update(P.alive ? P : this.killCamTarget(P), dt);
      this.sendMe(dtReal);
    }
    this.fx.update(dt, this.camera);
    this.shadows.update(this.punchers);
    // 足もとの光：ダイブ中のほかの人
    for (const p of this.punchers) {
      if (!p.alive || p.state !== 'skill' || Math.random() > 0.6) continue;
      const c = TRAIL_COLOR[p.def.skill.id];
      if (c && (p !== P || p.def.skill.id !== 'goggleDive')) this.fx.trail(p, c);
    }
    this.stage.update(dt, this.time, this.camera.position);
    if (this.phase !== 'result') this.hud.update(dt, this.camera);
  }
  showWait(text) {
    if (!text) {
      if (this.waitEl) {
        this.waitEl.remove();
        this.waitEl = null;
      }
      return;
    }
    if (!this.waitEl) {
      this.waitEl = document.createElement('div');
      this.waitEl.className = 'netwait';
      this.app.hudRoot.appendChild(this.waitEl);
    }
    if (this.waitEl.textContent !== text) this.waitEl.textContent = text;
  }
  // 試合の結果（ホストが計算したもの）
  showRes(o) {
    if (this.phase === 'result') return;
    const st = o.st || [];
    this.punchers.forEach((p, i) => {
      if (st[i]) Object.assign(p.stats, st[i]);
    });
    const r = o.r || { winner: -1, scores: [0, 0], unit: '' };
    this.result = r;
    this.phase = 'result';
    const myTeam = this.player.team;
    const win = r.winner === myTeam ? 1 : r.winner < 0 ? 0 : -1;
    const mvp = [0, 1].map((t) => {
      let best = null;
      for (const p of this.punchers) if (p.team === t && (!best || p.stats.score > best.stats.score)) best = p;
      return best;
    });
    this.app.showResult({ win, mode: this.opts.mode, scores: r.scores, unit: r.unit, reason: r.reason, mvp, me: this.player, punchers: this.punchers, char: this.opts.char, online: true });
  }
  dispose() {
    this.showWait(null);
    for (const q of this.projs.values()) if (q.mesh && q.mesh.parent) q.mesh.parent.remove(q.mesh);
    for (const a of this.areasR.values()) this.fx.disposeArea(a.mesh);
    this.areasR.clear();
    this.projs.clear();
    this.room.binHandler = null;
    super.dispose();
  }
}
