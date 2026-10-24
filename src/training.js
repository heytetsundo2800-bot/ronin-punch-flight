// 訓練場（v1.7）：時間制限なし。サンドバッグを相手に、移動・攻撃・技・サクラを自由に練習する
//   ・左上の板：練習メニュー（できたら ✓）・与えたダメージ・サンドバッグの動き・待ち時間なし・SP満タン・無敵
//   ・試合ではないので、ランクや今週の点は変わらない
import * as THREE from 'three';
import { Match } from './match.js';
import { PUNCHERS, PUNCHER_IDS } from './characters.js';
import { el, store, clamp } from './util.js';
import { ICON } from './icons.js';
import { sound } from './audio.js';
import { disposeDeep } from './gfx.js';

const _v = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

// 練習メニュー（順番はどれからでもよい）
const DRILLS = [
  { g: '移動', id: 'dash', name: 'ブースト（タップ）', need: 3 },
  { g: '移動', id: 'fly', name: '長押しで飛ぶ', need: 80, unit: 'm' },
  { g: '移動', id: 'look', name: '向きを変える', two: '右の親指でなぞって向きを変える', one: '押してすべらせて向きを変える', need: 360, unit: '°' },
  { g: '移動', id: 'brake', name: '急ブレーキ（飛びながら下フリック）', need: 2 },
  { g: '移動', id: 'step', name: 'ステップ・ロール（横フリック）', need: 3 },
  { g: '移動', id: 'uturn', name: '180度ターン（上→下フリック）', need: 1 },
  { g: '攻撃', id: 'lock', name: 'ロックオン（右の顔をタップ）', need: 2 },
  { g: '攻撃', id: 'hit', name: '攻撃を当てる（近づくと自動）', need: 15 },
  { g: '攻撃', id: 'dashAtk', name: 'ダッシュ攻撃（ロック中にタップ）', need: 1, melee: true },
  { g: '攻撃', id: 'ks', name: 'スキル（まん中の顔を上フリック）', need: 1 },
  { g: '攻撃', id: 'om', name: 'ディスク（下のディスクを上フリック）', need: 2 },
  { g: '攻撃', id: 'sp', name: 'スペシャル（SPボタン）', need: 1 },
  { g: '攻撃', id: 'ko', name: 'サンドバッグをたおす', need: 3 },
  { g: '攻撃', id: 'just', name: 'ジャスト回避（攻撃の直前にフリック）', need: 1, fight: true },
  { g: 'スクランブル', id: 'pick', name: 'サクラを拾う（近くを通る）', need: 5 },
  { g: 'スクランブル', id: 'dep', name: 'ダルマに預ける（近くで自動）', need: 5 },
];
const BEHAVIORS = [
  ['stand', '止まる'],
  ['move', '動く'],
  ['weak', '反撃・弱'],
  ['strong', '反撃・強'],
];
const OPT_KEY = 'rpf_train';

