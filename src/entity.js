// パンチャー1人ぶん（プレイヤーもCPUも同じしくみで動く）
import * as THREE from 'three';
import { MOVE, COMBAT, RESPAWN_TIME, RESPAWN_INVULN, ELEM } from './config.js';
import { OMAMORI } from './characters.js';
import { statusOf } from './kits.js';
import { buildPuncher, poseModel, setJetGlow, FACES } from './model.js';
import { clamp, damp, angleDamp, wrapAngle, lerp } from './util.js';
import { makeHitInfo } from './physics.js';

const UP = new THREE.Vector3(0, 1, 0);
const _down = new THREE.Vector3(0, -1, 0);
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();

export const BOOST_SEGS = 6;
export const SP_SEGS = 6;

export class Puncher {
  constructor(match, def, team, slot, isPlayer) {
    this.match = match;
    this.def = def;
    this.team = team;
    this.slot = slot;
    this.isPlayer = isPlayer;
    this.name = def.short || def.name;
    this.displayName = isPlayer ? 'あなた' : def.short || def.name;
    this.model = buildPuncher(def, team);
    this.model.userData.puncher = this;
    match.scene.add(this.model);
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.roll = 0;
    this.visYaw = 0;
    this.forward = new THREE.Vector3(0, 0, 1);
    this.right = new THREE.Vector3(1, 0, 0);
    this.flatFwd = new THREE.Vector3(0, 0, 1);
    this.hit = makeHitInfo();
    this.maxHp = def.hp;
    this.hp = def.hp;
    this.alive = true;
    this.respawnT = 0;
    this.boost = BOOST_SEGS;
    this.sp = 0; // スペシャルゲージ 0..1
    this.state = 'hover'; // hover / fly / dash / cruise / step / roll / brake / uturn / hurt / stun / ko / special / charge
    this.stateT = 0;
    this.dash = null;
    this.ground = false;
    this.groundT = 0;
    this.lock = null;
    this.intent = { hold: false, look: false, stickX: 0, stickY: 0, events: [] };
    this.atk = { combo: 0, cd: 0, phase: -1, side: 1, heavy: false, comboT: 0, target: null, pending: null };
    this.ksCd = 0;
    this.omCd = def.omamori.map(() => 0);
    this.omamori = def.omamori.slice();
    this.elem = def.elem || OMAMORI[this.omamori[0]].elem; // v1.5：キャラの属性で始まる（ディスクを下フリックで変えられる）
    this.elemCd = 0;
    this.diskLock = 0; // 属性変更のあとディスクが使えない時間
    this.charge = null; // ディスク発動までの溜め {id, t, total, slot}
    this.buffs = { atk: 0, atkT: 0, spd: 0, spdT: 0, shield: 0, shieldT: 0, slowT: 0, slow: 0, regen: 0, regenT: 0, big: 0, ikemen: 0 };
    // v1.5：キャラの技・相性の効果。名前ごとに1つ（同じ名前は上書き）{atk, def, spd, armor, t}
    //   atk：与えるダメージ +x、def：受けるダメージ +x（マイナスでへる）、spd：速さ +x、armor：ひるまない
    this.mods = new Map();
    this.syn = { atk: 0, def: 0, spd: 0, tags: [] }; // 相性（試合のあいだずっと）
    this.modAtk = 0;
    this.modDef = 0;
    this.modSpd = 0;
    this.armor = false;
    this.status = 0; // 見た目のしるし（STATUS のビット）。オンラインでも送る
    this.drunkT = 0; // 酔ってふらふら
    this.burnT = 0; // やけど（少しずつダメージ）
    this.burnDps = 0;
    this.burnSrc = null;
    this.poopT = 0; // おなかがゆるい（ときどき止まる）
    this.poopTick = 0;
    this.invuln = 0;
    this.justT = 0;
    this.stunT = 0;
    this.hurtT = 0;
    this.carry = { sakura: [], flag: null, balls: [] };
    this.stats = { ko: 0, down: 0, dmg: 0, pick: 0, dep: 0, score: 0, assist: 0, hits: 0, om: 0, ks: 0, sp: 0 };
    this.lastHitBy = null;
    this.lastHitT = -99;
    this.animT = Math.random() * 10;
    this.runPhase = 0;
    this.distSP = 0;
    this.turnVis = 0;
    this.flipT = 0;
    this.lookYawRate = 0;
    this.walkSpeed = 0;
    this.aura = null;
    this.jetOn = false;
    this.speedMul = def.speed;
    this.life = 0; // 復活した回数（オンライン対戦で古い位置を捨てるため）
    this.human = isPlayer;
    this.cpu = !isPlayer;
  }

  get radius() {
    return MOVE.radius * (this.buffs.big > 0 ? 2.2 : 1);
  }
  get carrying() {
    return this.carry.sakura.length + this.carry.balls.length * 3 + (this.carry.flag ? 99 : 0);
  }
  isEnemy(o) {
    return o && o.team !== this.team;
  }
  canAct() {
    return this.alive && this.stunT <= 0 && this.hurtT <= 0 && this.state !== 'special' && this.state !== 'ko' && this.state !== 'skill';
  }

