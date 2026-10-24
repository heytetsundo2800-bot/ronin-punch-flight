// 浪人パンチフライト：アプリ全体（画面の切りかえ・描画のループ）
import * as THREE from 'three';
import './styles.css';
import './theme.css';
import { ICON, stageIcon } from './icons.js';
import { VERSION, BUILD, MODES, DIFFICULTY, DIFF_KEYS, diffKey, ELEM, TEAM, rankOf, RANKS, STAGES, STAGE_CHOICES, stageLabel, resolveStage } from './config.js';
import { PUNCHERS, PUNCHER_IDS, OMAMORI, OMAMORI_IDS, KIND_COLOR, KIND_NAME, RARE_COLOR } from './characters.js';
import { buildMonster, poseMonster, MONSTERS } from './monsters.js';
import { projectileLook } from './fx.js';
import { buildPuncher, poseModel, EMOTE_PICKS } from './model.js';
import { Portraits } from './portraits.js';
import { Input } from './input.js';
import { Match } from './match.js';
import { Tutorial } from './tutorial.js';
import { Training } from './training.js';
import { RULE_TEXT, ruleHtml } from './rules.js';
import { sound } from './audio.js';
import { loadSave, saveSave, applyResult, omLevel, weekId } from './save.js';
import { net } from './net.js';
import { Room } from './room.js';
import { HostMatch, ClientMatch } from './netmatch.js';
import { rtcSupported } from './rtc.js';
import { el, $, $$, store, escapeHtml, isIOS, isLINE, isInApp, isStandalone, hasTouch, clamp, damp } from './util.js';
import { PAIRS, MACHIDA } from './kits.js';
import { toon, addOutline, disposeDeep, setOutlineViewport, shadowTex } from './gfx.js';
import { Post, GRADES } from './post.js';
import { buildLobbyArt, LOBBY_GROUND } from './lobbyart.js';

const MODE_KEYS = ['scramble', 'flag', 'ball'];


// まだ作っていない絵のかわり（とうめいな1ドット）
const BLANK_IMG = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
// キャラえらびに出す「相性」（kits.js の PAIRS・MACHIDA から）
function partnerOf(id) {
  const nm = (k) => (PUNCHERS[k] ? PUNCHERS[k].short || PUNCHERS[k].name : k);
  const out = [];
  for (const pr of PAIRS) {
    if (pr.a !== id && pr.b !== id) continue;
    const o = pr.a === id ? pr.b : pr.a;
    let text = '同じチームだと、2人とも攻撃力アップ・受けるダメージが少しへる。';
    if (pr.enemy) text += '敵どうしになると、2人とも少し弱くなる。';
    if (pr.kick) text += id === 'yuka' ? 'そして、ゆかは10秒ごとにエブンを蹴る（エブンはうれしい）。' : 'ただし、ゆかに10秒ごとに蹴られてHPが半分になる（うれしいので少し強くなる）。';
    out.push({ title: nm(o) + 'と同じチーム', text });
  }
  if (MACHIDA.includes(id)) out.push({ title: '町田ブラザーズ', text: MACHIDA.map(nm).join('・') + 'の4人がそろうと、4人とも攻撃力とスピードアップ。' });
  return out;
}

// CPUの強さをえらぶ部品（6段階。◀ ▶ で変える。名前・目もり・説明）
const DIFF_COLOR = ['#7dffb0', '#38d16a', '#3be6ff', '#ffd400', '#ff9d2e', '#ff3f5e'];
function diffPickHtml(cls = '') {
  return `<div class="diffpick ${cls}"><button class="dm" aria-label="CPUを弱くする">${ICON.back}</button><div class="dv"><div class="dn"><span>CPU</span><b></b></div><div class="pips">${DIFF_KEYS.map(() => '<i></i>').join('')}</div><small></small></div><button class="dp" aria-label="CPUを強くする">${ICON.next}</button></div>`;
}
function bindDiffPick(root, get, set) {
  const box = root.querySelector('.diffpick');
  if (!box) return () => {};
  const show = () => {
    const k = diffKey(get());
    const i = DIFF_KEYS.indexOf(k);
    const D = DIFFICULTY[k];
    box.style.setProperty('--lvc', DIFF_COLOR[i] || '#fff');
    box.dataset.k = k;
    box.querySelector('b').textContent = D.name;
    box.querySelector('small').textContent = D.desc;
    box.querySelectorAll('.pips i').forEach((p, j) => p.classList.toggle('on', j <= i));
    box.querySelector('.dm').disabled = i <= 0;
    box.querySelector('.dp').disabled = i >= DIFF_KEYS.length - 1;
  };
  const step = (d) => {
    const i = DIFF_KEYS.indexOf(diffKey(get())) + d;
    if (i < 0 || i >= DIFF_KEYS.length) return;
    set(DIFF_KEYS[i]);
    show();
    sound.play('ui');
  };
  box.querySelector('.dm').onclick = () => step(-1);
  box.querySelector('.dp').onclick = () => step(1);
  show();
  return show;
}

class App {
  constructor() {
    this.errors = [];
    const pushErr = (m) => {
      this.errors.push(String(m).slice(0, 300));
      if (this.errors.length > 12) this.errors.shift();
    };
    window.addEventListener('error', (e) => pushErr((e.message || 'error') + ' @' + (e.filename || '').split('/').pop() + ':' + (e.lineno || '')));
    window.addEventListener('unhandledrejection', (e) => pushErr('promise: ' + (e.reason && e.reason.message ? e.reason.message : e.reason)));
    this.root = $('#app');
    this.save = loadSave();
    this.settings = Object.assign({ sens: 1, lookSens: 1, scheme: 'two', invertX: false, invertY: false, tapSkill: true, quality: 'auto', hand: 'right', guideN: 0 }, store.get('rpf_settings', {}));
    this.screenEl = $('#screens');
    this.hudRoot = $('#hud');
    this.fxLayer = $('#fx');
    this.speedLines = el('div', 'speedlines');
    $('#app').insertBefore(this.speedLines, $('#hud'));
    this.match = null;
    this.paused = false;
    this.viewW = window.innerWidth;
    this.viewH = window.innerHeight;
    this.initGL();
    if (!this.renderer) return;
    this.portraits = new Portraits(this.renderer);
    this.input = new Input($('#touch'), null, null);
    this.applySettings();
    this.initLobby();
    this.bindGlobal();
    this.frameTimes = [];
    this.noRender = /[?&]norender=1/.test(location.search); // 自動テスト用：描かずに動かす
    // 招待リンク（?room=部屋コード）
    try {
      const rq = new URLSearchParams(location.search).get('room');
      if (rq && /^\d{5}$/.test(rq)) this.pendingRoom = rq;
    } catch (e) {}
    this.room = null;
    this.last = performance.now();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
    this.showTitle();
    this.net = net; // 自動テスト用
    net.init(this);
  }

