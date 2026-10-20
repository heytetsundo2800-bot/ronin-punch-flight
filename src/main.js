// 浪人パンチフライト：アプリ全体（画面の切りかえ・描画のループ）
import * as THREE from 'three';
import './styles.css';
import { VERSION, BUILD, MODES, DIFFICULTY, ELEM, TEAM, rankOf, RANKS } from './config.js';
import { PUNCHERS, PUNCHER_IDS, OMAMORI, OMAMORI_IDS, KIND_COLOR, RARE_COLOR } from './characters.js';
import { buildPuncher, poseModel } from './model.js';
import { Portraits } from './portraits.js';
import { Input } from './input.js';
import { Match } from './match.js';
import { Tutorial } from './tutorial.js';
import { sound } from './audio.js';
import { loadSave, saveSave, applyResult, omLevel, weekId } from './save.js';
import { net } from './net.js';
import { el, $, $$, store, escapeHtml, isIOS, isLINE, isInApp, isStandalone, hasTouch, clamp, damp } from './util.js';
import { toon, addOutline } from './gfx.js';

const MODE_KEYS = ['scramble', 'flag', 'ball'];

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
    this.settings = Object.assign({ sens: 1, invertY: false, tapSkill: true, quality: 'auto', hand: 'right' }, store.get('rpf_settings', {}));
    this.screenEl = $('#screens');
    this.hudRoot = $('#hud');
    this.fxLayer = $('#fx');
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
    this.last = performance.now();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
    this.showTitle();
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
    if (this.match) this.match.resize(w, h);
    if (this.lobby) {
      this.lobby.cam.aspect = w / h;
      this.lobby.cam.updateProjectionMatrix();
    }
  }
  setLowGfx(on) {
    this.lowGfx = on;
    if (this.match) for (const p of this.match.punchers) p.model.traverse((o) => {
      if (o.name === 'outline') o.visible = !on;
    });
  }
  applySettings() {
    this.input.sens = this.settings.sens;
    this.input.invertY = this.settings.invertY;
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
      if (document.hidden && this.match && this.match.phase === 'play') this.pause();
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
      if (this.match && !this.noRender) this.renderer.render(this.match.scene, this.match.camera);
    } else if (this.match && this.paused) {
      this.renderer.render(this.match.scene, this.match.camera);
    } else if (this.lobby) {
      this.updateLobby(dt);
      this.renderer.render(this.lobby.scene, this.lobby.cam);
    }
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
      this.renderer.setPixelRatio(this.dpr);
      this.renderer.setSize(this.viewW, this.viewH, false);
    } else if (avg > 1 / 32 && this.dpr <= 1 && !this.lowGfx && this.match) {
      // それでも重い：キャラのふちどりを消して軽くする
      this.setLowGfx(true);
    } else if (avg < 1 / 58 && this.dpr < Math.min(this.dprMax, 2)) {
      this.dpr = Math.min(this.dprMax, this.dpr + 0.25);
      this.renderer.setPixelRatio(this.dpr);
      this.renderer.setSize(this.viewW, this.viewH, false);
    }
  }

  // ===== ロビーの3D（キャラが立っている）=====
  initLobby() {
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0xcfe9ff, 60, 260);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x9fb4cf, 1.6));
    const sun = new THREE.DirectionalLight(0xfff4e0, 2.2);
    sun.position.set(4, 8, 6);
    scene.add(sun);
    const cam = new THREE.PerspectiveCamera(35, this.viewW / this.viewH, 0.1, 2000);
    // 空
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(900, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }',
        fragmentShader: 'varying vec3 vD; void main(){ float h = vD.y; vec3 c = mix(vec3(0.56,0.79,1.0), vec3(0.18,0.52,0.91), smoothstep(0.0,0.6,h)); c = mix(c, vec3(0.93,0.97,1.0), smoothstep(0.05,-0.3,h)); gl_FragColor = vec4(c,1.0); }',
      })
    );
    scene.add(sky);
    // 足場の島
    const isl = new THREE.Group();
    const top = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.5, 0.5, 32), toon(0x86d35e));
    top.position.y = -0.95;
    addOutline(top, 0x2a3a20, 0.04);
    isl.add(top);
    const rock = new THREE.Mesh(new THREE.ConeGeometry(2.45, 3.4, 12, 2), toon(0x9a8676));
    rock.rotation.x = Math.PI;
    rock.position.y = -2.9;
    isl.add(rock);
    scene.add(isl);
    // 遠くの島と雲
    const far = new THREE.Group();
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const r = 40 + (i % 3) * 25;
      const m = new THREE.Mesh(new THREE.ConeGeometry(4 + (i % 3) * 2, 8, 8), toon(0x9a8676));
      m.rotation.x = Math.PI;
      m.position.set(Math.cos(a) * r, -6 + (i % 4) * 5, Math.sin(a) * r - 30);
      far.add(m);
      const g = new THREE.Mesh(new THREE.CylinderGeometry(4.2 + (i % 3) * 2, 4 + (i % 3) * 2, 1, 12), toon(0x86d35e));
      g.position.copy(m.position);
      g.position.y += 4.3;
      far.add(g);
    }
    scene.add(far);
    // 舞う花びら
    const petals = [];
    const pm = new THREE.MeshBasicMaterial({ color: 0xffc2da, side: THREE.DoubleSide });
    for (let i = 0; i < 40; i++) {
      const m = new THREE.Mesh(new THREE.CircleGeometry(0.06, 5), pm);
      m.position.set((Math.random() - 0.5) * 12, Math.random() * 8 - 2, (Math.random() - 0.5) * 8);
      m.userData.v = new THREE.Vector3(0.3 + Math.random() * 0.4, -0.25 - Math.random() * 0.3, 0.1);
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
      L.model.traverse((o) => o.geometry && o.geometry.dispose());
    }
    L.model = buildPuncher(PUNCHERS[id], team);
    L.model.position.set(0, -0.12, 0);
    L.scene.add(L.model);
    L.charId = id;
    L.spin = Math.PI * 2;
  }
  updateLobby(dt) {
    const L = this.lobby;
    L.t += dt;
    L.spin = damp(L.spin, 0, 6, dt);
    if (L.model) {
      L.model.rotation.y = 0.35 + Math.sin(L.t * 0.4) * 0.15 + L.spin;
      poseModel(L.model, { mode: L.pose, t: L.t, speed01: 0, turn: 0, punchSide: 1, punchPhase: 0.3, runPhase: 0 }, dt);
    }
    // 画面の向きでキャラの位置を変える（縦：左下、横：左）
    const portrait = this.viewH > this.viewW;
    const asp = this.viewW / this.viewH;
    let dist = portrait ? 8.6 + (0.5 - Math.min(0.5, asp)) * 6 : 6.4;
    let ox = portrait ? 0.62 : 1.7;
    let ly = portrait ? 0.95 : 0.3;
    if (L.view === 'chars') {
      // キャラ選び：上の方にまん中で大きめ
      dist = portrait ? 6.2 : 5.5;
      ox = portrait ? 0 : 1.2;
      ly = portrait ? -0.75 : 0.2;
    }
    L.cx = damp(L.cx == null ? ox : L.cx, ox, 5, dt);
    L.cd = damp(L.cd == null ? dist : L.cd, dist, 5, dt);
    L.cy = damp(L.cy == null ? ly : L.cy, ly, 5, dt);
    L.cam.position.set(L.cx + 0.25, 0.85 + Math.sin(L.t * 0.5) * 0.05, L.cd);
    L.cam.lookAt(L.cx, L.cy, 0);
    for (const p of L.petals) {
      p.position.addScaledVector(p.userData.v, dt);
      p.rotation.x += dt * 2;
      p.rotation.y += dt * 1.3;
      if (p.position.y < -3) p.position.set(-6 - Math.random() * 3, 5 + Math.random() * 2, (Math.random() - 0.5) * 8);
    }
  }

  // ===== 画面の部品 =====
  setScreen(html, cls) {
    this.screenEl.innerHTML = '';
    if (this.lobby) this.lobby.view = (cls || '').includes('charsel') ? 'chars' : 'home';
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
    const T = TEAM[p.team];
    const c = el('div', 'cutin');
    const c1 = p.team === 0 ? '#1d6ad6' : '#d61d45';
    const c2 = p.team === 0 ? '#7fd0ff' : '#ff9fb6';
    c.style.setProperty('--c1', c1);
    c.style.setProperty('--c2', c2);
    c.innerHTML = `<div class="band"></div><img alt=""><div class="who">${escapeHtml(p.isPlayer ? 'あなた' : p.displayName || p.def.short || p.def.name)}・スペシャル</div><div class="nm">${escapeHtml(p.def.special.name)}</div>`;
    c.querySelector('img').src = this.portraits.full(p.def.id, p.team, 'special');
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

  // ===== タイトル =====
  showTitle() {
    sound.playBgm('menu');
    this.lobby.pose = 'hover';
    const s = this.setScreen(
      `<div class="logo"><span class="l1">一浪の空で、殴りあえ。</span><span class="l2">浪人パンチ<br>フライト</span><span class="l3">360°空中バトル・4対4</span></div>
       <div class="tapstart outline">タップしてはじめる</div>
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
      else this.showHome();
    };
    s.addEventListener('click', (e) => {
      if (e.target.closest('a')) return;
      go();
    });
  }

  showName(first) {
    const s = this.setScreen(
      `<div class="hdr">${first ? '' : '<button class="back">←</button>'}<h2>ニックネーム</h2></div>
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
      if (first && !this.save.tutorial) this.askTutorial();
      else if (first) this.showHome();
      else this.showSettings();
    };
  }
  async askTutorial() {
    const ok = await this.confirm('はじめての人へ', '操作の練習（約3分）をしますか？<br>空を飛ぶ・ブースト・回避・攻撃・スキルを順番に練習できます。', '練習する', 'あとで');
    if (ok) this.startTutorial();
    else this.showHome();
  }

  // ===== ホーム（ロビー）=====
  showHome() {
    sound.playBgm('menu');
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
         <button class="iconbtn help" aria-label="遊び方">？</button>
         <button class="iconbtn share" aria-label="友だちに送る">↗</button>
       </div>
       <div class="modecard">
         <div class="hd"><b>レギュラー</b><span>CPUと4対4</span></div>
         <div class="rule"><button class="prev">◀</button><div class="nm"></div><button class="next">▶</button></div>
         <div class="sub"></div>
         <div class="seg diff">${Object.keys(DIFFICULTY).map((k) => `<button data-k="${k}">${DIFFICULTY[k].name}</button>`).join('')}</div>
       </div>
       <button class="battlebtn">バトル</button>
       <div class="homechar"><div class="nm">${escapeHtml(def.name)}</div><div class="tp">${def.typeName}・${ELEM[def.elem].name}</div></div>
       <div style="flex:1"></div>
       <div class="tabs">
         <button data-t="char"><span class="i">👊</span>パンチャー</button>
         <button data-t="om"><span class="i">🧧</span>お守り</button>
         <button data-t="home" class="on"><span class="i">🏠</span>ホーム</button>
         <button data-t="rank"><span class="i">🏆</span>ランキング</button>
         <button data-t="set"><span class="i">⚙️</span>せってい</button>
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
    const diffBtns = $$('.diff button', s);
    const showDiff = () => diffBtns.forEach((b) => b.classList.toggle('on', b.dataset.k === S.diff));
    showDiff();
    diffBtns.forEach((b) => (b.onclick = () => {
      S.diff = b.dataset.k;
      saveSave(S);
      showDiff();
      sound.play('ui');
    }));
    $('.battlebtn', s).onclick = () => {
      sound.play('ui');
      this.startMatch();
    };
    $('.help', s).onclick = () => this.showHowto();
    $('.share', s).onclick = () => this.share();
    $$('.tabs button', s).forEach((b) => (b.onclick = () => {
      sound.play('ui');
      const t = b.dataset.t;
      if (t === 'char') this.showChars();
      else if (t === 'om') this.showOmamori();
      else if (t === 'rank') this.showRanking();
      else if (t === 'set') this.showSettings();
    }));
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

  // ===== キャラ選び =====
  showChars(selId) {
    const S = this.save;
    let cur = selId || S.char;
    this.setLobbyChar(cur);
    this.lobby.pose = 'hover';
    const s = this.setScreen(
      `<div class="hdr"><button class="back">←</button><h2>パンチャー</h2></div>
       <div class="charlist">${PUNCHER_IDS.map((id) => `<button data-id="${id}"><img alt="" src="${this.portraits.get(id, 0)}"><div>${escapeHtml(PUNCHERS[id].short || PUNCHERS[id].name)}</div></button>`).join('')}</div>
       <div style="flex:1;min-height:150px"></div>
       <div class="card info" style="max-height:46vh;overflow-y:auto;touch-action:pan-y"></div>
       <button class="btn y wide pick">このキャラで戦う</button>`,
      'panel charsel'
    );
    s.style.background = 'linear-gradient(180deg, rgba(14,18,32,0.9) 0, rgba(14,18,32,0.0) 26%, rgba(14,18,32,0.0) 40%, rgba(14,18,32,0.92) 56%)';
    const info = $('.info', s);
    const render = () => {
      const d = PUNCHERS[cur];
      $$('.charlist button', s).forEach((b) => b.classList.toggle('on', b.dataset.id === cur));
      const st = d.stat;
      const pts = [
        [55, 50 - st.atk * 8],
        [55 + st.hp * 7.5, 50 + st.hp * 4.5],
        [55 - st.spd * 7.5, 50 + st.spd * 4.5],
      ];
      const cs = S.charStats[cur];
      info.innerHTML = `<div class="statrow"><div style="flex:1"><div style="font-size:20px">${escapeHtml(d.name)}</div><div class="note">${d.typeName}タイプ・属性：<span style="color:${ELEM[d.elem].color}">${ELEM[d.elem].name}</span></div><p>${escapeHtml(d.profile)}</p>${cs ? `<div class="note">このキャラで ${cs.plays}戦 ${cs.wins}勝</div>` : ''}</div>
        <svg class="stats3" viewBox="0 0 110 100"><polygon points="55,10 98,72 12,72" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.3)"/><polygon points="${pts.map((p) => p.join(',')).join(' ')}" fill="rgba(255,212,0,0.55)" stroke="#ffd400" stroke-width="2"/><text x="55" y="8" fill="#fff" font-size="9" text-anchor="middle">こうげき</text><text x="101" y="84" fill="#fff" font-size="9" text-anchor="end">たいりょく</text><text x="9" y="84" fill="#fff" font-size="9">スピード</text></svg></div>
        <div class="skillbox"><span class="tag">スキル</span><div><b>${escapeHtml(d.skill.name)}</b>（${d.skill.cd}秒）<p>${escapeHtml(d.skill.desc)}</p></div></div>
        <div class="skillbox"><span class="tag sp">SP</span><div><b>${escapeHtml(d.special.name)}</b><p>${escapeHtml(d.special.desc)}</p></div></div>
        <div class="skillbox"><span class="tag" style="background:#ddd">通常</span><div><b>${d.attack.kind === 'melee' ? '近距離パンチ' : '遠距離ショット'}</b><p>${d.attack.kind === 'melee' ? '近づくと自動でパンチ。最後の一発でふっとばす' : 'はなれた敵を自動で撃つ（インクのたま）'}</p></div></div>`;
    };
    render();
    $$('.charlist button', s).forEach((b) => (b.onclick = () => {
      cur = b.dataset.id;
      this.setLobbyChar(cur);
      render();
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

  // ===== お守り（デッキ）=====
  showOmamori() {
    const S = this.save;
    const charId = S.char;
    let sel = null; // 選んだお守り
    const s = this.setScreen(
      `<div class="hdr"><button class="back">←</button><h2>お守り（${escapeHtml(PUNCHERS[charId].short || PUNCHERS[charId].name)}）</h2></div>
       <div class="card"><h3>セット中（左はしの色が最初の属性）</h3><div class="deck4"></div><p class="note">下の一覧から選んで、上の枠をタップすると入れかわります。</p></div>
       <div class="card omdetail"></div>
       <div class="card" style="flex:1;overflow-y:auto;touch-action:pan-y"><h3>持っているお守り</h3><div class="omgrid"></div></div>`,
      'panel scroll'
    );
    const deckEl = $('.deck4', s), grid = $('.omgrid', s), det = $('.omdetail', s);
    const card = (id, extra = '') => {
      const o = OMAMORI[id];
      const owned = !!S.om[id];
      return `<button class="omcard ${extra} ${owned ? '' : 'locked'}" data-id="${id}"><div class="g" style="background:radial-gradient(circle at 50% 40%, ${ELEM[o.elem].color}cc, ${ELEM[o.elem].color})">${o.icon}<span class="r" style="color:${RARE_COLOR[o.rare]}">${o.rare}</span>${owned ? `<span class="lv">Lv${omLevel(S, id)}</span>` : ''}</div><span class="k" style="background:${KIND_COLOR[o.kind]}">${o.kind}</span></button>`;
    };
    const showDet = (id) => {
      if (!id) {
        det.innerHTML = '<p class="note">お守りをタップすると説明が出ます。上フリックで発動、下フリックでその色の属性に変わります。</p>';
        return;
      }
      const o = OMAMORI[id];
      const lv = omLevel(S, id);
      const owned = !!S.om[id];
      det.innerHTML = `<div class="row sb"><b style="font-size:15px">${escapeHtml(o.name)}</b><span class="note">${o.rare}・${o.kind}・${ELEM[o.elem].name}</span></div><p>${escapeHtml(o.desc)}</p><div class="note">${owned ? `Lv${lv}（効果 +${(lv - 1) * 8}%・待ち時間 ${Math.round(o.cd * (1 - (lv - 1) * 0.04))}秒）` : 'まだ持っていません（お守り袋から出ます）'}</div>`;
    };
    const render = () => {
      const deck = S.decks[charId];
      deckEl.innerHTML = deck.map((id, i) => card(id, sel && sel === id ? 'sel' : '')).join('');
      grid.innerHTML = OMAMORI_IDS.map((id) => card(id, (deck.includes(id) ? 'inuse ' : '') + (sel === id ? 'sel' : ''))).join('');
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
          showDet(d[i]);
        } else {
          showDet(deck[i]);
        }
      }));
      $$('.omgrid .omcard', s).forEach((b) => (b.onclick = () => {
        const id = b.dataset.id;
        sel = sel === id ? null : id;
        showDet(id);
        render();
        sound.play('ui');
      }));
    };
    render();
    showDet(null);
    $('.back', s).onclick = () => this.showHome();
    this.backHandler = () => this.showHome();
  }

  // ===== ランキング =====
  async showRanking(tab = 'w') {
    const s = this.setScreen(
      `<div class="hdr"><button class="back">←</button><h2>ランキング</h2></div>
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
      list.innerHTML = `<p>ランキングはオンラインのアカウントで参加できます。</p><p class="note">${net.ready === false ? 'ランキングのサーバーはまだ準備中です。準備ができたら自動で参加できます。' : 'ネットにつながっていないか、サーバーに届きませんでした。'}</p>`;
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
              `<div class="row rkrow" data-u="${tab === 'f' && !x.me && x.u ? escapeHtml(x.u) : ''}" data-n="${escapeHtml(x.n)}" style="padding:6px 2px;border-bottom:1px solid rgba(255,255,255,0.06);${x.me ? 'background:rgba(255,212,0,0.15);border-radius:8px' : ''}"><b style="width:28px;text-align:center;color:${i < 3 ? '#ffd400' : '#fff'}">${x.rank || i + 1}</b><img alt="" style="width:30px;height:30px;border-radius:8px" src="${this.portraits.get(PUNCHERS[x.c] ? x.c : 'tora', 0)}"><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(x.n)}</span><b>${x.s}</b></div>`
          )
          .join('')
      : '<p class="note">まだだれもいません。一番乗りしよう！</p>';
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
      `<div class="hdr"><button class="back">←</button><h2>せってい</h2></div>
       <div class="card">
         <div class="toggle"><span>ニックネーム：<b class="nm"></b></span><button class="btn small k rename">変える</button></div>
         <div class="field"><span>旋回の速さ <b class="sv"></b></span><input type="range" min="0.5" max="1.6" step="0.05" class="sens"></div>
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
         <button class="btn wide k how">遊び方・操作の一覧</button>
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
    const inv = $('.inv', s);
    inv.checked = st.invertY;
    inv.onchange = () => {
      st.invertY = inv.checked;
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
      this.renderer.setPixelRatio(this.dpr);
      this.renderer.setSize(this.viewW, this.viewH, false);
    }));
    $('.tutbtn', s).onclick = () => this.startTutorial();
    $('.how', s).onclick = () => this.showHowto();
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

  showHowto() {
    const m = el(
      'div',
      'modal howto',
      `<div class="box"><h3>遊び方</h3>
      <div class="ctrl">
        <b>長押し</b><span>前へ飛ぶ（地面では走る）。離すとその場で止まる</span>
        <b>長押し＋スライド</b><span>飛びながら旋回（押した所にスティックが出る）</span>
        <b>すぐスライド</b><span>止まったまま向きを変える</span>
        <b>タップ</b><span>ブーストダッシュ（黄色いゲージを1つ使う）。そのあとは自動で飛び続ける</span>
        <b>横フリック</b><span>止まっているとき：ステップ／飛んでいるとき：バレルロール</span>
        <b>上フリック</b><span>止まっているとき：上へ浮かぶ</span>
        <b>下フリック</b><span>止まっているとき：バックステップ／飛んでいるとき：急ブレーキ</span>
        <b>上→下フリック</b><span>くるっと180度ターン（ロックオンは外れる）</span>
        <b>右のアイコン</b><span>タップでその敵をロックオン。近づくと自動でパンチ</span>
        <b>下のアイコン</b><span>上フリックでスキル。お守りを下フリックで属性を変える</span>
        <b>SPボタン</b><span>ゲージが満タンでスペシャル</span>
        <b>ロック中タップ</b><span>ダッシュ攻撃（ゲージ2つ）。相手の溜めをつぶせる</span>
      </div>
      <p class="note" style="margin-top:10px">ジャスト回避：攻撃が当たる直前にフリックすると、ダメージなしで相手にスキができる。<br>壁にむかってブーストすると壁キックで反転。地面に立つとブーストが早く回復。<br>属性：火→風→水→火 の順に強い（1.2倍）。</p>
      <h3 style="margin-top:12px">ルール</h3>
      ${MODE_KEYS.map((k) => `<p style="margin:6px 0 2px;color:#ffd400">${MODES[k].name}</p><ol>${MODES[k].howto.map((h) => `<li>${h}</li>`).join('')}</ol>`).join('')}
      <p class="note">パソコン：WASD/矢印で旋回、スペースで飛ぶ、J でブースト、Q/E で回避、X でバック、R でターン、1〜5 でスキル、F でスペシャル、Tab でロックオン。</p>
      <div class="btns"><button class="btn y close">とじる</button></div></div>`
    );
    this.root.appendChild(m);
    m.querySelector('.close').onclick = () => m.remove();
  }

  // ===== 試合 =====
  startMatch() {
    const S = this.save;
    this.screenEl.innerHTML = '';
    this.paused = false;
    const deck = S.decks[S.char];
    this.match = new Match(this, {
      mode: S.mode,
      char: S.char,
      difficulty: S.diff,
      playerName: S.name || 'プレイヤー',
      deck,
      deckLv: deck.map((id) => omLevel(S, id)),
      friends: (this.friendList || []).slice(),
    });
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
    if (this.match) {
      this.match.dispose();
      this.match = null;
    }
    this.fxLayer.innerHTML = '';
    this.paused = false;
  }
  pause() {
    if (!this.match || this.paused) return;
    this.paused = true;
    this.input.enabled = false;
    this.input.reset();
    sound.play('uiBack');
    const isTut = this.match.isTutorial;
    const m = el('div', 'modal', `<div class="box"><h3>ポーズ</h3><div class="btns"><button class="btn y resume">つづける</button><button class="btn k how">遊び方</button><button class="btn red quit">${isTut ? '練習をやめる' : 'あきらめる（負けになる）'}</button></div></div>`);
    this.root.appendChild(m);
    m.querySelector('.resume').onclick = () => {
      m.remove();
      this.paused = false;
      this.last = performance.now();
      if (this.match && this.match.phase === 'play') this.input.enabled = true;
    };
    m.querySelector('.how').onclick = () => this.showHowto();
    m.querySelector('.quit').onclick = () => {
      m.remove();
      if (isTut) {
        this.endMatch();
        this.showHome();
        return;
      }
      const M = this.match;
      this.paused = false;
      M.result = M.mode.result();
      M.result.winner = 1 - M.player.team;
      M.result.reason = 'あきらめた';
      M.phase = 'finish';
      M.toResult();
    };
  }

  showResult(r) {
    const S = this.save;
    const rw = applyResult(S, r);
    net.sync(S, r);
    const match = this.match;
    // 結果は3Dの試合画面のまま上にかぶせる
    if (match) {
      match.phase = 'result';
      match.input.enabled = false;
    }
    sound.stopBgm();
    sound.play(r.win > 0 ? 'win' : r.win < 0 ? 'lose' : 'ui');
    setTimeout(() => sound.playBgm('result'), 1500);
    const wl = r.win > 0 ? ['WIN!', 'win'] : r.win < 0 ? ['LOSE…', 'lose'] : ['DRAW', 'draw'];
    const rows = r.punchers
      .slice()
      .sort((a, b) => a.team - b.team || b.stats.score - a.stats.score)
      .map(
        (p) =>
          `<div class="tr t${p.team} ${p === r.me ? 'me' : ''}"><img alt="" src="${this.portraits.get(p.def.id, p.team)}"><span style="overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${escapeHtml(p.isPlayer ? S.name || 'あなた' : p.displayName || p.def.short || p.def.name)}${r.mvp[p.team] === p ? '<span class="mvp">MVP</span>' : ''}</span><span>${p.stats.ko}</span><span>${p.stats.down}</span><b>${p.stats.score}</b></div>`
      )
      .join('');
    const rk = rw.rankAfter;
    const up = rw.rankAfter.idx > rw.rankBefore.idx;
    const prizes = rw.prizes
      .map((pz, i) => {
        const o = OMAMORI[pz.id];
        return `<div class="bag" style="animation-delay:${0.6 + i * 0.35}s"><div class="g" style="background:radial-gradient(circle, ${ELEM[o.elem].color}cc, ${ELEM[o.elem].color})">${o.icon}</div><div>${escapeHtml(o.name)}</div><div class="${pz.isNew ? 'new' : ''}">${pz.isNew ? 'NEW!' : pz.lvUp ? 'Lv' + pz.lv + 'にアップ！' : 'Lv' + pz.lv}</div></div>`;
      })
      .join('');
    const s = this.setScreen(
      `<div class="wl ${wl[1]}">${wl[0]}</div>
       <div class="sc"><div class="dia d0"><span>${r.scores[0]}</span></div><div style="font-size:12px;color:#cfd7e8">${MODES[r.mode].name}<br>（${r.unit}）</div><div class="dia d1"><span>${r.scores[1]}</span></div></div>
       <div class="reason">${escapeHtml(r.reason || '')}</div>
       <div class="table"><div class="tr th"><span></span><span>名前</span><span>KO</span><span>ダウン</span><span>得点</span></div>${rows}</div>
       <div class="rpbox"><div class="row sb"><span>ランク <b style="color:#ffd400;font-size:18px">${rk.key}</b>${up ? ' <b style="color:#5dffa0">ランクアップ！</b>' : ''}</span><span>${rw.gain >= 0 ? '+' : ''}${rw.gain}pt（${S.rp}pt）</span></div>
       <div class="note">今週のポイント +${rw.weekPt}${rw.mvp ? '・MVPボーナス' : ''}</div>
       ${rw.prizes.length ? `<div class="note" style="margin-top:6px;color:#ffd400">お守り袋を開けた！</div><div class="prize">${prizes}</div>` : ''}</div>
       <div style="flex:1"></div>
       <div class="row" style="width:100%;max-width:420px;gap:10px"><button class="btn k home" style="flex:1">ホーム</button><button class="btn y again" style="flex:1.4">もう1回</button></div>`,
      'result scroll'
    );
    if (rw.prizes.length) setTimeout(() => sound.play('capsule'), 700);
    $('.home', s).onclick = () => {
      sound.play('ui');
      this.endMatch();
      this.showHome();
    };
    $('.again', s).onclick = () => {
      sound.play('ui');
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
});
