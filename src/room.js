// オンライン対戦の部屋：つなぐ（サーバーで手紙をやりとり）→ ロビー → 試合
//   部屋をつくった人（ホスト）の端末が試合を計算して、ほかの人に結果を送る
import { net } from './net.js';
import { Peer, rtcSupported } from './rtc.js';
import { PROTO } from './netproto.js';
import { PUNCHERS, PUNCHER_IDS, OMAMORI } from './characters.js';
import { shuffle } from './util.js';

const POLL_HOST = 1700; // ホストが手紙を見に行く間隔（ms）
const POLL_JOIN = 900; // 入る人が返事を待つ間隔
const ANSWER_WAIT = 25000; // 返事を待つ長さ
const OPEN_WAIT = 15000; // つながるのを待つ長さ
const SILENT_LIMIT = 15000; // 試合中：これより長く何も届かなければ切れたことにする
const SILENT_LOBBY = 60000; // ロビー：LINEで招待するあいだ、アプリを切りかえても切れないように長め
export const MAX_PLAYERS = 8;

export class Room {
  constructor(app) {
    this.app = app;
    this.role = null; // 'host' | 'client'
    this.code = '';
    this.myId = '';
    this.hostId = '';
    this.hk = '';
    this.ice = null;
    this.peers = new Map(); // ホスト：相手の id → Peer、入った人：ホストの id → Peer
    this.state = { mode: 'scramble', diff: 'normal', fill: true, members: [] };
    this.handlers = Object.create(null);
    this.binHandler = null;
    this.closed = false;
    this.accepting = false;
    this.inMatch = false;
    this._pollT = null;
    this._keep = setInterval(() => this.keepalive(), 1000);
    this.log = []; // つながり方の記録（不具合の報告に入れる）
  }
  note(s) {
    const t = (performance.now() / 1000).toFixed(1);
    this.log.push(t + ' ' + s);
    if (this.log.length > 40) this.log.shift();
    if (typeof window !== 'undefined' && window.__rpfNetDebug) console.log('[room] ' + s);
  }

  // ===== 共通 =====
  on(type, fn) {
    this.handlers[type] = fn;
  }
  off(type) {
    delete this.handlers[type];
  }
  emit(type, ...args) {
    const f = this.handlers[type];
    if (f) f(...args);
  }
  me() {
    return this.state.members.find((m) => m.id === this.myId) || null;
  }
  myInfo() {
    const S = this.app.save;
    const c = PUNCHERS[S.char] ? S.char : 'tora';
    const deck = (S.decks && S.decks[c]) || PUNCHERS[c].omamori;
    return { name: S.name || 'プレイヤー', char: c, deck: deck.slice(0, 4), lv: this.app.deckLevels(deck) };
  }
  keepalive() {
    const now = performance.now();
    // この端末が止まっていた（重い処理・アプリの切りかえ）→ 届いていない手紙があるかもしれないので、今回は切らない
    const gap = now - (this._tick || now);
    this._tick = now;
    if (gap > 2500) {
      for (const p of this.peers.values()) p.lastHeard = now;
      this.note('stall ' + Math.round(gap) + 'ms');
      return;
    }
    for (const p of this.peers.values()) {
      if (!p.open) continue;
      p.ping();
      if (now - p.lastHeard > (this.inMatch ? SILENT_LIMIT : SILENT_LOBBY)) {
        this.note('silent ' + p.id);
        p.close('timeout');
      }
    }
  }
  async letter(to, obj) {
    return net.call('rms', { code: this.code, to, from: this.myId, d: JSON.stringify(obj) }, { anon: true, timeout: 8000 });
  }