  // ===== 描画の準備 =====
  initGL() {
    const canvas = $('#gl');
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', alpha: false, stencil: false });
    } catch (e) {
      try {
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
      } catch (e2) {
        this.renderer = null;
      }
    }
    if (!this.renderer) {
      this.root.appendChild(el('div', 'nogl', '<div><h2>3Dが表示できません</h2><p>この端末・ブラウザでは WebGL が使えないようです。<br>Safari か Chrome の最新版で開いてみてください。<br>学校の端末の場合は、設定でグラフィックの機能が止められていることがあります。</p></div>'));
      return;
    }
    const R = this.renderer;
    R.outputColorSpace = THREE.SRGBColorSpace;
    R.setClearColor(0x8fcaff, 1);
    this.dprMax = this.settings.quality === 'low' ? 1 : Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = this.settings.quality === 'low' ? 1 : Math.min(this.dprMax, isIOS ? 2 : 1.75);
    R.setPixelRatio(this.dpr);
    // 仕上げ（ブルーム・色の仕上げ）。「かるい」画質では使わない
    this.post = new Post(R);
    this.post.enabled = this.settings.quality !== 'low';
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.contextLost = true;
      this.toast('画面の再読み込みが必要です。少し待つか、ページを開き直してください。', 6000);
    });
    canvas.addEventListener('webglcontextrestored', () => {
      location.reload();
    });
    // 画面の大きさ（iPhoneの表示バグ対策で #app の大きさを使う）
    const ro = new ResizeObserver(() => this.onResize());
    ro.observe(this.root);
    window.addEventListener('orientationchange', () => setTimeout(() => this.onResize(), 300));
    if (window.visualViewport) window.visualViewport.addEventListener('resize', () => this.onResize());
    this.onResize();
  }
  onResize() {
    const r = this.root.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    if (w === this.viewW && h === this.viewH && this._sized) return;
    this._sized = true;
    this.viewW = w;
    this.viewH = h;
    this.renderer.setSize(w, h, false);
    this.syncViewport();
    if (this.match) this.match.resize(w, h);
    if (this.lobby) {
      this.lobby.cam.aspect = w / h;
      this.lobby.cam.updateProjectionMatrix();
    }
  }
  // 解像度が変わったら：仕上げの画面とふちどりの太さも合わせる
  applyDpr() {
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(this.viewW, this.viewH, false);
    this.syncViewport();
  }
  syncViewport() {
    const W = Math.round(this.viewW * this.dpr), H = Math.round(this.viewH * this.dpr);
    setOutlineViewport(W, H, this.dpr);
    if (this.post) this.post.setSize(this.viewW, this.viewH, this.dpr);
  }
  setLowGfx(on) {
    this.lowGfx = on;
    if (this.match) for (const p of this.match.punchers) p.model.traverse((o) => {
      if (o.name === 'outline') o.visible = !on;
    });
  }
  applySettings() {
    this.input.sens = this.settings.sens;
    this.input.lookSens = this.settings.lookSens || 1;
    this.input.scheme = this.settings.scheme === 'one' ? 'one' : 'two';
    this.input.invertY = this.settings.invertY;
    this.input.invertX = !!this.settings.invertX;
    store.set('rpf_settings', this.settings);
  }

  bindGlobal() {
    // 最初のタッチで音を出せるようにする
    const unlock = () => sound.unlock();
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('touchend', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
    // iPhone のピンチ拡大を止める
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('dblclick', (e) => e.preventDefault());
    // 戻るジェスチャーで試合から出てしまわないように
    try {
      history.replaceState({ rpf: 1 }, '');
      history.pushState({ rpf: 2 }, '');
    } catch (e) {}
    window.addEventListener('popstate', () => {
      try {
        history.pushState({ rpf: 2 }, '');
      } catch (e) {}
      if (this.match && this.match.phase === 'play') this.pause();
      else if (this.backHandler) this.backHandler();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.match && this.match.phase === 'play' && !this.match.online) this.pause();
    });
  }

  // ===== ループ =====
  loop(now) {
    requestAnimationFrame(this.loop);
    if (this.contextLost) return;
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt > 0.25) dt = 0.25;
    if (dt <= 0) return;
    this.adaptQuality(dt);
    if (this.match && !this.paused) {
      const n = this.simSpeed || 1; // 自動テストで早送りするとき
      for (let i = 0; i < n && this.match; i++) this.match.update(dt);
      if (this.match && !this.noRender) this.renderMatch();
      // 速いときは集中線
      if (this.match) {
        const P = this.match.player;
        const sp = P.alive ? P.vel.length() : 0;
        const k = Math.max(0, Math.min(1, (sp - 20) / 18));
        const o = (this._slo || 0) + (k - (this._slo || 0)) * Math.min(1, dt * 10);
        this._slo = o;
        const v = o < 0.02 ? '0' : o.toFixed(2);
        if (v !== this._slv) {
          this.speedLines.style.opacity = v;
          this._slv = v;
        }
      }
    } else if (this.match && this.paused) {
      this.renderMatch();
    } else if (this.lobby) {
      this.updateLobby(dt);
      if (!this.noRender) {
        this.post.setGrade(this.lobby.view === 'disc' ? GRADES.disc : GRADES.lobby);
        this.post.render(this.lobby.scene, this.lobby.cam);
      }
    }
  }
  // 試合を描く。カメラがキャラにくっついているとき（うしろが壁）はキャラを消して前が見えるように
  renderMatch() {
    const m = this.match;
    const P = m.player;
    const hide = !!(m.cam && m.cam.close && P && P.model && P.model.visible);
    if (hide) P.model.visible = false;
    this.post.setGrade(m.grade || GRADES.sakura);
    this.post.render(m.scene, m.camera);
    if (hide) P.model.visible = true;
  }
  adaptQuality(dt) {
    this.fpsAvg = this.fpsAvg ? this.fpsAvg * 0.98 + (1 / dt) * 0.02 : 1 / dt;
    // 重いときは解像度を下げる
    if (this.settings.quality !== 'auto') return;
    const F = this.frameTimes;
    F.push(dt);
    if (F.length < 90) return;
    const avg = F.reduce((a, b) => a + b, 0) / F.length;
    F.length = 0;
    if (avg > 1 / 42 && this.dpr > 1) {
      this.dpr = Math.max(1, this.dpr - 0.25);
      this.applyDpr();
    } else if (avg > 1 / 36 && this.dpr <= 1 && this.post.bloomOn && this.match) {
      // まだ重い：光のにじみをやめる → それでも重い：仕上げをやめる → ふちどりを消す
      this.post.bloomOn = false;
    } else if (avg > 1 / 34 && this.dpr <= 1 && this.post.enabled && !this.post.offNext && this.match) {
      // 後処理をやめると全部のシェーダーが作り直しになる（試合中だと数秒止まる）ので、試合が終わってから切る
      this.post.offNext = true;
    } else if (avg > 1 / 32 && this.dpr <= 1 && !this.lowGfx && this.match) {
      // それでも重い：キャラのふちどりを消して軽くする
      this.setLowGfx(true);
    } else if (avg < 1 / 58 && this.dpr < Math.min(this.dprMax, 2)) {
      this.dpr = Math.min(this.dprMax, this.dpr + 0.25);
      this.applyDpr();
    }
  }

  // ===== ロビーの3D（キャラが立っている）=====
  initLobby() {
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x9fb4cf, 1.6));
    const sun = new THREE.DirectionalLight(0xfff4e0, 2.2);
    sun.position.set(4, 8, 6);
    scene.add(sun);
    const cam = new THREE.PerspectiveCamera(35, this.viewW / this.viewH, 0.1, 2000);
    // 空・雲海・雲・浮島（ステージと同じ描き方。lobbyart.js）
    this.lobbyArt = buildLobbyArt(scene);
    // 足もとの影（島の上）
    const isl = new THREE.Group();
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.8), new THREE.MeshBasicMaterial({ map: shadowTex(), color: 0x1a1030, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    sh.rotation.x = -Math.PI / 2;
    sh.position.y = LOBBY_GROUND + 0.02;
    sh.renderOrder = 1;
    isl.add(sh);
    scene.add(isl);
    // 舞う花びら
    // 花びらの形（先が少し割れたしずく形）。ひらひらと回りながら落ちる
    const petals = [];
    const ps = new THREE.Shape();
    ps.moveTo(0, -0.075);
    ps.bezierCurveTo(0.058, -0.04, 0.062, 0.04, 0.024, 0.07);
    ps.lineTo(0, 0.052);
    ps.lineTo(-0.024, 0.07);
    ps.bezierCurveTo(-0.062, 0.04, -0.058, -0.04, 0, -0.075);
    const pg = new THREE.ShapeGeometry(ps, 5);
    const pms = [0xffc6dc, 0xffadcb, 0xffe1ec].map((c) => new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }));
    for (let i = 0; i < 40; i++) {
      const m = new THREE.Mesh(pg, pms[i % 3]);
      m.position.set((Math.random() - 0.5) * 12, Math.random() * 8 - 2, (Math.random() - 0.5) * 8);
      m.userData.v = new THREE.Vector3(0.3 + Math.random() * 0.4, -0.25 - Math.random() * 0.3, 0.1);
      m.userData.w = [0.8 + Math.random() * 1.4, Math.random() * 6.3, 1.5 + Math.random() * 1.5];
      m.rotation.z = Math.random() * 6.3;
      scene.add(m);
      petals.push(m);
    }
    this.lobby = { scene, cam, isl, model: null, charId: null, t: 0, petals, pose: 'ground', spin: 0 };
    this.setLobbyChar(this.save.char);
  }
  setLobbyChar(id, team = 0) {
    const L = this.lobby;
    if (L.model) {
      L.scene.remove(L.model);
      disposeDeep(L.model);
    }
    L.model = buildPuncher(PUNCHERS[id], team);
    L.model.position.set(0, 0.07, 0); // 足が島の上にのるように
    L.scene.add(L.model);
    L.charId = id;
    L.spin = Math.PI * 2;
    // キャラえらびの窓に入れるための、頭の高さ（ふつうに浮かんでいるポーズで1回だけ測る。身ぶりでカメラが動かないように）
    try {
      poseModel(L.model, { mode: 'hover', t: 0.6, speed01: 0, turn: 0, punchSide: 1, punchPhase: 0.3, runPhase: 0, snap: true }, 1);
      L.model.updateMatrixWorld(true);
      L.charTop = L.model.userData.parts.head.getWorldPosition(new THREE.Vector3()).y + 0.4;
    } catch (e) {
      L.charTop = 1.35;
    }
  }
  // ロビーのキャラをタップしたか（画面の上での、頭から足までの範囲）
  hitLobbyChar(x, y) {
    const L = this.lobby;
    if (!L || !L.model || !L.model.visible) return false;
    const r = this.renderer.domElement.getBoundingClientRect();
    const scr = (v) => {
      v.applyMatrix4(L.model.matrixWorld).project(L.cam);
      return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
    };
    const hd = scr(new THREE.Vector3(0, 1.0, 0));
    const ft = scr(new THREE.Vector3(0, -0.95, 0));
    const w = Math.abs(ft[1] - hd[1]) * 0.42;
    return y > hd[1] - 16 && y < ft[1] + 12 && Math.abs(x - (hd[0] + ft[0]) / 2) < w;
  }
  // ロビーのキャラが身ぶりをする（キャラごとに好きな身ぶり）
  lobbyEmote(name) {
    const L = this.lobby;
    if (!L || !L.model) return;
    const pick = EMOTE_PICKS[L.charId] || ['wave'];
    L.emote = name || pick[Math.floor(Math.random() * pick.length)];
    L.emoteT = L.emoteDur = 1.6;
  }
  // ディスクの画面：モンスターを見せる窓の上下（画面の px）。見出しの下〜モンスター名の上。0.5秒ごとに測りなおす
  discWindow(dt) {
    const L = this.lobby;
    L.dwT = (L.dwT || 0) - dt;
    if (!L.dw || L.dwT <= 0) {
      L.dwT = 0.5;
      const H = this.viewH;
      let top = H * 0.07, bot = H * 0.27;
      const scr = document.querySelector('.screen.discsel');
      const hd = scr && scr.querySelector('.hdr'), st = scr && scr.querySelector('.discstage'), inf = scr && scr.querySelector('.dsinfo');
      if (hd && st) {
        const rh = hd.getBoundingClientRect(), rs = st.getBoundingClientRect();
        const ri = inf ? inf.getBoundingClientRect() : null;
        top = rh.bottom + 4;
        bot = ri && ri.height > 10 ? ri.top - 2 : rs.bottom - 74;
      }
      L.dw = { top, bot: Math.max(bot, top + 60) };
    }
    return L.dw;
  }
  // キャラえらびの画面：キャラを見せる窓（一覧の下〜説明の上。画面の px）。0.3秒ごとに測りなおす
  charWindow(dt) {
    const L = this.lobby;
    L.cwT = (L.cwT || 0) - dt;
    if (!L.cw || L.cwT <= 0) {
      L.cwT = 0.3;
      const H = this.viewH;
      let top = H * 0.25, bot = H * 0.6;
      const scr = document.querySelector('.screen.charsel');
      const ls = scr && scr.querySelector('.charlist'), inf = scr && scr.querySelector('.info');
      if (ls && inf) {
        top = ls.getBoundingClientRect().bottom + 6;
        bot = inf.getBoundingClientRect().top - 4;
      }
      L.cw = { top, bot: Math.max(bot, top + 90) };
    }
    return L.cw;
  }
  // 溜め→技→休む の1周で、いちばん大きく動いたときの大きさ（ディスク画面の窓からはみ出さないように）
  // 翼を広げる・のびあがるなど、ポーズで形が変わるので、1周を12回に分けて頂点で測る（光る板などの効果はのぞく）
  monFit(m) {
    const L = this.lobby, U = m.userData;
    const v = new THREE.Vector3();
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    const shown = (o) => {
      for (let q = o; q && q !== m; q = q.parent) if (!q.visible) return false;
      return true;
    };
    for (let i = 0; i < 12; i++) {
      const T = (i / 12) * 3.2;
      const ph = T < 1.1 ? 'charge' : T < 1.9 ? 'act' : 'idle';
      const kk = ph === 'charge' ? T / 1.1 : ph === 'act' ? (T - 1.1) / 0.8 : 0;
      poseMonster(m, ph, kk, T);
      for (const turn of [0.42, 0.7, 0.98]) {
        m.rotation.set(U.tilt || 0, turn, 0);
        const pu = (U.push || 0) * 0.25;
        m.position.set(Math.sin(turn) * pu, -L.monCy * L.monBase + ((U.lift || 0) - (U.dive || 0)) * 0.6, Math.cos(turn) * pu);
        m.scale.setScalar(L.monBase * (ph === 'act' ? 1.05 : 1));
        m.updateMatrixWorld(true);
        m.traverse((o) => {
          if (!o.isMesh || o.name === 'outline' || !o.geometry || !shown(o)) return;
          const mat = Array.isArray(o.material) ? o.material[0] : o.material;
          if (mat && (mat.blending === THREE.AdditiveBlending || (mat.transparent && mat.opacity < 0.35))) return;
          const pa = o.geometry.attributes.position;
          const step = Math.max(1, Math.floor(pa.count / 160));
          for (let j = 0; j < pa.count; j += step) {
            v.fromBufferAttribute(pa, j).applyMatrix4(o.matrixWorld);
            if (v.x < x0) x0 = v.x;
            if (v.x > x1) x1 = v.x;
            if (v.y < y0) y0 = v.y;
            if (v.y > y1) y1 = v.y;
            if (v.z < z0) z0 = v.z;
            if (v.z > z1) z1 = v.z;
          }
        });
      }
    }
    m.scale.setScalar(L.monBase);
    if (!(x1 > x0)) return null;
    // cy：ふつうの置き場所（高さ0.7）から、形のまん中がどれだけずれるか
    return { w: x1 - x0, h: y1 - y0, d: z1 - z0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
  }
  // ディスクの画面：モンスターが技を見せる（溜め→技→休む をくり返す）
  setLobbyMon(monId, discId) {
    const L = this.lobby;
    if (!L) return;
    L.monDisc = discId || null;
    if (L.monId === monId && L.mon) return;
    if (L.mon) L.scene.remove(L.mon);
    const m = buildMonster(monId);
    m.rotation.order = 'YXZ';
    // 大きさをそろえる（いちばん長いところを約3.2に）
    m.updateMatrixWorld(true);
    const box = new THREE.Box3();
    m.traverse((o) => {
      if (o.isMesh && o.name !== 'outline') {
        o.geometry.computeBoundingBox();
        box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
      }
    });
    const sz = box.getSize(new THREE.Vector3());
    const c = box.getCenter(new THREE.Vector3());
    const k = 2.3 / Math.max(sz.x, sz.y, sz.z, 0.5);
    L.monCy = c.y / m.scale.x; // 大きさをかける前の、まん中の高さ
    L.monBase = m.scale.x * k;
    L.monFit = this.monFit(m); // 窓に入るようにカメラの距離を決めるのに使う
    m.scale.setScalar(L.monBase);
    L.scene.add(m);
    L.mon = m;
    L.monId = monId;
    L.monT = 0;
    if (!L.hex) {
      L.hex = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 6, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
      L.scene.add(L.hex);
    }
    L.hex.material.color.set(ELEM[MONSTERS[monId].elem].hex);
  }
  updateLobby(dt) {
    const L = this.lobby;
    L.t += dt;
    if (this.lobbyArt) this.lobbyArt.update(L.t);
    L.spin = damp(L.spin, 0, 6, dt);
    const disc = L.view === 'disc' && L.mon;
    if (L.model) L.model.visible = !disc;
    if (L.mon) L.mon.visible = !!disc;
    // ディスク画面：モンスターのうしろをすっきり（奥の島・木・花びら・足場の島をかくす＝青い空だけ）
    if (this.lobbyArt && this.lobbyArt.far) this.lobbyArt.far.visible = !disc;
    if (this.lobbyArt && this.lobbyArt.ground) for (const g of this.lobbyArt.ground) g.visible = !disc;
    for (const p of L.petals) p.visible = !disc;
    if (disc) {
      // 3秒ごとに：溜め（1秒）→ 技（0.8秒）→ 休む
      L.monT += dt;
      const T = L.monT % 3.2;
      const ph = T < 1.1 ? 'charge' : T < 1.9 ? 'act' : 'idle';
      const kk = ph === 'charge' ? T / 1.1 : ph === 'act' ? (T - 1.1) / 0.8 : 0;
      const m = L.mon, U = m.userData;
      poseMonster(m, ph, kk, L.monT);
      const turn = 0.7 + Math.sin(L.t * 0.35) * 0.28;
      m.rotation.set(U.tilt || 0, turn, 0);
      m.position.set(Math.sin(turn) * U.push * 0.25, 0.7 - L.monCy * L.monBase + (U.lift - U.dive) * 0.6 + Math.sin(L.t * 1.6) * 0.06, Math.cos(turn) * U.push * 0.25);
      m.scale.setScalar(L.monBase * (ph === 'act' ? 1 + Math.sin(kk * Math.PI) * 0.05 : 1));
      // 攻撃のディスクは、口から弾が飛んでいく
      if (ph === 'act' && L.lastPh !== 'act' && L.monDisc && /^(akahon|tangocho|pencil|cookie)$/.test(L.monDisc)) {
        if (L.shot) L.scene.remove(L.shot.m);
        const sm = projectileLook(L.monDisc);
        sm.scale.setScalar(0.7);
        const mo = m.userData.def.mouth;
        const k = L.monBase;
        const sx = Math.sin(turn), cx = Math.cos(turn);
        sm.position.set(m.position.x + (mo[0] * cx + mo[2] * sx) * k, m.position.y + mo[1] * k, m.position.z + (-mo[0] * sx + mo[2] * cx) * k);
        L.scene.add(sm);
        L.shot = { m: sm, t: 0, v: new THREE.Vector3(sx, 0, cx).multiplyScalar(7) };
      }
      L.lastPh = ph;
      if (L.shot) {
        const q = L.shot;
        q.t += dt;
        q.m.position.addScaledVector(q.v, dt);
        if (L.monDisc === 'tangocho' || L.monDisc === 'cookie') q.m.rotation.y += dt * (L.monDisc === 'cookie' ? 9 : 16);
        else q.m.lookAt(q.m.position.x + q.v.x, q.m.position.y + q.v.y, q.m.position.z + q.v.z);
        q.m.scale.setScalar(0.7 * Math.max(0.01, 1 - Math.max(0, q.t - 0.45) / 0.25));
        if (q.t > 0.7) {
          L.scene.remove(q.m);
          L.shot = null;
        }
      }
      // 技の瞬間に六角の輪
      const hx = L.hex;
      if (ph === 'act') {
        hx.position.set(0, 0.7, 0.4);
        hx.lookAt(L.cam.position);
        hx.scale.setScalar(0.6 + kk * 3.4);
        hx.material.opacity = 0.9 * (1 - kk);
      } else hx.material.opacity = 0;
    } else {
      if (L.hex) L.hex.material.opacity = 0;
      if (L.shot) {
        L.scene.remove(L.shot.m);
        L.shot = null;
      }
    }
    if (L.model) {
      L.model.rotation.y = 0.35 + Math.sin(L.t * 0.4) * 0.15 + L.spin;
      // ホームでは、ときどき身ぶり（エモート）をする。タップしても反応する
      if (L.emoteT > 0) L.emoteT -= dt;
      L.nextEmote = (L.nextEmote == null ? 4 : L.nextEmote) - dt;
      if (L.nextEmote <= 0 && (L.view === 'home' || L.view === 'chars') && !L.forceMode) {
        L.nextEmote = 7 + Math.random() * 6;
        this.lobbyEmote();
      }
      const em = L.emoteT > 0 ? L.emote : null;
      poseModel(L.model, { mode: L.forceMode || L.pose, t: L.t, speed01: 0, turn: 0, punchSide: 1, punchPhase: L.forceMode === 'punch' ? 0.3 : 0.3, runPhase: 0, emote: em, emoteT: L.emoteT, emoteDur: L.emoteDur }, dt);
    }
    // 画面の向きでキャラの位置を変える（縦：左下、横：左）
    const portrait = this.viewH > this.viewW;
    const asp = this.viewW / this.viewH;
    let dist = portrait ? 8.6 + (0.5 - Math.min(0.5, asp)) * 6 : 6.4;
    let ox = portrait ? 0.62 : 1.7;
    let ly = portrait ? 0.95 : 0.3;
    let camY = 0.85;
    if (L.view === 'chars') {
      // キャラ選び：一覧と説明のあいだの窓に、頭から足まで（v1.7：窓の大きさを測って、ぴったり入る距離と高さにする）
      dist = portrait ? 9.2 : 5.5;
      ox = portrait ? 0 : 1.2;
      ly = portrait ? -0.5 : 0.2;
      if (portrait && L.model) {
        const R = this.charWindow(dt);
        const H = this.viewH, W = this.viewW;
        const tf = Math.tan((L.cam.fov * Math.PI) / 360);
        // 頭のてっぺん（髪をふくめて少し上まで。setLobbyChar で測った値）と足
        const top = L.charTop || 1.35, bot = -1.0;
        const ch = top - bot;
        const hpx = Math.max(90, R.bot - R.top);
        dist = clamp(Math.max((ch * H) / (0.92 * hpx * 2 * tf), 1.5 / (0.8 * 2 * tf * (W / H))), 5, 18);
        camY = 0.6;
        const yc = (top + bot) / 2;
        const a = Math.atan((0.5 - (R.top + R.bot) / 2 / H) * 2 * tf);
        ly = camY + dist * Math.tan(Math.atan((yc - camY) / dist) - a);
      }
    }
    if (L.view === 'disc') {
      // ディスク：上の窓（見出しの下〜モンスター名の上）のまん中に、はみ出さない大きさでモンスター
      const R = this.discWindow(dt);
      const H = this.viewH, W = this.viewW;
      const tf = Math.tan((L.cam.fov * Math.PI) / 360);
      const F = L.monFit || { w: 2.3, h: 1.3, d: 1.2, cy: 0 };
      const hpx = Math.max(60, R.bot - R.top);
      const E = 0.3; // モンスターを見上げる角度（約17度）。カメラをモンスターより下に置く＝うしろは地平線の白っぽい所ではなく、青い空
      // 見上げているので、奥行きも少し高さに見える
      const hp = F.h * Math.cos(E) + F.d * Math.sin(E);
      // 高さと横はばの両方が窓に入る距離（1周のポーズでいちばん大きいとき）
      dist = Math.max(6, (hp * H) / (0.92 * hpx * 2 * tf), F.w / (0.86 * 2 * tf * (W / H)));
      ox = F.cx || 0;
      // 画面のまん中から窓のまん中までの角度（上がプラス）
      const a = Math.atan((0.5 - (R.top + R.bot) / 2 / H) * 2 * tf);
      camY = 0.7 + F.cy - dist * Math.tan(E);
      ly = camY + dist * Math.tan(E - a);
    }
    if (L.debugCam) {
      // 見た目の点検用（テストのスクリプトから）
      dist = L.debugCam.dist;
      ox = L.debugCam.ox;
      ly = L.debugCam.ly;
      if (L.debugCam.camY != null) camY = L.debugCam.camY;
    }
    L.cx = damp(L.cx == null ? ox : L.cx, ox, 5, dt);
    L.cd = damp(L.cd == null ? dist : L.cd, dist, 5, dt);
    L.cy = damp(L.cy == null ? ly : L.cy, ly, 5, dt);
    L.ch = damp(L.ch == null ? camY : L.ch, camY, 5, dt);
    L.cam.position.set(L.cx + 0.25, L.ch + Math.sin(L.t * 0.5) * 0.05, L.cd);
    L.cam.lookAt(L.cx, L.cy, 0);
    for (const p of L.petals) {
      const w = p.userData.w;
      p.position.addScaledVector(p.userData.v, dt);
      p.rotation.z += dt * w[0];
      p.rotation.x = 0.75 * Math.sin(L.t * w[2] + w[1]); // ひらひら（真横にはなりにくい）
      p.rotation.y = 0.5 * Math.cos(L.t * w[2] * 0.7 + w[1]);
      if (p.position.y < -3) p.position.set(-6 - Math.random() * 3, 5 + Math.random() * 2, (Math.random() - 0.5) * 8);
    }
  }

  // ===== 画面の部品 =====
  setScreen(html, cls) {
    this.screenEl.innerHTML = '';
    if (this.lobby) this.lobby.view = (cls || '').includes('charsel') ? 'chars' : (cls || '').includes('discsel') ? 'disc' : 'home';
    const s = el('div', 'screen ' + (cls || ''), html);
    this.screenEl.appendChild(s);
    this.backHandler = null;
    return s;
  }
  toast(msg, ms = 2200) {
    const t = el('div', 'toast', msg);
    this.root.appendChild(t);
    setTimeout(() => t.remove(), ms);
  }
  bigText(text, cls) {
    const b = el('div', 'bigtext ' + (cls || ''), text);
    this.fxLayer.appendChild(b);
    setTimeout(() => b.remove(), 1000);
  }
  flash(color, t) {
    let f = this._flash;
    if (!f) {
      f = this._flash = el('div', 'flashfx');
      this.root.appendChild(f);
    }
    f.style.background = color;
    f.style.transition = 'none';
    f.style.opacity = '0.85';
    void f.offsetWidth;
    f.style.transition = `opacity ${t}s ease-out`;
    f.style.opacity = '0';
  }
  cutin(p) {
    // 味方は右から、敵は左から（向きもかえる）
    const me = this.match && this.match.player;
    const foe = !!(me && p.team !== me.team);
    const c = el('div', 'spcut' + (foe ? ' foe' : ''));
    const pal = p.team === 0 ? ['#06173f', '#1d62d0', '#6fc8ff', '#dff4ff'] : ['#3f0614', '#d01d45', '#ff8aa6', '#ffe3ea'];
    pal.forEach((v, i) => c.style.setProperty('--c' + i, v));
    const who = p.isPlayer ? 'あなた' : p.displayName || p.def.short || p.def.name;
    const name = [...p.def.special.name];
    const chars = name.map((ch, i) => `<i style="--i:${i}">${escapeHtml(ch)}</i>`).join('');
    c.innerHTML = `<div class="dim"></div><div class="rays"></div><div class="panel"><div class="pin"><div class="bg"></div><div class="dots"></div><div class="glow"></div><img alt=""><div class="streaks"></div><div class="glint"></div></div></div><div class="txt"><div class="who"><b>SPECIAL</b>${escapeHtml(who)}</div><div class="nm${name.length > 6 ? ' long' : ''}">${chars}</div></div><div class="flash"></div>`;
    c.querySelector('img').src = this.portraits.cut(p.def.id, p.team, foe ? -1 : 1);
    this.fxLayer.appendChild(c);
    setTimeout(() => c.remove(), 1300);
  }
  confirm(title, body, okLabel = 'OK', cancelLabel = 'やめる') {
    return new Promise((res) => {
      const m = el('div', 'modal', `<div class="box"><h3>${title}</h3><div class="note" style="font-size:13px;color:#dfe5f2">${body}</div><div class="btns"><button class="btn y ok">${okLabel}</button><button class="btn k no">${cancelLabel}</button></div></div>`);
      this.root.appendChild(m);
      m.querySelector('.ok').onclick = () => {
        m.remove();
        res(true);
      };
      m.querySelector('.no').onclick = () => {
        m.remove();
        res(false);
      };
    });
  }

  // いくつかの中からえらぶ（えらんだ番号を返す）
  choose(title, body, labels) {
    return new Promise((res) => {
      const m = el('div', 'modal', `<div class="box"><h3>${title}</h3><div class="note" style="font-size:13px;color:#dfe5f2">${body}</div><div class="btns">${labels.map((l, i) => `<button class="btn ${i === 0 ? 'y' : 'k'}" data-i="${i}">${l}</button>`).join('')}</div></div>`);
      this.root.appendChild(m);
      m.querySelectorAll('button[data-i]').forEach((b) => (b.onclick = () => {
        m.remove();
        res(+b.dataset.i);
      }));
    });
  }

  // ===== タイトル =====
  showTitle() {
    sound.playBgm('menu');
    this.lobby.pose = 'hover';
    const s = this.setScreen(
      `<div class="logo"><span class="l1">一浪の空で、殴りあえ。</span><span class="l2">浪人パンチ<br>フライト</span><span class="en">RONIN PUNCH FLIGHT</span><span class="l3">360° AERIAL BATTLE / 4 VS 4</span></div>
       <div class="tapwrap"><div class="tapstart">TAP TO START</div><div class="tapjp">タップしてはじめる</div></div>
       <div class="ver">v${VERSION}（${BUILD}）</div>`,
      'title'
    );
    if (isLINE) {
      const b = el('div', 'lineopen', 'LINEの中のブラウザだと音が出なかったり、ホーム画面に追加できません。<br><a href="' + location.href.split('#')[0] + (location.search ? '&' : '?') + 'openExternalBrowser=1">Safari・Chromeで開く</a>');
      s.appendChild(b);
    }
    const go = () => {
      sound.unlock();
      sound.play('ui');
      if (!this.save.name) this.showName(true);
      else if (this.pendingRoom) this.joinRoomFlow(this.takePendingRoom());
      else this.showHome();
    };
    s.addEventListener('click', (e) => {
      if (e.target.closest('a')) return;
      go();
    });
  }

  showName(first) {
    const s = this.setScreen(
      `<div class="hdr">${first ? '' : `<button class="back" aria-label="もどる">${ICON.back}</button>`}<h2>ニックネーム</h2></div>
       <div class="card"><p>ゲームの中とランキングに出る名前です。<b>本名は入れないでね。</b></p>
       <div class="field"><input maxlength="10" placeholder="10文字まで" value="${escapeHtml(this.save.name || '')}"></div>
       <p class="note">あとから「せってい」で変えられます。</p></div>
       <button class="btn y wide ok">決定</button>`,
      'panel'
    );
    const inp = $('input', s);
    if (!first) $('.back', s).onclick = () => this.showSettings();
    $('.ok', s).onclick = () => {
      const v = Array.from(inp.value.trim()).slice(0, 10).join('');
      if (!v) {
        this.toast('名前を入れてね');
        return;
      }
      if (net.badName(v)) {
        this.toast('その名前は使えません');
        return;
      }
      this.save.name = v;
      saveSave(this.save);
      sound.play('ui');
      net.rename(v);
      if (first && this.pendingRoom) this.joinRoomFlow(this.takePendingRoom());
      else if (first && !this.save.tutorial) this.askTutorial();
      else if (first) this.showHome();
      else this.showSettings();
    };
  }
  async askTutorial() {
    const ok = await this.confirm('はじめての人へ', '操作の練習（約3分）をしますか？<br>空を飛ぶ・ブースト・回避・攻撃・スキルを順番に練習できます。', '練習する', 'あとで');
    if (ok) this.startTutorial();
    else this.showHome();
  }

  // ===== 顔・ディスクの絵を少しずつ入れる =====
  // 18人・21枚の絵を一度に作ると、遅い端末では数秒かたまる。作ってある絵はすぐ入れて、
  // まだの絵は 1フレームに少しずつ作る（first：先に作りたいもの＝選んでいるキャラなど）
  porImg(id, team = 0) {
    const u = this.portraits.cached(id, team);
    return u ? `src="${u}"` : `src="${BLANK_IMG}" data-por="${id}" data-team="${team}"`;
  }
  monImg(monId, size = 128) {
    const u = this.portraits.monsterCached(monId, size);
    return u ? `src="${u}"` : `src="${BLANK_IMG}" data-mon="${monId}" data-size="${size}"`;
  }
  fillImgs(root, first) {
    const todo = [...root.querySelectorAll('img[data-por], img[data-mon]')];
    if (!todo.length) return;
    if (first) todo.sort((a, b) => (b.dataset.por === first || b.dataset.mon === first ? 1 : 0) - (a.dataset.por === first || a.dataset.mon === first ? 1 : 0));
    const step = () => {
      const t0 = performance.now();
      while (todo.length && performance.now() - t0 < 14) {
        const im = todo.shift();
        if (!im.isConnected) continue;
        try {
          if (im.dataset.por) im.src = this.portraits.get(im.dataset.por, +im.dataset.team || 0);
          else im.src = this.portraits.monster(im.dataset.mon, +im.dataset.size || 128);
        } catch (e) {}
        im.removeAttribute('data-por');
        im.removeAttribute('data-mon');
      }
      if (todo.length) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // ===== ホーム（ロビー）=====
  showHome() {
    sound.playBgm('menu');
    // ディスクの絵を、ひまなときに少しずつ先に作っておく（ディスク画面をすぐ開けるように）
    if (!this._monWarm) {
      this._monWarm = true;
      // （そのあと18人の顔も。キャラえらび・オンラインの部屋をすぐ開けるように）
      const ids = OMAMORI_IDS.map((id) => ['m', OMAMORI[id].mon]).concat(PUNCHER_IDS.map((id) => ['p', id]));
      const step = () => {
        const it = ids.shift();
        if (!it) return;
        if (!this.match) {
          try {
            if (it[0] === 'm') this.portraits.monster(it[1], 128);
            else this.portraits.get(it[1], 0);
          } catch (e) {}
        }
        setTimeout(step, 140);
      };
      setTimeout(step, 1200);
    }
    if (!store.ok() && !this._noStoreWarned) {
      this._noStoreWarned = true;
      setTimeout(() => this.toast('この端末は記録を保存できない設定です（プライベートブラウズなど）。閉じると記録が消えます', 4500), 800);
    }
    net.friends().then((f) => (this.friendList = f)).catch(() => {});
    this.setLobbyChar(this.save.char);
    this.lobby.pose = 'ground';
    const S = this.save;
    const rk = rankOf(S.rp);
    const def = PUNCHERS[S.char];
    const prog = rk.next ? ((S.rp - rk.min) / (rk.next - rk.min)) * 100 : 100;
    const s = this.setScreen(
      `<div class="topbar">
         <div class="plate"><div class="rankbadge">${rk.key}</div><div style="min-width:0"><div class="nm">${escapeHtml(S.name || 'プレイヤー')}</div><div class="rp">ランク ${S.rp}pt${rk.next ? ' / 次 ' + rk.next : ''}</div><div class="rpbar"><i style="width:${prog}%"></i></div></div></div>
         <div style="flex:1"></div>
         ${isIOS && !isStandalone() && !isInApp ? `<button class="iconbtn a2hs" aria-label="アプリにする">${ICON.install}</button>` : ''}
         <button class="iconbtn help" aria-label="遊び方">${ICON.help}</button>
         <button class="iconbtn share" aria-label="友だちに送る">${ICON.share}</button>
       </div>
       <div class="modecard">
         <div class="hd"><b>REGULAR</b><button class="rulebtn" aria-label="ルールと勝ち方">${ICON.book}<span>ルール</span></button></div>
         <div class="rule"><button class="prev" aria-label="前のルール">${ICON.back}</button><div class="nm"></div><button class="next" aria-label="次のルール">${ICON.next}</button></div>
         <div class="sub"></div>
         ${diffPickHtml()}
         <button class="stagebtn" aria-label="ステージをかえる"><span>STAGE</span><b></b><i>${ICON.next}</i></button>
       </div>
       <button class="battlebtn"><span class="en">BATTLE</span><span class="jp">バトル</span></button>
       <div class="subbtns">
         <button class="trainbtn">${ICON.target}<b>訓練場</b><small>自由に練習</small></button>
         <button class="onlinebtn">${ICON.online}<b>オンライン対戦</b><small>LINEで招待</small></button>
       </div>
       <div class="homechar"><span class="en">${escapeHtml(def.en)}</span><div class="nm">${escapeHtml(def.name)}</div><div class="tp">${def.typeName}・${def.elemLabel || ELEM[def.elem].name}</div></div>
       <div style="flex:1"></div>
       <div class="tabs">
         <button data-t="char"><span class="i">${ICON.fighter}</span>パンチャー</button>
         <button data-t="om"><span class="i">${ICON.disc}</span>ディスク</button>
         <button data-t="home" class="on"><span class="i">${ICON.home}</span>ホーム</button>
         <button data-t="rank"><span class="i">${ICON.rank}</span>ランキング</button>
         <button data-t="set"><span class="i">${ICON.gear}</span>せってい</button>
       </div>`,
      'home'
    );
    const nm = $('.rule .nm', s), sub = $('.sub', s);
    const showMode = () => {
      const M = MODES[S.mode];
      nm.textContent = M.name;
      sub.textContent = M.sub;
    };
    showMode();
    $('.prev', s).onclick = () => {
      S.mode = MODE_KEYS[(MODE_KEYS.indexOf(S.mode) + 2) % 3];
      saveSave(S);
      showMode();
      sound.play('ui');
    };
    $('.next', s).onclick = () => {
      S.mode = MODE_KEYS[(MODE_KEYS.indexOf(S.mode) + 1) % 3];
      saveSave(S);
      showMode();
      sound.play('ui');
    };
    bindDiffPick(s, () => S.diff, (k) => {
      S.diff = k;
      saveSave(S);
    });
    const stBtn = $('.stagebtn', s);
    const showStage = () => ($('b', stBtn).innerHTML = stageIcon(S.stage) + escapeHtml(stageLabel(S.stage)));
    showStage();
    stBtn.onclick = () => {
      const i = STAGE_CHOICES.indexOf(STAGE_CHOICES.includes(S.stage) ? S.stage : 'random');
      S.stage = STAGE_CHOICES[(i + 1) % STAGE_CHOICES.length];
      saveSave(S);
      showStage();
      sound.play('ui');
    };
    $('.battlebtn', s).onclick = () => {
      sound.play('ui');
      // はじめてのルールは、先に「どんなルールか・勝ち方」を見せる
      const seen = S.seenRules || (S.seenRules = {});
      if (!seen[S.mode]) {
        seen[S.mode] = 1;
        saveSave(S);
        this.showRules(S.mode, () => this.startMatch());
        return;
      }
      this.startMatch();
    };
    $('.rulebtn', s).onclick = () => {
      sound.play('ui');
      this.showRules(S.mode);
    };
    $('.trainbtn', s).onclick = () => {
      sound.play('ui');
      this.startTraining();
    };
    $('.onlinebtn', s).onclick = () => {
      sound.play('ui');
      this.showOnline();
    };
    $('.help', s).onclick = () => this.showHowto();
    $('.share', s).onclick = () => this.share();
    // キャラをタップすると身ぶり（エモート）で応える
    s.addEventListener('click', (e) => {
      if (e.target.closest('button, .modecard, .topbar, .tabs')) return;
      if (!this.hitLobbyChar(e.clientX, e.clientY)) return;
      this.lobbyEmote();
      this.lobby.nextEmote = 9;
      sound.play('ui');
    });
    if ($('.a2hs', s)) $('.a2hs', s).onclick = () => this.showA2HS();
    // はじめての人には一度だけ「アプリにする」をすすめる
    if (isIOS && !isStandalone() && !isInApp && S.plays >= 1 && !store.get('rpf_a2hs_shown', false)) {
      store.set('rpf_a2hs_shown', true);
      setTimeout(() => this.showA2HS(), 600);
    }
    $$('.tabs button', s).forEach((b) => (b.onclick = () => {
      sound.play('ui');
      const t = b.dataset.t;
      if (t === 'char') this.showChars();
      else if (t === 'om') this.showOmamori();
      else if (t === 'rank') this.showRanking();
      else if (t === 'set') this.showSettings();
    }));
  }

  showA2HS() {
    const m = el(
      'div',
      'modal',
      `<div class="box"><h3>ホーム画面に追加すると<br>アプリみたいに遊べる！</h3>
      <div class="ctrl" style="grid-template-columns:34px 1fr;gap:10px">
        <b>1</b><span>Safari の下（または上）の <span class="inico">${ICON.iosShare}</span> 共有ボタン（四角から矢印が出ているマーク）を押す</span>
        <b>2</b><span>「ホーム画面に追加」を押す（見つからなければ下にスクロール）</span>
        <b>3</b><span>右上の「追加」を押す → ホーム画面のアイコンから起動！</span>
      </div>
      <p class="note" style="margin-top:10px">画面が広くなって、まちがって戻ったりしなくなります。<br>※Safari とホーム画面のアプリでは記録が別になります。アカウントの「引き継ぎコード」で移せます。</p>
      <div class="btns"><button class="btn y close">わかった</button></div></div>`
    );
    this.root.appendChild(m);
    m.querySelector('.close').onclick = () => m.remove();
  }
  share() {
    const url = location.origin + '/?openExternalBrowser=1';
    const text = '浪人パンチフライトで勝負しよう！4対4の空中バトル👊 ' + url;
    if (navigator.share) {
      navigator.share({ title: '浪人パンチフライト', text: '浪人パンチフライトで勝負しよう！4対4の空中バトル👊', url }).catch(() => {});
    } else {
      window.open('https://line.me/R/share?text=' + encodeURIComponent(text), '_blank');
    }
  }

  deckLevels(deck) {
    return deck.map((id) => omLevel(this.save, id));
  }
  takePendingRoom() {
    const c = this.pendingRoom;
    this.pendingRoom = null;
    try {
      // 戻ったときにもう一度入らないように、アドレスから消す
      const u = new URL(location.href);
      u.searchParams.delete('room');
      history.replaceState(history.state, '', u.pathname + (u.search ? u.search : '') + u.hash);
    } catch (e) {}
    return c;
  }

  // ===== オンライン対戦 =====
  showOnline() {
    const s = this.setScreen(
      `<div class="hdr"><button class="back" aria-label="もどる">${ICON.back}</button><h2>オンライン対戦</h2></div>
       <div class="card"><h3>フレンドと4対4（ベータ版）</h3>
         <p>部屋をつくって、コードかLINEで友だちを呼ぼう。あいた席はCPUが入る。</p>
         <button class="btn y wide make">部屋をつくる</button>
       </div>
       <div class="card"><h3>部屋に入る</h3>
         <div class="field"><input class="code" inputmode="numeric" pattern="[0-9]*" maxlength="5" placeholder="5けたの部屋コード" autocomplete="off"></div>
         <button class="btn wide k join">入る</button>
       </div>
       <div class="card"><p class="note">・部屋をつくった人（ホスト）のスマホが試合を計算します。試合中、ホストの人はアプリを閉じたり、ほかのアプリに切りかえたりしないでね。<br>・つながらないときは、みんな同じWi-Fiにするか、Wi-Fiを切ってモバイル通信で試してね（学校のWi-Fiだとつながらないことがあります）。<br>・遠くの人と遊ぶと、少しおくれることがあります。</p></div>`,
      'panel scroll'
    );
    $('.back', s).onclick = () => this.showHome();
    this.backHandler = () => this.showHome();
    if (!rtcSupported()) {
      $('.make', s).disabled = true;
      $('.join', s).disabled = true;
      this.toast('このブラウザはオンライン対戦に対応していません（Safari・Chromeの新しい版で開いてね）', 4000);
    }
    $('.make', s).onclick = () => this.createRoomFlow();
    const inp = $('.code', s);
    inp.oninput = () => (inp.value = inp.value.replace(/[^0-9]/g, '').slice(0, 5));
    $('.join', s).onclick = () => {
      const c = inp.value.trim();
      if (!/^\d{5}$/.test(c)) {
        this.toast('5けたの数字を入れてね');
        return;
      }
      this.joinRoomFlow(c);
    };
  }
  busyModal(text) {
    const m = el('div', 'modal', `<div class="box"><h3>${escapeHtml(text)}</h3><div class="spinner"></div><div class="btns"><button class="btn k cancel">やめる</button></div></div>`);
    this.root.appendChild(m);
    return m;
  }
  roomErr(err) {
    return (
      {
        nf: 'その部屋は見つかりませんでした（コードをたしかめてね）',
        closed: 'その部屋は今は入れません（試合中かも）',
        full: '部屋がいっぱいです（8人まで）',
        ver: 'アプリの版がちがいます。ページを開き直して最新にしてね',
        rtc: 'このブラウザはオンライン対戦に対応していません',
        noanswer: 'ホストから返事がありませんでした',
        p2p: 'つながりませんでした。同じWi-Fiにするか、モバイル通信で試してね',
        rl: '回数が多すぎます。少し待ってね',
        setup: 'サーバーの準備中です',
        net: 'ネットにつながっていません',
        busy: 'こみあっています。もう一度ためしてね',
      }[err] || '通信できませんでした（' + err + '）'
    );
  }
  bindRoom(room) {
    this.room = room;
    room.on('toast', (t) => this.toast(escapeHtml(t)));
    room.on('sound', (n) => sound.play(n === 'join' ? 'pickup' : n));
    room.on('lobby', () => this.renderRoom && this.renderRoom());
    room.on('msg', (from, o) => this.onRoomMsg(from, o));
    room.on('left', (id, m) => {
      if (this.match && this.match.isHost && this.match.onLeft) this.match.onLeft(id, m);
    });
    room.on('closed', (why) => this.onRoomClosed(why));
  }
  async createRoomFlow() {
    if (this.room) this.leaveRoom();
    const m = this.busyModal('部屋をつくっています…');
    const room = new Room(this);
    let cancelled = false;
    m.querySelector('.cancel').onclick = () => {
      cancelled = true;
      room.leave();
      m.remove();
    };
    const r = await room.create();
    m.remove();
    if (cancelled) return;
    if (!r.ok) {
      room.leave();
      this.toast(this.roomErr(r.err), 3500);
      return;
    }
    this.bindRoom(room);
    room.setOpt('mode', this.save.mode || 'scramble');
    room.setOpt('diff', this.save.diff || 'normal');
    room.setOpt('stage', STAGE_CHOICES.includes(this.save.stage) ? this.save.stage : 'random');
    this.showRoom();
  }
  async joinRoomFlow(code) {
    if (this.room) this.leaveRoom();
    if (!rtcSupported()) {
      this.toast(this.roomErr('rtc'), 3500);
      this.showHome();
      return;
    }
    if (!this.screenEl.querySelector('.screen')) this.showHome();
    const m = this.busyModal('部屋 ' + code + ' につないでいます…');
    const room = new Room(this);
    let cancelled = false;
    m.querySelector('.cancel').onclick = () => {
      cancelled = true;
      room.leave();
      m.remove();
    };
    const r = await room.join(code);
    m.remove();
    if (cancelled) return;
    if (!r.ok) {
      room.leave();
      this.toast(this.roomErr(r.err), 4000);
      return;
    }
    this.bindRoom(room);
    sound.play('pickup');
    this.showRoom();
  }
  leaveRoom() {
    if (!this.room) return;
    const r = this.room;
    this.lastRoomLog = r.log.slice(-15);
    this.room = null;
    this.renderRoom = null;
    r.leave();
  }
  onRoomClosed(why) {
    const wasRoom = this.room;
    if (!wasRoom) return;
    this.lastRoomLog = wasRoom.log.slice(-15).concat(['closed: ' + why]);
    this.room = null;
    this.renderRoom = null;
    wasRoom.leave();
    if (this.match && this.match.online) this.endMatch();
    const msg = why === 'hostleft' ? 'ホストが部屋をとじました' : why === 'gone' ? '部屋の期限が切れました' : 'ホストとの接続が切れました';
    const code = wasRoom.role === 'client' ? wasRoom.code : '';
    this.showHome();
    if (why === 'lost' && code) {
      // 切れただけなら、同じ部屋にもう一度入れる
      this.confirm('オンライン対戦', escapeHtml(msg) + '<br>同じ部屋（' + code + '）にもう一度入りますか？', 'もう一度入る', 'やめる').then((ok) => ok && this.joinRoomFlow(code));
    } else this.confirm('オンライン対戦', escapeHtml(msg), 'OK', 'とじる');
  }
  onRoomMsg(from, o) {
    if (o.t === 'start' && this.room && this.room.role === 'client') {
      this.startOnline(o.cfg);
      return;
    }
    if (o.t === 'toLobby' && this.room && this.room.role === 'client') {
      // ホストがロビーにもどった（結果を見ている人はそのまま）
      return;
    }
    if (this.match && this.match.online && this.match.onMsg) this.match.onMsg(from, o);
  }
  showRoom() {
    const room = this.room;
    if (!room) return this.showHome();
    sound.playBgm('menu');
    this.lobby.pose = 'hover';
    const host = room.role === 'host';
    const s = this.setScreen(
      `<div class="hdr"><button class="back" aria-label="もどる">${ICON.back}</button><h2>オンライン対戦</h2></div>
       <div class="card roomcode"><div><div class="note">部屋コード</div><div class="code">${room.code}</div></div><div class="col"><button class="btn y small invite">LINEで招待</button><button class="btn k small copy">コピー</button></div></div>
       <div class="card teams"><div class="tcol t0"><h4>青チーム</h4><div class="slots"></div></div><div class="tcol t1"><h4>赤チーム</h4><div class="slots"></div></div></div>
       <div class="card ropts"></div>
       <div class="card mychar"><h3>自分のキャラ<span class="hint">横にスクロールで18人</span></h3><div class="charrow">${PUNCHER_IDS.map((id) => `<button data-id="${id}" style="--e:${ELEM[PUNCHERS[id].elem].color}"><img alt="" ${this.porImg(id, 0)}><span>${escapeHtml(PUNCHERS[id].short || PUNCHERS[id].name)}</span></button>`).join('')}</div></div>
       ${host ? '<button class="btn y wide start">スタート</button>' : '<div class="waitmsg">ホストがスタートするのを待っています…</div>'}
       <p class="note" style="text-align:center">${host ? 'メンバーをタップするとチームを入れかえます' : 'ホストの人はアプリを閉じないでね'}</p>`,
      'panel scroll room'
    );
    this.fillImgs(s, this.save.char);
    const leave = async () => {
      const ok = await this.confirm('部屋を出る', host ? '部屋をとじます。入っている人も外に出ます。' : '部屋から出ますか？', '出る', 'もどる');
      if (!ok) return;
      this.leaveRoom();
      this.showHome();
    };
    $('.back', s).onclick = leave;
    this.backHandler = leave;
    const url = location.origin + '/?room=' + room.code + '&openExternalBrowser=1';
    $('.invite', s).onclick = () => {
      const text = '浪人パンチフライトで勝負しよう！部屋コード ' + room.code + ' 👊 ' + url;
      if (navigator.share) navigator.share({ title: '浪人パンチフライト', text: '浪人パンチフライトで勝負しよう！部屋コード ' + room.code + ' 👊', url }).catch(() => {});
      else window.open('https://line.me/R/share?text=' + encodeURIComponent(text), '_blank');
    };
    $('.copy', s).onclick = async () => {
      try {
        await navigator.clipboard.writeText(url);
        this.toast('招待リンクをコピーしました');
      } catch (e) {
        this.toast('コピーできませんでした。コード ' + room.code + ' を伝えてね');
      }
    };
    $$('.charrow button', s).forEach((b) => {
      b.onclick = () => {
        this.save.char = b.dataset.id;
        saveSave(this.save);
        this.setLobbyChar(this.save.char);
        sound.play('ui');
        room.setMyChar();
        render();
      };
    });
    if (host)
      $('.start', s).onclick = () => {
        if (!room.canStart()) {
          this.toast('「CPUで埋める」がオフのときは、両方のチームに1人以上必要です');
          return;
        }
        sound.play('ui');
        this.hostStart();
      };
    const render = () => {
      if (!this.room || !s.isConnected) return;
      const st = room.state;
      for (let t = 0; t < 2; t++) {
        const box = $(`.t${t} .slots`, s);
        const ms = st.members.filter((m) => m.team === t).sort((a, b) => a.slot - b.slot);
        let h = '';
        for (let i = 0; i < 4; i++) {
          const m = ms[i];
          if (m)
            h += `<button class="rslot${m.id === room.myId ? ' me' : ''}" data-id="${escapeHtml(m.id)}"><img alt="" src="${this.portraits.get(PUNCHERS[m.char] ? m.char : 'tora', t)}"><span class="nm">${escapeHtml(m.name)}</span>${m.host ? '<i class="tag">ホスト</i>' : m.ping ? `<i class="ping">${m.ping}ms</i>` : ''}</button>`;
          else h += `<div class="rslot empty">${st.fill ? 'CPU' : '－'}</div>`;
        }
        box.innerHTML = h;
      }
      if (host)
        $$('.rslot[data-id]', s).forEach((b) => {
          b.onclick = () => {
            room.switchTeam(b.dataset.id);
            sound.play('ui');
          };
        });
      const M = MODES[st.mode] || MODES.scramble;
      $('.ropts', s).innerHTML = host
        ? `<div class="rule"><button class="prev" aria-label="前のルール">${ICON.back}</button><div class="nm">${M.name}</div><button class="next" aria-label="次のルール">${ICON.next}</button></div>
           <div class="toggle"><span>ステージ</span><div class="seg stg" style="margin:0;width:200px;background:rgba(255,255,255,0.1)">${STAGE_CHOICES.map((k) => `<button data-k="${k}" class="${(st.stage || 'random') === k ? 'on' : ''}">${k === 'random' ? 'おまかせ' : STAGES[k].short}</button>`).join('')}</div></div>
           <div class="toggle dtog"><span>CPUの強さ</span>${diffPickHtml('wide')}</div>
           <label class="toggle"><span>あいた席をCPUで埋める</span><input type="checkbox" class="fill" ${st.fill ? 'checked' : ''}></label>`
        : `<div class="row sb"><span>ルール</span><b>${M.name}</b></div><div class="row sb"><span>ステージ</span><b>${stageLabel(st.stage)}</b></div><div class="row sb"><span>CPU</span><b>${st.fill ? DIFFICULTY[diffKey(st.diff)].name + '（' + (DIFF_KEYS.indexOf(diffKey(st.diff)) + 1) + '/6）' : 'なし'}</b></div>`;
      if (host) {
        const ro = $('.ropts', s);
        $('.prev', ro).onclick = () => {
          room.setOpt('mode', MODE_KEYS[(MODE_KEYS.indexOf(st.mode) + 2) % 3]);
          sound.play('ui');
        };
        $('.next', ro).onclick = () => {
          room.setOpt('mode', MODE_KEYS[(MODE_KEYS.indexOf(st.mode) + 1) % 3]);
          sound.play('ui');
        };
        bindDiffPick(ro, () => room.state.diff, (k) => {
          room.setOpt('diff', k);
          this.save.diff = k;
          saveSave(this.save);
        });
        $$('.stg button', ro).forEach((b) => (b.onclick = () => {
          room.setOpt('stage', b.dataset.k);
          this.save.stage = b.dataset.k;
          saveSave(this.save);
          sound.play('ui');
        }));
        $('.fill', ro).onchange = (e) => room.setOpt('fill', e.target.checked);
      }
      const me = room.me();
      $$('.charrow button', s).forEach((b) => b.classList.toggle('on', me ? b.dataset.id === me.char : b.dataset.id === this.save.char));
    };
    this.renderRoom = render;
    render();
  }
  hostStart() {
    const room = this.room;
    if (!room || room.role !== 'host') return;
    room.inMatch = true;
    room.lock(true);
    const cfg = { mode: room.state.mode, diff: room.state.diff, stage: resolveStage(room.state.stage), roster: room.buildRoster() };
    room.broadcast({ t: 'start', cfg });
    this.startOnline(cfg);
  }
  startOnline(cfg) {
    const room = this.room;
    if (!room || !cfg || !Array.isArray(cfg.roster)) return;
    const meIdx = cfg.roster.findIndex((r) => r.human === room.myId);
    if (meIdx < 0) {
      this.toast('この試合には入っていません');
      return;
    }
    if (this.match) this.endMatch();
    room.inMatch = true;
    // まだ結果画面などのモーダルが出ていたら消す
    this.root.querySelectorAll('.modal').forEach((m) => m.remove());
    this.screenEl.innerHTML = '';
    this.renderRoom = null;
    this.paused = false;
    const opts = { mode: MODES[cfg.mode] ? cfg.mode : 'scramble', stage: STAGES[cfg.stage] ? cfg.stage : 'sakura', char: cfg.roster[meIdx].char, difficulty: diffKey(cfg.diff), playerName: this.save.name || 'プレイヤー', roster: cfg.roster, meIdx };
    this.match = room.role === 'host' ? new HostMatch(this, opts, room) : new ClientMatch(this, opts, room);
    this.match.resize(this.viewW, this.viewH);
    if (this.lowGfx || this.settings.quality === 'low') this.setLowGfx(true);
  }
  backToRoom() {
    this.endMatch();
    const room = this.room;
    if (!room) return this.showHome();
    room.inMatch = false;
    if (room.role === 'host') {
      room.lock(false);
      room.pushLobby();
    }
    this.showRoom();
  }

  // ===== キャラ選び =====
  showChars(selId) {
    const S = this.save;
    let cur = selId || S.char;
    let open = false; // 説明をくわしく見せているか
    this.setLobbyChar(cur);
    this.lobby.pose = 'hover';
    // v1.7：キャラが一覧や説明にかくれないように、キャラは「一覧の下〜説明の上」の窓にぴったり入れる（updateLobby の charWindow）
    const s = this.setScreen(
      `<div class="hdr"><button class="back" aria-label="もどる">${ICON.back}</button><h2>パンチャー</h2></div>
       <div class="charlist">${PUNCHER_IDS.map((id) => `<button data-id="${id}" style="--e:${ELEM[PUNCHERS[id].elem].color}"><img alt="" ${this.porImg(id, 0)}><div>${escapeHtml(PUNCHERS[id].short || PUNCHERS[id].name)}</div>${partnerOf(id).length ? '<i class="pr">♥</i>' : ''}</button>`).join('')}</div>
       <div class="charview"></div>
       <div class="card info cinfo"></div>
       <button class="btn y wide pick">このキャラで戦う</button>`,
      'panel charsel'
    );
    this.fillImgs(s, cur);
    s.style.background = 'linear-gradient(180deg, rgba(14,18,32,0.9) 0, rgba(14,18,32,0.0) 22%, rgba(14,18,32,0.0) 62%, rgba(14,18,32,0.9) 78%)';
    const info = $('.info', s);
    const bar = (n) => `<i class="sb">${[1, 2, 3, 4, 5].map((k) => `<b class="${k <= n ? 'on' : ''}"></b>`).join('')}</i>`;
    const render = () => {
      const d = PUNCHERS[cur];
      $$('.charlist button', s).forEach((b) => b.classList.toggle('on', b.dataset.id === cur));
      const st = d.stat;
      const cs = S.charStats[cur];
      const syn = partnerOf(cur);
      const atkLabel = d.attack.label || (d.attack.kind === 'melee' ? '近距離パンチ' : '遠距離ショット');
      const atkDesc = d.attack.desc || (d.attack.kind === 'melee' ? '近づくと自動でパンチ。最後の一発でふっとばす' : 'はなれた敵を自動で撃つ（インクのたま）');
      info.innerHTML = `<div class="ctop"><div class="cname"><b>${escapeHtml(d.name)}</b><span>${d.typeName}・<span style="color:${ELEM[d.elem].color}">${escapeHtml(d.elemLabel || ELEM[d.elem].name)}</span></span></div>
          <div class="cstat"><span>こうげき</span>${bar(st.atk)}<span>たいりょく</span>${bar(st.hp)}<span>スピード</span>${bar(st.spd)}</div></div>
        <div class="cline"><span class="tag">スキル</span><b>${escapeHtml(d.skill.name)}</b><small>（${d.skill.cd}秒）</small></div>
        <div class="cline"><span class="tag sp">SP</span><b>${escapeHtml(d.special.name)}</b></div>
        <div class="cline"><span class="tag" style="background:#ddd">通常</span><b>${escapeHtml(atkLabel)}</b></div>
        ${d.passive ? `<div class="cline"><span class="tag pv">とくせい</span><b>${escapeHtml(d.passive.name)}</b></div>` : ''}
        <button class="more">${open ? 'とじる ▲' : 'くわしく ▼'}</button>
        <div class="cdetail">
          <p>${escapeHtml(d.profile)}</p>${cs ? `<div class="note">このキャラで ${cs.plays}戦 ${cs.wins}勝</div>` : ''}${d.elemLabel ? `<div class="note">属性「${escapeHtml(d.elemLabel)}」の中身は${ELEM[d.elem].name}</div>` : ''}
          <div class="skillbox"><span class="tag">スキル</span><div><b>${escapeHtml(d.skill.name)}</b>（${d.skill.cd}秒）<p>${escapeHtml(d.skill.desc)}</p></div></div>
          <div class="skillbox"><span class="tag sp">SP</span><div><b>${escapeHtml(d.special.name)}</b><p>${escapeHtml(d.special.desc)}</p></div></div>
          <div class="skillbox"><span class="tag" style="background:#ddd">通常</span><div><b>${escapeHtml(atkLabel)}</b><p>${escapeHtml(atkDesc)}</p></div></div>
          ${d.passive ? `<div class="skillbox"><span class="tag pv">とくせい</span><div><b>${escapeHtml(d.passive.name)}</b><p>${escapeHtml(d.passive.desc)}</p></div></div>` : ''}
          ${syn.map((x) => `<div class="skillbox"><span class="tag syn">相性</span><div><b>${escapeHtml(x.title)}</b><p>${escapeHtml(x.text)}</p></div></div>`).join('')}
        </div>`;
      info.classList.toggle('open', open);
      $('.more', info).onclick = () => {
        open = !open;
        sound.play('ui');
        render();
        this.lobby.cwT = 0; // 窓の大きさが変わったので、すぐ測りなおす
      };
    };
    render();
    const list = $('.charlist', s);
    const center = (smooth) => {
      const b = $(`.charlist button[data-id="${cur}"]`, s);
      if (b && list.scrollWidth > list.clientWidth) list.scrollTo({ left: b.offsetLeft - (list.clientWidth - b.offsetWidth) / 2, behavior: smooth ? 'smooth' : 'auto' });
    };
    requestAnimationFrame(() => center(false));
    $$('.charlist button', s).forEach((b) => (b.onclick = () => {
      cur = b.dataset.id;
      this.setLobbyChar(cur);
      render();
      center(true);
      info.scrollTop = 0;
      sound.play('ui');
    }));
    $('.back', s).onclick = () => this.showHome();
    this.backHandler = () => this.showHome();
    $('.pick', s).onclick = () => {
      S.char = cur;
      saveSave(S);
      sound.play('ui');
      this.showHome();
    };
  }

  // ===== ディスク（デッキ）=====
  // キックフライトのディスクと同じ：モンスターの技をキャラに付ける。上で3Dのモンスターが技を見せる
  showOmamori() {
    const S = this.save;
    const charId = S.char;
    let sel = null; // 一覧で選んだディスク（上の枠をタップすると入れかわる）
    const s = this.setScreen(
      `<div class="hdr"><button class="back" aria-label="もどる">${ICON.back}</button><h2>ディスク<small>${escapeHtml(PUNCHERS[charId].short || PUNCHERS[charId].name)}</small></h2></div>
       <div class="discstage"><div class="dsinfo"></div></div>
       <div class="dsbody">
         <div class="card deckcard"><h3>セット中<span class="hint">キャラの属性で始まる・下フリックで変える</span></h3><div class="deck4"></div></div>
         <div class="card omdetail"></div>
         <div class="card listcard"><h3>持っているディスク<span class="hint cnt"></span></h3><div class="omgrid"></div></div>
       </div>`,
      'panel discsel'
    );
    const deckEl = $('.deck4', s), grid = $('.omgrid', s), det = $('.omdetail', s), info = $('.dsinfo', s);
    const card = (id, extra = '') => {
      const o = OMAMORI[id];
      const owned = !!S.om[id];
      return `<button class="omcard ${extra} ${owned ? '' : 'locked'}" data-id="${id}" style="--e:${ELEM[o.elem].color};--k:${KIND_COLOR[o.kind]};--r:${RARE_COLOR[o.rare]}" aria-label="${escapeHtml(o.name)}"><div class="g"><img alt="" ${this.monImg(o.mon, 128)}></div><span class="r">${o.rare}</span>${owned ? `<span class="lv">Lv${omLevel(S, id)}</span>` : `<span class="lk">${ICON.lock}</span>`}<span class="k">${o.kind}</span></button>`;
    };
    const show = (id) => {
      const o = OMAMORI[id];
      if (!o) return;
      this.setLobbyMon(o.mon, id);
      const lv = omLevel(S, id);
      const owned = !!S.om[id];
      info.innerHTML = `<span class="rr" style="--r:${RARE_COLOR[o.rare]}">${o.rare}</span><div class="mn">${escapeHtml(o.name)}</div><div class="mv"><i style="background:${KIND_COLOR[o.kind]}">${o.kind}</i>${escapeHtml(o.move)}</div>`;
      det.innerHTML = `<div class="dtop"><b>${escapeHtml(o.move)}</b><span class="chips"><span style="--c:${ELEM[o.elem].color}">${ELEM[o.elem].name}</span><span style="--c:${KIND_COLOR[o.kind]}">${KIND_NAME[o.kind]}</span><span>待ち ${Math.round(o.cd * (1 - (lv - 1) * 0.04))}秒</span></span></div><p>${escapeHtml(o.desc)}</p><div class="note">${owned ? `Lv${lv}（効果 +${(lv - 1) * 8}%）・上フリックで発動、下フリックでこの属性に変わる` : 'まだ持っていません（勝つともらえるディスクパックから出ます）'}</div>`;
    };
    const render = () => {
      const deck = S.decks[charId];
      deckEl.innerHTML = deck.map((id) => card(id, sel && sel === id ? 'sel' : '')).join('');
      grid.innerHTML = OMAMORI_IDS.map((id) => card(id, (deck.includes(id) ? 'inuse ' : '') + (sel === id ? 'sel' : ''))).join('');
      this.fillImgs(s, sel && OMAMORI[sel] ? OMAMORI[sel].mon : null);
      $('.cnt', s).textContent = OMAMORI_IDS.filter((id) => S.om[id]).length + ' / ' + OMAMORI_IDS.length;
      $$('.deck4 .omcard', s).forEach((b, i) => (b.onclick = () => {
        if (sel && S.om[sel]) {
          const d = S.decks[charId];
          const j = d.indexOf(sel);
          if (j >= 0) d[j] = d[i];
          d[i] = sel;
          saveSave(S);
          sound.play('ui');
          sel = null;
          render();
          show(d[i]);
        } else {
          show(deck[i]);
          sound.play('ui');
        }
      }));
      $$('.omgrid .omcard', s).forEach((b) => (b.onclick = () => {
        const id = b.dataset.id;
        sel = sel === id ? null : id;
        show(id);
        render();
        sound.play('ui');
      }));
    };
    render();
    show(S.decks[charId][0]);
    $('.back', s).onclick = () => this.showHome();
    this.backHandler = () => this.showHome();
  }

  // ===== ランキング =====
  async showRanking(tab = 'w') {
    const s = this.setScreen(
      `<div class="hdr"><button class="back" aria-label="もどる">${ICON.back}</button><h2>ランキング</h2></div>
       <div class="seg rk"><button data-t="w">今週</button><button data-t="a">ランク</button><button data-t="f">フレンド</button></div>
       <div class="card list" style="flex:1;overflow-y:auto;margin-top:10px;touch-action:pan-y"><p class="note">読みこみ中…</p></div>
       <div class="card me"></div>`,
      'panel'
    );
    s.querySelector('.seg').style.background = 'rgba(255,255,255,0.08)';
    $$('.rk button', s).forEach((b) => {
      b.classList.toggle('on', b.dataset.t === tab);
      b.onclick = () => this.showRanking(b.dataset.t);
    });
    $('.back', s).onclick = () => this.showHome();
    this.backHandler = () => this.showHome();
    const list = $('.list', s), me = $('.me', s);
    me.innerHTML = `<p class="note">今週のポイント：<b>${this.save.week.id === weekId() ? this.save.week.pt : 0}</b>　ランク：<b>${rankOf(this.save.rp).key}（${this.save.rp}pt）</b></p>`;
    const r = await net.ranking(tab);
    if (!r) {
      list.innerHTML = `<p>ランキングはオンラインのアカウントで参加できます。</p><p class="note">${net.ready === false ? escapeHtml(net.whyNot()) : 'ネットにつながっていないか、サーバーに届きませんでした。'}</p>`;
      return;
    }
    if (tab === 'f' && !r.list.length) {
      list.innerHTML = `<p>まだフレンドがいません。</p><p class="note">「せってい」のフレンドコードを友だちに送るか、友だちのコードを入れてね。</p>`;
      return;
    }
    list.innerHTML = r.list.length
      ? r.list
          .map(
            (x, i) =>
              `<div class="row rkrow" data-u="${tab === 'f' && !x.me && x.u ? escapeHtml(x.u) : ''}" data-n="${escapeHtml(x.n)}" style="padding:6px 2px;border-bottom:1px solid rgba(255,255,255,0.06);${x.me ? 'background:rgba(255,212,0,0.15);border-radius:8px' : ''}"><b style="width:28px;text-align:center;color:${i < 3 ? '#ffd400' : '#fff'}">${x.rank || i + 1}</b><img alt="" style="width:30px;height:30px;border-radius:8px" ${this.porImg(PUNCHERS[x.c] ? x.c : 'tora', 0)}><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(x.n)}</span><b>${x.s}</b></div>`
          )
          .join('')
      : '<p class="note">まだだれもいません。一番乗りしよう！</p>';
    this.fillImgs(list);
    if (tab === 'f')
      $$('.rkrow', list).forEach((row) => {
        if (!row.dataset.u) return;
        row.onclick = async () => {
          const ok = await this.confirm('フレンドをやめる', escapeHtml(row.dataset.n) + ' さんとのフレンドをやめますか？', 'やめる', 'もどる');
          if (!ok) return;
          const rr = await net.removeFriend(row.dataset.u);
          this.toast(rr && rr.ok ? 'フレンドをやめました' : 'できませんでした');
          this.showRanking('f');
        };
      });
    if (r.me) me.innerHTML += `<p class="note">あなたの順位：<b>${r.me.rank}位</b>（${r.me.s}）</p>`;
  }

  // ===== せってい =====
  showSettings() {
    const st = this.settings;
    const s = this.setScreen(
      `<div class="hdr"><button class="back" aria-label="もどる">${ICON.back}</button><h2>せってい</h2></div>
       <div class="card">
         <div class="toggle"><span>ニックネーム：<b class="nm"></b></span><button class="btn small k rename">変える</button></div>
         <div class="toggle"><span>操作のしかた</span><div class="seg sch" style="margin:0;width:180px;background:rgba(255,255,255,0.1)"><button data-s="two">両手</button><button data-s="one">片手</button></div></div>
         <p class="note schnote" style="margin:-4px 0 8px"></p>
         <div class="field lookf"><span>視点の速さ（右の親指） <b class="lv"></b></span><input type="range" min="0.5" max="2" step="0.05" class="lsens"></div>
         <div class="field"><span>旋回の速さ（スライド） <b class="sv"></b></span><input type="range" min="0.5" max="1.6" step="0.05" class="sens"></div>
         <label class="toggle"><span>左右の操作を反対にする</span><input type="checkbox" class="invx"></label>
         <label class="toggle"><span>上下の操作を反対にする</span><input type="checkbox" class="inv"></label>
         <label class="toggle"><span>スキルをタップでも出す（上フリックでも出る）</span><input type="checkbox" class="tap"></label>
         <div class="field"><span>効果音</span><input type="range" min="0" max="1" step="0.05" class="sfx"></div>
         <div class="field"><span>BGM</span><input type="range" min="0" max="1" step="0.05" class="bgm"></div>
         <div class="toggle"><span>画質</span><div class="seg q" style="margin:0;width:180px;background:rgba(255,255,255,0.1)"><button data-q="auto">おまかせ</button><button data-q="high">きれい</button><button data-q="low">かるい</button></div></div>
       </div>
       <div class="card acct"></div>
       <div class="card">
         <button class="btn wide k tutbtn">操作の練習（チュートリアル）</button>
         <div style="height:8px"></div>
         <button class="btn wide k trainbtn2">訓練場（自由に練習）</button>
         <div style="height:8px"></div>
         <button class="btn wide k how">遊び方・操作の一覧</button>
         <div style="height:8px"></div>
         <button class="btn wide k rulesbtn">ルールと勝ち方</button>
         <div style="height:8px"></div>
         <button class="btn wide k sharebtn">友だちに送る（LINEなど）</button>
         <div style="height:8px"></div>
         <button class="btn wide k report">不具合を送る（学校の端末など）</button>
       </div>
       <div class="card"><p class="note">浪人パンチフライト v${VERSION}（${BUILD}）<br>キックフライト（グレンジ）の遊びをもとにしたファンメイドのゲームです。公式とは関係ありません。</p></div>`,
      'panel scroll'
    );
    $('.nm', s).textContent = this.save.name || '未設定';
    $('.rename', s).onclick = () => this.showName(false);
    const sens = $('.sens', s), sv = $('.sv', s);
    sens.value = st.sens;
    sv.textContent = Math.round(st.sens * 100) + '%';
    sens.oninput = () => {
      st.sens = +sens.value;
      sv.textContent = Math.round(st.sens * 100) + '%';
      this.applySettings();
    };
    // 操作のしかた（両手／片手）
    const schB = $$('.sch button', s), schNote = $('.schnote', s), lookF = $('.lookf', s);
    const showSch = () => {
      const two = st.scheme !== 'one';
      schB.forEach((b) => b.classList.toggle('on', b.dataset.s === (two ? 'two' : 'one')));
      schNote.innerHTML = two
        ? '左の親指：アクセル（長押しで飛ぶ・はなすと止まる）・フリック<br>右の親指：なぞって視点を動かす・タップでブースト'
        : '画面のどこでも：長押しで飛ぶ・スライドで旋回・フリック・タップ（キックフライトと同じ）';
      lookF.style.display = two ? '' : 'none';
    };
    showSch();
    schB.forEach((b) => (b.onclick = () => {
      st.scheme = b.dataset.s;
      this.applySettings();
      showSch();
    }));
    const lsens = $('.lsens', s), lv = $('.lv', s);
    lsens.value = st.lookSens || 1;
    lv.textContent = Math.round((st.lookSens || 1) * 100) + '%';
    lsens.oninput = () => {
      st.lookSens = +lsens.value;
      lv.textContent = Math.round(st.lookSens * 100) + '%';
      this.applySettings();
    };
    const inv = $('.inv', s);
    inv.checked = st.invertY;
    inv.onchange = () => {
      st.invertY = inv.checked;
      this.applySettings();
    };
    const invx = $('.invx', s);
    invx.checked = !!st.invertX;
    invx.onchange = () => {
      st.invertX = invx.checked;
      this.applySettings();
    };
    const tap = $('.tap', s);
    tap.checked = st.tapSkill;
    tap.onchange = () => {
      st.tapSkill = tap.checked;
      this.applySettings();
    };
    const sfx = $('.sfx', s), bgm = $('.bgm', s);
    sfx.value = sound.vol.sfx;
    bgm.value = sound.vol.bgm;
    sfx.oninput = () => sound.setVolume('sfx', +sfx.value);
    sfx.onchange = () => sound.play('pickup');
    bgm.oninput = () => sound.setVolume('bgm', +bgm.value);
    const qb = $$('.q button', s);
    const showQ = () => qb.forEach((b) => b.classList.toggle('on', b.dataset.q === st.quality));
    showQ();
    qb.forEach((b) => (b.onclick = () => {
      st.quality = b.dataset.q;
      this.applySettings();
      showQ();
      this.dprMax = st.quality === 'low' ? 1 : Math.min(window.devicePixelRatio || 1, 2);
      this.dpr = st.quality === 'high' ? this.dprMax : st.quality === 'low' ? 1 : Math.min(this.dprMax, 1.5);
      this.post.enabled = st.quality !== 'low';
      this.post.bloomOn = true;
      this.applyDpr();
    }));
    $('.tutbtn', s).onclick = () => this.startTutorial();
    $('.trainbtn2', s).onclick = () => this.startTraining();
    $('.how', s).onclick = () => this.showHowto();
    $('.rulesbtn', s).onclick = () => this.showRules(this.save.mode);
    $('.sharebtn', s).onclick = () => this.share();
    $('.report', s).onclick = () => this.showReport();
    $('.back', s).onclick = () => this.showHome();
    this.backHandler = () => this.showHome();
    net.renderAccount($('.acct', s));
  }

  deviceInfo() {
    let gl = '';
    try {
      const g = this.renderer.getContext();
      const ext = g.getExtension('WEBGL_debug_renderer_info');
      gl = ext ? g.getParameter(ext.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER);
      gl += this.renderer.capabilities.isWebGL2 ? ' (WebGL2)' : ' (WebGL1)';
    } catch (e) {}
    return {
      v: VERSION + ' ' + BUILD,
      ua: navigator.userAgent,
      scr: screen.width + 'x' + screen.height,
      view: this.viewW + 'x' + this.viewH,
      dpr: window.devicePixelRatio,
      rdpr: this.dpr,
      gl,
      fps: Math.round(this.fpsAvg || 0),
      standalone: isStandalone(),
      inapp: isInApp,
      storage: store.ok(),
      lang: navigator.language,
      errors: this.errors.slice(-8),
      net: this.room ? this.room.log.slice(-15) : this.lastRoomLog || [],
    };
  }
  showReport() {
    const info = this.deviceInfo();
    const m = el(
      'div',
      'modal',
      `<div class="box"><h3>不具合を送る</h3><p class="note" style="font-size:12px;color:#dfe5f2">どんなことが起きたか書いてね（例：学校のiPadで画面がまっ黒）。端末の情報もいっしょに送ります。名前やメールなどの個人情報は書かないでね。</p>
      <div class="field"><textarea maxlength="500" rows="4" style="font:inherit;font-size:15px;padding:10px;border-radius:10px;border:2px solid rgba(255,255,255,.25);background:rgba(0,0,0,.3);color:#fff;-webkit-user-select:text;user-select:text;touch-action:auto"></textarea></div>
      <p class="note" style="word-break:break-all">${escapeHtml(info.gl || 'グラフィック情報なし')} / ${info.view} / ${info.fps}fps / ${info.standalone ? 'ホーム画面アプリ' : info.inapp ? 'アプリ内ブラウザ' : 'ブラウザ'}</p>
      <div class="btns"><button class="btn y ok">送る</button><button class="btn k no">やめる</button></div></div>`
    );
    this.root.appendChild(m);
    m.querySelector('.no').onclick = () => m.remove();
    m.querySelector('.ok').onclick = async () => {
      const text = m.querySelector('textarea').value.trim().slice(0, 500);
      m.remove();
      const r = await net.report(text, info);
      this.toast(r && r.ok ? '送りました。ありがとう！' : '送れませんでした（ネットか、サーバーの準備中かも）');
    };
  }

  // ルールの説明（3つのルールをタブで切りかえ）。onBattle があれば「バトルへ」ボタン
  showRules(k, onBattle) {
    let cur = MODE_KEYS.includes(k) ? k : 'scramble';
    const m = el(
      'div',
      'modal rules',
      `<div class="box"><h3>ルールと勝ち方</h3>
        <div class="seg rtabs">${MODE_KEYS.map((x) => `<button data-k="${x}">${escapeHtml(RULE_TEXT[x].short)}</button>`).join('')}</div>
        <div class="rcont"></div>
        <p class="note" style="margin-top:8px">どのルールも4対4・3分。相手をたおすと、相手は5秒後に自分の陣地から復活する。操作は「遊び方」と「訓練場」で練習できる。</p>
        <div class="btns">${onBattle ? '<button class="btn y go">わかった！バトルへ</button>' : ''}<button class="btn ${onBattle ? 'k' : 'y'} close">とじる</button></div></div>`
    );
    this.root.appendChild(m);
    const show = () => {
      $$('.rtabs button', m).forEach((b) => b.classList.toggle('on', b.dataset.k === cur));
      $('.rcont', m).innerHTML = ruleHtml(cur, escapeHtml);
      $('.rcont', m).scrollTop = 0;
    };
    $$('.rtabs button', m).forEach((b) => (b.onclick = () => {
      cur = b.dataset.k;
      show();
      sound.play('ui');
    }));
    show();
    $('.close', m).onclick = () => m.remove();
    if (onBattle)
      $('.go', m).onclick = () => {
        m.remove();
        onBattle();
      };
  }

  showHowto() {
    const two = this.settings.scheme !== 'one';
    const rows = two
      ? `<b>左で長押し</b><span>アクセル。前へ飛ぶ（地面では走る）。離すとその場で止まる。左の指をすべらせても向きは変わらない</span>
        <b>右でなぞる</b><span>視点（向き）を動かす。飛びながらでも、止まっていても。飛ぶ方向もこれで決まる。すばやくなぞると大きく回る</span>
        <b>タップ</b><span>ブーストダッシュ（黄色いゲージを1つ使う。左右どちらの親指でも）。そのあとは自動で飛び続ける</span>
        <b>右で敵をタップ</b><span>その敵をロックオン（もう一度タップで外す）</span>
        <b>フリック</b><span>回避・ブレーキ・ターンのフリックは左の親指で（右でなぞると視点になる）</span>`
      : `<b>長押し</b><span>前へ飛ぶ（地面では走る）。離すとその場で止まる</span>
        <b>長押し＋スライド</b><span>飛びながら旋回（押した所にスティックが出る）</span>
        <b>押してすべらせる</b><span>止まったまま向きを変える（指ははなさない。すばやく離すとステップ）</span>
        <b>タップ</b><span>ブーストダッシュ（黄色いゲージを1つ使う）。そのあとは自動で飛び続ける</span>`;
    const m = el(
      'div',
      'modal howto',
      `<div class="box"><h3>遊び方</h3>
      <p class="note" style="margin:0 0 8px">いまの操作：<b>${two ? '両手（左で移動・右で視点）' : '片手（どこでも）'}</b>。せっていの「操作のしかた」で変えられる</p>
      <div class="ctrl">
        ${rows}
        <b>横フリック</b><span>止まっているとき：ステップ／飛んでいるとき：バレルロール</span>
        <b>上フリック</b><span>止まっているとき：上へ浮かぶ</span>
        <b>下フリック</b><span>止まっているとき：バックステップ／飛んでいるとき：急ブレーキ</span>
        <b>上→下フリック</b><span>くるっと180度ターン（ロックオンは外れる）</span>
        <b>右のアイコン</b><span>タップでその敵をロックオン。近づくと自動でパンチ</span>
        <b>下のアイコン</b><span>上フリックでスキル（ディスクは先生・ごはん・犬などが出て技を出す。溜め中に攻撃されると割れる）。ディスクを下フリックで属性を変える</span>
        <b>SPボタン</b><span>ゲージが満タンでスペシャル</span>
        <b>ロック中タップ</b><span>ダッシュ攻撃（ゲージ2つ）。相手の溜めをつぶせる</span>
      </div>
      <p class="note" style="margin-top:10px">ジャスト回避：攻撃が当たる直前にフリックすると、ダメージなしで相手にスキができる。<br>壁にむかってブーストすると壁キックで反転。長押しで壁にぶつかると、壁にそって上へすべる。地面に立つとブーストが早く回復。<br>スクランブルのサクラは、自分のダルマの近くで自動で預ける。<br>属性：火→風→水→火 の順に強い（1.2倍）。</p>
      <h3 style="margin-top:12px">ルール</h3>
      ${MODE_KEYS.map((k) => `<p style="margin:6px 0 2px;color:#ffd400">${MODES[k].name}</p><ol>${MODES[k].howto.map((h) => `<li>${h}</li>`).join('')}</ol>`).join('')}
      <button class="btn k wide morerules" style="margin-top:6px">ルールと勝ち方を図でくわしく</button>
      <p class="note">パソコン：WASD/矢印で旋回、スペースで飛ぶ、J でブースト、Q/E で回避、X でバック、R でターン、1〜5 でスキル、F でスペシャル、Tab でロックオン。</p>
      <div class="btns"><button class="btn y close">とじる</button></div></div>`
    );
    this.root.appendChild(m);
    m.querySelector('.close').onclick = () => m.remove();
    m.querySelector('.morerules').onclick = () => this.showRules(this.match ? this.match.opts.mode : this.save.mode);
  }

  // ===== 試合 =====
  startMatch() {
    const S = this.save;
    if (this.settings.quality === 'auto' && this.post.enabled) this.post.bloomOn = true;
    this.screenEl.innerHTML = '';
    this.paused = false;
    const deck = S.decks[S.char];
    this.match = new Match(this, {
      mode: S.mode,
      stage: resolveStage(S.stage),
      char: S.char,
      difficulty: S.diff,
      playerName: S.name || 'プレイヤー',
      deck,
      deckLv: deck.map((id) => omLevel(S, id)),
      friends: (this.friendList || []).slice(),
      teams: this.testTeams || null, // テスト用（ふだんは null）
    });
    this.match.resize(this.viewW, this.viewH);
    if (this.lowGfx || this.settings.quality === 'low') this.setLowGfx(true);
  }
  // 訓練場（時間制限なし・サンドバッグ相手に練習。ランクや点は変わらない）
  startTraining() {
    if (this.match) this.endMatch();
    if (this.settings.quality === 'auto' && this.post.enabled) this.post.bloomOn = true;
    this.screenEl.innerHTML = '';
    this.paused = false;
    const S = this.save;
    const deck = S.decks[S.char];
    this.match = new Training(this, { mode: 'scramble', stage: resolveStage(S.stage), char: S.char, difficulty: 'zero', playerName: S.name || 'プレイヤー', deck, deckLv: deck.map((id) => omLevel(S, id)) });
    this.match.resize(this.viewW, this.viewH);
    if (this.lowGfx || this.settings.quality === 'low') this.setLowGfx(true);
  }
  startTutorial() {
    this.screenEl.innerHTML = '';
    this.paused = false;
    this.match = new Tutorial(this, { mode: 'scramble', char: this.save.char, difficulty: 'easy', playerName: this.save.name || 'プレイヤー', deck: this.save.decks[this.save.char], tutorial: true });
    this.match.resize(this.viewW, this.viewH);
  }
  endMatch() {
    clearTimeout(this._resBgm);
    if (this.post.offNext) {
      this.post.enabled = false;
      this.post.offNext = false;
    }
    if (this.speedLines) this.speedLines.style.opacity = '0';
    this._slv = '0';
    this._slo = 0;
    if (this.match) {
      this.match.dispose();
      this.match = null;
    }
    this.fxLayer.innerHTML = '';
    this.paused = false;
  }
  pause() {
    if (!this.match || this.paused) return;
    if (this.match.phase === 'finish' || this.match.phase === 'result') return;
    if (this.match.online) return this.onlineMenu();
    this.paused = true;
    this.input.enabled = false;
    this.input.reset();
    sound.play('uiBack');
    const isTut = this.match.isTutorial || this.match.isTraining;
    const quitLabel = this.match.isTraining ? '訓練場を出る' : isTut ? '練習をやめる' : 'あきらめる（負けになる）';
    const m = el('div', 'modal', `<div class="box"><h3>ポーズ</h3><div class="btns"><button class="btn y resume">つづける</button><button class="btn k how">遊び方</button>${this.match.isTutorial || this.match.isTraining ? '' : '<button class="btn k rules">ルールと勝ち方</button>'}<button class="btn red quit">${quitLabel}</button></div></div>`);
    this.root.appendChild(m);
    m.querySelector('.resume').onclick = () => {
      m.remove();
      this.paused = false;
      this.last = performance.now();
      if (this.match && this.match.phase === 'play') this.input.enabled = true;
    };
    m.querySelector('.how').onclick = () => this.showHowto();
    if (m.querySelector('.rules')) m.querySelector('.rules').onclick = () => this.showRules(this.match ? this.match.opts.mode : 'scramble');
    m.querySelector('.quit').onclick = () => {
      m.remove();
      if (isTut) {
        this.endMatch();
        this.showHome();
        return;
      }
      const M = this.match;
      this.paused = false;
      if (!M || M.phase === 'finish' || M.phase === 'result') return;
      M.result = M.mode.result();
      M.result.winner = 1 - M.player.team;
      M.result.reason = 'あきらめた';
      M.phase = 'finish';
      M.toResult();
    };
  }

  // オンライン対戦中のメニュー（試合は止まらない）
  onlineMenu() {
    if (this.root.querySelector('.modal.onl')) return;
    sound.play('uiBack');
    const host = this.room && this.room.role === 'host';
    const m = el('div', 'modal onl', `<div class="box"><h3>メニュー</h3><p class="note">オンライン対戦中は止まりません</p><div class="btns"><button class="btn y resume">つづける</button><button class="btn k how">遊び方</button><button class="btn red quit">${host ? '部屋をとじる（全員終わる）' : '部屋から出る'}</button></div></div>`);
    this.root.appendChild(m);
    m.querySelector('.resume').onclick = () => m.remove();
    m.querySelector('.how').onclick = () => this.showHowto();
    m.querySelector('.quit').onclick = () => {
      m.remove();
      this.leaveRoom();
      this.endMatch();
      this.showHome();
    };
  }

  showResult(r) {
    const S = this.save;
    const rw = applyResult(S, r);
    net.sync(S, r);
    const match = this.match;
    // 結果は3Dの試合画面のまま上にかぶせる（試合中の表示は消す）
    if (match) {
      match.phase = 'result';
      match.input.enabled = false;
    }
    this.hudRoot.classList.add('resultmode');
    this.speedLines.style.opacity = '0';
    sound.stopBgm();
    sound.play(r.win > 0 ? 'win' : r.win < 0 ? 'lose' : 'ui');
    clearTimeout(this._resBgm);
    this._resBgm = setTimeout(() => {
      if (this.match && this.match.phase === 'result') sound.playBgm('result');
    }, 1500);
    const wl = r.win > 0 ? ['WIN!', 'win'] : r.win < 0 ? ['LOSE…', 'lose'] : ['DRAW', 'draw'];
    const rows = r.punchers
      .slice()
      .sort((a, b) => a.team - b.team || b.stats.score - a.stats.score)
      .map(
        (p) =>
          `<div class="tr t${p.team} ${p === r.me ? 'me' : ''}"><img alt="" src="${this.portraits.get(p.def.id, p.team)}"><span class="nmw"><span class="nm">${escapeHtml(p.isPlayer ? S.name || 'あなた' : p.displayName || p.def.short || p.def.name)}</span>${r.mvp[p.team] === p ? '<span class="mvp">MVP</span>' : ''}</span><span>${p.stats.ko}</span><span>${p.stats.down}</span><b>${p.stats.score}</b></div>`
      )
      .join('');
    const rk = rw.rankAfter;
    const up = rw.rankAfter.idx > rw.rankBefore.idx;
    const prizes = rw.prizes
      .map((pz, i) => {
        const o = OMAMORI[pz.id];
        return `<div class="bag" style="animation-delay:${0.6 + i * 0.35}s;--e:${ELEM[o.elem].color};--r:${RARE_COLOR[o.rare]}"><div class="g"><img alt="" src="${this.portraits.monster(o.mon, 128)}"></div><div class="nm">${escapeHtml(o.name)}</div><div class="${pz.isNew ? 'new' : ''}">${pz.isNew ? 'NEW!' : pz.lvUp ? 'Lv' + pz.lv + 'にアップ！' : 'Lv' + pz.lv}</div></div>`;
      })
      .join('');
    const s = this.setScreen(
      `<div class="wl ${wl[1]}">${wl[0]}</div>
       <div class="sc"><div class="dia d0"><span>${r.scores[0]}</span></div><div style="font-size:12px;color:#cfd7e8">${MODES[r.mode].name}<br>（${r.unit}）</div><div class="dia d1"><span>${r.scores[1]}</span></div></div>
       <div class="reason">${escapeHtml(r.reason || '')}</div>
       <div class="table"><div class="tr th"><span></span><span>名前</span><span>KO</span><span>ダウン</span><span>得点</span></div>${rows}</div>
       <div class="rpbox"><div class="row sb"><span>ランク <b style="color:#ffd400;font-size:18px">${rk.key}</b>${up ? ' <b style="color:#5dffa0">ランクアップ！</b>' : ''}</span><span>${rw.gain >= 0 ? '+' : ''}${rw.gain}pt（${S.rp}pt）</span></div>
       <div class="note">今週のポイント +${rw.weekPt}${rw.mvp ? '・MVPボーナス' : ''}</div>
       ${rw.prizes.length ? `<div class="note" style="margin-top:6px;color:#ffd400">ディスクパックを開けた！</div><div class="prize">${prizes}</div>` : ''}</div>
       <div style="flex:1"></div>
       <div class="row resbtns" style="width:100%;max-width:420px;gap:10px"><button class="btn k home" style="flex:1">${r.online ? '部屋を出る' : 'ホーム'}</button><button class="btn y again" style="flex:1.4">${r.online ? '部屋にもどる' : 'もう1回'}</button></div>`,
      'result scroll'
    );
    // 自分のキャラの勝ち・負けポーズ（タイトルのうしろ）
    if (r.me && r.me.def) {
      const hero = el('div', `hero t${r.me.team} ${wl[1]}`);
      hero.innerHTML = '<img alt="">';
      hero.querySelector('img').src = this.portraits.hero(r.me.def.id, r.me.team, r.win > 0 ? 'win' : r.win < 0 ? 'lose' : 'hover');
      s.prepend(hero);
      s.classList.add('hashero');
    }
    if (rw.prizes.length) setTimeout(() => sound.play('capsule'), 700);
    $('.home', s).onclick = () => {
      sound.play('ui');
      if (r.online) this.leaveRoom();
      this.endMatch();
      this.showHome();
    };
    $('.again', s).onclick = () => {
      sound.play('ui');
      if (r.online) return this.backToRoom();
      this.endMatch();
      this.startMatch();
    };
    // 勝ったチームのダルマに目が入る
    if (match && r.win !== 0) {
      const wt = r.win > 0 ? r.me.team : 1 - r.me.team;
      const g = match.guardians[wt];
      if (g && g.model.userData.eyes) g.model.userData.eyes[1].visible = true;
      for (const p of match.punchers) {
        if (!p.alive) continue;
        p.state = 'hover';
        p.vel.set(0, 0, 0);
      }
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.__app = new App();
  window.__sound = sound; // テスト用
});