  spawnAt(pos, yaw) {
    this.pos.copy(pos);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.visYaw = yaw;
    this.pitch = 0;
    this.hp = this.maxHp;
    this.alive = true;
    this.state = 'hover';
    this.stateT = 0;
    this.boost = BOOST_SEGS;
    this.invuln = RESPAWN_INVULN;
    this.stunT = this.hurtT = 0;
    this.roll = 0; // スクリューの途中で倒れても、かたむいたままにならない
    this.dash = null;
    this.charge = null;
    this.lock = null;
    this.clearMods();
    this.model.visible = true;
    this.model.scale.setScalar(1);
    this.updateAxes();
    this.model.position.copy(this.pos);
  }

  updateAxes() {
    const cp = Math.cos(this.pitch);
    this.forward.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp);
    this.flatFwd.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.right.set(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
  }

  // 技・相性の効果を足し合わせる
  addMod(tag, m, t) {
    this.mods.set(tag, { atk: m.atk || 0, def: m.def || 0, spd: m.spd || 0, armor: !!m.armor, t });
    this.sumMods();
  }
  hasMod(tag) {
    return this.mods.has(tag);
  }
  clearMods() {
    this.mods.clear();
    this.drunkT = this.burnT = this.poopT = 0;
    this.sumMods();
  }
  sumMods() {
    let a = this.syn.atk, d = this.syn.def, sp = this.syn.spd, ar = false;
    for (const m of this.mods.values()) {
      a += m.atk;
      d += m.def;
      sp += m.spd;
      if (m.armor) ar = true;
    }
    this.modAtk = a;
    this.modDef = d;
    this.modSpd = sp;
    this.armor = ar;
  }

  // 速さの倍率（キャラ・バフ・荷物）
  moveMul() {
    let m = this.speedMul;
    // CPUの強さ（v1.7）：弱いCPUはゆっくり飛ぶ
    if (this.cpu && this.cpuLv && this.cpuLv.speed) m *= this.cpuLv.speed;
    if (this.buffs.spdT > 0) m *= 1 + this.buffs.spd;
    if (this.buffs.slowT > 0) m *= 1 - this.buffs.slow;
    if (this.modSpd) m *= Math.max(0.3, 1 + this.modSpd);
    if (this.drunkT > 0) m *= 0.8;
    const n = this.carry.sakura.length;
    if (n > 0) m *= 1 - Math.min(MOVE.carrySlowMax, n * MOVE.carrySlowPer);
    if (this.carry.balls.length) m *= 1 - Math.min(0.4, this.carry.balls.length * 0.08);
    if (this.carry.flag) m *= 0.62;
    if (this.buffs.big > 0) m *= 0.9;
    if (this.atk.phase >= 0 && this.def.attack.kind === 'melee' && !this.atk.shotNow) m *= 0.55;
    return m;
  }

  // ===== 入力からの行動 =====
  handleEvents() {
    const evs = this.intent.events;
    // 少し前に押したのに、ひるみ中などで出せなかった操作をもう一度ためす（先行入力）
    const buf = this.buffered || (this.buffered = []);
    const now = this.match.time;
    if (buf.length && this.canAct()) {
      for (const b of buf) if (now - b.t < 0.35) evs.push(b.e);
      buf.length = 0;
    } else if (buf.length) {
      for (let i = buf.length - 1; i >= 0; i--) if (now - buf[i].t >= 0.35) buf.splice(i, 1);
    }
    for (let i = 0; i < evs.length; i++) {
      const e = evs[i];
      if (!this.alive) continue;
      if (!this.canAct() && (e.type === 'skill' || e.type === 'special' || e.type === 'tap' || e.type === 'flick' || e.type === 'uturn')) {
        if (e.type !== 'flick' || this.stunT <= 0) buf.push({ e, t: now });
        continue;
      }
      if (e.type === 'press') {
        this.pressYaw = this.yaw;
        this.pressPitch = this.pitch;
        continue;
      }
      // すばやい操作の途中で少しだけ向きが変わっていたら元にもどす
      // （右の親指のタップは別の指なので、もどさない。v1.7：前は右でタップすると、左で押したときの向きにもどっていた）
      if ((e.type === 'tap' || e.type === 'flick' || e.type === 'uturn') && !e.look && e.dur != null && e.dur < 0.32 && this.pressYaw != null && !this.lock) {
        this.yaw = this.pressYaw;
        this.pitch = this.pressPitch;
        this.updateAxes();
      }
      if (e.type === 'tap') this.tryDash();
      else if (e.type === 'flick') this.flick(e.dir);
      else if (e.type === 'uturn') this.uturn();
      else if (e.type === 'skill') this.useSlot(e.slot);
      else if (e.type === 'elem') this.switchElem(e.slot);
      else if (e.type === 'special') this.useSpecial();
      else if (e.type === 'lock') this.setLock(e.target);
      else if (e.type === 'lockNext') this.lockNext();
      else if (e.type === 'deposit') this.wantDeposit = true;
    }
    evs.length = 0;
  }

