// アカウント・ランキング（サーバー：/api/rpf）
// サーバーやデータベースがまだ無いときも、ゲームはふつうに遊べる
import { store, escapeHtml, el, $, isIOS, isStandalone, copyText, pickFriendCode } from './util.js';
import { PUNCHERS } from './characters.js';
import { rankOf } from './config.js';
import { weekId, saveSave } from './save.js';

const AKEY = 'rpf_acct_v1';
const API = '/api/rpf';
// NGワード（ざっくり）
const NG = ['死ね', 'しね', '殺す', 'ころす', 'ちんこ', 'まんこ', 'うんこ', 'セックス', 'fuck', 'shit', 'bitch', 'nigger', 'admin', '運営'].map((w) => w.normalize('NFKC').toLowerCase());
const ERR_MSG = { ng: 'その名前は使えません', name: '名前は1〜10文字にしてね', rl: '回数が多すぎます。少し待ってね', full: 'フレンドがいっぱいです（100人まで）', nf: '見つかりませんでした', self: '自分のコードです', setup: 'サーバーの準備中です' };

class Net {
  constructor() {
    this.ready = null; // サーバーとデータベースが使えるか（null=まだ調べていない）
    this.acct = store.get(AKEY, null); // {uid, token, fc}
    this.noAcct = !!store.get('rpf_noacct', false); // アカウントを消した人には、自動では作らない
    this.reach = null; // 'ok' | 'setup'（サーバーの準備中）| 'offline'（届かない）
    this.app = null;
    this.busy = false;
  }
  init(app) {
    this.app = app;
    this.ping();
    this.startPresence();
    // 招待リンク（?f=フレンドコード）
    try {
      const q = new URLSearchParams(location.search);
      const f = q.get('f');
      if (f) this.pendingFriend = f.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    } catch (e) {}
  }
  badName(n) {
    const s = n.normalize('NFKC').toLowerCase().replace(/\s/g, '');
    if (!s || /[\u0000-\u001f\u007f]/.test(n)) return true;
    return NG.some((w) => s.includes(w));
  }
  errText(err) {
    return ERR_MSG[err] || '通信できませんでした';
  }
  async call(a, body = {}, opts = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.acct && !opts.anon) headers.Authorization = 'Bearer ' + this.acct.uid + '.' + this.acct.token;
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), opts.timeout || 9000) : null;
    try {
      const r = await fetch(API, { method: 'POST', headers, body: JSON.stringify({ a, ...body }), signal: ctrl ? ctrl.signal : undefined, keepalive: !!opts.keepalive });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j) {
        const err = (j && j.err) || 'http' + r.status;
        // ほかの端末に引き継がれた（合い言葉が変わった）
        if (err === 'auth' && headers.Authorization && a !== 'rank') {
          this.acct = null;
          this.saveAcct();
          this.app && this.app.toast('このデータはほかの端末に引き継がれました');
        }
        return { ok: false, err };
      }
      return j;
    } catch (e) {
      return { ok: false, err: 'net' };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  async ping() {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 7000) : null;
    try {
      const r = await fetch(API + '?a=ping', { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined });
      const j = await r.json();
      this.ready = !!(j && j.ready);
      this.reach = this.ready ? 'ok' : 'setup';
    } catch (e) {
      this.ready = false;
      this.reach = 'offline';
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (this.ready && this.app && this.app.save.name && !this.acct) this.register();
    else if (this.ready && this.acct) this.me();
    // ネットがもどったら、もう一度たしかめる
    if (this.reach === 'offline' && !this._onl && typeof window !== 'undefined') {
      this._onl = true;
      window.addEventListener('online', () => {
        this._onl = false;
        this.ping();
      }, { once: true });
    }
    return this.ready;
  }
  // サーバーにつながらない理由の説明
  whyNot() {
    if (this.reach === 'offline') return 'ネットにつながっていないか、サーバーに届きませんでした。';
    if (this.reach === 'setup') return 'サーバーはまだ準備中です。準備ができたら自動で使えるようになります。';
    return 'サーバーを確認中です。';
  }
  saveAcct() {
    if (this.acct) store.set(AKEY, this.acct);
    else store.del(AKEY);
  }
  // 名前を決めたら自動で登録（ランキングに出るため）
  async register(manual) {
    if (!this.ready || this.acct || this.busy) return;
    // 自分で消した人・この端末に保存できない人（プライベートブラウズなど）には自動で作らない
    if (!manual && (this.noAcct || !store.ok())) return;
    const S = this.app.save;
    if (!S.name) return;
    if (manual && this.noAcct) {
      this.noAcct = false;
      store.del('rpf_noacct');
    }
    this.busy = true;
    const r = await this.call('register', { name: S.name, c: S.char, save: this.packSave(S) }, { anon: true });
    this.busy = false;
    if (r.ok && r.uid) {
      this.acct = { uid: r.uid, token: r.token, fc: r.fc };
      this.saveAcct();
      if (this.pendingFriend) this.addFriend(this.pendingFriend);
    } else if (r.err === 'ng' || r.err === 'name') {
      this.app && this.app.toast('ランキング用：' + this.errText(r.err) + '（せっていで名前を変えてね）', 3500);
    }
    return r;
  }
  async me() {
    const r = await this.call('me');
    if (r.ok) {
      if (r.fc) this.acct.fc = r.fc;
      this.saveAcct();
      if (this.pendingFriend) this.addFriend(this.pendingFriend);
    }
    // 引き継がれた（auth）ときのお知らせは call() で出している
  }
  packSave(S) {
    let j = JSON.stringify(S);
    if (j.length > 18000) j = JSON.stringify({ ...S, charStats: {} });
    return j.length > 18000 ? '' : j;
  }
  async rename(name) {
    if (!this.ready) return;
    if (!this.acct) return this.register();
    const r = await this.call('rename', { name });
    if (!r.ok && r.err !== 'auth') this.app && this.app.toast('ランキングの名前：' + this.errText(r.err), 3000);
    return r;
  }
  async sync(S, r) {
    if (!this.ready) return;
    if (!this.acct) await this.register();
    if (!this.acct) return;
    // 試合が終わった週の点を送る（月曜0時をまたいでも消えない）
    await this.call('sync', { rp: S.rp, wk: S.week.id || weekId(), wpt: S.week.pt || 0, c: S.char, plays: S.plays, save: this.packSave(S) });
  }
  async ranking(tab) {
    if (this.ready === null) await this.ping();
    if (!this.ready) return null;
    const r = await this.call('rank', { t: tab, wk: weekId() });
    if (!r.ok) return null;
    return r;
  }
  // フレンドの名前とキャラ（CPUの名前に使う）
  async friends() {
    if (!this.ready || !this.acct) return [];
    if (this.friendsCache && Date.now() - this.friendsCache.t < 120000) return this.friendsCache.list;
    const r = await this.call('rank', { t: 'f', wk: weekId() });
    const list = r && r.ok ? r.list.filter((x) => !x.me).map((x) => ({ n: x.n, c: x.c, u: x.u })) : [];
    this.friendsCache = { t: Date.now(), list };
    return list;
  }
  async removeFriend(uid) {
    const r = await this.call('fdel', { uid });
    this.friendsCache = null;
    return r;
  }
  async issueCode() {
    const r = await this.call('code');
    return r.ok ? r.code : null;
  }
  async restore(code) {
    const r = await this.call('restore', { code: code.toUpperCase().replace(/[^A-Z0-9]/g, '') }, { anon: true });
    if (!r.ok) return r;
    const old = this.acct;
    this.acct = { uid: r.uid, token: r.token, fc: r.fc };
    this.saveAcct();
    this.noAcct = false;
    store.del('rpf_noacct');
    // 新しいスマホで名前を入れたときに自動でできたアカウント（ほとんど遊んでいない）は消しておく
    if (old && old.uid !== r.uid && this.app && (this.app.save.plays || 0) < 3) {
      const keep = this.acct;
      this.acct = old;
      await this.call('del').catch(() => {});
      this.acct = keep;
      this.saveAcct();
    }
    this.friendsCache = null;
    return r;
  }
  async addFriend(code) {
    this.pendingFriend = null;
    try {
      const u = new URL(location.href);
      u.searchParams.delete('f');
      history.replaceState(history.state, '', u.toString());
    } catch (e) {}
    if (!this.acct) return;
    const r = await this.call('fadd', { fc: String(code).toUpperCase().replace(/[^A-Z0-9]/g, '') });
    if (r.ok && this.app) {
      this.app.toast((r.name ? r.name + ' さんと' : '') + 'フレンドになりました！');
      this.friendsCache = null;
    } else if (r.err === 'nf') this.app && this.app.toast('フレンドコードが見つかりません');
    else if (r.err !== 'auth') this.app && this.app.toast(this.errText(r.err));
    return r;
  }
  // ===== v1.8：フレンドのオンライン表示と、部屋への招待 =====
  // アプリを開いているあいだ、ときどき「いるよ」を送る（メニュー・部屋＝12秒ごと、試合中＝45秒ごと、画面を閉じているあいだは送らない）
  // 返事に、自分あての招待と（ほしいときは）オンラインのフレンドがのってくる
  startPresence() {
    if (this._pres) return;
    this._pres = { t: null, n: 0, busy: false };
    if (typeof document !== 'undefined')
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) this.pokePresence();
      });
    this.schedulePresence(1500);
  }
  schedulePresence(ms) {
    const P = this._pres;
    if (!P) return;
    clearTimeout(P.t);
    P.t = setTimeout(() => this.presenceTick(), ms);
  }
  // すぐに1回送る（フレンドの一覧を開いたときなど）
  pokePresence() {
    this.schedulePresence(60);
  }
  // しばらく送っていなければ送る（試合が終わってホームにもどったときなど。試合中は45秒ごとだったので）
  pokeIfStale() {
    const P = this._pres;
    if (P && Date.now() - (P.last || 0) > 13000) this.pokePresence();
  }
  async presenceTick() {
    const P = this._pres;
    if (!P) return;
    if (P.busy) return this.schedulePresence(1000);
    const hidden = typeof document !== 'undefined' && document.hidden;
    if (!this.ready || !this.acct || hidden) return this.schedulePresence(hidden ? 20000 : 8000);
    const app = this.app;
    const st = app && app.presenceState ? app.presenceState() : 'menu';
    P.n++;
    const wantF = !!(app && app.wantFriends && app.wantFriends(P.n));
    P.busy = true;
    P.last = Date.now();
    const r = await this.call('hb', { s: st, f: wantF ? 1 : 0 }, { timeout: 7000 });
    P.busy = false;
    if (r && r.ok) {
      if (Array.isArray(r.fr)) {
        this.fon = new Map(r.fr.filter((x) => x && typeof x.u === 'string').map((x) => [x.u, x.s]));
        this.fonT = Date.now();
        if (app && app.onPresence) app.onPresence();
      }
      if (Array.isArray(r.inv) && r.inv.length && app && app.onInvites) app.onInvites(r.inv);
    }
    if (app && app.showNextInvite) app.showNextInvite();
    this.schedulePresence(st === 'match' ? 45000 : 12000);
  }
  // フレンドのいまのようす：'menu'（オンライン）・'room'（部屋にいる）・'match'（対戦中）・null（オフライン）
  friendState(uid) {
    if (!this.fon || !this.fonT || Date.now() - this.fonT > 90000) return null;
    return this.fon.get(uid) || null;
  }
  onlineFriends() {
    if (!this.fon || !this.fonT || Date.now() - this.fonT > 90000) return 0;
    return this.fon.size;
  }
  // 部屋に招待する
  async inviteFriend(uid, code) {
    if (!this.acct) return { ok: false, err: 'auth' };
    return this.call('inv', { to: uid, r: code });
  }
  async report(text, info) {
    return this.call('report', { text, info }, { anon: !this.acct });
  }
  async deleteAccount() {
    const r = await this.call('del');
    if (r.ok) {
      this.acct = null;
      this.saveAcct();
      this.noAcct = true;
      store.set('rpf_noacct', true);
      this.friendsCache = null;
    }
    return r;
  }

  // せってい画面のアカウント欄
  renderAccount(box) {
    const A = this.acct;
    if (this.ready === false || this.ready === null) {
      box.innerHTML = `<h3>アカウント</h3><p class="note">${this.ready === null ? 'サーバーを確認中…' : this.whyNot() + '<br>いまは、この端末にだけ記録が保存されます。'}</p>${this.ready === false ? '<button class="btn small k retry">もう一度ためす</button>' : ''}`;
      if (this.ready === null) setTimeout(() => this.app && box.isConnected && this.renderAccount(box), 1500);
      const rt = box.querySelector('.retry');
      if (rt)
        rt.onclick = async () => {
          this.ready = null;
          this.renderAccount(box);
          await this.ping();
          if (box.isConnected) this.renderAccount(box);
        };
      return;
    }
    const inst = isIOS && !isStandalone() ? '<p class="note">※iPhoneでは、Safari とホーム画面に追加したアプリで保存場所が別になります。アプリで遊ぶ人は、アプリの中で引き継ぎコードを使ってください。</p>' : '';
    box.innerHTML = `<h3>アカウント</h3>
      ${A ? this.codeBarHtml() : this.noAcct ? '<p class="note">アカウントは消しました。ランキングやフレンドを使うときは「アカウントを作る」を押してね。</p>' : !store.ok() ? '<p class="note">この端末（ブラウザ）は記録を保存できない設定です（プライベートブラウズなど）。アプリを閉じると記録が消えます。</p>' : '<p class="note">名前を決めると自動でアカウントができます。</p>'}
      <div class="row" style="flex-wrap:wrap;gap:8px;margin-top:6px">
        ${A ? '<button class="btn small y invite">フレンドを招待</button><button class="btn small k addf">コードで追加</button><button class="btn small k code">機種変更（引き継ぎコード）</button>' : '<button class="btn small y reg">アカウントを作る</button>'}
        <button class="btn small k restore">引き継ぎコードで戻す</button>
        ${A ? '<button class="btn small red del">アカウントを消す</button>' : ''}
      </div>${inst}`;
    const q = (s) => box.querySelector(s);
    if (q('.reg')) q('.reg').onclick = async () => {
      const r = await this.register(true);
      if (r && !r.ok) this.app.toast(this.errText(r.err));
      this.renderAccount(box);
    };
    if (q('.invite')) q('.invite').onclick = () => this.shareFriendLink();
    if (q('.addf')) q('.addf').onclick = () => this.addFriendModal();
    this.bindCodeBar(box);
    if (q('.code')) q('.code').onclick = async () => {
      const ok = await this.app.confirm('引き継ぎコード', '新しいスマホで「引き継ぎコードで戻す」に入れると、記録をそのまま持っていけます。<br>コードは1回だけ使えます。戻すと、この端末はログアウトします。', 'コードを出す');
      if (!ok) return;
      const c = await this.issueCode();
      if (!c) {
        this.app.toast('コードを出せませんでした');
        return;
      }
      this.app.confirm('引き継ぎコード', `<div style="font-size:24px;text-align:center;letter-spacing:2px;color:#ffd400;margin:10px 0;user-select:text;-webkit-user-select:text">${escapeHtml(c)}</div>メモかスクショをしておいてね。出し直すと前のコードは使えなくなります。`, 'とじる', 'コピー').then((close) => {
        if (!close) {
          try {
            navigator.clipboard.writeText(c);
            this.app.toast('コピーしました');
          } catch (e) {}
        }
      });
    };
    q('.restore').onclick = () =>
      this.prompt('引き継ぎコード（12文字）', 14, async (v) => {
        const r = await this.restore(v);
        if (!r.ok) {
          this.app.toast(r.err === 'rl' ? '回数が多すぎます。少し待ってね' : 'コードがちがうか、もう使われています');
          return;
        }
        // 記録を戻す（大きいほう）
        if (r.save) {
          try {
            const remote = JSON.parse(r.save);
            const S = this.app.save;
            const merged = { ...S, ...remote };
            merged.rp = Math.max(S.rp || 0, remote.rp || 0);
            merged.plays = Math.max(S.plays || 0, remote.plays || 0);
            merged.om = { ...(S.om || {}), ...(remote.om || {}) };
            // v1.7：前の版の記録の「つよい」は、同じ強さの「鬼」に（loadSave と同じ読みかえ）
            if (!remote.diffV && remote.diff === 'hard') merged.diff = 'oni';
            merged.diffV = 2;
            Object.assign(S, merged);
            saveSave(S);
          } catch (e) {}
        }
        this.app.toast('記録を戻しました！');
        this.renderAccount(box);
      });
    if (q('.del')) q('.del').onclick = async () => {
      const ok = await this.app.confirm('アカウントを消す', 'ランキング・フレンド・預けた記録がサーバーから消えます。この端末の記録は残ります。', '消す');
      if (!ok) return;
      const r = await this.deleteAccount();
      this.app.toast(r.ok ? '消しました' : '消せませんでした');
      this.renderAccount(box);
    };
  }
  // フレンドになるリンクを送る（LINEなど）。リンクにもコードを書いておく
  shareFriendLink() {
    const A = this.acct;
    if (!A || !A.fc) return;
    const url = location.origin + '/?f=' + A.fc + '&openExternalBrowser=1';
    const msg = '浪人パンチフライトでフレンドになろう！フレンドコード ' + A.fc;
    if (navigator.share) navigator.share({ title: '浪人パンチフライト', text: msg, url }).catch(() => {});
    else window.open('https://line.me/R/share?text=' + encodeURIComponent(msg + ' ' + url), '_blank');
  }
  // v1.8：自分のフレンドコード（タップかボタンでコピー）
  codeBarHtml() {
    const fc = (this.acct && this.acct.fc) || '';
    return `<div class="fcbar"><button class="fcv" aria-label="フレンドコードをコピー"><small>あなたのフレンドコード</small><b>${escapeHtml(fc || '--------')}</b></button><button class="btn small y fccopy"${fc ? '' : ' disabled'}>コピー</button></div>`;
  }
  bindCodeBar(box) {
    const fc = (this.acct && this.acct.fc) || '';
    const copy = async () => {
      if (!fc) return;
      const ok = await copyText(fc);
      if (!this.app) return;
      if (ok) {
        this.app.toast('フレンドコード ' + escapeHtml(fc) + ' をコピーしました<br>LINEなどに貼りつけて、友だちに送ってね', 3200);
        const b = box.querySelector('.fccopy');
        if (b) {
          b.textContent = 'コピーした！';
          clearTimeout(b._t);
          b._t = setTimeout(() => b.isConnected && (b.textContent = 'コピー'), 1800);
        }
      } else this.app.toast('コピーできませんでした。コード ' + escapeHtml(fc) + ' を伝えてね', 3200);
    };
    box.querySelectorAll('.fcv, .fccopy').forEach((b) => (b.onclick = copy));
  }
  // v1.8：友だちのフレンドコードで追加する（LINEでもらった文やリンクをそのまま貼りつけてもOK）
  addFriendModal(done) {
    if (!this.acct) {
      this.app && this.app.toast('フレンドを使うにはアカウントが必要です（せってい→アカウント）', 3000);
      return;
    }
    const canPaste = typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.readText === 'function';
    const m = el(
      'div',
      'modal fcadd',
      `<div class="box"><h3>フレンドを追加</h3><p class="note">友だちのフレンドコード（8文字）を入れてね。LINEでもらった文やリンクを、そのまま貼りつけてもOK。</p>
        <div class="field"><input class="fcin" maxlength="400" autocapitalize="characters" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="例：ABCD2345"></div>
        <div class="fcprev"></div>
        <div class="btns"><button class="btn y ok" disabled>追加する</button>${canPaste ? '<button class="btn k paste">コピーしたコードを貼りつけ</button>' : ''}<button class="btn k no">やめる</button></div></div>`
    );
    this.app.root.appendChild(m);
    const inp = m.querySelector('.fcin'), prev = m.querySelector('.fcprev'), ok = m.querySelector('.ok');
    const update = () => {
      const c = pickFriendCode(inp.value);
      ok.disabled = !c;
      prev.innerHTML = c ? `コード <b>${escapeHtml(c)}</b> の人を追加します` : inp.value.trim() ? '<span class="bad">8文字のコードが見つかりません（I・O・0・1 は使われていません）</span>' : '';
      return c;
    };
    inp.oninput = update;
    setTimeout(() => inp.focus(), 50);
    if (m.querySelector('.paste'))
      m.querySelector('.paste').onclick = async () => {
        try {
          const t = await navigator.clipboard.readText();
          inp.value = t.slice(0, 400);
          if (!update()) this.app.toast('コピーした文の中に、フレンドコードが見つかりませんでした', 2600);
        } catch (e) {
          this.app.toast('入れる欄を長押しして「ペースト」してね', 2600);
          inp.focus();
        }
      };
    const submit = async () => {
      const c = update();
      if (!c) return;
      ok.disabled = true;
      const r = await this.addFriend(c);
      if (r && r.ok) {
        m.remove();
        if (done) done(r);
      } else ok.disabled = false;
    };
    ok.onclick = submit;
    inp.onkeydown = (e) => e.key === 'Enter' && submit();
    m.querySelector('.no').onclick = () => m.remove();
  }
  prompt(title, max, cb) {
    const m = el('div', 'modal', `<div class="box"><h3>${title}</h3><div class="field"><input maxlength="${max}" autocapitalize="characters" autocomplete="off"></div><div class="btns"><button class="btn y ok">OK</button><button class="btn k no">やめる</button></div></div>`);
    this.app.root.appendChild(m);
    const inp = m.querySelector('input');
    setTimeout(() => inp.focus(), 50);
    m.querySelector('.ok').onclick = () => {
      const v = inp.value.trim();
      m.remove();
      if (v) cb(v);
    };
    m.querySelector('.no').onclick = () => m.remove();
  }
}

export const net = new Net();