export class Training extends Match {
  constructor(app, opts) {
    super(app, { ...opts, solo: true, mode: 'scramble' });
    this.isTraining = true;
    this.noTimer = true;
    clearTimeout(this._teamT); // 「あなたは青チーム」は出さない
    this.hud.root.classList.add('training');
    this.opt = Object.assign({ beh: 'move', n: 3, nocd: true, spfull: false, god: false, open: false }, store.get(OPT_KEY, {}) || {});
    if (!BEHAVIORS.some((b) => b[0] === this.opt.beh)) this.opt.beh = 'move';
    this.opt.n = this.opt.n === 1 ? 1 : 3;
    this.count = {};
    this.done = new Set();
    this.prev = null;
    this.dmgTotal = 0;
    this.dmgLog = []; // [時刻, ダメージ]（1秒あたりを出す）
    this.dummies = [];
    const melee = this.player.def.attack.kind === 'melee';
    this.drills = DRILLS.filter((d) => !d.melee || melee);
    // ダメージを数える・無敵・ダッシュ攻撃とジャスト回避を数える
    const C = this.combat;
    const dmg0 = C.damage.bind(C);
    C.damage = (src, t, base, o = {}) => {
      // 無敵でも、ジャスト回避は数える（本物の damage を通すと 0 になって justDodge が動く）
      const just = t && t.justT > 0 && (t.state === 'step' || t.state === 'roll') && !o.noJust;
      if (t === this.player && this.opt.god && src !== this.player && !just) {
        if (this.fx.miss && o.kind !== 'dot') this.fx.miss(t);
        return 0;
      }
      const d = dmg0(src, t, base, o);
      if (d > 0 && src === this.player && t && t.dummy) {
        this.dmgTotal += d;
        this.dmgLog.push([this.time, d]);
      }
      return d;
    };
    const dash0 = C.dashHit.bind(C);
    C.dashHit = (p, t) => {
      if (p === this.player) this.bump('dashAtk', 1);
      return dash0(p, t);
    };
    const just0 = C.justDodge.bind(C);
    C.justDodge = (t, src, o) => {
      if (t === this.player) this.bump('just', 1);
      return just0(t, src, o);
    };
    this.buildPanel();
    this.spawnDummies();
    this.announce('訓練場\n時間制限なし・自由に練習', -1, true);
    // 開始の演出は短く
    this.phaseT = 1.6;
  }
  twoHands() {
    return this.input && this.input.scheme === 'two';
  }
  saveOpt() {
    store.set(OPT_KEY, this.opt);
  }