  tryDash() {
    if (!this.canAct() || this.charge) return false;
    if (this.state === 'dash' && this.dash && this.dash.windup > 0) return false;
    const t = this.lock && this.lock.alive ? this.lock : null;
    let attack = false;
    if (t && this.def.attack.kind === 'melee') {
      _v.subVectors(t.pos, this.pos);
      const d = _v.length();
      if (d < COMBAT.dashAtkRange && d > 2) attack = true;
    }
    const cost = attack ? 2 : 1;
    if (this.boost < cost - 0.001) {
      this.match.fxNoBoost && this.match.fxNoBoost(this);
      return false;
    }
    this.boost -= cost;
    this.state = 'dash';
    this.stateT = 0;
    this.dash = { windup: 0.07, t: MOVE.dashTime * (attack ? 1.35 : 1), attack, target: attack ? t : null, cost, hitDone: false };
    this.atk.phase = -1;
    this.match.sfx('dash', this);
    return true;
  }

  flick(dir) {
    if (!this.canAct()) return;
    // ダッシュの溜め中に上下フリック → ダッシュを取り消し（ゲージは戻る）
    if (this.state === 'dash' && this.dash && this.dash.windup > 0 && Math.abs(dir.y) > 0.5 && Math.abs(dir.x) < 0.5) {
      this.boost = Math.min(BOOST_SEGS, this.boost + this.dash.cost);
      this.dash = null;
      this.state = 'hover';
    }
    if (this.charge) return; // ディスクの溜め中は動けない
    const moving = this.state === 'fly' || this.state === 'dash' || this.state === 'cruise' || this.vel.length() > MOVE.flySpeed * 0.55;
    this.justT = MOVE.justWindow;
    if (moving) {
      if (dir.y > 0.5 && Math.abs(dir.x) < 0.5) {
        // 下フリック：急停止
        this.state = 'brake';
        this.stateT = 0;
        this.dash = null;
        this.match.sfx('brake', this);
        return;
      }
      // バレルロール：速さと向きはそのまま、横・上へずれる
      const sx = dir.x, sy = -dir.y;
      _v.copy(this.right).multiplyScalar(sx);
      _v.addScaledVector(UP, sy * 0.8);
      if (_v.lengthSq() < 0.01) _v.copy(this.right);
      _v.normalize();
      this.rollDir = _v.clone();
      this.rollSign = sx >= 0 ? -1 : 1;
      if (Math.abs(sx) < 0.3) this.rollSign = 1;
      this.prevState = this.state === 'dash' ? 'cruise' : this.state;
      this.state = 'roll';
      this.stateT = 0;
      this.dash = null;
      this.invuln = Math.max(this.invuln, 0.12);
      this.match.sfx('roll', this);
      return;
    }
    // 止まっているとき：横＝ステップ、上＝上昇、下＝バックステップ
    const sx = dir.x, sy = dir.y;
    _v.set(0, 0, 0);
    _v.addScaledVector(this.right, sx);
    if (sy > 0.3) _v.addScaledVector(this.flatFwd, -sy);
    if (sy < -0.3) {
      if (Math.abs(sx) < 0.3) _v.addScaledVector(UP, 1);
      else _v.addScaledVector(UP, 0.4);
    }
    if (_v.lengthSq() < 0.01) _v.copy(this.right);
    _v.normalize();
    this.stepDir = _v.clone();
    this.state = 'step';
    this.stateT = 0;
    this.stepUp = sy < -0.3 && Math.abs(sx) < 0.3;
    this.invuln = Math.max(this.invuln, 0.12);
    this.match.sfx('step', this);
  }

  uturn() {
    if (!this.canAct() || this.charge) return;
    this.state = 'uturn';
    this.stateT = 0;
    this.uturnFrom = this.yaw;
    this.uturnFromPitch = this.pitch;
    this.uturnSpeed = this.vel.length();
    this.lock = null; // 反転するとロックオンが外れる
    this.dash = null;
    this.match.sfx('uturn', this);
  }

  setLock(t) {
    if (!t || !t.alive || t.team === this.team) {
      this.lock = null;
      return;
    }
    this.lock = this.lock === t ? null : t;
    this.lockOutT = -COMBAT.lockGrace;
    if (this.isPlayer) this.match.sfx('lock', this);
  }
  // v1.8：ロックしている敵が見えているか（自分の画面に映っているか。CPUは前のほう約70°以内）。すぐ近く（7m）は見えていることにする
  lockVisible(L) {
    const d = L.pos.distanceTo(this.pos);
    if (d < 7) return true;
    const cam = this.isPlayer && this.match.camera;
    if (cam) {
      _v.copy(L.pos);
      _v.project(cam);
      return _v.z < 1 && Math.abs(_v.x) < 1.35 && Math.abs(_v.y) < 1.15;
    }
    _v.subVectors(L.pos, this.pos).divideScalar(d);
    return _v.dot(this.forward) > 0.34;
  }
  unlock(why) {
    if (!this.lock) return;
    this.lock = null;
    if (this.isPlayer && why === 'view') this.match.sfx('unlock', this);
  }
  lockNext() {
    const c = this.match.lockCandidates(this);
    if (!c.length) {
      this.lock = null;
      return;
    }
    const i = c.indexOf(this.lock);
    this.lock = c[(i + 1) % c.length];
    this.lockOutT = -COMBAT.lockGrace;
  }

