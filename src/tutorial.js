// 操作の練習（キックフライトのチュートリアルと同じ順番）
import * as THREE from 'three';
import { ICON } from './icons.js';
import { Match } from './match.js';
import { el, $ } from './util.js';
import { sound } from './audio.js';
import { saveSave } from './save.js';

const STEPS = [
  // two：両手の操作（左の親指で移動・右の親指で視点）のときの文
  { id: 'dash', label: '移動', msg: 'まずは加速の基本。<em>タップ</em>でブーストダッシュしよう！<br><small>黄色いゲージを1つ使う。時間で回復するよ</small>', two: 'まずは加速の基本。<em>タップ</em>でブーストダッシュしよう！<br><small>左右どちらの親指でもOK。黄色いゲージを1つ使う</small>', need: 3, hint: 'center' },
  { id: 'fly', label: '移動', msg: '<em>長押し</em>で飛び続けよう！<br>押したまま<em>指をスライド</em>すると旋回できる', two: '<em>左の親指で長押し</em>して飛び続けよう！（左はアクセル。はなすと止まる）<br>飛ぶ向きは<em>右の親指でなぞって</em>変えられる', need: 60, unit: 'm', hint: 'hold' },
  { id: 'look', label: '移動', msg: '止まっているときは<em>指をすべらせたまま</em>（はなさずに）動かすと、その場で向きを変えられる<br><small>すばやく動かして離すとステップ（回避）になるよ</small>', two: '<em>右の親指で画面をなぞる</em>と、視点（向き）がぐるっと動く！<br><small>飛びながらでも、止まっていても使えるよ</small>', need: 180, unit: '°', hint: 'swipe' },
  { id: 'brake', label: '移動', msg: '飛んでいるときに<em>下フリック</em>で急ブレーキ！<br><small>（止まっているときはバックステップ）</small>', two: '飛んでいるときに<em>左の親指で下フリック</em>で急ブレーキ！<br><small>（止まっているときはバックステップ）</small>', need: 2, hint: 'down' },
  { id: 'step', label: '移動', msg: '止まっているときに<em>横フリック</em>でステップ！<br><small>飛んでいるときはバレルロールになる</small>', two: '止まっているときに<em>左の親指で横フリック</em>でステップ！<br><small>飛んでいるときはバレルロールになる</small>', need: 2, hint: 'side' },
  { id: 'uturn', label: '移動', msg: '<em>上→下の連続フリック</em>で、くるっと真後ろを向こう！', two: '<em>左の親指で上→下の連続フリック</em>で、くるっと真後ろを向こう！', need: 1, hint: 'updown' },
  { id: 'collect', label: 'スクランブル', msg: '移動を使いこなして<em>サクラ</em>を集めよう！<br><small>近くを通るだけで取れる。持つほど遅くなる</small>', need: 6, hint: null },
  { id: 'deposit', label: 'スクランブル', msg: '青いダルマに近づいて、右下の<em>「預ける」を長押し</em>！<br><small>預けたサクラは倒されてもなくならない</small>', need: 4, hint: 'deposit' },
  { id: 'attack', label: '攻撃', msg: '敵があらわれた！右の<em>顔アイコンをタップ</em>でロックオン。<br>近づくと<em>自動でパンチ</em>するよ', need: 4, hint: 'lock' },
  { id: 'om', label: '攻撃', msg: '下の<em>ディスクを上にフリック</em>して、ディスクの技を出そう！（先生やラーメンが出てくる）', need: 1, hint: 'om' },
  { id: 'ks', label: '攻撃', msg: 'まん中の<em>顔のアイコンを上にフリック</em>！パンチャースキル', need: 1, hint: 'ks' },
  { id: 'sp', label: '攻撃', msg: '最後に、戦況を一気に変える<em>スペシャル</em>！<br>光っている<em>SPボタン</em>をタップ', need: 1, hint: 'sp' },
];