  // ===== ホスト =====
  async create() {
    if (!rtcSupported()) return { ok: false, err: 'rtc' };
    const info = this.myInfo();
    const r = await net.call('rmk', { n: info.name }, { anon: true });
    if (!r.ok) return r;
    this.role = 'host';
    this.code = r.code;
    this.myId = r.pid;
    this.hostId = r.pid;
    this.hk = r.hk;
    this.ice = r.ice;
    this.state.members = [{ id: this.myId, host: true, team: 0, slot: 0, ping: 0, ...info }];
    this.accepting = true;
    this.pollHost();
    return { ok: true };
  }
  async pollHost() {
    clearTimeout(this._pollT);
    if (this.closed || this.role !== 'host') return;
    if (this.accepting) {
      const r = await net.call('rmp', { code: this.code, me: this.myId }, { anon: true, timeout: 8000 });
      if (this.closed) return;
      if (r.ok && r.gone) {
        // 部屋が消えた（3時間たった など）→ 作りなおす
        this.emit('toast', '部屋の期限が切れました。作りなおしてね');
        this.emit('closed', 'gone');
        return;
      }
      if (r.ok) for (const m of r.m) this.onLetter(m.f, m.d);
    }
    this._pollT = setTimeout(() => this.pollHost(), POLL_HOST);
  }
  async onLetter(from, data) {
    let d = null;
    try {
      d = JSON.parse(data);
    } catch (e) {
      return;
    }
    if (!d || d.t !== 'offer' || typeof d.sdp !== 'string') return;
    if (this.peers.has(from)) return;
    if (this.state.members.length >= MAX_PLAYERS || this.inMatch) {
      this.letter(from, { t: 'full' });
      return;
    }
    const peer = new Peer(from, this.ice);
    this.peers.set(from, peer);
    this.note('offer from ' + from);
    peer.onmsg = (o) => this.hostMsg(peer, o);
    peer.onbin = (b) => this.binHandler && this.binHandler(from, b);
    peer.onclose = (why) => {
      this.note('peer ' + from + ' closed: ' + why);
      this.peerGone(from);
    };
    const giveUp = setTimeout(() => !peer.open && peer.close('timeout'), OPEN_WAIT + 8000);
    peer.onopen = () => {
      clearTimeout(giveUp);
      this.note('open ' + from);
    };
    try {
      const sdp = await peer.answer(d.sdp);
      const r = await this.letter(from, { t: 'answer', sdp });
      this.note('answer to ' + from + ' ' + (r.ok ? 'sent' : 'fail ' + r.err) + ' cands=' + candInfo(sdp));
    } catch (e) {
      this.note('answer error ' + (e && e.message));
      peer.close('answer-fail');
    }
  }
  hostMsg(peer, o) {
    const id = peer.id;
    if (o.t === 'hello') {
      this.note('hello from ' + id);
      if (o.proto !== PROTO) {
        peer.send({ t: 'reject', why: 'ver' });
        setTimeout(() => peer.close('ver'), 500);
        return;
      }
      if (this.state.members.length >= MAX_PLAYERS || this.inMatch) {
        peer.send({ t: 'reject', why: 'full' });
        setTimeout(() => peer.close('full'), 500);
        return;
      }
      const m = { id, host: false, ping: 0, ...cleanInfo(o) };
      const [team, slot] = this.freeSeat();
      m.team = team;
      m.slot = slot;
      this.state.members.push(m);
      peer.send({ t: 'welcome', id, code: this.code });
      this.emit('toast', m.name + ' が入った！');
      this.emit('sound', 'join');
      this.pushLobby();
      return;
    }
    if (o.t === 'char') {
      const m = this.state.members.find((x) => x.id === id);
      if (m) Object.assign(m, cleanInfo({ ...m, ...o }));
      this.pushLobby();
      return;
    }
    if (o.t === 'bye') {
      peer.close('bye');
      return;
    }
    this.emit('msg', id, o);
  }
  peerGone(id) {
    this.peers.delete(id);
    const i = this.state.members.findIndex((m) => m.id === id);
    if (i >= 0) {
      const m = this.state.members[i];
      this.state.members.splice(i, 1);
      if (!this.closed) this.emit('toast', m.name + ' が抜けた');
      this.emit('left', id, m);
      this.pushLobby();
    }
  }
  freeSeat() {
    const count = [0, 1].map((t) => this.state.members.filter((m) => m.team === t).length);
    const team = count[0] <= count[1] ? 0 : 1;
    return [team, this.firstSlot(team)];
  }
  firstSlot(team, except) {
    const used = new Set(this.state.members.filter((m) => m.team === team && m !== except).map((m) => m.slot));
    for (let s = 0; s < 4; s++) if (!used.has(s)) return s;
    return -1;
  }
  // ホスト：メンバーのチームを入れかえる
  switchTeam(id) {
    const m = this.state.members.find((x) => x.id === id);
    if (!m) return;
    const t = 1 - m.team;
    const s = this.firstSlot(t, m);
    if (s < 0) return;
    m.team = t;
    m.slot = s;
    this.pushLobby();
  }
  setOpt(k, v) {
    this.state[k] = v;
    this.pushLobby();
  }
  setMyChar() {
    const me = this.me();
    if (!me) return;
    const info = this.myInfo();
    if (this.role === 'host') {
      Object.assign(me, info);
      this.pushLobby();
    } else {
      Object.assign(me, info);
      this.send({ t: 'char', ...info });
      this.emit('lobby', this.state);
    }
  }
  pushLobby() {
    if (this.role !== 'host') return;
    for (const m of this.state.members) {
      const p = this.peers.get(m.id);
      m.ping = p ? Math.round(p.rtt) : 0;
    }
    this.broadcast({ t: 'lobby', state: this.state });
    this.emit('lobby', this.state);
  }
  broadcast(o) {
    for (const p of this.peers.values()) if (p.open) p.send(o);
  }
  broadcastBin(buf) {
    for (const p of this.peers.values()) if (p.open) p.sendBin(buf);
  }
  sendTo(id, o) {
    const p = this.peers.get(id);
    return p && p.open ? p.send(o) : false;
  }
  canStart() {
    const ms = this.state.members;
    if (!ms.length) return false;
    if (this.state.fill) return true;
    return ms.some((m) => m.team === 0) && ms.some((m) => m.team === 1);
  }
  // 試合の組み合わせを作る（人のいない席はCPU）
  buildRoster() {
    const out = [];
    for (let team = 0; team < 2; team++) {
      const humans = this.state.members.filter((m) => m.team === team).sort((a, b) => a.slot - b.slot);
      const ids = shuffle(PUNCHER_IDS.slice());
      const n = this.state.fill ? 4 : humans.length;
      for (let s = 0; s < n; s++) {
        const h = humans[s];
        if (h) out.push({ team, slot: s, char: h.char, name: h.name, human: h.id, deck: h.deck, lv: h.lv });
        else {
          const used = out.filter((x) => x.team === team).map((x) => x.char);
          const c = ids.find((x) => !used.includes(x)) || ids[s % ids.length];
          out.push({ team, slot: s, char: c, name: PUNCHERS[c].short || PUNCHERS[c].name, human: null });
        }
      }
    }
    out.forEach((r, i) => (r.idx = i));
    return out;
  }
  async lock(on) {
    this.accepting = !on;
    if (this.role !== 'host' || !this.code) return;
    net.call('rmx', { code: this.code, hk: this.hk, op: on ? 'lock' : 'open' }, { anon: true });
    if (!on) this.pollHost();
  }

