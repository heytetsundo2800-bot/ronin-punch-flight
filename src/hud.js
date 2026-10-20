// バトル画面の表示（スマホ縦持ちの配置）
import * as THREE from 'three';
import { TEAM, ELEM, MOVE, COMBAT } from './config.js';
import { OMAMORI, KIND_COLOR, RARE_COLOR } from './characters.js';
import { BOOST_SEGS, SP_SEGS } from './entity.js';
import { el, fmtTime, clamp, TAU, isIOS } from './util.js';

// iPhone（iOS 18 以降）は、スイッチの切りかえで本体がブルッとする。透明なスイッチをボタンに重ねる
function addHaptic(btn) {
  if (!isIOS) return;
  const h = document.createElement('input');
  h.type = 'checkbox';
  h.setAttribute('switch', '');
  h.className = 'hap';
  h.tabIndex = -1;
  h.setAttribute('aria-hidden', 'true');
  btn.appendChild(h);
}

const _v = new THREE.Vector3();

export class Hud {
  constructor(root, match, portraits) {
    this.root = root;
    this.m = match;
    this.portraits = portraits;
    root.innerHTML = '';
    root.className = 'hud';
    // 上：点数・時間・ミニマップ
    this.top = el('div', 'hud-top');
    this.flagBar = el('div', 'flagbar hidden', '<i class="g0"></i><div class="line"></div><i class="g1"></i><span class="f f0"></span><span class="f f1"></span>');
    this.top.appendChild(this.flagBar);
    this.scoreRow = el('div', 'score-row', '<div class="dia d0"><span>0</span></div><div class="mid"><div class="timer">3:00</div></div><div class="dia d1"><span>0</span></div>');
    this.top.appendChild(this.scoreRow);
    this.mapWrap = el('div', 'minimap');
    this.map = document.createElement('canvas');
    this.mapWrap.appendChild(this.map);
    this.top.appendChild(this.mapWrap);
    root.appendChild(this.top);
    this.timerEl = this.scoreRow.querySelector('.timer');
    this.sc = [this.scoreRow.querySelector('.d0 span'), this.scoreRow.querySelector('.d1 span')];
    // 左右：味方と敵
    this.cols = [el('div', 'team-col left'), el('div', 'team-col right')];
    root.appendChild(this.cols[0]);
    root.appendChild(this.cols[1]);
    this.rows = new Map();
    const me = match.player;
    for (const p of match.punchers) this.addMember(p);
    // メニュー
    this.menuBtn = el('button', 'hud-menu', '<span></span><span></span><span></span>');
    this.menuBtn.setAttribute('aria-label', 'メニュー');
    root.appendChild(this.menuBtn);
    this.mission = el('div', 'hud-mission', '');
    root.appendChild(this.mission);
    // ロックオンの的
    this.lockCol = el('div', 'lock-col');
    root.appendChild(this.lockCol);
    this.lockBtns = [];
    for (let i = 0; i < COMBAT.lockCandidates; i++) {
      const b = el('button', 'lockbtn hidden', '<img alt=""><i class="tri"></i><b class="dist"></b>');
      addHaptic(b);
      this.lockCol.appendChild(b);
      this.lockBtns.push({ b, img: b.querySelector('img'), dist: b.querySelector('.dist'), target: null, key: '' });
    }
    // 自キャラのそば：HP・属性・持ち数・ブースト
    this.self = el('div', 'selfbox', `<div class="elem"></div><div class="shp"><i></i><em></em></div><div class="scarry"><span>0</span></div><svg class="boost" viewBox="0 0 44 44"></svg>`);
    root.appendChild(this.self);
    this.selfHp = this.self.querySelector('.shp i');
    this.selfHpTxt = this.self.querySelector('.shp em');
    this.selfElem = this.self.querySelector('.elem');
    this.selfCarry = this.self.querySelector('.scarry span');
    this.selfCarryBox = this.self.querySelector('.scarry');
    this.boostSvg = this.self.querySelector('.boost');
    this.boostSegs = [];
    for (let i = 0; i < BOOST_SEGS; i++) {
      const a0 = (i / BOOST_SEGS) * TAU - Math.PI / 2 + 0.07, a1 = ((i + 1) / BOOST_SEGS) * TAU - Math.PI / 2 - 0.07;
      const r = 17;
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', `M ${22 + Math.cos(a0) * r} ${22 + Math.sin(a0) * r} A ${r} ${r} 0 0 1 ${22 + Math.cos(a1) * r} ${22 + Math.sin(a1) * r}`);
      this.boostSvg.appendChild(p);
      this.boostSegs.push(p);
    }
    // 下：スキル
    this.deck = el('div', 'deck');
    root.appendChild(this.deck);
    this.slots = [];
    for (let s = 0; s < 5; s++) {
      const isKS = s === 2;
      const b = el('button', 'slot' + (isKS ? ' ks' : ''));
      if (isKS) {
        b.innerHTML = `<img alt=""><b class="cd"></b><i class="up">▲</i>`;
        b.querySelector('img').src = portraits.get(me.def.id, me.team);
      } else {
        const oi = s < 2 ? s : s - 1;
        const om = OMAMORI[me.omamori[oi]];
        b.innerHTML = `<div class="omg" style="--k:${KIND_COLOR[om.kind]};--e:${ELEM[om.elem].color}"><span class="ic">${om.icon}</span><span class="rare" style="color:${RARE_COLOR[om.rare]}">${om.rare}</span></div><b class="cd"></b><span class="kind" style="background:${KIND_COLOR[om.kind]}">${om.kind}</span><i class="up">▲</i>`;
      }
      addHaptic(b);
      this.deck.appendChild(b);
      this.slots.push({ b, cd: b.querySelector('.cd'), slot: s, last: '' });
    }
    this.spBtn = el('button', 'spbtn', '<svg viewBox="0 0 64 64"></svg><b>SP</b>');
    this.spSvg = this.spBtn.querySelector('svg');
    this.spSegs = [];
    for (let i = 0; i < SP_SEGS; i++) {
      const a0 = (i / SP_SEGS) * TAU - Math.PI / 2 + 0.06, a1 = ((i + 1) / SP_SEGS) * TAU - Math.PI / 2 - 0.06;
      const r = 27;
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', `M ${32 + Math.cos(a0) * r} ${32 + Math.sin(a0) * r} A ${r} ${r} 0 0 1 ${32 + Math.cos(a1) * r} ${32 + Math.sin(a1) * r}`);
      this.spSvg.appendChild(p);
      this.spSegs.push(p);
    }
    addHaptic(this.spBtn);
    this.deck.appendChild(this.spBtn);
    this.bottomBar = el('div', 'bottombar', `<span class="nm"></span><span class="pt">0pt</span>`);
    this.ptEl = this.bottomBar.querySelector('.pt');
    this.bottomBar.querySelector('.nm').textContent = match.playerName || 'プレイヤー';
    root.appendChild(this.bottomBar);
    // 預けるボタン（スクランブル）
    this.depBtn = el('button', 'depbtn hidden', '<b>預ける</b><small>長押し</small>');
    root.appendChild(this.depBtn);
    // お知らせ
    this.banner = el('div', 'banner hidden');
    root.appendChild(this.banner);
    this.alert = el('div', 'alertbox hidden', 'ダルマがピンチ！');
    root.appendChild(this.alert);
    // 倒されたとき
    this.dead = el('div', 'deadbox hidden', `<div class="t">復活まであと <b>5</b></div><div class="by"><img alt=""><span></span></div>`);
    root.appendChild(this.dead);
    // スティックの輪
    this.ring = el('div', 'stick-ring', '<div class="knob"></div>');
    root.appendChild(this.ring);
    this.knob = this.ring.querySelector('.knob');
    // 狙われているときの矢印
    this.warn = el('div', 'warn-arrows');
    root.appendChild(this.warn);
    this.warnEls = [];
    this.frame = 0;
    this.mapCtx = this.map.getContext('2d');
    this.resize();
  }