export class Tutorial extends Match {
  constructor(app, opts) {
    super(app, { ...opts, solo: true });
    this.isTutorial = true;
    this.noTimer = true;
    this.step = 0;
    this.count = 0;
    this.prev = {};
    this.box = el('div', 'tut', '<div class="box"><span class="lbl"></span><span class="msg"></span><span class="cnt"></span></div>');
    app.hudRoot.appendChild(this.box);
    this.hand = el('div', 'handhint hidden', ICON.touch);
    app.hudRoot.appendChild(this.hand);
    this.enemy = null;
    // 最初はダルマに少しサクラを預けておく（攻撃の目印）
    this.showStep();
  }
  // 両手の操作（左で移動・右で視点）か
  twoHands() {
    return this.input && this.input.scheme === 'two';
  }
  snapshot() {
    const p = this.player;
    return { state: p.state, stepUp: p.stepUp, pick: p.stats.pick, dep: p.stats.dep, hits: p.stats.hits, om: p.stats.om, ks: p.stats.ks, sp: p.stats.sp, yaw: p.yaw, pos: p.pos.clone() };
  }
  showStep() {
    const S = STEPS[this.step];
    if (!S) return;
    this.count = 0;
    this.box.querySelector('.lbl').textContent = S.label + ' ' + (this.step + 1) + '/' + STEPS.length;
    this.box.querySelector('.msg').innerHTML = this.twoHands() && S.two ? S.two : S.msg;
    const b = this.box.querySelector('.box');
    b.style.animation = 'none';
    void b.offsetWidth;
    b.style.animation = '';
    this.updateCount();
    this.prev = this.snapshot();
    // 攻撃の練習で敵を出す
    if (S.id === 'attack' && !this.enemy) {
      // 練習の相手は、はじめからいる3人から（新しい仲間は強さがいろいろなので）
      const id = ['tora', 'even', 'aomachi'].find((x) => x !== this.opts.char) || 'tora';
      this.enemy = this.addPuncher(id, 1, 0, null);
      // 自分の前に出す
      const P = this.player;
      this.enemy.pos.copy(P.pos).addScaledVector(P.flatFwd, 12);
      this.enemy.pos.y += 1;
      this.enemy.yaw = P.yaw + Math.PI;
      this.enemy.maxHp = 99999;
      this.enemy.hp = 99999;
      this.enemy.invuln = 0;
      this.enemy.displayName = 'れんしゅう相手';
    }
    if (S.id === 'sp') {
      this.player.sp = 1;
      sound.play('spReady');
    }
    if (S.id === 'om' || S.id === 'ks') {
      this.player.omCd = this.player.omCd.map(() => 0);
      this.player.ksCd = 0;
    }
  }
  updateCount() {
    const S = STEPS[this.step];
    const c = Math.min(S.need, Math.floor(this.count));
    this.box.querySelector('.cnt').textContent = c + '/' + S.need + (S.unit || '');
  }
  update(dt) {
    super.update(dt);
    if (this.phase !== 'play' || this.done) return;
    const S = STEPS[this.step];
    if (!S) return;
    const p = this.player;
    const now = this.snapshot();
    const pv = this.prev;
    let inc = 0;
    switch (S.id) {
      case 'dash':
        if (now.state === 'dash' && pv.state !== 'dash') inc = 1;
        break;
      case 'fly': {
        const d = now.pos.distanceTo(pv.pos);
        if ((p.state === 'fly' || p.state === 'cruise') && d < 5) inc = d; // ワープは数えない
        break;
      }
      case 'look':
        // 止まってスライド（片手）か、右の親指（両手：飛びながらでも数える）
        if (p.state !== 'uturn' && ((p.intent.lookActive && !p.lock) || (!p.intent.hold && (p.state === 'hover' || p.ground)))) {
          let d = now.yaw - pv.yaw;
          while (d > Math.PI) d -= Math.PI * 2;
          while (d < -Math.PI) d += Math.PI * 2;
          inc = (Math.abs(d) * 180) / Math.PI;
        }
        break;
      case 'brake':
        if (now.state === 'brake' && pv.state !== 'brake') inc = 1;
        if (now.state === 'step' && pv.state !== 'step' && p.stepDir && p.stepDir.dot(p.flatFwd) < -0.5) inc = 1;
        break;
      case 'step':
        if ((now.state === 'step' && pv.state !== 'step' && !now.stepUp) || (now.state === 'roll' && pv.state !== 'roll')) inc = 1;
        break;
      case 'uturn':
        if (now.state === 'uturn' && pv.state !== 'uturn') inc = 1;
        break;
      case 'collect':
        inc = now.pick - pv.pick;
        break;
      case 'deposit':
        inc = now.dep - pv.dep;
        break;
      case 'attack':
        inc = now.hits - pv.hits;
        break;
      case 'om':
        inc = now.om - pv.om;
        break;
      case 'ks':
        inc = now.ks - pv.ks;
        break;
      case 'sp':
        inc = now.sp - pv.sp;
        break;
    }
    this.prev = now;
    if (inc > 0) {
      const before = Math.floor(this.count);
      this.count += inc;
      if (Math.floor(this.count) !== before) this.updateCount();
      if (this.count >= S.need) {
        sound.play('goal');
        this.app.bigText('GOOD', 'go');
        this.step++;
        if (this.step >= STEPS.length) this.complete();
        else setTimeout(() => this.running && this.showStep(), 700);
      }
    }
    // 練習相手はゆっくり動くだけ
    if (this.enemy && this.enemy.alive) {
      const e = this.enemy;
      e.intent.hold = false;
      e.intent.stickX = 0.2;
      if (e.hp < 90000) e.hp = 99999;
    }
    this.updateHand(S);
  }
  updateHand(S) {
    const h = this.hand;
    const H = this.hud;
    let r = null;
    if (S.hint === 'om') r = H.slots[0].b.getBoundingClientRect();
    else if (S.hint === 'ks') r = H.slots[2].b.getBoundingClientRect();
    else if (S.hint === 'sp') r = H.spBtn.getBoundingClientRect();
    else if (S.hint === 'deposit' && !H.depBtn.classList.contains('hidden')) r = H.depBtn.getBoundingClientRect();
    else if (S.hint === 'lock' && !this.player.lock && H.lockBtns[0] && !H.lockBtns[0].b.classList.contains('hidden')) r = H.lockBtns[0].b.getBoundingClientRect();
    else if (S.hint === 'center' || S.hint === 'hold' || S.hint === 'swipe' || S.hint === 'down' || S.hint === 'side' || S.hint === 'updown') {
      // 両手のときは、移動（長押し・フリック）は画面の左、視点（なぞる）は右に手を出す
      let cx = this.viewW / 2;
      if (this.twoHands()) cx = S.hint === 'swipe' ? this.viewW * 0.74 : this.viewW * 0.27;
      r = { left: cx - 20, top: this.viewH * 0.62, width: 40, height: 40 };
    }
    if (!r) {
      h.classList.add('hidden');
      return;
    }
    h.classList.remove('hidden');
    // 手の絵は CSS で中心に合わせてある（margin）。動き方は data-k ごとに CSS で変える
    const x = Math.round(r.left + r.width / 2) + 'px';
    const y = Math.round(r.top + r.height * 0.55) + 'px';
    if (h.style.left !== x) h.style.left = x;
    if (h.style.top !== y) h.style.top = y;
    const k = S.hint || 'center';
    if (h.dataset.k !== k) h.dataset.k = k;
  }
  complete() {
    this.done = true;
    this.hand.classList.add('hidden');
    this.box.querySelector('.lbl').textContent = 'クリア';
    this.box.querySelector('.msg').innerHTML = '基本操作はこれで全部！<br>本番は<em>4対4</em>で、3分間でより多くのサクラを集めたチームの勝ち！';
    this.box.querySelector('.cnt').innerHTML = ICON.check;
    this.app.save.tutorial = true;
    saveSave(this.app.save);
    sound.play('win');
    setTimeout(async () => {
      if (!this.running) return;
      const ok = await this.app.confirm('チュートリアル完了！', 'このまま本番（CPUと4対4・スクランブル）をやってみる？', 'やってみる', 'ホームへ');
      this.app.endMatch();
      if (ok) {
        this.app.save.mode = 'scramble';
        this.app.save.diff = 'easy';
        saveSave(this.app.save);
        this.app.startMatch();
      } else this.app.showHome();
    }, 1800);
  }
  dispose() {
    this.running = false;
    super.dispose();
  }
}
