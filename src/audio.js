// 音（すべてその場で合成する。外部ファイルなし）
import { store } from './util.js';

class Sound {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.sfxGain = null;
    this.bgmGain = null;
    const s = store.get('rpf_sound', { sfx: 0.8, bgm: 0.55 });
    this.vol = s;
    this.bgm = null;
    this.bgmTimer = null;
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
        this.bgmGain.gain.value = this.vol.bgm * 0.5;
        this.bgmGain.connect(this.master);
        const len = this.ctx.sampleRate * 1;
        this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state !== 'running') this.ctx.resume();
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
    else this.bgmGain.gain.value = v * 0.5;
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
      case 'capsule':
        [392, 523, 659, 784, 1046, 1318, 1568].forEach((f, i) => this.tone(f, 0.12, 'square', 0.08 * v, 0, i * 0.05));
        break;
    }
  }

  // ===== BGM（16分音符のループ）=====
  playBgm(kind) {
    if (this.bgmKind === kind) return;
    this.stopBgm();
    this.bgmKind = kind;
    if (!this.ctx) return;
    const songs = {
      menu: { bpm: 112, key: 0, prog: [0, 5, 3, 4], lead: true, drive: 0 },
      battle: { bpm: 150, key: 2, prog: [0, 4, 5, 3], lead: true, drive: 1 },
      final: { bpm: 166, key: 4, prog: [5, 3, 0, 4], lead: true, drive: 2 },
      result: { bpm: 120, key: 0, prog: [0, 3, 4, 0], lead: true, drive: 0 },
    };
    const S = songs[kind];
    if (!S) return;
    const c = this.ctx;
    const step = 60 / S.bpm / 4;
    let next = c.currentTime + 0.1;
    let i = 0;
    const scale = [0, 2, 4, 5, 7, 9, 11];
    const base = 48 + S.key; // C3
    const chordOf = (deg) => [scale[deg % 7], scale[(deg + 2) % 7] + (deg + 2 >= 7 ? 12 : 0), scale[(deg + 4) % 7] + (deg + 4 >= 7 ? 12 : 0)];
    const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
    const melodyPat = [0, -1, 2, -1, 1, 2, -1, 4, 2, -1, 1, 0, -1, 2, 4, -1];
    const tick = () => {
      while (next < c.currentTime + 0.25) {
        const bar = Math.floor(i / 16) % 4;
        const s16 = i % 16;
        const deg = S.prog[bar];
        const ch = chordOf(deg);
        const t = next - c.currentTime;
        const g = this.bgmGain;
        // ドラム
        if (s16 % 4 === 0) this.tone(60, 0.18, 'sine', 0.5, 0.35, t, g);
        if (S.drive && (s16 === 4 || s16 === 12)) this.noise(0.14, 0.32, 2400, 900, 0.6, t, 'bandpass', g);
        if (!S.drive && s16 === 8) this.noise(0.12, 0.2, 2000, 800, 0.8, t, 'bandpass', g);
        if (s16 % 2 === 0 || S.drive > 1) this.noise(0.035, S.drive ? 0.1 : 0.06, 9000, 7000, 1, t, 'highpass', g);
        // ベース
        if (s16 % 2 === 0) {
          const n = base - 12 + ch[0] + (s16 % 8 === 6 ? 12 : 0);
          this.tone(midi(n), step * 1.8, S.drive ? 'sawtooth' : 'triangle', S.drive ? 0.09 : 0.12, 0, t, g);
        }
        // コード（裏拍）
        if (s16 % 4 === 2) for (const cn of ch) this.tone(midi(base + 12 + cn), step * 1.6, 'square', 0.025, 0, t, g);
        // メロディ
        if (S.lead) {
          const mi = melodyPat[(s16 + bar * 3) % 16];
          if (mi >= 0 && (s16 % 2 === 0 || S.drive)) {
            const n = base + 24 + chordOf(deg)[mi % 3] + (mi >= 3 ? 12 : 0);
            this.tone(midi(n), step * (S.drive ? 0.9 : 1.6), 'square', S.drive ? 0.045 : 0.035, 0, t, g);
          }
        }
        next += step;
        i++;
      }
    };
    tick();
    this.bgmTimer = setInterval(tick, 60);
  }
  stopBgm() {
    if (this.bgmTimer) clearInterval(this.bgmTimer);
    this.bgmTimer = null;
    this.bgmKind = null;
  }
}

export const sound = new Sound();