  // ===== サンドバッグ =====
  // 自分のスタートの前（12〜26m）に置く。キャラは自分と別の人から
  anchors() {
    const b = this.stage.bases[this.player.team];
    const base = b.respawn[0];
    const yaw = b.faceYaw;
    const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const right = new THREE.Vector3(-Math.cos(yaw), 0, Math.sin(yaw));
    const out = [];
    const spots = this.opt.n === 1 ? [[16, 0, 1.5]] : [[14, -7, 1], [20, 0, 2.5], [26, 7, 4]];
    for (const [f, r, h] of spots) out.push(base.clone().addScaledVector(fwd, f).addScaledVector(right, r).addScaledVector(UP, h));
    return out;
  }
  spawnDummies() {
    for (const d of this.dummies) this.removeDummy(d);
    this.dummies = [];
    const pool = PUNCHER_IDS.filter((id) => id !== this.player.def.id);
    const start = Math.floor(Math.random() * pool.length);
    const A = this.anchors();
    A.forEach((pos, i) => {
      const id = pool[(start + i * 5) % pool.length];
      const d = this.addPuncher(id, 1 - this.player.team, i, null);
      d.dummy = true;
      d.anchor = pos.clone();
      d.displayName = 'サンドバッグ' + (A.length > 1 ? i + 1 : '');
      d.yaw = this.stage.bases[this.player.team].faceYaw + Math.PI;
      d.spawnAt(pos, d.yaw);
      d.invuln = 0;
      this.applyBehavior(d);
      this.dummies.push(d);
    });
  }
  removeDummy(d) {
    const i = this.punchers.indexOf(d);
    if (i >= 0) this.punchers.splice(i, 1);
    // 足もとの影・ジェットの記録・預ける時間も消す（入れかえたあとに古い影が残らないように）
    const sh = this.shadows && this.shadows.items.get(d);
    if (sh) {
      this.scene.remove(sh.m);
      sh.m.material.dispose();
      this.shadows.items.delete(d);
    }
    if (this.fx && this.fx.jets) this.fx.jets.delete(d);
    if (this.mode && this.mode.depositT) this.mode.depositT.delete(d);
    if (d.model) {
      if (d.model.parent) d.model.parent.remove(d.model);
      disposeDeep(d.model);
    }
    if (this.hud && this.hud.removeMember) this.hud.removeMember(d);
    for (const p of this.punchers) if (p.lock === d) p.lock = null;
  }
  applyBehavior(d) {
    const b = this.opt.beh;
    // 止まる・動く＝攻撃しない／反撃・弱＝よわよわ／反撃・強＝ふつう
    this.setCpuLevel(d, b === 'weak' ? 'weak' : b === 'strong' ? 'normal' : 'zero');
    if (b === 'stand' || b === 'move') d.lock = null;
  }
  // 訓練場ではダルマは撃たない（自分のダルマがサンドバッグを撃たないように）
  guardK() {
    return 0;
  }
  // サンドバッグの動き（AIのかわりに、ここで操作を決める）
  driveDummy(d, dt) {
    const I = d.intent;
    I.hold = false;
    I.stickX = I.stickY = 0;
    I.lookX = I.lookY = 0;
    if (!d.alive) return;
    const P = this.player;
    const b = this.opt.beh;
    if (b === 'stand') {
      // その場で、自分のほうを向いて止まる
      if (d.pos.distanceTo(d.anchor) > 1.5) this.steerTo(d, d.anchor, 1);
      else this.faceTo(d, P.pos, dt);
      return;
    }
    if (b === 'move') {
      // 決まった場所のまわりを、ゆっくり円をえがいて飛ぶ
      const k = this.time * 0.45 + d.slot * 2.1;
      _v.set(Math.cos(k) * 7, Math.sin(k * 0.7) * 2, Math.sin(k) * 7).add(d.anchor);
      this.steerTo(d, _v, 0.6);
      return;
    }
    // 反撃：近くに来たら向かってくる（離れすぎたら元の場所へもどる）
    const near = P.alive && P.pos.distanceTo(d.anchor) < 32;
    if (near) {
      d.lock = P;
      if (d.pos.distanceTo(P.pos) > 2.6) this.steerTo(d, P.pos, b === 'strong' ? 1 : 0.7);
    } else {
      d.lock = null;
      if (d.pos.distanceTo(d.anchor) > 2) this.steerTo(d, d.anchor, 0.8);
    }
  }
  faceTo(d, pos, dt) {
    _v.subVectors(pos, d.pos);
    const ty = Math.atan2(_v.x, _v.z);
    let e = ty - d.yaw;
    while (e > Math.PI) e -= Math.PI * 2;
    while (e < -Math.PI) e += Math.PI * 2;
    d.intent.stickX = clamp(-e * 2, -1, 1) * 0.6;
  }
  steerTo(d, pos, speed) {
    _v.subVectors(pos, d.pos);
    const dist = _v.length();
    if (dist < 0.6) return;
    const ty = Math.atan2(_v.x, _v.z), tp = Math.asin(clamp(_v.y / dist, -1, 1));
    let e = ty - d.yaw;
    while (e > Math.PI) e -= Math.PI * 2;
    while (e < -Math.PI) e += Math.PI * 2;
    d.intent.stickX = clamp(-e * 2.6, -1, 1);
    d.intent.stickY = clamp((tp - d.pitch) * 2.6, -1, 1);
    d.intent.hold = Math.abs(e) < 1.1 && dist > 1;
    d.trainSpeed = speed;
  }
  // サンドバッグはたおれても、すぐ同じ場所にもどる
  ko(victim, killer) {
    if (!victim.alive) return;
    super.ko(victim, killer);
    if (victim.dummy) {
      victim.respawnT = 1.6;
      if (killer === this.player) this.bump('ko', 1);
    }
  }
  respawn(p) {
    if (p.dummy) {
      p.spawnAt(p.anchor, p.yaw);
      p.buffs = { atk: 0, atkT: 0, spd: 0, spdT: 0, shield: 0, shieldT: 0, slowT: 0, slow: 0, regen: 0, regenT: 0, big: 0, ikemen: 0 };
      p.model.rotation.set(0, p.yaw, 0);
      p.killedBy = null;
      p.invuln = 0.4;
      p.life = ((p.life || 0) + 1) & 255;
      this.fx.respawn && this.fx.respawn(p);
      return;
    }
    super.respawn(p);
  }
  // 自分をスタートの場所にもどす
  goHome() {
    const P = this.player;
    this.placeAtBase(P);
    P.lock = null;
    this.cam.first = true;
  }
  // サンドバッグを自分の前に呼ぶ（その場所を新しい置き場所にする）
  callDummies() {
    const P = this.player;
    const n = this.dummies.length;
    const W = this.world, B = W.bounds;
    this.dummies.forEach((d, i) => {
      const side = n === 1 ? 0 : (i - 1) * 6;
      // 前に壁や島があれば、その手前まで（場外の見えない壁の外にも出さない）
      const want = 12 + i * 4;
      const free = W.raycast(P.pos, P.flatFwd, want + 2);
      _v.copy(P.pos).addScaledVector(P.flatFwd, Math.max(4, Math.min(want, free - 2))).addScaledVector(P.right, side);
      _v.y += 1 + i;
      if (B) {
        _v.x = clamp(_v.x, -B.x + 4, B.x - 4);
        _v.z = clamp(_v.z, B.zMin + 4, B.zMax - 4);
        _v.y = clamp(_v.y, (B.yMin || 1) + 2, (B.yMax || 90) - 4);
      }
      d.anchor.copy(_v);
      if (d.alive) {
        d.pos.copy(_v);
        d.vel.set(0, 0, 0);
      }
    });
    sound.play('ui');
  }