  // スロット 0,1 / 3,4 はディスク、2 はパンチャースキル
  useSlot(slot) {
    if (slot === 2) return this.useKS();
    const oi = slot < 2 ? slot : slot - 1;
    return this.useOmamori(oi);
  }
  useKS() {
    if (!this.canAct() || this.ksCd > 0 || this.charge) return false;
    const ok = this.match.skills.useKS(this);
    if (ok) {
      this.stats.ks++;
      this.ksCd = this.def.skill.cd;
      this.invuln = Math.max(this.invuln, COMBAT.skillInvuln);
    }
    return ok;
  }
  useOmamori(i) {
    if (!this.canAct() || this.omCd[i] > 0 || this.charge || this.diskLock > 0) return false;
    const id = this.omamori[i];
    const om = OMAMORI[id];
    if (!om) return false;
    const total = this.match.skills.chargeTime(this, om);
    this.charge = { id, slot: i, t: total, total };
    const lv = (this.omLv && this.omLv[i]) || 1;
    this.omCd[i] = om.cd * (1 - (lv - 1) * 0.04);
    this.match.sfx('charge', this);
    this.match.fx.chargeIcon && this.match.fx.chargeIcon(this, om);
    return true;
  }
  switchElem(i) {
    const id = this.omamori[i];
    const om = OMAMORI[id];
    if (!om || this.elemCd > 0 || om.elem === this.elem || this.omCd[i] > 0 || this.charge) return false;
    this.elem = om.elem;
    this.elemCd = 3.5;
    this.diskLock = 1.0;
    this.match.sfx('elem', this);
    this.match.fx.elemSwitch && this.match.fx.elemSwitch(this);
    return true;
  }
  useSpecial() {
    if (!this.canAct() || this.sp < 0.999 || this.charge) return false;
    this.sp = 0;
    this.stats.sp++;
    this.match.skills.useSpecial(this);
    return true;
  }

  // エモート（身ぶり）をする。上半身だけなので、飛びながらでもできる
  emote(name, dur = 1.3) {
    this.emoteName = name;
    this.emoteT = dur;
    this.emoteDur = dur;
  }
  addSP(v) {
    if (!this.alive) return;
    const before = this.sp;
    this.sp = clamp(this.sp + v, 0, 1);
    if (before < 1 && this.sp >= 1 && this.isPlayer) this.match.sfx('spReady', this);
  }