  addMember(p) {
    const me = this.m.player;
    const side = p.team === me.team ? 0 : 1;
    const row = el('div', 'mem t' + p.team + (p === me ? ' me' : ''));
    row.innerHTML = `<div class="face"><img alt=""><b class="x">✕</b></div><div class="info"><div class="hp"><i></i></div><div class="carry"><span>0</span></div></div>`;
    row.querySelector('img').src = this.portraits.get(p.def.id, p.team);
    this.cols[side].appendChild(row);
    this.rows.set(p, { row, hp: row.querySelector('.hp i'), carry: row.querySelector('.carry span'), carryBox: row.querySelector('.carry'), last: '' });
  }

  resize() {
    const r = this.mapWrap.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const s = Math.max(60, r.width || 110);
    this.map.width = s * dpr;
    this.map.height = s * dpr;
    this.mapScale = dpr;
  }

  showBanner(text, team, big) {
    const b = this.banner;
    b.className = 'banner t' + team + (big ? ' big' : '');
    b.textContent = text;
    b.style.animation = 'none';
    void b.offsetWidth;
    b.style.animation = '';
    clearTimeout(this._bt);
    this._bt = setTimeout(() => b.classList.add('hidden'), big ? 2200 : 1600);
  }
  showAlert() {
    this.alert.classList.remove('hidden');
    clearTimeout(this._at);
    this._at = setTimeout(() => this.alert.classList.add('hidden'), 1400);
  }