  // ===== 入る人 =====
  async join(code) {
    if (!rtcSupported()) return { ok: false, err: 'rtc' };
    const r = await net.call('rmj', { code }, { anon: true });
    this.note('join ' + code + ' ' + (r.ok ? 'ok' : r.err));
    if (!r.ok) return r;
    this.role = 'client';
    this.code = code;
    this.myId = r.pid;
    this.hostId = r.host;
    this.ice = r.ice;
    const peer = new Peer(this.hostId, this.ice);
    this.peers.set(this.hostId, peer);
    let sdp;
    try {
      sdp = await peer.offer();
    } catch (e) {
      return { ok: false, err: 'rtc' };
    }
    const sent = await this.letter(this.hostId, { t: 'offer', sdp });
    this.note('offer ' + (sent.ok ? 'sent' : 'fail ' + sent.err) + ' cands=' + candInfo(sdp));
    if (!sent.ok) return sent;
    // 返事を待つ
    const t0 = performance.now();
    let answered = false;
    while (!answered && performance.now() - t0 < ANSWER_WAIT && !this.closed) {
      await sleep(POLL_JOIN);
      const p = await net.call('rmp', { code, me: this.myId }, { anon: true, timeout: 8000 });
      if (p.ok && p.gone) return { ok: false, err: 'nf' };
      if (!p.ok) continue;
      for (const m of p.m) {
        let d = null;
        try {
          d = JSON.parse(m.d);
        } catch (e) {}
        if (!d) continue;
        if (d.t === 'full') return { ok: false, err: 'full' };
        if (d.t === 'answer' && typeof d.sdp === 'string') {
          try {
            await peer.accept(d.sdp);
            answered = true;
            this.note('answer ok');
          } catch (e) {
            this.note('answer bad ' + (e && e.message));
            return { ok: false, err: 'rtc' };
          }
        }
      }
    }
    if (this.closed) return { ok: false, err: 'cancel' };
    if (!answered) return { ok: false, err: 'noanswer' };
    // つながるのを待つ
    const opened = await new Promise((resolve) => {
      if (peer.open) return resolve(true);
      const to = setTimeout(() => resolve(false), OPEN_WAIT);
      peer.onopen = () => {
        clearTimeout(to);
        resolve(true);
      };
      peer.onclose = () => {
        clearTimeout(to);
        resolve(false);
      };
    });
    if (!opened) {
      this.note('open fail state=' + peer.pc.connectionState + '/' + peer.pc.iceConnectionState);
      peer.close('open-fail');
      return { ok: false, err: 'p2p' };
    }
    this.note('open');
    // あいさつ
    const welcome = await new Promise((resolve) => {
      const to = setTimeout(() => resolve({ t: 'reject', why: 'timeout' }), 8000);
      peer.onmsg = (o) => {
        if (o.t === 'welcome' || o.t === 'reject') {
          clearTimeout(to);
          resolve(o);
        }
      };
      peer.send({ t: 'hello', proto: PROTO, ...this.myInfo() });
    });
    if (welcome.t !== 'welcome') {
      this.note('rejected ' + welcome.why);
      peer.close('reject');
      return { ok: false, err: welcome.why === 'ver' ? 'ver' : welcome.why === 'full' ? 'full' : 'p2p' };
    }
    peer.onmsg = (o) => this.clientMsg(o);
    peer.onbin = (b) => this.binHandler && this.binHandler(this.hostId, b);
    peer.onclose = (why) => {
      this.note('host link closed: ' + why);
      this.peers.delete(this.hostId);
      if (!this.closed) this.emit('closed', why === 'bye' ? 'hostleft' : 'lost');
    };
    return { ok: true };
  }
  clientMsg(o) {
    if (o.t === 'lobby') {
      this.state = o.state;
      this.emit('lobby', this.state);
      return;
    }
    if (o.t === 'bye') {
      this.emit('closed', 'hostleft');
      return;
    }
    this.emit('msg', this.hostId, o);
  }
  send(o) {
    const p = this.peers.get(this.hostId);
    return p && p.open ? p.send(o) : false;
  }
  sendBin(buf) {
    const p = this.peers.get(this.hostId);
    return p && p.open ? p.sendBin(buf) : false;
  }
  hostRtt() {
    const p = this.peers.get(this.hostId);
    return p ? p.rtt : 0;
  }