  // ===== 練習メニュー =====
  bump(id, v) {
    if (this.done.has(id)) return;
    const D = this.drills.find((x) => x.id === id);
    if (!D) return;
    const before = Math.floor(this.count[id] || 0);
    this.count[id] = (this.count[id] || 0) + v;
    if (this.count[id] >= D.need) {
      this.done.add(id);
      sound.play('goal');
      this.app.bigText('GOOD', 'go');
      if (this.done.size === this.drills.length) {
        setTimeout(() => this.running && this.announce('練習メニュー 全部クリア！', this.player.team, true), 700);
        sound.play('win');
      }
      this.renderPanel();
    } else if (Math.floor(this.count[id]) !== before) this.renderPanel(true);
  }
  snapshot() {
    const p = this.player;
    return { state: p.state, stepUp: p.stepUp, pick: p.stats.pick, dep: p.stats.dep, hits: p.stats.hits, om: p.stats.om, ks: p.stats.ks, sp: p.stats.sp, yaw: p.yaw, pos: p.pos.clone(), lock: p.lock };
  }
  track() {
    const p = this.player;
    const now = this.snapshot();
    const pv = this.prev;
    this.prev = now;
    if (!pv || !p.alive) return;
    if (now.state === 'dash' && pv.state !== 'dash') this.bump('dash', 1);
    if (p.state === 'fly' || p.state === 'cruise') {
      const d = now.pos.distanceTo(pv.pos);
      if (d < 5) this.bump('fly', d);
    }
    if (p.state !== 'uturn' && !p.lock && (p.intent.lookActive || Math.abs(p.intent.stickX) > 0.08)) {
      let d = now.yaw - pv.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      if (Math.abs(d) > 0.0005) this.bump('look', (Math.abs(d) * 180) / Math.PI);
    }
    if (now.state === 'brake' && pv.state !== 'brake') this.bump('brake', 1);
    if ((now.state === 'step' && pv.state !== 'step' && !now.stepUp) || (now.state === 'roll' && pv.state !== 'roll')) this.bump('step', 1);
    if (now.state === 'uturn' && pv.state !== 'uturn') this.bump('uturn', 1);
    if (now.lock && now.lock !== pv.lock && now.lock.dummy) this.bump('lock', 1);
    if (now.hits > pv.hits) this.bump('hit', now.hits - pv.hits);
    if (now.ks > pv.ks) this.bump('ks', now.ks - pv.ks);
    if (now.om > pv.om) this.bump('om', now.om - pv.om);
    if (now.sp > pv.sp) this.bump('sp', now.sp - pv.sp);
    if (now.pick > pv.pick) this.bump('pick', now.pick - pv.pick);
    if (now.dep > pv.dep) this.bump('dep', now.dep - pv.dep);
  }