  update(dt, cam) {
    const M = this.m, me = M.player;
    this.frame++;
    const slow = this.frame % 3 === 0;
    // 時間と点数
    if (slow) {
      this.timerEl.textContent = M.overtime ? '延長' : fmtTime(M.timeLeft);
      this.timerEl.classList.toggle('hurry', M.timeLeft <= 30);
      const s0 = M.mode.score(0), s1 = M.mode.score(1);
      this.sc[0].textContent = s0;
      this.sc[1].textContent = s1;
      this.ptEl.textContent = me.stats.score + 'pt';
      // フラッグの進み具合
      const ex = M.mode.hudExtra();
      if (ex && ex.flag) {
        this.flagBar.classList.remove('hidden');
        const f0 = this.flagBar.querySelector('.f0'), f1 = this.flagBar.querySelector('.f1');
        // 青は左のゴールへ、赤は右のゴールへ
        f0.style.left = 6 + (1 - ex.flag[0]) * 88 + '%';
        f1.style.left = 6 + ex.flag[1] * 88 + '%';
      }
      if (ex && ex.gHp) {
        this.mapWrap.style.setProperty('--g0', ex.gHp[0] < 0 ? 0 : ex.gHp[0]);
        this.mapWrap.style.setProperty('--g1', ex.gHp[1] < 0 ? 0 : ex.gHp[1]);
        this.mapWrap.classList.add('ghp');
        this.mapWrap.classList.toggle('open0', ex.gHp[0] < 0);
        this.mapWrap.classList.toggle('open1', ex.gHp[1] < 0);
      }
      // メンバー
      for (const [p, r] of this.rows) {
        const hp = clamp(p.hp / p.maxHp, 0, 1);
        r.hp.style.width = hp * 100 + '%';
        const c = M.mode.key === 'scramble' ? p.carry.sakura.length : M.mode.key === 'ball' ? p.carry.balls.reduce((a, b) => a + b.value, 0) : p.carry.flag ? '旗' : 0;
        const key = (p.alive ? 1 : 0) + '|' + c + '|' + (p.sp >= 1 ? 1 : 0);
        if (key !== r.last) {
          r.last = key;
          r.carry.textContent = c;
          r.carryBox.classList.toggle('zero', !c);
          r.row.classList.toggle('dead', !p.alive);
          r.row.classList.toggle('sp', p.sp >= 1);
        }
      }
      // ミッション（自分の記録）
      const ms = M.mode.key === 'scramble' ? `<b>${me.stats.pick}</b>拾った・<b>${me.stats.ko}</b>KO` : `<b>${me.stats.ko}</b>KO・<b>${Math.round(me.stats.dmg / 100) / 10}k</b>ダメ`;
      if (ms !== this._ms) {
        this._ms = ms;
        this.mission.innerHTML = ms;
      }
    }
    // スキルのクールタイム
    for (const s of this.slots) {
      let cd = 0, ready = true, extra = '';
      if (s.slot === 2) {
        cd = me.ksCd;
      } else {
        const oi = s.slot < 2 ? s.slot : s.slot - 1;
        cd = me.omCd[oi];
        if (me.charge && me.charge.slot === oi) extra = ' charging';
        if (me.diskLock > 0) ready = false;
        const om = OMAMORI[me.omamori[oi]];
        if (om.elem === me.elem) extra += ' curelem';
      }
      if (cd > 0) ready = false;
      if (!me.alive || me.charge) ready = false;
      const key = Math.ceil(cd) + '|' + ready + extra;
      if (key !== s.last) {
        s.last = key;
        s.cd.textContent = cd > 0 ? Math.ceil(cd) : '';
        s.b.className = 'slot' + (s.slot === 2 ? ' ks' : '') + (ready ? ' ready' : ' wait') + extra;
      }
    }
    const segs = Math.floor(me.sp * SP_SEGS + 0.0001);
    const spKey = segs + '|' + (me.sp >= 1);
    if (spKey !== this._sp) {
      this._sp = spKey;
      this.spSegs.forEach((p, i) => p.classList.toggle('on', i < segs));
      this.spBtn.classList.toggle('full', me.sp >= 1);
    }
    // 自キャラの横
    _v.copy(me.pos);
    _v.project(cam);
    const W = M.viewW, H = M.viewH;
    let sx = (_v.x * 0.5 + 0.5) * W, sy = (-_v.y * 0.5 + 0.5) * H;
    if (_v.z > 1 || !me.alive) {
      sx = W / 2;
      sy = H * 0.62;
    }
    sx = clamp(sx, 90, W - 40);
    sy = clamp(sy, H * 0.3, H * 0.8);
    this.self.style.transform = `translate(${Math.round(sx - 78)}px, ${Math.round(sy - 6)}px)`;
    this.self.classList.toggle('hidden', !me.alive);
    const hp = clamp(me.hp / me.maxHp, 0, 1);
    this.selfHp.style.width = hp * 100 + '%';
    this.selfHp.classList.toggle('low', hp < 0.3);
    if (slow) {
      this.selfHpTxt.textContent = Math.ceil(me.hp);
      this.selfElem.style.borderBottomColor = ELEM[me.elem].color;
      const c = M.mode.key === 'scramble' ? me.carry.sakura.length : M.mode.key === 'ball' ? me.carry.balls.reduce((a, b) => a + b.value, 0) : me.carry.flag ? '旗' : 0;
      this.selfCarry.textContent = c;
      this.selfCarryBox.classList.toggle('zero', !c);
    }
    const b = me.boost;
    for (let i = 0; i < BOOST_SEGS; i++) {
      const f = clamp(b - i, 0, 1);
      const p = this.boostSegs[i];
      const cls = f >= 1 ? 'on' : f > 0 ? 'part' : '';
      if (p.getAttribute('class') !== cls) p.setAttribute('class', cls);
    }
    // ロックオンの的（近くて、間に壁がない敵）
    if (this.frame % 4 === 0) {
      const cand = M.lockCandidates(me);
      for (let i = 0; i < this.lockBtns.length; i++) {
        const L = this.lockBtns[i];
        const t = cand[i];
        L.target = t || null;
        if (!t) {
          L.b.classList.add('hidden');
          continue;
        }
        L.b.classList.remove('hidden');
        const key = t.def.id + t.team;
        if (L.key !== key) {
          L.key = key;
          L.img.src = this.portraits.get(t.def.id, t.team);
        }
        L.dist.textContent = Math.round(t.pos.distanceTo(me.pos)) + 'm';
        L.b.classList.toggle('locked', me.lock === t);
        L.b.classList.toggle('aimed', t.lock === me); // 赤い三角＝相手にねらわれている
      }
    }
    // 預けるボタン
    const canDep = M.mode.canDeposit(me);
    this.depBtn.classList.toggle('hidden', !canDep);
    if (!canDep) me.depositHeld = false;
    // 倒されたとき
    if (!me.alive) {
      this.dead.classList.remove('hidden');
      this.dead.querySelector('b').textContent = Math.max(1, Math.ceil(me.respawnT));
      if (this._killer !== me.killedBy) {
        this._killer = me.killedBy;
        const k = me.killedBy;
        const by = this.dead.querySelector('.by');
        if (k && k.def) {
          by.style.display = '';
          by.querySelector('img').src = this.portraits.get(k.def.id, k.team);
          by.querySelector('span').textContent = (k.displayName || k.def.short || k.def.name) + ' に倒された';
        } else by.style.display = 'none';
      }
    } else this.dead.classList.add('hidden');
    // ミニマップ
    if (this.frame % 2 === 0) this.drawMap(me);
  }