  // ===== 毎フレーム =====
  update(dt) {
    this.animT += dt;
    if (!this.alive) {
      this.respawnT -= dt;
      this.updateKO(dt);
      if (this.respawnT <= 0) this.match.respawn(this);
      return;
    }
    this.tickTimers(dt);
    // ロックの相手がいなくなった／遠すぎる／しばらく見えていない（v1.8：本物と同じく、視界から出ると外れる）
    if (this.lock !== this._lockPrev) {
      // ロックの相手が変わった（タップ・CPU・通信のどれでも）→ ふり向くあいだは少し待つ
      this._lockPrev = this.lock;
      this.lockOutT = -COMBAT.lockGrace;
    }
    if (this.lock) {
      const L = this.lock;
      if (!L.alive || L.pos.distanceTo(this.pos) > COMBAT.lockRange) this.lock = null;
      else if (this.lockVisible(L)) this.lockOutT = 0;
      else {
        this.lockOutT = (this.lockOutT || 0) + dt;
        if (this.lockOutT > COMBAT.lockOutTime) this.unlock('view');
      }
    }

    this.handleEvents();

    // スペシャル中は動かない
    if (this.state === 'special') {
      this.vel.multiplyScalar(Math.exp(-6 * dt));
      this.integrate(dt);
      this.animate(dt);
      return;
    }
    // ディスクの溜め
    if (this.charge) {
      this.charge.t -= dt;
      if (this.charge.t <= 0) {
        const c = this.charge;
        this.charge = null;
        this.match.skills.fireOmamori(this, c.id, c.slot);
      }
    }

    const I = this.intent;
    const stunned = this.stunT > 0 || this.hurtT > 0;
    const mm = this.moveMul();
    const fly = MOVE.flySpeed * mm;

    // 向きを変える
    if (!stunned && this.state !== 'uturn') {
      let yr = I.stickX * MOVE.yawRate;
      let pr = I.stickY * MOVE.pitchRate;
      // 右の親指（両手の操作）：なぞった分だけそのまま向きが変わる（ラジアン）
      let lx = I.lookX || 0, ly = I.lookY || 0;
      if (this.charge) {
        yr = 0;
        pr = 0; // ディスク発動中は向きを変えられない
        lx = ly = 0;
      }
      // 飛んでいるときは少しゆっくり大回り
      if (this.state === 'fly' || this.state === 'cruise' || this.state === 'dash') {
        yr *= 0.85;
        pr *= 0.85;
      }
      // スティック右（指を右へ）＝画面で右へ曲がる。yaw は左回りがプラスなので引く
      this.yaw = wrapAngle(this.yaw - yr * dt - lx);
      this.pitch = clamp(this.pitch + pr * dt + ly, -MOVE.pitchLimit, MOVE.pitchLimit);
      // 酔ってふらふら（コーダイの一気飲みのあと）：向きが勝手に左右へゆれる
      if (this.drunkT > 0) this.yaw = wrapAngle(this.yaw + Math.sin(this.animT * 4.7) * 0.85 * dt * Math.min(1, this.drunkT));
      // ロックオン：相手のほうへ自動で向く
      const L = this.lock;
      if (L && L.alive && !this.charge) {
        _v.subVectors(L.pos, this.pos);
        const ty = Math.atan2(_v.x, _v.z);
        const tp = Math.atan2(_v.y, Math.hypot(_v.x, _v.z));
        const steer = Math.abs(I.stickX) + Math.abs(I.stickY) > 0.4 || Math.abs(lx) + Math.abs(ly) > 0.002;
        // v1.8：前の半分ぐらいの強さで、速さにも上限（大きく回りこまれると追いきれない）
        const k = steer ? COMBAT.lockTurnSteer : COMBAT.lockTurn;
        const mx = COMBAT.lockTurnMax * dt;
        const a = 1 - Math.exp(-k * dt);
        this.yaw = wrapAngle(this.yaw + clamp(wrapAngle(ty - this.yaw) * a, -mx, mx));
        this.pitch = clamp(this.pitch + clamp((tp - this.pitch) * a, -mx, mx), -MOVE.pitchLimit, MOVE.pitchLimit);
      }
      // turnVis は「左へ曲がる＝プラス」（体のかたむき用）。右の親指で曲がったときも体をかたむける
      const lookRate = dt > 0 ? clamp(lx / dt / MOVE.yawRate, -1, 1) : 0;
      this.turnVis = damp(this.turnVis, -clamp(I.stickX + lookRate, -1, 1), 6, dt);
    } else {
      this.turnVis = damp(this.turnVis, 0, 6, dt);
    }
    // 地上にいるときは上下の向きを水平に近づける（走る）
    this.updateAxes();

    // 状態ごとの動き
    const st = this.state;
    if (stunned) {
      this.vel.multiplyScalar(Math.exp(-3 * dt));
      if (this.state !== 'hurt' && this.state !== 'stun') this.state = this.stunT > 0 ? 'stun' : 'hurt';
      if (this.carry.flag && this.stunT > 0.3) this.match.mode.dropFlag && this.match.mode.dropFlag(this);
    } else if (st === 'skill') {
      // スキルが速さを決める（skills.js）
    } else if (st === 'hurt' || st === 'stun') {
      this.state = 'hover';
    } else if (st === 'dash') {
      const D = this.dash;
      if (D.windup > 0) {
        D.windup -= dt;
        this.vel.multiplyScalar(Math.exp(-10 * dt));
      } else {
        // ダッシュ攻撃：相手へ向かう。v1.8：出だしは相手へまっすぐ向くが、そのあとは急には曲がれない（横によけられる）
        if (D.attack && D.target && D.target.alive) {
          _v.subVectors(D.target.pos, this.pos);
          const d = _v.length();
          _v.normalize();
          const ty = Math.atan2(_v.x, _v.z);
          const tp = clamp(Math.asin(clamp(_v.y, -1, 1)), -MOVE.pitchLimit, MOVE.pitchLimit);
          if (!D.aimed) {
            D.aimed = true;
            this.yaw = ty;
            this.pitch = tp;
          } else {
            const mx = COMBAT.dashAtkTurn * dt;
            this.yaw = wrapAngle(this.yaw + clamp(wrapAngle(ty - this.yaw), -mx, mx));
            this.pitch = clamp(this.pitch + clamp(tp - this.pitch, -mx, mx), -MOVE.pitchLimit, MOVE.pitchLimit);
          }
          this.updateAxes();
          if (d < COMBAT.dashAtkHit + D.target.radius && !D.hitDone) {
            D.hitDone = true;
            this.match.combat.dashHit(this, D.target);
            D.t = Math.min(D.t, 0.06);
          }
        }
        const sp = MOVE.dashSpeed * Math.max(0.75, mm);
        this.vel.copy(this.forward).multiplyScalar(sp);
        D.t -= dt;
        if (D.t <= 0) {
          this.dash = null;
          this.state = 'cruise'; // ブーストのあとは自動で飛び続ける
          this.stateT = 0;
        }
      }
    } else if (st === 'step') {
      const T = MOVE.dodgeTime;
      const k = 1 - this.stateT / T;
      const sp = MOVE.dodgeSpeed * (this.stepUp ? 0.95 : 1) * Math.max(0.2, k * 1.6);
      this.vel.copy(this.stepDir).multiplyScalar(sp);
      if (this.stateT >= T) {
        this.state = 'hover';
        this.stateT = 0;
      }
    } else if (st === 'roll') {
      const T = 0.32;
      // 進む向きはそのまま、横へずれる
      const base = Math.max(fly, this.vel.length() * 0.9);
      this.vel.copy(this.forward).multiplyScalar(base);
      this.vel.addScaledVector(this.rollDir, 15 * Math.sin((this.stateT / T) * Math.PI));
      this.roll = this.rollSign * (this.stateT / T) * Math.PI * 2;
      if (this.stateT >= T) {
        this.roll = 0;
        this.state = I.hold ? 'fly' : this.prevState === 'fly' ? 'hover' : 'cruise';
        if (this.state === 'hover' && this.prevState === 'cruise') this.state = 'cruise';
        this.stateT = 0;
      }
    } else if (st === 'brake') {
      this.vel.multiplyScalar(Math.exp(-MOVE.hardBrake * dt));
      if (this.stateT > 0.25) {
        this.state = 'hover';
        this.stateT = 0;
      }
    } else if (st === 'uturn') {
      const T = MOVE.uturnTime;
      const k = Math.min(1, this.stateT / T);
      const e = k * k * (3 - 2 * k);
      this.yaw = wrapAngle(this.uturnFrom + Math.PI * e);
      this.pitch = lerp(this.uturnFromPitch, -this.uturnFromPitch * 0.3, e);
      this.updateAxes();
      this.vel.multiplyScalar(Math.exp(-6 * dt));
      if (k >= 1) {
        // 速く飛んでいたら、向きを変えてそのまま飛ぶ
        this.state = this.uturnSpeed > fly * 0.6 ? (I.hold ? 'fly' : 'cruise') : 'hover';
        if (this.state !== 'hover') this.vel.copy(this.forward).multiplyScalar(this.uturnSpeed * 0.8);
        this.stateT = 0;
      }
    } else {
      // 通常：長押しで飛ぶ／離すと止まる／ブーストのあとは自動で飛ぶ
      if (I.hold) {
        this.state = 'fly';
      } else if (st === 'fly') {
        this.state = 'hover';
        this.stateT = 0;
      }
      if (this.state === 'fly' || this.state === 'cruise') {
        _v.copy(this.forward);
        if (this.ground && this.forward.y < 0.25) {
          // 地上を走る（同じ速さ）
          _v.y = 0;
          _v.normalize();
        }
        // v1.7：長押しで壁にまっすぐぶつかっても止まらないように、壁にそって（正面なら上へ）すべる
        //   壁からはなれた次のフレームでまた壁へ向かわないように、少しのあいだ壁の向きをおぼえておく
        if (this.hit.hitWall) {
          this.wallN = (this.wallN || new THREE.Vector3()).copy(this.hit.wallNormal);
          this.wallT = 0.3;
          this.wallBound = !!this.hit.bound;
        }
        if (this.state === 'fly' && this.wallT > 0) {
          this.wallT -= dt;
          const n = this.wallN;
          const into = _v.dot(n);
          if (into < -0.15) {
            _v.addScaledVector(n, -into);
            // 場外の見えない壁では横にすべるだけ（上へのぼらない）
            if (!this.wallBound) _v.y += -into * 0.9;
            if (_v.lengthSq() < 0.01) _v.set(0, 1, 0);
            _v.normalize();
          }
        }
        _v.multiplyScalar(fly);
        this.vel.x = damp(this.vel.x, _v.x, MOVE.accel, dt);
        this.vel.y = damp(this.vel.y, _v.y, MOVE.accel, dt);
        this.vel.z = damp(this.vel.z, _v.z, MOVE.accel, dt);
      } else {
        // その場で止まる（空中でも落ちない）
        this.vel.multiplyScalar(Math.exp(-MOVE.brake * dt));
        // すぐ下に足場があれば自動で着地
        if (!this.ground && this.state === 'hover' && this.stateT > 0.35) {
          const gy = this.match.world.groundBelow(this.pos, 3.2);
          if (gy != null && this.pos.y - gy < 3.0) this.vel.y = Math.min(this.vel.y, -4.5);
        }
      }
    }

    // 近接の自動攻撃
    this.match.combat.autoAttack(this, dt);

    this.integrate(dt);

    // ブーストの回復（空中は約3秒で1、地上は約0.5秒で1）
    if (this.state !== 'dash') {
      const r = this.ground ? MOVE.boostRegenGround : this.state === 'fly' || this.state === 'cruise' ? MOVE.boostRegenFly : MOVE.boostRegenAir;
      this.boost = Math.min(BOOST_SEGS, this.boost + r * dt);
    }
    // 動いた距離でスペシャルがたまる
    const moved = this.vel.length() * dt;
    this.addSP(moved / 900);

    this.animate(dt);
  }