  buildPanel() {
    const box = el('div', 'trn' + (this.opt.open ? ' open' : ''));
    box.innerHTML = `<div class="trn-bar"><span class="ti">${ICON.target}</span><b>訓練場</b><span class="nx"></span><span class="pg"></span><button class="tgl" aria-label="練習メニュー">${ICON.menu}</button></div>
      <div class="trn-body">
        <div class="trn-dmg">与えたダメージ <b class="tot">0</b><span>　1秒あたり <b class="dps">0</b></span><button class="clr" aria-label="ダメージを0にもどす">${ICON.refresh}</button></div>
        <div class="trn-list"></div>
        <div class="trn-opts">
          <div class="lab">サンドバッグ</div>
          <div class="seg beh">${BEHAVIORS.map(([k, n]) => `<button data-k="${k}">${n}</button>`).join('')}</div>
          <div class="seg num"><button data-n="1">1体</button><button data-n="3">3体</button></div>
          <label><input type="checkbox" class="nocd"><span>スキル・ディスクの待ち時間なし</span></label>
          <label><input type="checkbox" class="spfull"><span>SPをいつも満タンにする</span></label>
          <label><input type="checkbox" class="god"><span>無敵（ダメージを受けない）</span></label>
          <div class="btns"><button class="call">サンドバッグを前に呼ぶ</button><button class="home">スタートにもどる</button></div>
          <div class="btns"><button class="reset">メニューをやり直す</button><button class="quit">訓練場を出る</button></div>
        </div>
      </div>`;
    this.hud.root.appendChild(box);
    this.panel = box;
    // 板の上の操作は、試合の操作（飛ぶ・視点）にしない。パソコンで Enter（ブースト）を押したときに、さわったボタンがもう一度おされないようにフォーカスをはずす
    for (const t of ['pointerdown', 'touchstart']) box.addEventListener(t, (e) => e.stopPropagation(), { passive: true });
    box.addEventListener('click', (e) => {
      const b = e.target.closest('button, input');
      if (b && b.blur) setTimeout(() => b.blur(), 0);
    });
    box.querySelector('.tgl').onclick = () => {
      this.opt.open = !this.opt.open;
      box.classList.toggle('open', this.opt.open);
      this.saveOpt();
      sound.play('ui');
    };
    box.querySelector('.trn-bar').addEventListener('click', (e) => {
      if (e.target.closest('.tgl')) return;
      box.querySelector('.tgl').click();
    });
    box.querySelectorAll('.beh button').forEach((b) => (b.onclick = () => {
      this.opt.beh = b.dataset.k;
      for (const d of this.dummies) this.applyBehavior(d);
      this.saveOpt();
      this.renderPanel();
      sound.play('ui');
    }));
    box.querySelectorAll('.num button').forEach((b) => (b.onclick = () => {
      const n = +b.dataset.n;
      if (n === this.opt.n) return;
      this.opt.n = n;
      this.saveOpt();
      this.spawnDummies();
      this.renderPanel();
      sound.play('ui');
    }));
    for (const k of ['nocd', 'spfull', 'god']) {
      const c = box.querySelector('.' + k);
      c.checked = !!this.opt[k];
      c.onchange = () => {
        this.opt[k] = c.checked;
        this.saveOpt();
        sound.play('ui');
      };
    }
    box.querySelector('.call').onclick = () => this.callDummies();
    box.querySelector('.home').onclick = () => {
      this.goHome();
      sound.play('ui');
    };
    box.querySelector('.clr').onclick = () => {
      this.dmgTotal = 0;
      this.dmgLog.length = 0;
      sound.play('ui');
    };
    box.querySelector('.reset').onclick = () => {
      this.count = {};
      this.done.clear();
      this.renderPanel();
      sound.play('ui');
    };
    box.querySelector('.quit').onclick = () => {
      sound.play('uiBack');
      this.app.endMatch();
      this.app.showHome();
    };
    this.renderPanel();
  }
  drillName(D) {
    if (D.id === 'look') return this.twoHands() ? D.two : D.one;
    return D.name;
  }
  renderPanel(countsOnly) {
    const box = this.panel;
    if (!box) return;
    const list = this.drills;
    const next = list.find((d) => !this.done.has(d.id));
    const cnt = (d) => Math.min(d.need, Math.floor(this.count[d.id] || 0)) + '/' + d.need + (d.unit || '');
    box.querySelector('.nx').innerHTML = next ? `つぎ：${this.drillName(next)} <i>${cnt(next)}</i>` : '全部クリア！自由に練習しよう';
    box.querySelector('.pg').textContent = this.done.size + '/' + list.length;
    const L = box.querySelector('.trn-list');
    if (countsOnly && L.children.length) {
      for (const d of list) {
        const r = L.querySelector(`[data-id="${d.id}"] em`);
        if (r) r.textContent = cnt(d);
      }
      return;
    }
    let h = '', g = '';
    for (const d of list) {
      if (d.g !== g) {
        g = d.g;
        h += `<div class="grp">${g}</div>`;
      }
      const ok = this.done.has(d.id);
      h += `<div class="row${ok ? ' ok' : ''}${d.fight && this.opt.beh !== 'weak' && this.opt.beh !== 'strong' ? ' dim' : ''}" data-id="${d.id}"><i class="ck">${ok ? ICON.check : ''}</i><span>${this.drillName(d)}${d.fight ? '<small>（サンドバッグを「反撃」にすると練習できる）</small>' : ''}</span><em>${cnt(d)}</em></div>`;
    }
    L.innerHTML = h;
    box.querySelectorAll('.beh button').forEach((b) => b.classList.toggle('on', b.dataset.k === this.opt.beh));
    box.querySelectorAll('.num button').forEach((b) => b.classList.toggle('on', +b.dataset.n === this.opt.n));
  }