  // ===== おわり =====
  leave() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this._pollT);
    clearInterval(this._keep);
    if (this.role === 'host') {
      this.broadcast({ t: 'bye' });
      if (this.code) net.call('rmx', { code: this.code, hk: this.hk, op: 'close' }, { anon: true, keepalive: true });
    } else this.send({ t: 'bye' });
    setTimeout(() => {
      for (const p of this.peers.values()) p.close('bye');
      this.peers.clear();
    }, 150);
    this.handlers = Object.create(null);
    this.binHandler = null;
  }
}

function cleanInfo(o) {
  const c = PUNCHERS[o.char] ? o.char : 'tora';
  const name = typeof o.name === 'string' && o.name.trim() ? Array.from(o.name.trim()).slice(0, 10).join('') : 'プレイヤー';
  let deck = Array.isArray(o.deck) ? o.deck.filter((x) => typeof x === 'string' && OMAMORI[x]).slice(0, 4) : [];
  if (deck.length !== 4 || new Set(deck).size !== 4) deck = PUNCHERS[c].omamori.slice();
  const lv = Array.isArray(o.lv) ? o.lv.slice(0, 4).map((v) => Math.max(1, Math.min(10, Math.round(+v) || 1))) : [1, 1, 1, 1];
  return { name, char: c, deck, lv };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 候補の種類を数える（host／srflx／relay）
function candInfo(sdp) {
  const c = { host: 0, srflx: 0, relay: 0, prflx: 0 };
  for (const m of String(sdp).matchAll(/ typ (host|srflx|relay|prflx)/g)) c[m[1]]++;
  return 'h' + c.host + 's' + c.srflx + 'r' + c.relay;
}