  drawMap(me) {
    const ctx = this.mapCtx, M = this.m;
    const S = this.map.width;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, S, S);
    const R = S / 2;
    ctx.save();
    ctx.beginPath();
    ctx.arc(R, R, R - 1, 0, TAU);
    ctx.clip();
    ctx.fillStyle = 'rgba(12,16,28,0.82)';
    ctx.fillRect(0, 0, S, S);
    // 自分が上を向くように回す
    const scale = (R * 0.95) / 105;
    ctx.translate(R, R);
    ctx.rotate(Math.PI + me.yaw);
    ctx.scale(scale, scale);
    ctx.translate(-me.pos.x, -me.pos.z);
    // 島
    ctx.fillStyle = 'rgba(200,210,230,0.55)';
    for (const is of M.stage.islands) {
      ctx.beginPath();
      ctx.arc(is.x, is.z, is.R, 0, TAU);
      ctx.fill();
    }
    // 場外の線
    const B = M.stage.bounds;
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 2 / scale;
    ctx.strokeRect(-B.x, B.zMin, B.x * 2, B.zMax - B.zMin);
    // ダルマ
    for (const g of M.guardians) {
      ctx.fillStyle = TEAM[g.team].color;
      ctx.beginPath();
      ctx.arc(g.pos.x, g.pos.z, 6, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5 / scale;
      ctx.stroke();
    }
    // ルールの物
    const list = this._list || (this._list = []);
    list.length = 0;
    M.mode.minimap(list, me);
    for (const it of list) {
      if (it.kind === 'sakura') {
        ctx.fillStyle = '#ff9ccc';
        ctx.fillRect(it.pos.x - 1.6, it.pos.z - 1.6, 3.2, 3.2);
      } else if (it.kind === 'flag') {
        ctx.fillStyle = TEAM[it.team].color;
        ctx.beginPath();
        ctx.moveTo(it.pos.x, it.pos.z - 5);
        ctx.lineTo(it.pos.x + 5, it.pos.z);
        ctx.lineTo(it.pos.x, it.pos.z + 5);
        ctx.lineTo(it.pos.x - 5, it.pos.z);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.stroke();
      } else if (it.kind === 'goal' || it.kind === 'ring') {
        ctx.strokeStyle = TEAM[it.team].color;
        ctx.lineWidth = 2.5 / scale;
        ctx.beginPath();
        ctx.arc(it.pos.x, it.pos.z, 7, 0, TAU);
        ctx.stroke();
        if (it.open) {
          ctx.fillStyle = 'rgba(255,255,255,0.6)';
          ctx.fill();
        }
      } else if (it.kind === 'ball' || it.kind === 'rapid') {
        ctx.fillStyle = it.kind === 'rapid' ? '#ff66ff' : '#ffcc66';
        ctx.beginPath();
        ctx.arc(it.pos.x, it.pos.z, it.kind === 'rapid' ? 4 : 2.4, 0, TAU);
        ctx.fill();
      }
    }
    // 人
    for (const p of M.punchers) {
      if (!p.alive || p === me) continue;
      ctx.fillStyle = TEAM[p.team].color;
      ctx.beginPath();
      ctx.arc(p.pos.x, p.pos.z, 3.4, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1 / scale;
      ctx.stroke();
    }
    ctx.restore();
    // 自分（黄色い矢印・まん中で上向き）
    ctx.fillStyle = '#ffd83b';
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(R, R - 8 * this.mapScale);
    ctx.lineTo(R + 5.5 * this.mapScale, R + 6 * this.mapScale);
    ctx.lineTo(R, R + 3 * this.mapScale);
    ctx.lineTo(R - 5.5 * this.mapScale, R + 6 * this.mapScale);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(R, R, R - 1.5, 0, TAU);
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}