  // ===== 毎フレーム =====
  update(dt) {
    if (this.phase === 'play') {
      const P = this.player;
      if (this.opt.nocd) {
        P.ksCd = 0;
        for (let i = 0; i < P.omCd.length; i++) P.omCd[i] = 0;
      }
      if (this.opt.spfull && P.alive) P.sp = 1;
      for (const d of this.dummies) this.driveDummy(d, dt);
    }
    super.update(dt);
    if (this.phase !== 'play') return;
    // サンドバッグの速さ（動く＝ゆっくり）
    for (const d of this.dummies) {
      // ふっとばされているあいだは、速さをおさえない
      if (d.trainSpeed && d.vel.lengthSq() > 0 && !(d.stunT > 0) && !(d.hurtT > 0)) {
        const max = 14.5 * d.trainSpeed;
        const v = d.vel.length();
        if (v > max && d.state !== 'dash') d.vel.multiplyScalar(max / v);
      }
    }
    this.track();
    // ダメージの表示（0.25秒ごと）
    this._dT = (this._dT || 0) - dt;
    if (this._dT <= 0 && this.panel) {
      this._dT = 0.25;
      while (this.dmgLog.length && this.time - this.dmgLog[0][0] > 1) this.dmgLog.shift();
      const dps = this.dmgLog.reduce((a, x) => a + x[1], 0);
      this.panel.querySelector('.tot').textContent = Math.round(this.dmgTotal).toLocaleString();
      this.panel.querySelector('.dps').textContent = Math.round(dps).toLocaleString();
    }
  }
  // 試合ではないので、終わりも結果もない
  finish() {}
  toResult() {}
  dispose() {
    this.running = false;
    super.dispose();
  }
}