  // タイマー（オンライン対戦のホストは、ほかの端末の人もこれだけ進める）
  tickTimers(dt) {
    this.stateT += dt;
    this.invuln = Math.max(0, this.invuln - dt);
    this.justT = Math.max(0, this.justT - dt);
    this.ksCd = Math.max(0, this.ksCd - dt);
    for (let i = 0; i < this.omCd.length; i++) this.omCd[i] = Math.max(0, this.omCd[i] - dt);
    this.elemCd = Math.max(0, this.elemCd - dt);
    this.diskLock = Math.max(0, this.diskLock - dt);
    this.stunT = Math.max(0, this.stunT - dt);
    this.hurtT = Math.max(0, this.hurtT - dt);
    const B = this.buffs;
    for (const k of ['atkT', 'spdT', 'shieldT', 'slowT', 'regenT']) B[k] = Math.max(0, B[k] - dt);
    if (B.shieldT <= 0) B.shield = 0;
    // 弱くて長いおそさ（強いのに上書きされていたもの）を、強いのが切れたら続ける（kits.js の slowDown）
    if (B.slowNext) {
      B.slowNext.t -= dt;
      if (B.slowNext.t <= 0) B.slowNext = null;
      else if (B.slowT <= 0) {
        B.slow = B.slowNext.amt;
        B.slowT = B.slowNext.t;
        B.slowNext = null;
      }
    }
    // 技・相性の効果の時間
    if (this.mods.size) {
      let ch = false;
      for (const [k, m] of this.mods) {
        m.t -= dt;
        if (m.t <= 0) {
          this.mods.delete(k);
          ch = true;
          if (this.match.skills.onModEnd) this.match.skills.onModEnd(this, k);
        }
      }
      if (ch) this.sumMods();
    }
    this.drunkT = Math.max(0, this.drunkT - dt);
    if (!this.match.netClient) this.status = statusOf(this);
    // やけど・おなか（ダメージはホストだけが計算する。入った人の端末では damage は何もしない）
    if (this.burnT > 0) {
      this.burnT -= dt;
      this.burnAcc = (this.burnAcc || 0) + dt;
      if (this.burnAcc >= 0.5) {
        this.burnAcc = 0;
        if (this.alive) this.match.combat.damage(this.burnSrc, this, this.burnDps * 0.5, { kind: 'dot' });
      }
    }
    if (this.poopT > 0) {
      this.poopT -= dt;
      this.poopTick -= dt;
      if (this.poopTick <= 0 && this.alive) {
        // おなかがゆるくて、ときどき止まってしまう
        this.poopTick = 1.6;
        this.match.combat.damage(this.poopSrc || null, this, 40, { kind: 'dot', stun: 0.3, soft: true });
        this.match.fx.say && this.match.fx.say(this, 'ギュルル…', 'poop');
      }
    }
    if (B.regenT > 0) this.heal(this.maxHp * B.regen * dt, true);
    if (B.big > 0) {
      B.big -= dt;
      if (B.big <= 0) this.match.skills.endBig(this);
    }
    if (B.ikemen > 0) {
      B.ikemen -= dt;
      if (B.ikemen <= 0) this.match.skills.endIkemen(this);
    }
  }

