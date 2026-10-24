// 1試合（4対4・3分）
import * as THREE from 'three';
import { MATCH_TIME, RESPAWN_TIME, TEAM, COMBAT, DIFFICULTY, MODES, diffKey, allyDiffKey } from './config.js';
import { PUNCHERS, PUNCHER_IDS, OMAMORI } from './characters.js';
import { buildStage } from './stage.js';
import { Puncher } from './entity.js';
import { Combat } from './combat.js';
import { Skills } from './skills.js';
import { Brain, assignRoles } from './ai.js';
import { createMode, Guardian } from './modes.js';
import { FX, projectileLook } from './fx.js';
import { FollowCam } from './camera.js';
import { Hud, STAMPS } from './hud.js';
import { sound } from './audio.js';
import { shuffle, el, clamp, rand, vibrate } from './util.js';
import { disposeDeep } from './gfx.js';
import { buildMonster } from './monsters.js';
import { BlobShadows } from './shadow.js';
import { GRADES } from './post.js';
import { KO_EMOTE } from './model.js';
import { applySynergy, updateSynergy, PAIRS, MACHIDA } from './kits.js';
import { RULE_TEXT } from './rules.js';

const _v = new THREE.Vector3();
// スタンプ → 身ぶり（ナイス・ありがとう・集まれ・守って・攻める・ドンマイ・ガハハ・ごめん）
const STAMP_EMOTE = ['thumbs', 'bow', 'wave', 'point', 'flex', 'thumbs', 'laugh', 'sorry'];

