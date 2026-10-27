// 音：効果音はその場で合成。BGMは鉄人さんが Suno で作った曲（bgm_private/。なければコードで作った曲＝tools/music/bgm.py）
import { store } from './util.js';

const BGM_LEVEL = 0.72; // 曲の大きさ（設定の「BGM」にかける）

class Sound {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.sfxGain = null;
    this.bgmGain = null;
    const s = store.get('rpf_sound', { sfx: 0.8, bgm: 0.55 });
    this.vol = s;
    this.cur = null; // いま鳴っている曲
    this.wantKind = null;
    this.unlocked = false;
    this.noiseBuf = null;
    this.last = {};
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) this.suspend();
      else this.resume();
    });
    window.addEventListener('pagehide', () => this.suspend());
  }
  unlock() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 1;
        this.master.connect(this.ctx.destination);
        this.sfxGain = this.ctx.createGain();
        this.sfxGain.gain.value = this.vol.sfx;
        this.sfxGain.connect(this.master);
        this.bgmGain = this.ctx.createGain();
        this.bgmGain.gain.value = this.vol.bgm * BGM_LEVEL;
        this.bgmGain.connect(this.master);
        const len = this.ctx.sampleRate * 1;
        this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state !== 'running') this.ctx.resume();
      if (this.wantKind && !this.cur) {
        const k = this.wantKind;
        this.wantKind = null;
        this.playBgm(k);
      }
      // iPhone：無音を1回鳴らして音を出せる状態にする
      if (!this.unlocked) {
        const b = this.ctx.createBuffer(1, 1, 22050);
        const s = this.ctx.createBufferSource();
        s.buffer = b;
        s.connect(this.ctx.destination);
        s.start(0);
        this.unlocked = true;
      }
    } catch (e) {}
  }
  suspend() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    // いきなり止めると「ブツッ」と鳴るので、すっと消してから止める
    try {
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setValueAtTime(this.master.gain.value, t);
      this.master.gain.linearRampToValueAtTime(0, t + 0.012);
      setTimeout(() => this.ctx && this.ctx.suspend(), 30);
    } catch (e) {}
  }
  resume() {
    if (!this.ctx) return;
    try {
      this.ctx.resume().then(() => {
        const t = this.ctx.currentTime;
        this.master.gain.cancelScheduledValues(t);
        this.master.gain.setValueAtTime(0, t);
        this.master.gain.linearRampToValueAtTime(1, t + 0.15);
      });
    } catch (e) {}
  }
  setVolume(kind, v) {
    this.vol[kind] = v;
    store.set('rpf_sound', this.vol);
    if (!this.ctx) return;
    if (kind === 'sfx') this.sfxGain.gain.value = v;
    else {
      this.bgmGain.gain.value = v * BGM_LEVEL;
      // 0にしたら曲を止めて、展開した曲も手放す。上げたら、いまの画面の曲をはじめる
      if (v <= 0.001) {
        this.fadeBgm(0.2);
        this.dec = null;
      } else if (!this.cur && this.wantKind) this.playBgm(this.wantKind);
    }
  }

  // ===== 部品 =====
  tone(freq, dur, type = 'square', vol = 0.2, slide = 0, at = 0, dest) {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime + at;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(dest || this.sfxGain);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
  noise(dur, vol = 0.2, f0 = 2000, f1 = 400, q = 1, at = 0, type = 'bandpass', dest) {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime + at;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f);
    f.connect(g);
    g.connect(dest || this.sfxGain);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.05);
  }

  // ===== 効果音 =====
  play(name, vol = 1) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    // 同じ音が重なりすぎないように
    const gap = { pickup: 0.03, hit: 0.035, swing: 0.05, deposit: 0.05 }[name] || 0.015;
    if (this.last[name] && now - this.last[name] < gap) return;
    this.last[name] = now;
    const v = vol;
    switch (name) {
      case 'ui':
        this.tone(880, 0.06, 'square', 0.12 * v);
        this.tone(1320, 0.07, 'square', 0.09 * v, 0, 0.04);
        break;
      case 'uiBack':
        this.tone(660, 0.07, 'square', 0.1 * v);
        this.tone(440, 0.08, 'square', 0.08 * v, 0, 0.04);
        break;
      case 'dash':
        this.noise(0.32, 0.34 * v, 600, 3800, 0.8);
        this.tone(220, 0.25, 'sawtooth', 0.06 * v, 2.2);
        break;
      case 'step':
      case 'roll':
        this.noise(0.18, 0.22 * v, 1200, 4200, 1.2);
        break;
      case 'brake':
        this.noise(0.2, 0.2 * v, 3000, 500, 1.5);
        break;
      case 'uturn':
        this.noise(0.25, 0.22 * v, 800, 3000, 1);
        this.tone(500, 0.18, 'triangle', 0.08 * v, 1.6);
        break;
      case 'wallkick':
        this.tone(160, 0.12, 'square', 0.18 * v, 0.5);
        this.noise(0.15, 0.25 * v, 2500, 800, 1);
        break;
      case 'land':
        this.noise(0.08, 0.12 * v, 900, 300, 1);
        break;
      case 'swing':
        this.noise(0.09, 0.12 * v, 1800, 3500, 2);
        break;
      case 'swingHeavy':
        this.noise(0.16, 0.18 * v, 900, 2800, 1.5);
        break;
      case 'hit':
        this.tone(140, 0.09, 'square', 0.22 * v, 0.55);
        this.noise(0.07, 0.28 * v, 3500, 1200, 1.2);
        break;
      case 'hitHeavy':
        this.tone(110, 0.2, 'square', 0.3 * v, 0.4);
        this.noise(0.18, 0.38 * v, 2800, 300, 0.9);
        break;
      case 'hitGuardian':
        this.tone(90, 0.16, 'triangle', 0.25 * v, 0.6);
        this.noise(0.1, 0.2 * v, 1800, 600, 2);
        break;
      case 'shot':
        this.tone(900, 0.08, 'square', 0.07 * v, 0.5);
        break;
      case 'pickup':
        this.tone(1568, 0.07, 'square', 0.08 * v);
        this.tone(2093, 0.09, 'square', 0.07 * v, 0, 0.045);
        break;
      case 'deposit':
        this.tone(1046, 0.06, 'triangle', 0.12 * v, 1.5);
        break;
      case 'ko':
        this.tone(440, 0.4, 'sawtooth', 0.14 * v, 0.25);
        this.noise(0.4, 0.3 * v, 2000, 100, 0.8);
        break;
      case 'koEnemy':
        [784, 988, 1175, 1568].forEach((f, i) => this.tone(f, 0.12, 'square', 0.1 * v, 0, i * 0.05));
        break;
      case 'respawn':
        this.tone(523, 0.12, 'triangle', 0.12 * v, 2);
        break;
      case 'lock':
        this.tone(1200, 0.05, 'square', 0.08 * v);
        this.tone(1800, 0.06, 'square', 0.06 * v, 0, 0.05);
        break;
      case 'unlock':
        // v1.8：ロックオンが外れた（下がる音）
        this.tone(1500, 0.05, 'square', 0.06 * v);
        this.tone(900, 0.07, 'square', 0.05 * v, 0, 0.05);
        break;
      case 'charge':
        this.tone(330, 0.5, 'sine', 0.1 * v, 2.5);
        break;
      case 'missile':
        this.noise(0.35, 0.22 * v, 500, 2500, 1.5);
        this.tone(300, 0.3, 'sawtooth', 0.06 * v, 0.6);
        break;
      case 'boomerang':
        this.noise(0.3, 0.18 * v, 2000, 900, 6);
        break;
      case 'boom':
        this.tone(80, 0.4, 'sine', 0.4 * v, 0.4);
        this.noise(0.45, 0.4 * v, 1600, 120, 0.7, 0, 'lowpass');
        break;
      case 'heal':
        [659, 784, 1046].forEach((f, i) => this.tone(f, 0.18, 'triangle', 0.1 * v, 0, i * 0.07));
        break;
      case 'buff':
        [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.12, 'square', 0.07 * v, 0, i * 0.04));
        break;
      case 'trap':
        this.tone(200, 0.15, 'square', 0.12 * v, 0.8);
        break;
      case 'warp':
        this.tone(400, 0.3, 'sine', 0.15 * v, 4);
        this.noise(0.3, 0.15 * v, 4000, 800, 3);
        break;
      case 'elem':
        this.tone(700, 0.15, 'triangle', 0.1 * v, 1.5);
        break;
      case 'just':
        this.tone(1760, 0.25, 'sine', 0.16 * v, 0.5);
        this.noise(0.3, 0.2 * v, 6000, 2000, 2);
        break;
      case 'spReady':
        [784, 988, 1318].forEach((f, i) => this.tone(f, 0.16, 'square', 0.08 * v, 0, i * 0.06));
        break;
      case 'special':
        this.noise(0.8, 0.3 * v, 300, 5000, 1);
        [392, 523, 659, 784].forEach((f, i) => this.tone(f, 0.25, 'sawtooth', 0.08 * v, 0, i * 0.08));
        break;
      case 'ksTora':
        this.noise(0.5, 0.3 * v, 500, 2500, 1);
        this.tone(160, 0.3, 'square', 0.14 * v, 1.6);
        break;
      case 'ksEven':
        this.noise(0.45, 0.28 * v, 4000, 600, 2);
        this.tone(600, 0.3, 'sine', 0.1 * v, 2);
        break;
      case 'flash':
      case 'ksAomachi':
        this.tone(2400, 0.06, 'square', 0.12 * v);
        this.noise(0.25, 0.35 * v, 8000, 3000, 0.5, 0.02, 'highpass');
        break;
      case 'guardianShot':
        this.tone(520, 0.2, 'sawtooth', 0.08 * v, 0.4);
        break;
      case 'guardianDown':
        this.tone(220, 0.6, 'square', 0.2 * v, 0.3);
        this.noise(0.6, 0.35 * v, 2000, 100, 0.7);
        break;
      case 'goal':
        [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, 0.16, 'square', 0.1 * v, 0, i * 0.06));
        break;
      case 'flag':
        this.tone(880, 0.1, 'square', 0.1 * v);
        this.tone(1175, 0.14, 'square', 0.1 * v, 0, 0.08);
        break;
      case 'rapid':
        [1046, 1318, 1568, 2093, 1568, 2093].forEach((f, i) => this.tone(f, 0.1, 'square', 0.07 * v, 0, i * 0.06));
        break;
      case 'alert':
        this.tone(988, 0.1, 'square', 0.09 * v);
        this.tone(988, 0.1, 'square', 0.09 * v, 0, 0.16);
        break;
      case 'count':
        this.tone(660, 0.15, 'square', 0.14 * v);
        break;
      case 'go':
        this.tone(1320, 0.4, 'square', 0.16 * v);
        this.tone(990, 0.4, 'square', 0.1 * v);
        break;
      case 'whistle':
        this.tone(2200, 0.5, 'sine', 0.18 * v, 1.02);
        break;
      case 'win':
        [523, 659, 784, 1046, 784, 1046, 1318].forEach((f, i) => this.tone(f, 0.18, 'square', 0.1 * v, 0, i * 0.11));
        break;
      case 'lose':
        [659, 587, 523, 392].forEach((f, i) => this.tone(f, 0.28, 'triangle', 0.12 * v, 0, i * 0.18));
        break;
      case 'summon':
        // ディスクのモンスターが出る（光の門がひらく音）
        this.tone(520, 0.28, 'sine', 0.12 * v, 3.2);
        this.tone(1568, 0.16, 'triangle', 0.07 * v, 0, 0.06);
        this.tone(2093, 0.22, 'triangle', 0.05 * v, 0, 0.11);
        this.noise(0.3, 0.12 * v, 1200, 7000, 2.5);
        break;
      case 'summonSR':
        this.tone(180, 0.45, 'sawtooth', 0.06 * v, 3.5);
        this.tone(520, 0.3, 'sine', 0.12 * v, 3.2);
        [1318, 1568, 2093, 2637].forEach((f, i) => this.tone(f, 0.2, 'triangle', 0.055 * v, 0, 0.06 + i * 0.05));
        this.noise(0.45, 0.16 * v, 600, 8000, 1.8);
        break;
      case 'shatter':
        // モンスターが割れる
        this.noise(0.22, 0.3 * v, 7000, 2500, 3, 0, 'bandpass');
        [3520, 4186, 4699, 5274].forEach((f, i) => this.tone(f, 0.09, 'triangle', 0.05 * v, 0.9, i * 0.025));
        this.tone(220, 0.18, 'square', 0.07 * v, 0.5);
        break;
      // ===== v1.5 の仲間の技 =====
      case 'voice':
        // エブンの歌声：ゆれる3つの音
        this.tone(523, 0.32, 'triangle', 0.1 * v, 1.12);
        this.tone(784, 0.28, 'sine', 0.07 * v, 0.95, 0.05);
        this.tone(659, 0.3, 'sawtooth', 0.03 * v, 1.05, 0.02);
        break;
      case 'drum':
        // ドン・タン・ドン
        this.tone(120, 0.14, 'sine', 0.32 * v, 0.4);
        this.noise(0.12, 0.26 * v, 2200, 900, 0.9, 0.06);
        this.tone(100, 0.12, 'sine', 0.26 * v, 0.45, 0.12);
        break;
      case 'gulp':
        // ゴクゴク
        [0, 0.13, 0.26].forEach((at) => this.tone(260, 0.1, 'sine', 0.14 * v, 0.5, at));
        break;
      case 'fire':
        this.noise(0.5, 0.26 * v, 400, 1800, 0.7, 0, 'lowpass');
        this.noise(0.4, 0.12 * v, 2500, 900, 1.2, 0.05);
        break;
      case 'call':
        // プルルル
        [0, 0.1, 0.2, 0.3].forEach((at, i) => this.tone(i % 2 ? 1175 : 932, 0.08, 'square', 0.06 * v, 0, at));
        break;
      case 'vomit':
        this.noise(0.6, 0.3 * v, 900, 200, 0.8, 0, 'lowpass');
        this.tone(180, 0.5, 'sawtooth', 0.07 * v, 0.5);
        break;
      case 'capsule':
        [392, 523, 659, 784, 1046, 1318, 1568].forEach((f, i) => this.tone(f, 0.12, 'square', 0.08 * v, 0, i * 0.05));
        break;
    }
  }

  // ===== BGM（曲のファイルを、つなぎ目なしでループ）=====
  // 曲は tools/music/bgm.py でコードから作ったもの（ロビー＝118BPM・32小節、バトル＝150BPM・32小節）
  // ファイルは [おわりの0.5秒][ループ][はじめの0.5秒] になっていて、まん中をくり返す
  // メモリ：圧縮したままのファイル（1曲 1MB ほど）は持っておき、展開（1曲 20MB ほど）は鳴らす曲だけにする
  rawBgm(name, ext) {
    if (!this.raw) this.raw = {};
    const key = name + '.' + ext;
    if (!this.raw[key])
      this.raw[key] = fetch('bgm_' + key + '?m=' + MVER)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('bgm ' + r.status))))
        .catch((e) => {
          delete this.raw[key];
          throw e;
        });
    return this.raw[key];
  }
  loadBgm(name) {
    if (!this.ctx || !BGM[name]) return Promise.resolve(null);
    if (this.dec && this.dec.name === name) return this.dec.p;
    // 読めなかったばかりの曲は、少し待ってからためす（5秒→10秒→…最大2分）
    if (!this.bgmFail) this.bgmFail = {};
    const f = this.bgmFail[name];
    if (f && Date.now() < f.until) return Promise.resolve(null);
    // AAC（m4a）が使えるブラウザは m4a、だめなら MP3（展開できなかったときも、もう一方をためす）
    const first = canAAC() ? 'm4a' : 'mp3';
    const second = first === 'm4a' ? 'mp3' : 'm4a';
    const dec = (ab) => new Promise((res, rej) => this.ctx.decodeAudioData(ab.slice(0), res, rej)); // 元のデータは取っておく
    const p = this.rawBgm(name, first)
      .then(dec)
      .catch(() => {
        if (this.raw) delete this.raw[name + '.' + first];
        return this.rawBgm(name, second).then(dec);
      })
      .then(
        (buf) => {
          delete this.bgmFail[name];
          return buf;
        },
        () => {
          const n = (this.bgmFail[name] ? this.bgmFail[name].n : 0) + 1;
          this.bgmFail[name] = { n, until: Date.now() + Math.min(120000, 5000 * 2 ** (n - 1)) };
          if (this.dec && this.dec.p === p) this.dec = null;
          return null;
        }
      );
    // 展開した曲は1つだけ持つ（前の曲は、鳴りおわったら消える）
    this.dec = { name, p };
    return p;
  }
  playBgm(kind) {
    const name = BGM_OF[kind];
    this.wantKind = kind;
    if (!name) return this.stopBgm();
    if (!this.ctx) return; // 音が出せるようになったら（unlock）はじめる
    if (this.cur && this.cur.name === name) return;
    // BGMの音量が0：読みこまない（音量を上げたら、そのときはじめる）
    if (this.vol.bgm <= 0.001) return this.fadeBgm(0.3);
    const token = (this.bgmToken = (this.bgmToken || 0) + 1);
    this.loadBgm(name).then((buf) => {
      if (!buf || token !== this.bgmToken || BGM_OF[this.wantKind] !== name || this.vol.bgm <= 0.001) return;
      if (this.cur && this.cur.name === name) return;
      this.startBgmBuf(name, buf);
      // もう1曲は、圧縮のまま先に取っておく（展開は使うときに）
      const other = name === 'lobby' ? 'battle' : 'lobby';
      this.rawBgm(other, canAAC() ? 'm4a' : 'mp3').catch(() => {});
    });
  }
  startBgmBuf(name, buf) {
    const c = this.ctx;
    const t = c.currentTime + 0.03;
    this.fadeBgm(0.6);
    const L = BGM[name];
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.loopStart = L.start;
    src.loopEnd = Math.min(L.end, buf.duration - 0.01);
    const g = c.createGain();
    // 1小節目の頭がちゃんと聞こえるように、頭の少し前から鳴らして、頭までに音量を上げきる（ブツッと鳴らないように）
    // v1.8：Suno の曲は、曲のはじめ（play）から鳴らして、ループの終わりまで来たらループのはじめへもどる
    const pre = L.play != null ? 0.06 : Math.min(0.12, L.start);
    const at = L.play != null ? L.play : L.start - pre;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1, t + pre * 0.85);
    src.connect(g);
    g.connect(this.bgmGain);
    src.start(t, at);
    this.cur = { name, src, g };
  }
  fadeBgm(sec) {
    const cur = this.cur;
    if (!cur || !this.ctx) return;
    this.cur = null;
    const t = this.ctx.currentTime;
    try {
      cur.g.gain.cancelScheduledValues(t);
      cur.g.gain.setValueAtTime(Math.max(0.0001, cur.g.gain.value), t);
      cur.g.gain.exponentialRampToValueAtTime(0.0001, t + sec);
      cur.src.stop(t + sec + 0.05);
    } catch (e) {}
  }
  stopBgm() {
    this.wantKind = null;
    this.bgmToken = (this.bgmToken || 0) + 1;
    this.fadeBgm(0.4);
  }
}

// 曲のファイルとループの位置（秒）。小節数×拍子から計算（bgm.py と同じ）
const MVER = typeof __MVER__ !== 'undefined' ? __MVER__ : '0';
const loopOf = (bpm, bars) => ({ start: 0.5, end: 0.5 + Math.floor(((bars * 4 * 60) / bpm) * 44100) / 44100 });
// v1.8：Suno の曲（bgm_private/）でビルドしたときは、そのループの位置（play＝鳴らしはじめる位置。曲のはじめから）
const BGM_SUNO = typeof __BGM_LOOPS__ !== 'undefined' ? __BGM_LOOPS__ : null;
const BGM = BGM_SUNO || {
  lobby: loopOf(118, 32),
  battle: loopOf(150, 32),
};
let _aac = null;
function canAAC() {
  if (_aac == null) {
    try {
      _aac = !!document.createElement('audio').canPlayType('audio/mp4; codecs="mp4a.40.2"');
    } catch (e) {
      _aac = false;
    }
  }
  return _aac;
}
// 画面ごとの曲（試合の残り30秒も、同じ曲のまま）
const BGM_OF = { menu: 'lobby', result: 'lobby', battle: 'battle', final: 'battle' };

export const sound = new Sound();