  integrate(dt) {
    this.pos.addScaledVector(this.vel, dt);
    const w = this.match.world;
    const preVel = this.state === 'dash' ? this.vel.length() : 0;
    w.resolveSphere(this.pos, this.radius, this.vel, this.hit);
    const wasGround = this.ground;
    this.ground = this.hit.ground;
    // 足もとがほんの少し下にあるときも「立っている」とする（ちらつき防止）
    if (!this.ground && this.vel.y <= 0.5) {
      const d = w.raycast(this.pos, _down, this.radius + 0.25);
      if (d <= this.radius + 0.2) this.ground = true;
    }
    if (this.ground) this.groundT += dt;
    else this.groundT = 0;
    if (!wasGround && this.ground && this.isPlayer && this.state !== 'dash') this.match.sfx('land', this);
    // 壁キック：ブースト中に壁へぶつかったら蹴って反転
    if (this.state === 'dash' && this.hit.hitWall && preVel > 10 && this.dash && this.dash.windup <= 0) {
      const n = this.hit.wallNormal;
      _v.copy(this.forward);
      const d = _v.dot(n);
      if (d < -0.35) {
        _v.addScaledVector(n, -2 * d).normalize();
        this.yaw = Math.atan2(_v.x, _v.z);
        this.pitch = clamp(Math.asin(clamp(_v.y, -1, 1)), -MOVE.pitchLimit, MOVE.pitchLimit);
        this.updateAxes();
        this.dash.t = Math.max(this.dash.t, MOVE.dashTime * 0.8);
        this.match.fx.wallKick && this.match.fx.wallKick(this, n);
        this.match.sfx('wallkick', this);
      }
    }
    // 自動で飛んでいるときに壁にぶつかったら止まる
    if (this.state === 'cruise' && this.hit.hitWall && this.vel.length() < MOVE.flySpeed * 0.3) this.state = 'hover';
  }