export class Match {
  constructor(app, opts) {
    this.app = app;
    this.opts = opts;
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xcfe9ff, 140, 430);
    const hemi = new THREE.HemisphereLight(0xffffff, 0x9fb4cf, 1.55);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff4e0, 2.1);
    sun.position.set(60, 120, -80);
    this.scene.add(sun);
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.3, 2200);
    this.stage = buildStage(this.scene, { id: opts.stage });
    this.world = this.stage.world;
    // ステージごとの空気（霧・光の色）
    const env = this.stage.env;
    if (env) {
      this.scene.fog.color.setHex(env.fog[0]);
      this.scene.fog.near = env.fog[1];
      this.scene.fog.far = env.fog[2];
      hemi.color.setHex(env.hemi[0]);
      hemi.groundColor.setHex(env.hemi[1]);
      hemi.intensity = env.hemi[2];
      sun.color.setHex(env.sun[0]);
      sun.intensity = env.sun[1];
      sun.position.set(...env.sun[2]);
    }
    this.diffKey = diffKey(opts.difficulty || 'easy');
    this.diff = DIFFICULTY[this.diffKey];
    this.time = 0;
    this.timeLeft = MATCH_TIME;
    this.phase = 'intro';
    this.phaseT = 0;
    this.overtime = false;
    this.running = true;
    this.timeScale = 1;
    this.hitStopT = 0;
    this.slowT = 0;
    this.slowScale = 1;
    this.aiReserve = new Map();
    this.playerName = opts.playerName || 'プレイヤー';
    // オンライン対戦のしるし（HUDを作る前に決めておく）
    this.online = !!opts.online;
    this.netClient = !!opts.netClient;
    if (opts.room) this.room = opts.room;
    this.viewW = app.viewW;
    this.viewH = app.viewH;
    // ダルマ
    this.guardians = [0, 1].map((t) => new Guardian(this, t, this.stage.bases[t].daruma));
    // パンチャー：プレイヤー＋味方3人／敵4人
    this.punchers = [];
    const myTeam = 0;
    const roster = (team, includePlayer, avoid = []) => {
      const ids = shuffle(PUNCHER_IDS.slice());
      const list = [];
      const put = (id) => {
        if (list.length < 4 && !list.includes(id)) list.push(id);
      };
      if (includePlayer) list.push(opts.char);
      // ときどき、相性のいい組み合わせ（カップル・町田の4人）をいっしょに出す
      const r = Math.random();
      if (r < 0.12 && (!includePlayer || MACHIDA.includes(opts.char))) MACHIDA.forEach(put);
      else if (r < 0.5) {
        // エブン×ゆか（蹴られる）は、自分がエブンかゆかのときはわざわざ入れない（たまたま入ることはある）
        const noKick = includePlayer && (opts.char === 'even' || opts.char === 'yuka');
        const pool = noKick ? PAIRS.filter((x) => !x.kick) : PAIRS;
        const mine = includePlayer ? pool.filter((x) => x.a === opts.char || x.b === opts.char) : [];
        const pr = mine.length && Math.random() < 0.6 ? mine[0] : pool[Math.floor(Math.random() * pool.length)];
        if (!includePlayer || list.length + 2 <= 4 || pr.a === opts.char || pr.b === opts.char) {
          put(pr.a);
          put(pr.b);
        }
      }
      // のこりは、相手チームとかぶらないキャラから
      for (const id of ids) if (!avoid.includes(id)) put(id);
      for (const id of ids) put(id);
      return list;
    };
    if (opts.roster) {
      this.buildFromRoster(opts);
    } else this.buildRandom(opts, roster, myTeam);
    this.player = this.punchers.find((p) => p.isPlayer) || this.punchers[0];
    this.punchers.forEach((p, i) => (p.netId = i));
    this.applyCpuLevels();
    // 相性（同じチームのカップル・町田の4人・敵どうし）。ホストも入った人も同じ組み合わせから同じ結果
    applySynergy(this);
    this.combat = new Combat(this);
    this.skills = new Skills(this);
    this.mode = createMode(opts.mode, this);
    // CPU（オンライン対戦の、ほかの端末の人には付けない）
    if (!opts.noBrains) {
      for (let team = 0; team < 2; team++) {
        const members = this.punchers.filter((p) => p.team === team);
        const roles = assignRoles(members);
        members.forEach((p, i) => {
          if (p.cpu) p.brain = new Brain(p, this, roles[i]);
        });
      }
    }
    // スタート位置
    for (const p of this.punchers) this.placeAtBase(p);
    this.fx = new FX(this, app.fxLayer);
    this.shadows = new BlobShadows(this.scene, this.world);
    this.grade = GRADES[this.stage.id] || GRADES.sakura; // 仕上げの色（post.js）
    this.fxNoBoost = (p) => this.fx.noBoost(p);
    this.cam = new FollowCam(this.camera, this.world);
    this.hud = new Hud(app.hudRoot, this, app.portraits);
    this.input = app.input;
    this.input.reset();
    this.bindHud();
    this.input.isMoving = () => {
      const s = this.player.state;
      return s === 'fly' || s === 'cruise' || s === 'dash' || s === 'roll';
    };
    this.resize(app.viewW, app.viewH);
    // 開始の演出：上からぐるっと見せる
    this.introCam = { t: 0 };
    sound.playBgm('battle');
    this.announce(MODES[opts.mode].name + (this.stage.name ? '\n' + this.stage.name : ''), -1, true);
    // v1.7：はじめに「勝ち方」をひとこと（チュートリアル・訓練場では出さない）
    if (!opts.solo && RULE_TEXT[opts.mode]) {
      this.goalCard = el('div', 'goalcard', `<span>勝ち方</span><b>${RULE_TEXT[opts.mode].goal}</b>`);
      app.hudRoot.appendChild(this.goalCard);
    }
    // どっちのチームか、はじめにはっきり出す（赤チームなのに青に見えて混乱した、の対策）
    const myT = this.player ? this.player.team : 0;
    this._teamT = setTimeout(() => {
      if (this.running && this.hud && (this.phase === 'intro' || this.phase === 'wait')) this.announce('あなたは' + TEAM[myT].name, myT, true);
      // 相性が出ていたら、そのあとに知らせる
      const syn = (this.synergies || []).slice(0, 3);
      if (syn.length) this._synT = setTimeout(() => this.running && this.hud && this.showSynergies(syn), 1500);
    }, 2300);
    this.prewarm();
  }

  // この試合で出るモンスターと技の弾を、先に GPU で準備しておく（はじめて出たときに一瞬止まらないように）
  prewarm() {
    const R = this.app.renderer;
    if (!R || this.app.noRender || typeof R.compile !== 'function') return;
    try {
      const g = new THREE.Group();
      const mons = new Set(); // ディスクの見た目
      for (const p of this.punchers) for (const id of p.omamori || []) if (OMAMORI[id] && OMAMORI[id].mon) mons.add(OMAMORI[id].mon);
      for (const m of mons) g.add(buildMonster(m));
      const kinds = new Set(['akahon', 'tangocho', 'pencil']);
      for (const p of this.punchers) if (p.def.attack.proj) kinds.add(p.def.attack.proj);
      for (const p of this.punchers) if (p.def.attack.shot && p.def.attack.shot.proj) kinds.add(p.def.attack.shot.proj);
      if (this.punchers.some((p) => p.def.skill.id === 'iceFrappe')) kinds.add('ice');
      if (this.punchers.some((p) => p.def.skill.id === 'oniden')) kinds.add('phone');
      if (this.punchers.some((p) => (p.omamori || []).includes('cookie'))) kinds.add('cookie');
      for (const k of kinds) g.add(projectileLook(k));
      // 試合では「後処理の板（linear）」に描くので、その形のシェーダーを用意する（画面に直接描く形とは別物）
      const post = this.app.post;
      const prev = R.getRenderTarget();
      R.setRenderTarget(post && post.enabled && !post.failed ? post.main : null);
      R.compile(g, this.camera, this.scene);
      R.setRenderTarget(prev);
    } catch (e) {}
    // スペシャルのカットインの絵も、開始の演出のあいだに作っておく（1枚ずつ間をあけて。はじめてのスペシャルで止まらないように）
    const PT = this.app.portraits, me = this.player;
    if (!PT || !me) return;
    const todo = [], seen = new Set();
    for (const p of this.punchers) {
      const facing = p.team !== me.team ? -1 : 1;
      const k = p.def.id + '|' + p.team + '|' + facing;
      if (seen.has(k)) continue;
      seen.add(k);
      todo.push([p.def.id, p.team, facing]);
    }
    let i = 0;
    const step = () => {
      if (!this.running || i >= todo.length) return;
      const [id, team, f] = todo[i++];
      try {
        PT.cut(id, team, f);
      } catch (e) {}
      setTimeout(step, 120);
    };
    setTimeout(step, 400);
  }

  // オンライン対戦：決まった組み合わせで人を出す
  buildFromRoster(opts) {
    for (const r of opts.roster) {
      const def = PUNCHERS[r.char] || PUNCHERS.tora;
      const isPlayer = r.idx === opts.meIdx;
      const p = new Puncher(this, def, r.team, r.slot, isPlayer);
      p.human = !!r.human;
      p.cpu = !r.human;
      p.peer = r.human || null;
      p.displayName = String(r.name || def.short || def.name).slice(0, 10);
      if (r.deck && r.deck.length === 4 && r.deck.every((id) => OMAMORI[id])) {
        p.omamori = r.deck.slice();
        p.omCd = p.omamori.map(() => 0);
        p.elem = def.elem || OMAMORI[p.omamori[0]].elem;
        p.omLv = (r.lv || [1, 1, 1, 1]).slice(0, 4);
      } else {
        const lv = DIFFICULTY[diffKey(opts.difficulty)].omLv;
        p.omLv = [lv, lv, lv, lv];
      }
      this.punchers.push(p);
    }
  }

  buildRandom(opts, roster, myTeam) {
    let teams;
    if (opts.solo) teams = [[opts.char], []];
    else if (opts.teams) teams = opts.teams.map((t) => t.slice(0, 4).map((id) => (PUNCHERS[id] ? id : 'tora'))); // テスト用：決まった組み合わせ
    else {
      const mine = roster(myTeam, true);
      teams = [mine, roster(1 - myTeam, false, mine)];
    }
    // フレンドがいたら、その人の名前とキャラでCPUを出す（味方から順に）
    const friendSlots = [];
    if (!opts.solo && opts.friends && opts.friends.length) {
      const fl = shuffle(opts.friends.slice()).slice(0, 7);
      const order = [[0, 1], [1, 0], [0, 2], [1, 1], [0, 3], [1, 2], [1, 3]];
      fl.forEach((f, i) => {
        const [team, slot] = order[i];
        if (PUNCHERS[f.c]) teams[team][slot] = f.c;
        friendSlots.push({ team, slot, name: f.n });
      });
    }
    for (let team = 0; team < 2; team++) {
      teams[team].forEach((id, slot) => {
        const isPlayer = team === myTeam && slot === 0;
        const def = PUNCHERS[id];
        const p = new Puncher(this, def, team, slot, isPlayer);
        p.human = isPlayer;
        p.cpu = !isPlayer;
        if (isPlayer && opts.deck) {
          p.omamori = opts.deck.slice();
          p.omCd = p.omamori.map(() => 0);
          p.elem = def.elem || OMAMORI[p.omamori[0]].elem;
          p.omLv = (opts.deckLv || []).slice();
        } else if (!isPlayer) {
          const lv = DIFFICULTY[diffKey(opts.difficulty)].omLv;
          p.omLv = [lv, lv, lv, lv];
        }
        if (!isPlayer) {
          p.displayName = def.short || def.name;
        } else p.displayName = this.playerName;
        this.punchers.push(p);
      });
    }
    for (const fs of friendSlots) {
      const p = this.punchers.find((q) => q.team === fs.team && q.slot === fs.slot);
      if (p && !p.isPlayer) {
        p.displayName = String(fs.name).slice(0, 10);
        p.friend = true;
      }
    }
  }

  // 相性の知らせ（同じチームのカップル・町田ブラザーズ・敵どうし）
  showSynergies(list) {
    const me = this.player ? this.player.team : 0;
    for (const x of list) {
      if (x.bad) this.hud.toastSyn && this.hud.toastSyn('💔 ' + x.name + '　ちょっと弱くなる', -1, true);
      else {
        const who = x.team === me ? '味方' : '敵';
        const what = x.machida ? '町田ブラザーズ結成！ 4人とも強くなる' : x.kick ? 'ゆかがエブンを蹴る…エブンはうれしい' : '相性ばつぐん！ 2人とも強くなる';
        this.hud.toastSyn && this.hud.toastSyn((x.machida ? '🏙️ ' : '💞 ') + who + '：' + (x.machida ? '' : x.name + '　') + what, x.team, false);
      }
    }
  }

  // CPUの強さ（v1.7）：一人で遊ぶときは、敵がえらんだ強さ・味方は allyDiffKey。オンラインはみんな同じ強さ
  applyCpuLevels() {
    const key = this.diffKey;
    const me = this.player ? this.player.team : 0;
    const ally = this.online ? key : allyDiffKey(key);
    for (const p of this.punchers) this.setCpuLevel(p, p.team === me ? ally : key);
  }
  setCpuLevel(p, key) {
    if (!p.cpu) {
      p.cpuKey = null;
      p.cpuLv = null;
      return;
    }
    p.cpuKey = DIFFICULTY[key] ? key : this.diffKey;
    p.cpuLv = DIFFICULTY[p.cpuKey];
  }
  // ダルマの弾の強さ（一人で遊ぶときの、敵のダルマだけ弱くする。0＝撃たない）
  guardK(team) {
    if (this.online || !this.player || team === this.player.team) return 1;
    return this.diff.guard;
  }

  omOf(id) {
    return OMAMORI[id];
  }

  // あとから人を足す（チュートリアル用）
  addPuncher(id, team, slot, role) {
    const p = new Puncher(this, PUNCHERS[id], team, slot, false);
    p.displayName = PUNCHERS[id].short || PUNCHERS[id].name;
    p.cpu = true;
    p.human = false;
    p.netId = this.punchers.length;
    this.punchers.push(p);
    this.setCpuLevel(p, team === (this.player ? this.player.team : 0) ? allyDiffKey(this.diffKey) : this.diffKey);
    if (role) p.brain = new Brain(p, this, role);
    this.placeAtBase(p);
    if (this.hud) this.hud.addMember(p);
    return p;
  }

  placeAtBase(p) {
    const b = this.stage.bases[p.team];
    const sp = b.respawn[p.slot % b.respawn.length];
    p.spawnAt(sp, b.faceYaw);
    p.invuln = 0;
  }

  bindHud() {
    const H = this.hud, me = () => this.player;
    // ロックオンのアイコン
    H.lockBtns.forEach((L) => {
      L.b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (L.target) this.player.intent.events.push({ type: 'lock', target: L.target });
      });
    });
    // スキル：上フリックで発動（タップでも可）、ディスクは下フリックで属性を変える
    H.slots.forEach((s) => {
      let y0 = 0, t0 = 0, id = null;
      s.b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        y0 = e.clientY;
        t0 = performance.now();
        id = e.pointerId;
        try {
          // 押した要素（iPhoneの振動用スイッチ）でつかむ → 指を離したときにスイッチが切りかわってブルッとする
          (e.target && e.target.setPointerCapture ? e.target : s.b).setPointerCapture(e.pointerId);
        } catch (err) {}
        s.b.classList.add('press');
      });
      const up = (e) => {
        if (id !== e.pointerId) return;
        id = null;
        s.b.classList.remove('press');
        const dy = e.clientY - y0;
        if (e.type === 'pointercancel') return;
        if (dy > 26 && s.slot !== 2) {
          const oi = s.slot < 2 ? s.slot : s.slot - 1;
          this.player.intent.events.push({ type: 'elem', slot: oi });
        } else if (dy < -14 || (this.app.settings.tapSkill && Math.abs(dy) < 14)) {
          this.player.intent.events.push({ type: 'skill', slot: s.slot });
        }
      };
      s.b.addEventListener('pointerup', up);
      s.b.addEventListener('pointercancel', up);
    });
    H.spBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.player.intent.events.push({ type: 'special' });
    });
    H.menuBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // 試合が終わったあと（FINISH! のあいだ）はメニューを出さない
      if (this.phase === 'finish' || this.phase === 'result') return;
      this.app.pause();
    });
    // 預ける（長押し）
    const dep = H.depBtn;
    dep.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.player.depositHeld = true;
      dep.classList.add('press');
      try {
        dep.setPointerCapture(e.pointerId);
      } catch (err) {}
    });
    const depUp = () => {
      this.player.depositHeld = false;
      dep.classList.remove('press');
    };
    dep.addEventListener('pointerup', depUp);
    dep.addEventListener('pointercancel', depUp);
    // スタンプ（オンライン対戦）
    if (H.stampBtn) {
      H.stampBtn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        H.stampPal.classList.toggle('hidden');
      });
      H.stampPal.querySelectorAll('button').forEach((b) =>
        b.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          H.stampPal.classList.add('hidden');
          this.sendStamp(+b.dataset.i);
        })
      );
    }
    this.input.ringEl = H.ring;
    this.input.knobEl = H.knob;
  }
  sendStamp() {}
  // スタンプを見せる（味方と自分のだけ）
  showStamp(p, i) {
    const text = STAMPS[i];
    if (!p || !text || p.team !== this.player.team) return;
    this.hud.say(p, text);
    // スタンプに合わせてキャラも身ぶりをする（エモート）
    p.emote(STAMP_EMOTE[i] || 'wave');
    sound.play('ui', 0.7);
  }

  resize(w, h) {
    this.viewW = w;
    this.viewH = h;
    this.cam.setAspect(w / h);
    this.camera.updateProjectionMatrix();
    this.hud.resize();
    if (this.fx.parts) this.fx.parts.mat.uniforms.scale.value = h * 0.9;
  }

  // ===== 毎フレーム =====
  update(dtReal) {
    let dt = Math.min(dtReal, 1 / 20);
    // ヒットストップ・スロー
    if (this.hitStopT > 0) {
      this.hitStopT -= dtReal;
      dt *= 0.08;
    } else if (this.slowT > 0) {
      this.slowT -= dtReal;
      dt *= this.slowScale;
    }
    this.phaseT += dtReal;
    const P = this.player;
    if (this.phase === 'intro') {
      this.updateIntro(dtReal);
    } else if (this.phase === 'play' || this.phase === 'finish') {
      if (this.phase === 'play') {
        this.time += dt;
        if (this.noTimer) this.timeLeft = Math.max(this.timeLeft, 61);
        else if (!this.overtime) this.timeLeft = Math.max(0, this.timeLeft - dt);
        else this.mode.overtime = (this.mode.overtime || 0) + dt;
        this.timerCues();
        if (this.timeLeft <= 0) {
          if (this.mode.timeUp()) this.finish('タイムアップ！');
          else if (!this.overtime) {
            this.overtime = true;
            this.announce('延長戦！', -1, true);
          }
        }
        // 入力
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
        for (const p of this.punchers) if (p.brain) p.brain.update(dt);
      } else {
        P.intent.hold = false;
        P.intent.stickX = P.intent.stickY = 0;
        P.intent.lookX = P.intent.lookY = 0;
        P.intent.lookActive = false;
        P.intent.events.length = 0;
        for (const p of this.punchers) {
          if (p.brain) {
            p.intent.hold = false;
            p.intent.stickX = p.intent.stickY = 0;
            p.intent.events.length = 0;
          }
        }
      }
      for (const p of this.punchers) this.stepPuncher(p, dt);
      this.skills.update(dt);
      if (this.phase === 'play') updateSynergy(this, dt);
      this.combat.update(dt);
      this.mode.update(dt, this.time);
      for (const g of this.guardians) g.update(dt, this.time);
      this.cam.update(P.alive ? P : this.killCamTarget(P), dt);
      if (this.phase === 'finish' && this.phaseT > 2.4) this.toResult();
    }
    this.fx.update(dt, this.camera);
    this.shadows.update(this.punchers);
    this.stage.update(dt, this.time, this.camera.position);
    if (this.phase !== 'result') this.hud.update(dt, this.camera);
  }

  // のこり時間の合図（30秒・最後の5秒）
  timerCues() {
    if (this.noTimer) return;
    if (this.timeLeft <= 30 && !this.hurried) {
      this.hurried = true;
      sound.playBgm('final');
      this.announce('のこり30秒！', -1, true);
    }
    if (this.timeLeft <= 5 && Math.ceil(this.timeLeft) !== this._lastCount && this.timeLeft > 0) {
      this._lastCount = Math.ceil(this.timeLeft);
      sound.play('count');
    }
  }
  stepPuncher(p, dt) {
    p.update(dt);
  }

  killCamTarget(P) {
    // 倒されている間は倒した相手を映す
    const k = P.killedBy;
    if (k && k.alive && k.pos) return k;
    return P;
  }

  updateIntro(dt) {
    const T = this.phaseT;
    const P = this.player;
    // 3,2,1,GO
    const n = 3 - Math.floor(T - 0.6);
    if (T > 0.6 && n >= 1 && n !== this._cd) {
      this._cd = n;
      this.app.bigText(String(n), 'count');
      sound.play('count');
    }
    if (T > 3.6 && this.phase === 'intro') {
      this.phase = 'play';
      this.phaseT = 0;
      this.app.bigText('GO!', 'go');
      sound.play('go');
      this.input.enabled = true;

      for (const p of this.punchers) p.invuln = 0.5;
      return;
    }
    for (const p of this.punchers) {
      p.intent.hold = false;
      p.animate(dt);
    }
    for (const g of this.guardians) g.update(dt, this.phaseT);
    // カメラ：高いところから、自分のうしろへおりてくる
    const k = clamp(T / 3.3, 0, 1);
    const e = 1 - Math.pow(1 - k, 3);
    this.cam.distScale = 1 + (1 - e) * 6;
    this.cam.height = 1.45 + (1 - e) * 16;
    this.cam.update(P, dt, { snap: T < 0.05 });
    if (k >= 1) {
      this.cam.distScale = 1;
      this.cam.height = 1.45;
    }
  }

  // ===== できごと =====
  ko(victim, killer) {
    if (!victim.alive) return;
    victim.alive = false;
    victim.respawnT = RESPAWN_TIME;
    victim.killedBy = killer && killer.def ? killer : null;
    victim.stats.down++;
    victim.lock = null;
    victim.charge = null;
    victim.state = 'ko';
    victim.vel.multiplyScalar(0.4);
    victim.vel.y += 6;
    this.mode.onKO(victim, killer);
    this.skills.onKO && this.skills.onKO(victim, killer);
    // スペシャルゲージ：倒した人は約1.2目盛り、倒された人は約0.7目盛り減る
    victim.sp = Math.max(0, victim.sp - 0.7 / 6);
    if (killer && killer.def) {
      killer.stats.ko++;
      killer.stats.score += 50;
      killer.addSP(1.2 / 6);
    }
    // アシスト
    for (const p of this.punchers) if (p !== killer && p.team !== victim.team && p.lastAssist === victim && this.time - p.lastAssistT < 6) p.stats.assist++;
    for (const p of this.punchers) if (p.lock === victim) p.lock = null;
    this.koFeedback(victim, killer);
  }
  // 倒した・倒されたの見せ方（それぞれの画面の「自分」から見て決める）
  koFeedback(victim, killer) {
    if (!victim) return;
    this.fx.ko(victim);
    // CPU は倒したら、キャラらしい身ぶりで一瞬キメる（攻撃などが始まればそちらが優先）
    if (killer && killer.cpu && killer.alive && killer.def && killer.emote) killer.emote(KO_EMOTE[killer.def.id] || 'thumbs', 1.0);
    if (victim.isPlayer) {
      sound.play('ko');
      vibrate(120);
      this.cam.shake(0.5, 0.4);
    } else if (killer && killer.isPlayer) {
      sound.play('koEnemy');
      vibrate(40);
      this.app.bigText('KO!', 'ko');
    } else sound.play('hitHeavy', 0.6);
    const kn = killer && killer.def ? killer.displayName : 'ダルマ';
    if (victim.isPlayer || (killer && killer.isPlayer) || victim.team === this.player.team) this.announce(`${kn} が ${victim.displayName} をたおした`, killer && killer.team != null ? killer.team : -1);
  }

  respawn(p) {
    const b = this.stage.bases[p.team];
    const sp = b.respawn[p.slot % b.respawn.length];
    p.spawnAt(sp, b.faceYaw);
    p.buffs = { atk: 0, atkT: 0, spd: 0, spdT: 0, shield: 0, shieldT: 0, slowT: 0, slow: 0, regen: 0, regenT: 0, big: 0, ikemen: 0 };
    if (p.model.userData.glasses) p.model.userData.glasses.visible = true;
    p.model.rotation.set(0, p.yaw, 0);
    p.killedBy = null;
    p.life = ((p.life || 0) + 1) & 255;
    this.respawnFeedback(p);
  }
  respawnFeedback(p) {
    if (!p) return;
    this.fx.respawn(p);
    if (p.isPlayer) {
      sound.play('respawn');
      this.cam.first = true;
    }
  }
  // 当たったときの画面のゆれ・止まり（自分がかかわるときだけ）
  hitFeedback(t, src, heavy, melee, stun) {
    if (!t) return;
    if (heavy && (t.isPlayer || (src && src.isPlayer))) this.shake(t.isPlayer ? 0.35 : 0.2, 0.18);
    if (src && (src.isPlayer || t.isPlayer) && (melee || heavy)) this.hitStop(heavy ? COMBAT.hitStop * 1.6 : COMBAT.hitStop);
  }
  justFeedback(t) {
    if (!t) return;
    this.fx.just && this.fx.just(t);
    this.sfx('just', t);
    if (t.isPlayer) this.slowmo(0.35, 0.35);
  }

  // v1.7：右の親指で敵の上をタップしたら、ブーストではなくロックオン（近い敵ほど広くとる）
  tapLock(e) {
    const P = this.player;
    if (!P || !P.alive || e.x == null) return null;
    let best = null, bd = 1e9;
    for (const o of this.punchers) {
      // ロック中の相手はのぞく（そのままタップ＝ダッシュ攻撃。外すのは右の顔アイコンで）
      if (o.team === P.team || !o.alive || o === P.lock) continue;
      const d3 = o.pos.distanceTo(P.pos);
      if (d3 > COMBAT.lockRange) continue;
      _v.copy(o.pos);
      _v.y += 0.3;
      _v.project(this.camera);
      if (_v.z > 1 || Math.abs(_v.x) > 1.05 || Math.abs(_v.y) > 1.05) continue;
      const x = (_v.x * 0.5 + 0.5) * this.viewW, y = (-_v.y * 0.5 + 0.5) * this.viewH;
      const r = clamp(1100 / Math.max(1, d3), 34, 80);
      const d = Math.hypot(x - e.x, y - e.y);
      if (d < r && d < bd) {
        bd = d;
        best = o;
      }
    }
    return best ? { type: 'lock', target: best } : null;
  }

  lockCandidates(p) {
    const out = [];
    for (const o of this.punchers) {
      if (o.team === p.team || !o.alive) continue;
      _v.subVectors(o.pos, p.pos);
      const d = _v.length();
      if (d > COMBAT.candidateRange) continue;
      _v.normalize();
      if (this.world.raycast(p.pos, _v, d) < d - 1.2) continue; // 射線が通らない
      out.push({ o, d });
    }
    out.sort((a, b) => a.d - b.d);
    // ロック中の相手は必ず入れる
    const res = out.slice(0, COMBAT.lockCandidates).map((x) => x.o);
    if (p.lock && !p.lock.isGuardian && !res.includes(p.lock) && p.lock.alive) {
      res.pop();
      res.unshift(p.lock);
    }
    return res;
  }

  announce(text, team, big) {
    this.hud && this.hud.showBanner(text, team, big);
  }
  alertGuardian(team) {
    if (team !== this.player.team) return;
    if (this.time - (this._lastAlert || -9) < 3) return;
    this._lastAlert = this.time;
    this.hud.showAlert();
    sound.play('alert');
  }
  cutin(p) {
    // 自分か、近くの人のスペシャルだけ大きく見せる
    if (p.isPlayer || p.pos.distanceTo(this.player.pos) < 35) {
      this.app.cutin(p);
      this.slowmo(0.3, 0.9);
    }
  }
  sfx(name, src, other, pos) {
    // 遠くの音は小さく
    let v = 1;
    const ref = this.camera.position;
    const at = pos || (src && src.pos);
    if (at) {
      const d = at.distanceTo(ref);
      v = clamp(1.2 - d / 70, 0, 1);
      if (src && src.isPlayer) v = 1;
    }
    if (v > 0.05) sound.play(name, v);
  }
  shake(a, t) {
    this.cam.shake(a, t);
  }
  hitStop(t) {
    this.hitStopT = Math.max(this.hitStopT, t);
  }
  slowmo(scale, t) {
    this.slowScale = scale;
    this.slowT = Math.max(this.slowT, t);
  }
  screenFlash(color, t) {
    this.app.flash(color, t);
  }

  finish(reason) {
    if (this.phase !== 'play') return;
    this.phase = 'finish';
    this.phaseT = 0;
    this.input.enabled = false;
    this.input.reset();
    sound.play('whistle');
    this.app.bigText(reason && reason.includes('ノックアウト') ? 'KNOCK OUT!' : 'FINISH!', 'finish');
    this.result = this.mode.result();
    this.result.reason = this.result.reason || reason;
    // 結果画面の大きな絵を、FINISH! のあいだに作っておく（結果が出る瞬間に止まらないように）
    const me = this.player, w = this.result.winner;
    setTimeout(() => {
      try {
        if (this.app.portraits && me && me.def) this.app.portraits.hero(me.def.id, me.team, w === me.team ? 'win' : w === 0 || w === 1 ? 'lose' : 'hover');
      } catch (e) {}
    }, 500);
  }
  toResult() {
    if (this.phase === 'result') return;
    this.phase = 'result';
    const r = this.result;
    const myTeam = this.player.team;
    const win = r.winner === myTeam ? 1 : r.winner < 0 ? 0 : -1;
    // MVP：チームでいちばん点が高い人
    const mvp = [0, 1].map((t) => {
      let best = null;
      for (const p of this.punchers) if (p.team === t && (!best || p.stats.score > best.stats.score)) best = p;
      return best;
    });
    this.app.showResult({
      win,
      mode: this.opts.mode,
      scores: r.scores,
      unit: r.unit,
      reason: r.reason,
      mvp,
      me: this.player,
      punchers: this.punchers,
      char: this.opts.char,
      online: !!this.online,
      diff: this.diffKey,
    });
  }

  dispose() {
    this.running = false;
    clearTimeout(this._teamT);
    clearTimeout(this._synT);
    this.input.enabled = false;
    this.input.reset();
    this.shadows.dispose();
    // 場面にある物をまとめて GPU から消す（取りのぞく前に。使い回す物は残す）
    disposeDeep(this.scene);
    this.combat.clear();
    this.skills.clear();
    this.fx.clear();
    this.mode.dispose();
    this.stage.dispose();
    this.app.hudRoot.innerHTML = '';
  }
}