  heal(v, silent) {
    if (!this.alive) return;
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + v);
    if (!silent && this.hp > before) this.match.fx.healNum && this.match.fx.healNum(this, Math.round(this.hp - before));
  }

  // ===== 見た目 =====
  animate(dt) {
    const m = this.model;
    m.position.copy(this.pos);
    const sc = this.buffs.big > 0 ? 2.3 : 1;
    const cur = m.scale.x;
    if (Math.abs(cur - sc) > 0.001) m.scale.setScalar(damp(cur, sc, 7, dt));
    // 体の向き：止まっているときは上下をあまり傾けない
    const flying = this.state === 'fly' || this.state === 'dash' || this.state === 'cruise' || this.state === 'roll';
    const pitchVis = flying && !this.ground ? this.pitch : this.pitch * 0.25;
    this.visYaw = angleDamp(this.visYaw, this.yaw, 18, dt);
    let roll = this.roll;
    if (flying && this.state !== 'roll') roll += -this.turnVis * 0.7;
    m.rotation.set(-pitchVis, this.visYaw, roll, 'YXZ');
    if (this.state === 'uturn') {
      // くるっと宙返りするように見せる
      const k = Math.min(1, this.stateT / MOVE.uturnTime);
      m.rotation.x += Math.sin(k * Math.PI) * -0.6;
    }
    const sp = this.vel.length();
    let mode = 'hover';
    if (!this.alive) mode = 'ko';
    else if (this.state === 'special') mode = 'special';
    else if (this.stunT > 0) mode = 'stun';
    else if (this.hurtT > 0) mode = 'hurt';
    else if (this.atk.phase >= 0) mode = this.def.attack.kind === 'melee' && !this.atk.shotNow ? 'punch' : 'shoot';
    else if (this.state === 'dash') mode = 'dash';
    else if (this.ground && this.state !== 'step') mode = 'ground';
    else if (flying && sp > 3) mode = 'fly';
    // 試合が終わったら：勝ったチームは勝ちポーズ、負けたチームはうなだれる（引き分けはそのまま）
    const M = this.match;
    if (this.alive && M.result && (M.phase === 'result' || (M.phase === 'finish' && M.phaseT > 0.5))) {
      const w = M.result.winner;
      if (w === 0 || w === 1) mode = w === this.team ? 'win' : 'lose';
    }
    if (mode === 'ground') this.runPhase += dt * (sp * 0.95 + 0.1);
    const pst = this._pst || (this._pst = {});
    pst.mode = mode;
    pst.t = this.animT;
    pst.speed01 = mode === 'ground' ? clamp(sp / MOVE.flySpeed, 0, 1) : clamp(sp / (MOVE.flySpeed * 0.9), 0, 1);
    pst.turn = this.turnVis;
    pst.punchSide = this.atk.side;
    pst.punchPhase = Math.max(0, this.atk.phase);
    pst.heavy = this.atk.heavy;
    pst.runPhase = this.runPhase;
    // 表情：アオッチのメガネオフ（イケメン）中はキラキラの目
    pst.face = this.buffs.ikemen > 0 && this.alive && !(this.hurtT > 0) && mode !== 'punch' && mode !== 'shoot' ? FACES.special : -1;
    // エモート（スタンプの身ぶり）
    if (this.emoteT > 0) this.emoteT -= dt;
    pst.emote = this.emoteT > 0 ? this.emoteName : null;
    pst.emoteT = this.emoteT;
    pst.emoteDur = this.emoteDur;
    poseModel(m, pst, dt);
    const jet = this.alive && (mode === 'fly' || mode === 'dash');
    if (jet !== this.jetOn) {
      setJetGlow(m, jet);
      this.jetOn = jet;
    }
    // 無敵中はちかちか
    m.visible = this.alive || this.respawnT > RESPAWN_TIME - 1.2;
    if (this.alive && this.invuln > 0 && this.state !== 'step' && this.state !== 'roll' && this.state !== 'special') {
      m.visible = Math.floor(this.animT * 18) % 2 === 0;
    }
  }

  updateKO(dt) {
    // 倒れて回りながら落ちていく
    this.vel.y -= 9 * dt;
    this.vel.multiplyScalar(Math.exp(-1.2 * dt));
    this.pos.addScaledVector(this.vel, dt);
    if (this.pos.y < 1) this.pos.y = 1;
    this.model.position.copy(this.pos);
    this.model.rotation.x += dt * 4;
    this.model.rotation.z += dt * 2.5;
    const k = clamp(1 - (RESPAWN_TIME - this.respawnT) / 1.2, 0, 1);
    this.model.scale.setScalar(Math.max(0.01, k));
    this.model.visible = k > 0.02;
    const pst = this._pst || (this._pst = {});
    pst.mode = 'ko';
    pst.t = this.animT;
    poseModel(this.model, pst, dt);
  }
}
