#!/usr/bin/env python3
# 浪人パンチフライトのBGMをつくる（すべてコードで合成。外部の音源・サンプルなし）
# 使い方：python3 tools/music/bgm.py [lobby|battle|all] [出力フォルダ]
#   → bgm_lobby.m4a / bgm_battle.m4a（つなぎ目なしでループする）と、ループ位置の JSON
# 曲の雰囲気は、鉄人さんが Suno で選んだ2曲（ロビーA・バトルA）に合わせた
#   ロビー：Future bass / electro-pop・118BPM・明るいプラック・きらきらのスーパーソウ・スラップベース
#   バトル：Hyper EDM × ドラムンベース・150BPM・ブレイクビーツ・グロウルベース・ヒーローっぽいリード
import json
import os
import subprocess
import sys

import numpy as np
from scipy import signal
from scipy.ndimage import maximum_filter1d

SR = 44100
rng = np.random.default_rng(20261021)


def mtof(m):
    return 440.0 * 2.0 ** ((np.asarray(m, dtype=np.float64) - 69.0) / 12.0)


# =====================================================================
# 音のもと
# =====================================================================
def _farr(freq, n):
    f = np.asarray(freq, dtype=np.float64)
    return np.full(n, float(f)) if f.ndim == 0 else f[:n]


def saw(freq, n, ph0=None):
    """polyBLEP のノコギリ波（ギザギザの少ない音）"""
    f = _farr(freq, n)
    dt = f / SR
    ph = ((rng.random() if ph0 is None else ph0) + np.cumsum(dt)) % 1.0
    y = 2.0 * ph - 1.0
    m = ph < dt
    t = ph[m] / dt[m]
    y[m] -= t + t - t * t - 1.0
    m = ph > 1.0 - dt
    t = (ph[m] - 1.0) / dt[m]
    y[m] -= t * t + t + t + 1.0
    return y


def square(freq, n, ph0=None):
    p = rng.random() if ph0 is None else ph0
    return 0.5 * (saw(freq, n, p) - saw(freq, n, (p + 0.5) % 1.0))


def sine(freq, n, ph0=0.0):
    f = _farr(freq, n)
    return np.sin(2 * np.pi * (ph0 + np.cumsum(f) / SR))


def tri(freq, n):
    f = _farr(freq, n)
    ph = (rng.random() + np.cumsum(f) / SR) % 1.0
    return 4.0 * np.abs(ph - 0.5) - 1.0


def noise(n):
    return rng.uniform(-1, 1, n)


def supersaw(freq, n, voices=7, detune=0.22, width=1.0):
    """少しずつずらしたノコギリ波を重ねて左右に広げる（EDMの厚い音）"""
    f = _farr(freq, n)
    L = np.zeros(n)
    R = np.zeros(n)
    offs = np.linspace(-1.0, 1.0, voices)
    for i, o in enumerate(offs):
        y = saw(f * 2.0 ** (o * detune / 12.0), n)
        pan = o * width
        L += y * np.sqrt((1 - pan) / 2)
        R += y * np.sqrt((1 + pan) / 2)
    k = 1.5 / np.sqrt(voices)
    return L * k, R * k


# =====================================================================
# フィルター・エンベロープ
# =====================================================================
def lp(x, fc, q=0.707):
    fc = min(fc, SR * 0.45)
    b, a = signal.iirfilter(2, fc / (SR / 2), btype='low', ftype='butter') if q == 0.707 else _rbj('lp', fc, q)
    return signal.lfilter(b, a, x)


def hp(x, fc, q=0.707):
    fc = min(fc, SR * 0.45)
    b, a = signal.iirfilter(2, fc / (SR / 2), btype='high', ftype='butter') if q == 0.707 else _rbj('hp', fc, q)
    return signal.lfilter(b, a, x)


def bp(x, fc, q=1.0):
    b, a = _rbj('bp', min(fc, SR * 0.45), q)
    return signal.lfilter(b, a, x)


def _rbj(kind, fc, q):
    w = 2 * np.pi * fc / SR
    al = np.sin(w) / (2 * q)
    c = np.cos(w)
    if kind == 'lp':
        b = [(1 - c) / 2, 1 - c, (1 - c) / 2]
    elif kind == 'hp':
        b = [(1 + c) / 2, -(1 + c), (1 + c) / 2]
    else:
        b = [al, 0, -al]
    a = [1 + al, -2 * c, 1 - al]
    return np.array(b) / a[0], np.array(a) / a[0]


def tv_filter(x, fc, q=0.8, kind='lp', block=128):
    """時間で変わるフィルター（fc は配列）。ブロックごとに係数を変える"""
    y = np.zeros_like(x)
    zi = np.zeros(2)
    fc = np.broadcast_to(fc, x.shape)
    for s in range(0, len(x), block):
        e = min(len(x), s + block)
        b, a = _rbj(kind, float(np.clip(fc[(s + e) // 2], 30, SR * 0.45)), q)
        y[s:e], zi = signal.lfilter(b, a, x[s:e], zi=zi)
    return y


def env_adsr(n_on, a=0.005, d=0.1, s=0.7, r=0.08, curve=4.0):
    """鳴っている長さ n_on（サンプル）＋余韻 r 秒"""
    na, nd, nr = max(1, int(a * SR)), max(1, int(d * SR)), max(1, int(r * SR))
    e = np.empty(n_on + nr)
    t = np.arange(n_on)
    att = np.minimum(1.0, t / na)
    dec = s + (1 - s) * np.exp(-np.maximum(0, t - na) / nd * curve / 4)
    e[:n_on] = np.where(t < na, att, dec)
    last = e[n_on - 1] if n_on > 0 else 0
    e[n_on:] = last * np.exp(-np.arange(nr) / nr * 6)
    return e


def env_perc(n, decay, attack=0.002):
    t = np.arange(n) / SR
    return np.minimum(1, t / max(attack, 1e-4)) * np.exp(-t / decay)


def soft(x, drive=1.0):
    return np.tanh(x * drive) / np.tanh(drive)


# =====================================================================
# 打楽器
# =====================================================================
def kick(punch=1.0, length=0.36, decay=0.17):
    n = int(length * SR)
    t = np.arange(n) / SR
    f = 50 + 160 * np.exp(-t / 0.03) + 50 * np.exp(-t / 0.005)
    body = sine(f, n) * np.exp(-t / decay)
    click = hp(noise(n), 2500) * np.exp(-t / 0.004) * 0.5
    y = soft(body * 1.3 + click * punch, 1.6)
    return y * 0.95


def snare(tone=190, length=0.32, bright=1.0):
    n = int(length * SR)
    t = np.arange(n) / SR
    body = sine(tone * (1 + 0.4 * np.exp(-t / 0.02)), n) * np.exp(-t / 0.07) * 0.7
    nz = bp(noise(n), 3500 * bright, 0.6) * np.exp(-t / 0.13) * 1.1
    nz += hp(noise(n), 6000) * np.exp(-t / 0.05) * 0.4
    return soft(body + nz, 1.3) * 0.8


def clap(length=0.35):
    n = int(length * SR)
    t = np.arange(n) / SR
    nz = bp(noise(n), 1600, 1.2)
    e = np.zeros(n)
    for k, dl in enumerate([0, 0.011, 0.022]):
        e += (t >= dl) * np.exp(-np.maximum(0, t - dl) / 0.008) * (0.8 if k < 2 else 1.0)
    e += (t >= 0.03) * np.exp(-np.maximum(0, t - 0.03) / 0.11) * 0.6
    return nz * e * 1.4


def hat(open_=False):
    n = int((0.32 if open_ else 0.07) * SR)
    t = np.arange(n) / SR
    m = sum(square(f, n) for f in [3527, 4950, 6123, 7401, 8203]) / 5
    y = hp(noise(n) * 0.7 + m * 0.5, 7500)
    return y * np.exp(-t / (0.12 if open_ else 0.018)) * 0.55


def shaker():
    n = int(0.09 * SR)
    t = np.arange(n) / SR
    return bp(noise(n), 8000, 0.8) * np.minimum(1, t / 0.012) * np.exp(-t / 0.03) * 0.5


def crash(length=2.2):
    n = int(length * SR)
    t = np.arange(n) / SR
    m = sum(square(f, n) for f in [2421, 3197, 4310, 5222, 6890, 8130]) / 6
    y = hp(noise(n) * 0.8 + m * 0.35, 4200)
    return y * np.exp(-t / 0.7) * 0.5


def ride():
    n = int(0.55 * SR)
    t = np.arange(n) / SR
    m = sum(square(f, n) for f in [3011, 4523, 5507]) / 3
    y = hp(m * 0.6 + noise(n) * 0.25, 5000)
    return y * np.exp(-t / 0.22) * 0.28


def impact(length=1.6):
    n = int(length * SR)
    t = np.arange(n) / SR
    sub = sine(55 * np.exp(-t / 0.9) + 28, n) * np.exp(-t / 0.55)
    nz = lp(noise(n), 900) * np.exp(-t / 0.25)
    return soft(sub * 1.2 + nz * 0.6, 1.4) * 0.9


def riser(length):
    n = int(length * SR)
    t = np.arange(n) / SR
    k = t / length
    nz = tv_filter(noise(n), 300 + 9000 * k ** 2, 1.2, 'bp')
    tone = sine(200 + 1800 * k ** 2.2, n) * 0.25
    end = np.clip((n - np.arange(n)) / (0.02 * SR), 0, 1)  # おわりの瞬間はすっと消す
    return (nz * 1.4 + tone) * k ** 1.6 * 0.6 * end


def downlifter(length):
    n = int(length * SR)
    t = np.arange(n) / SR
    k = t / length
    nz = tv_filter(noise(n), 8000 * (1 - k) ** 2 + 200, 1.0, 'bp')
    return nz * (1 - k) ** 2 * 0.5


# =====================================================================
# 楽器（音色）
# =====================================================================
def pluck(m, dur, bright=1.0):
    """プラック（はじく音）：ノコギリ＋矩形を、明るい→暗いへ"""
    n_on = int(dur * SR)
    e = env_adsr(n_on, 0.002, 0.16, 0.0, 0.12)
    n = len(e)
    f = mtof(m)
    x = saw(f, n) * 0.6 + square(f * 2.0, n) * 0.25
    br = lp(x, 7000 * bright)
    dk = lp(x, 900)
    k = np.exp(-np.arange(n) / (0.07 * SR))
    return (br * k + dk * (1 - k)) * e


def bell(m, dur):
    """FMのベル（きらきら）"""
    n = int((dur + 0.9) * SR)
    t = np.arange(n) / SR
    f = mtof(m)
    mod = sine(f * 3.5, n) * (2.2 * np.exp(-t / 0.35)) * f
    y = sine(f + mod / (2 * np.pi * 1.0) * 0, n)
    ph = 2 * np.pi * np.cumsum(np.full(n, f)) / SR + 2.2 * np.exp(-t / 0.35) * np.sin(2 * np.pi * f * 3.5 * t)
    y = np.sin(ph) * np.exp(-t / 0.9) + 0.25 * np.sin(2 * ph) * np.exp(-t / 0.3)
    return y * np.minimum(1, t / 0.003) * 0.5


def slap(m, dur):
    """スラップベース：はじいた瞬間が明るい"""
    n_on = int(dur * SR)
    e = env_adsr(n_on, 0.002, 0.18, 0.45, 0.05)
    n = len(e)
    f = mtof(m)
    x = saw(f, n) * 0.7 + sine(f, n) * 0.6
    k = np.exp(-np.arange(n) / (0.03 * SR))
    y = lp(x, 4500) * k + lp(x, 650) * (1 - k)
    y += hp(noise(n), 3000) * np.exp(-np.arange(n) / (0.004 * SR)) * 0.25
    return soft(y * e * 1.2, 1.2)


def growl(m, dur, vowels='aoa', rate=None):
    """グロウルベース：母音（あ・お・う）のフィルターを動かして「ヨォ」と鳴らす"""
    n_on = int(dur * SR)
    e = env_adsr(n_on, 0.004, 0.05, 0.9, 0.04)
    n = len(e)
    f = mtof(m)
    x = saw(f, n) * 0.8 + square(f * 1.003, n) * 0.5 + sine(f * 0.5, n) * 0.4
    x = soft(x * 2.2, 2.0)
    F = {'a': (800, 1250), 'o': (450, 850), 'u': (330, 700), 'e': (550, 1900), 'i': (300, 2300)}
    pts = [F[v] for v in vowels]
    seg = np.linspace(0, len(pts) - 1, n)
    i0 = np.floor(seg).astype(int).clip(0, len(pts) - 1)
    i1 = np.minimum(i0 + 1, len(pts) - 1)
    fr = seg - i0
    f1 = np.array([p[0] for p in pts])
    f2 = np.array([p[1] for p in pts])
    c1 = f1[i0] * (1 - fr) + f1[i1] * fr
    c2 = f2[i0] * (1 - fr) + f2[i1] * fr
    y = tv_filter(x, c1, 4.0, 'bp') * 1.4 + tv_filter(x, c2, 5.0, 'bp') * 1.0 + lp(x, 180) * 0.9
    y = soft(y * 1.8, 1.8)
    return y * e * 0.8


def reese(m, dur):
    n_on = int(dur * SR)
    e = env_adsr(n_on, 0.02, 0.2, 0.85, 0.1)
    n = len(e)
    f = mtof(m)
    x = saw(f * 2 ** (-0.14 / 12), n) + saw(f * 2 ** (0.14 / 12), n) + sine(f * 0.5, n) * 0.8
    lfo = 380 + 220 * np.sin(2 * np.pi * np.arange(n) / SR * 0.8 + rng.random() * 6)
    y = tv_filter(soft(x, 1.5), lfo, 1.1, 'lp')
    return y * e * 0.7


def pad(chord, dur, bright=1800):
    n_on = int(dur * SR)
    e = env_adsr(n_on, 0.35, 0.5, 0.85, 0.6)
    n = len(e)
    L = np.zeros(n)
    R = np.zeros(n)
    for m in chord:
        l, r = supersaw(mtof(m), n, 5, 0.12)
        L += l
        R += r
    L = lp(L, bright) * e
    R = lp(R, bright) * e
    k = 0.32 / max(1, len(chord))
    return L * k, R * k


def sawchord(chord, dur, bright=6500, a=0.004, d=0.25, s=0.7, r=0.12, detune=0.22):
    n_on = int(dur * SR)
    e = env_adsr(n_on, a, d, s, r)
    n = len(e)
    L = np.zeros(n)
    R = np.zeros(n)
    for m in chord:
        l, rr = supersaw(mtof(m), n, 7, detune)
        L += l
        R += rr
    L = lp(L, bright) * e
    R = lp(R, bright) * e
    k = 0.42 / max(1, len(chord))
    return L * k, R * k


def lead_line(notes, spb16, total_n, glide=0.045, vib=True, oct_layer=True, bright=7000):
    """リードの旋律（なめらかにつなぐ）。notes = [(開始16分, 長さ16分, MIDI)]"""
    f = np.zeros(total_n)
    amp = np.zeros(total_n)
    prev = None
    for (st, ln, m) in notes:
        s = int(st * spb16 * SR)
        e = min(total_n, int((st + ln) * spb16 * SR))
        if s >= total_n:
            continue
        seg = np.arange(e - s) / SR
        target = float(mtof(m))
        if prev is None:
            fseg = np.full(e - s, target)
        else:
            fseg = target + (prev - target) * np.exp(-seg / glide)
        if vib:
            depth = np.clip((seg - 0.16) / 0.25, 0, 1) * 0.0075
            fseg = fseg * (1 + depth * np.sin(2 * np.pi * 5.6 * seg))
        f[s:e] = fseg
        a = np.minimum(1, seg / 0.012) * (0.82 + 0.18 * np.exp(-seg / 0.12))
        rel = np.clip((e - s - np.arange(e - s)) / (0.03 * SR), 0, 1)
        amp[s:e] = a * rel
        prev = target
    # 鳴っていないところは前の高さのまま（位相がとぶのを防ぐ）
    last = 220.0
    for i in range(0, total_n, 512):
        blk = f[i:i + 512]
        z = blk == 0
        if z.all():
            f[i:i + 512] = last
        else:
            blk[z] = blk[~z][0] if z[0] else last
            last = blk[~z][-1]
    L, R = supersaw(f, total_n, 7, 0.16, 0.8)
    if oct_layer:
        sq = square(f * 0.5, total_n) * 0.35
        L += sq
        R += sq
    L = lp(L, bright) * amp
    R = lp(R, bright) * amp
    return L * 0.5, R * 0.5


# =====================================================================
# まとめ役（トラックに音を置く）
# =====================================================================
class Mix:
    def __init__(self, total_s, tail_s=4.0):
        self.n = int(total_s * SR)
        self.N = self.n + int(tail_s * SR)
        self.bus = {}

    def track(self, name):
        if name not in self.bus:
            self.bus[name] = np.zeros((2, self.N))
        return self.bus[name]

    def put(self, name, t, x, gain=1.0, pan=0.0):
        """t 秒に音 x（モノラル配列 or (L,R)）を置く"""
        b = self.track(name)
        s = int(round(t * SR))
        if isinstance(x, tuple):
            L, R = x
        else:
            pl = np.sqrt((1 - pan) / 2) * 1.41421356
            pr = np.sqrt((1 + pan) / 2) * 1.41421356
            L, R = x * pl, x * pr
        e = min(self.N, s + len(L))
        if s >= self.N or e <= 0:
            return
        b[0, s:e] += L[: e - s] * gain
        b[1, s:e] += R[: e - s] * gain


def reverb_ir(length=2.2, damp=6000, pre=0.018):
    n = int(length * SR)
    t = np.arange(n) / SR
    ir = np.zeros((2, n + int(pre * SR)))
    for c in range(2):
        x = noise(n) * np.exp(-t / (length / 6.5))
        x = lp(x, damp)
        ir[c, int(pre * SR):] = x
    ir /= np.sqrt(np.sum(ir ** 2, axis=1, keepdims=True)) + 1e-9
    return ir


def apply_reverb(x, ir, wet):
    out = np.zeros_like(x)
    for c in range(2):
        out[c] = signal.fftconvolve(x[c], ir[c])[: x.shape[1]]
    return out * wet


def pingpong(x, delay_s, fb=0.42, taps=6, wet=0.35, tone=5000):
    d = int(delay_s * SR)
    out = np.zeros_like(x)
    mono = (x[0] + x[1]) * 0.5
    src = lp(mono, tone)
    for k in range(1, taps + 1):
        g = wet * fb ** (k - 1)
        ch = (k - 1) % 2
        if d * k < x.shape[1]:
            out[ch, d * k:] += src[: -d * k] * g
    return out


def sidechain_curve(N, kicks, depth=0.7, release=0.16):
    g = np.ones(N)
    rel = int(release * 4 * SR)
    shape = 1 - depth * np.exp(-np.arange(rel) / (release * SR)) * np.minimum(1, np.arange(rel) / (0.004 * SR) + 0.0)
    for t in kicks:
        s = int(t * SR)
        e = min(N, s + rel)
        if s < N:
            g[s:e] = np.minimum(g[s:e], shape[: e - s])
    return g


def master(x, peak=0.94, loud=-12.5):
    """仕上げ：低い雑音を切る→いちばん大きいところを目標の大きさに→軽く圧縮→天井"""
    for c in range(2):
        x[c] = hp(x[c], 35)
    # いちばん大きい区間（4秒ごと）の大きさを loud dBFS に合わせる
    mono = (x[0] + x[1]) * 0.5
    w = 4 * SR
    k = max(1, len(mono) // w)
    secs = [np.sqrt(np.mean(mono[i * w:(i + 1) * w] ** 2)) for i in range(k)]
    x = x * (10 ** (loud / 20) / (max(secs) + 1e-9))
    # 軽いコンプ（大きいところだけ少しおさえる）
    env = np.sqrt(signal.lfilter([0.002], [1, -0.998], ((x[0] ** 2 + x[1] ** 2) / 2)) + 1e-12)
    thr = np.percentile(env, 88)
    g = np.where(env > thr, (thr / env) ** (1 - 1 / 1.8), 1.0)
    x = x * g
    # 天井（先読みつきのリミッター）
    pk = maximum_filter1d(np.max(np.abs(x), axis=0), size=int(0.005 * SR))
    lim = np.minimum(1.0, peak * 0.97 / (pk + 1e-9))
    lim = np.minimum(lim, np.convolve(lim, np.ones(96) / 96, mode='same'))
    x = x * lim
    return np.tanh(x / peak) * peak


def active_rms_db(b):
    """鳴っているところだけの音の大きさ（dBFS）"""
    mono = (b[0] + b[1]) * 0.5
    fr = 2048
    k = len(mono) // fr
    pw = np.mean(mono[: k * fr].reshape(k, fr) ** 2, axis=1)
    if pw.max() <= 0:
        return -200.0
    act = pw[pw > pw.max() * 1e-4]
    return 10 * np.log10(np.mean(act) + 1e-12)


def finish(mix, kicks, sc_buses, fx, loop_s, name, outdir, levels=None):
    N = mix.N
    # それぞれの楽器の大きさをそろえる（鳴っているところの大きさを目標に）
    if levels:
        for nm, b in mix.bus.items():
            if nm in levels:
                g = 10 ** ((levels[nm] - active_rms_db(b)) / 20)
                mix.bus[nm] = b * g
    sc = sidechain_curve(N, kicks)
    total = np.zeros((2, N))
    for nm, b in mix.bus.items():
        if nm in sc_buses:
            b = b * sc[None, :] ** sc_buses[nm]
        total += b
    # 響き（リバーブ・ディレイ）
    for nm, (rv, dl) in fx.items():
        if nm not in mix.bus:
            continue
        b = mix.bus[nm]
        if nm in sc_buses:
            b = b * sc[None, :] ** sc_buses[nm]
        if rv:
            total += apply_reverb(b, IR_BIG if rv > 0.2 else IR_SMALL, rv)
        if dl:
            total += pingpong(b, dl[0], dl[1], 6, dl[2])
    # ループ：はみ出した余韻を頭に重ねる（つなぎ目で音が切れない）
    n = mix.n
    loop = total[:, :n].copy()
    tail = total[:, n:]
    loop[:, : tail.shape[1]] += tail[:, : min(tail.shape[1], n)]
    # 仕上げは、前後を少しつなげた状態でかける（つなぎ目でフィルターやコンプがとぎれない）
    X = int(2.0 * SR)
    ext = master(np.concatenate([loop[:, -X:], loop, loop[:, :X]], axis=1))
    loop = ext[:, X:-X]
    # ファイル：[おわりの0.5秒] + [ループ] + [はじめの0.5秒]（どのブラウザでもつなぎ目がずれても切れない）
    P = int(0.5 * SR)
    out = np.concatenate([loop[:, -P:], loop, loop[:, :P]], axis=1)
    os.makedirs(outdir, exist_ok=True)
    wav = os.path.join(outdir, f'bgm_{name}.wav')
    from scipy.io import wavfile
    wavfile.write(wav, SR, (np.clip(out.T, -1, 1) * 32767).astype(np.int16))
    m4a = os.path.join(outdir, f'bgm_{name}.m4a')
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', wav, '-c:a', 'aac', '-b:a', '144k', '-movflags', '+faststart', m4a], check=True)
    # AAC が読めないブラウザ用に MP3 も作る
    mp3 = os.path.join(outdir, f'bgm_{name}.mp3')
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', wav, '-c:a', 'libmp3lame', '-b:a', '160k', mp3], check=True)
    info = {'file': f'bgm_{name}.m4a', 'loopStart': P / SR, 'loopEnd': (P + n) / SR, 'length': out.shape[1] / SR}
    # 音の大きさの目安（RMS dBFS）
    rms = 20 * np.log10(np.sqrt(np.mean(loop ** 2)) + 1e-9)
    print(name, 'loop', round(n / SR, 3), 's', 'rms', round(rms, 1), 'dBFS', 'peak', round(float(np.max(np.abs(loop))), 3), 'size', os.path.getsize(m4a) // 1024, 'KB')
    return info


# 楽器ごとの大きさの目標（鳴っているところの RMS dBFS）
LEVELS = {
    'lobby': {'drums': -17.0, 'perc': -27.0, 'bass': -19.5, 'chords': -21.0, 'pad': -23.0, 'lead': -19.5, 'lead2': -24.0, 'arp': -25.0, 'bell': -23.5, 'fx': -25.0},
    'battle': {'drums': -15.5, 'perc': -26.0, 'bass': -18.0, 'chords': -21.0, 'pad': -22.0, 'lead': -18.5, 'lead2': -23.0, 'arp': -24.5, 'fx': -24.0},
}
IR_BIG = reverb_ir(2.4, 6500)
IR_SMALL = reverb_ir(0.9, 8000)


# =====================================================================
# ロビーの曲（F メジャー・118 BPM・32小節）
# =====================================================================
def song_lobby():
    bpm = 118
    beat = 60 / bpm
    bar = beat * 4
    s16 = beat / 4
    bars = 32
    M = Mix(bars * bar)
    # 8小節の進行：B♭maj9 → Cadd9 → Am7 → Dm9 → Gm9 → C7 → Fmaj7 → B♭|C
    prog = [
        (46, [58, 62, 65, 69, 72]),
        (48, [60, 64, 67, 74]),
        (45, [57, 60, 64, 67, 72]),
        (50, [57, 60, 62, 65, 69]),
        (43, [58, 62, 65, 69]),
        (48, [58, 60, 64, 67]),
        (41, [60, 64, 65, 69]),
        (46, [58, 62, 65, 69]),
    ]
    half = (48, [60, 64, 67, 72])  # 8小節目の後半は C
    hook = [
        [(0, 2, 74), (3, 2, 77), (6, 2, 81), (8, 4, 79), (12, 2, 77), (14, 2, 74)],
        [(0, 3, 76), (3, 2, 79), (6, 4, 84), (10, 2, 82), (12, 2, 81), (14, 2, 79)],
        [(0, 6, 81), (6, 2, 79), (8, 2, 76), (10, 2, 79), (12, 4, 81)],
        [(0, 8, 77), (8, 2, 76), (10, 2, 74), (12, 2, 72), (14, 2, 74)],
        [(0, 3, 82), (3, 3, 81), (6, 2, 79), (8, 4, 77), (12, 2, 79), (14, 2, 81)],
        [(0, 4, 82), (4, 4, 84), (8, 6, 86), (14, 2, 84)],
        [(0, 8, 81), (8, 2, 84), (10, 2, 81), (12, 2, 79), (14, 2, 77)],
        [(0, 4, 79), (4, 2, 81), (6, 2, 82), (8, 8, 84)],
    ]
    bells = [
        [(0, 4, 77), (6, 2, 81), (8, 4, 84), (14, 2, 81)],
        [(0, 4, 79), (6, 2, 84), (8, 6, 86)],
        [(0, 4, 76), (6, 2, 79), (8, 4, 84), (12, 4, 81)],
        [(0, 6, 77), (8, 2, 76), (10, 2, 74), (12, 4, 72)],
        [(0, 4, 74), (6, 2, 77), (8, 4, 82), (14, 2, 81)],
        [(0, 4, 79), (6, 2, 82), (8, 8, 84)],
        [(0, 4, 81), (4, 4, 79), (8, 4, 77), (12, 4, 76)],
        [(0, 4, 74), (4, 4, 77), (8, 4, 79), (12, 4, 84)],
    ]
    slap_pat = [(0, 2, 0), (3, 1, 12), (4, 1, 0), (6, 1, 12), (8, 2, 7), (10, 1, 12), (11, 1, 0), (14, 2, 10)]
    kicks = []
    K, SN, CL, HH, OH, SH = kick(), snare(200), clap(), hat(), hat(True), shaker()
    stab_rhythm = [(0, 3), (3, 3), (6, 2), (10, 2), (12, 4)]
    for b in range(bars):
        t0 = b * bar
        sec = 'A' if b < 8 else 'B' if b < 16 else 'H' if b < 24 else 'D'
        pi = b % 8
        root, ch = prog[pi]
        chords = [(0, 16, root, ch)] if pi != 7 else [(0, 8, root, ch), (8, 8, half[0], half[1])]
        build = b >= 30
        # --- ドラム ---
        if sec in 'AB':
            for st in (0, 10):
                M.put('drums', t0 + st * s16, K, 0.9)
                kicks.append(t0 + st * s16)
            M.put('drums', t0 + 8 * s16, CL, 0.55)
            M.put('drums', t0 + 8 * s16, SN, 0.35)
            for st in (2, 6, 10, 14):
                M.put('perc', t0 + st * s16, HH, 0.5, 0.25)
            for st in range(16):
                M.put('perc', t0 + st * s16, SH, 0.22 + (0.12 if st % 4 == 2 else 0), -0.35)
            if sec == 'B' and pi % 2 == 1:
                M.put('perc', t0 + 15 * s16, CL, 0.25, 0.3)
        elif sec == 'H':
            for st in (0, 4, 8, 12):
                M.put('drums', t0 + st * s16, K, 0.95)
                kicks.append(t0 + st * s16)
            for st in (4, 12):
                M.put('drums', t0 + st * s16, CL, 0.6)
                M.put('drums', t0 + st * s16, SN, 0.4)
            for st in (2, 6, 10, 14):
                M.put('perc', t0 + st * s16, OH, 0.42, 0.2)
            for st in range(16):
                M.put('perc', t0 + st * s16, SH, 0.24, -0.35)
        elif sec == 'D' and not build:
            if b >= 28:
                for st in (0, 8):
                    M.put('drums', t0 + st * s16, K, 0.6)
                    kicks.append(t0 + st * s16)
            for st in (4, 12):
                M.put('perc', t0 + st * s16, SH, 0.2, -0.3)
        if build:
            n_hits = 8 if b == 30 else 16
            for i in range(n_hits):
                st = i * (16 // n_hits)
                v = 0.25 + 0.45 * ((b - 30) * 16 + st) / 32
                M.put('drums', t0 + st * s16, SN, v * 0.7)
                if i % 2 == 0:
                    M.put('drums', t0 + st * s16, K, 0.7)
                    kicks.append(t0 + st * s16)
            if b == 30:
                M.put('fx', t0, riser(2 * bar - s16 * 2), 0.9)
        if b in (0, 8, 16):
            M.put('fx', t0, crash(), 0.55, 0.2)
        if b == 0:
            M.put('fx', t0, impact(), 0.5)
        if b == 24:
            M.put('fx', t0, downlifter(bar * 1.5), 0.6)
            M.put('fx', t0, crash(), 0.4, -0.2)
        # --- ベース ---
        if sec != 'D' or build:
            for (st0, ln0, r0, _) in chords:
                for (st, ln, iv) in slap_pat:
                    if st < st0 or st >= st0 + ln0:
                        continue
                    nm = r0 + iv - 12 if iv < 12 else r0 + iv - 12
                    M.put('bass', t0 + st * s16, slap(nm, ln * s16 * 0.92), 0.55)
        else:
            for (st0, ln0, r0, _) in chords:
                M.put('bass', t0 + st0 * s16, reese(r0 - 12, ln0 * s16), 0.38)
        # --- 和音 ---
        for (st0, ln0, r0, chd) in chords:
            if sec in 'AD':
                M.put('pad', t0 + st0 * s16, pad(chd, ln0 * s16, 2200 if sec == 'A' else 1500), 0.8)
            if sec == 'B':
                M.put('pad', t0 + st0 * s16, pad(chd, ln0 * s16, 1800), 0.55)
                for (st, ln) in stab_rhythm:
                    if st0 <= st < st0 + ln0:
                        M.put('chords', t0 + st * s16, sawchord([m + 12 for m in chd[:4]], ln * s16 * 0.9, 5200, 0.003, 0.18, 0.55, 0.08), 0.5)
            if sec == 'H':
                M.put('chords', t0 + st0 * s16, sawchord(chd, ln0 * s16, 4200, 0.01, 0.4, 0.75, 0.15), 0.55)
        # --- プラックのアルペジオ ---
        if sec in 'ABH' or build:
            for (st0, ln0, r0, chd) in chords:
                tones = sorted(chd)[:4]
                seq = tones + [m + 12 for m in tones]
                pat = [0, 2, 4, 6, 7, 5, 3, 1]
                for st in range(st0, st0 + ln0):
                    m = seq[pat[st % 8] % len(seq)]
                    br = 0.6 if sec == 'A' else 0.9 if sec == 'B' else 0.7
                    if build:
                        br = 0.4 + (b - 30) * 0.5 + st / 32
                    M.put('arp', t0 + st * s16, pluck(m, s16 * 0.8, br), 0.24 if sec != 'H' else 0.16, 0.3 if st % 2 else -0.3)
        # --- ベル ---
        if sec in 'BD' and not build:
            for (st, ln, m) in bells[pi]:
                M.put('bell', t0 + st * s16, bell(m, ln * s16), 0.3 if sec == 'B' else 0.36, 0.15)
    # --- リード（サビ）---
    for b in range(16, 24):
        pass
    notes = []
    for i in range(8):
        for (st, ln, m) in hook[i]:
            notes.append(((16 + i) * 16 + st, ln, m))
    L, R = lead_line(notes, s16, M.n, bright=6500)
    M.put('lead', 0, (L, R), 0.62)
    # 静かなところで、サビの頭をやわらかく
    notes2 = []
    for i in range(4):
        for (st, ln, m) in hook[i]:
            notes2.append(((24 + i) * 16 + st, ln, m - 12))
    L2, R2 = lead_line(notes2, s16, M.n, vib=True, oct_layer=False, bright=2200)
    M.put('lead2', 0, (L2, R2), 0.38)
    sc = {'pad': 1.0, 'chords': 1.0, 'bass': 0.6, 'arp': 0.5, 'lead': 0.25, 'lead2': 0.4, 'bell': 0.2}
    fx = {'pad': (0.25, None), 'chords': (0.22, None), 'arp': (0.18, (s16 * 3, 0.4, 0.28)), 'bell': (0.32, (s16 * 3, 0.45, 0.3)), 'lead': (0.22, (s16 * 3, 0.35, 0.22)), 'lead2': (0.3, (s16 * 3, 0.4, 0.3)), 'drums': (0.06, None), 'perc': (0.08, None), 'fx': (0.15, None)}
    return M, kicks, sc, fx, bars * bar


# =====================================================================
# バトルの曲（D マイナー・150 BPM・32小節）
#   Drop A（8）→ リード（8）→ Drop B（8）→ 静か＋盛り上げ（8）→ Drop A にもどる
# =====================================================================
def song_battle():
    bpm = 150
    beat = 60 / bpm
    bar = beat * 4
    s16 = beat / 4
    bars = 32
    M = Mix(bars * bar)
    V = {
        'Dm': (38, [62, 65, 69, 74]),
        'Bb': (34, [62, 65, 70, 74]),
        'F': (41, [60, 65, 69, 72]),
        'C': (36, [60, 64, 67, 72]),
        'Gm': (43, [62, 67, 70, 74]),
        'A': (33, [61, 64, 69, 73]),
    }
    dropP = ['Dm', 'Bb', 'F', 'C', 'Dm', 'Bb', 'Gm', 'A']
    leadP = ['Bb', 'C', 'Dm', 'F', 'Gm', 'Bb', 'C', 'A']
    brkP = ['Bb', 'C', 'Dm', 'Dm', 'Gm', 'Bb', 'C', 'A']
    lead = [
        [(0, 4, 74), (4, 4, 77), (8, 6, 82), (14, 2, 81)],
        [(0, 4, 79), (4, 2, 76), (6, 2, 79), (8, 8, 84)],
        [(0, 6, 81), (6, 2, 77), (8, 4, 74), (12, 2, 76), (14, 2, 77)],
        [(0, 8, 84), (8, 4, 81), (12, 2, 84), (14, 2, 86)],
        [(0, 6, 86), (6, 2, 84), (8, 4, 82), (12, 2, 81), (14, 2, 79)],
        [(0, 4, 77), (4, 2, 79), (6, 2, 82), (8, 8, 86)],
        [(0, 6, 88), (6, 2, 86), (8, 4, 84), (12, 2, 82), (14, 2, 84)],
        [(0, 12, 85), (12, 4, 88)],
    ]
    growlA = [(0, 3, 0, 'aoa'), (3, 1, 0, 'o'), (4, 2, 12, 'ea'), (6, 2, 0, 'oa'), (8, 3, 0, 'aou'), (11, 1, 7, 'o'), (12, 4, 0, 'aoua')]
    growlB = [(0, 2, 0, 'ao'), (2, 2, 12, 'ea'), (4, 1, 0, 'o'), (5, 1, 0, 'a'), (6, 2, 7, 'oa'), (8, 2, 0, 'au'), (10, 2, 12, 'ie'), (12, 1, 0, 'o'), (13, 1, 3, 'a'), (14, 2, 0, 'uoa')]
    K, SN, CL, HH, OH, RD = kick(1.2), snare(185, 0.3, 1.1), clap(), hat(), hat(True), ride()
    kicks = []
    for b in range(bars):
        t0 = b * bar
        sec = 'A' if b < 8 else 'L' if b < 16 else 'B' if b < 24 else 'K'
        pi = b % 8
        name = dropP[pi] if sec in 'AB' else leadP[pi] if sec == 'L' else brkP[pi]
        root, ch = V[name]
        build = b >= 28
        quiet = sec == 'K' and not build
        # --- ドラム（ブレイクビーツ）---
        if sec in 'ALB':
            ks = [0, 10] + ([7] if pi % 2 == 1 else [])
            for st in ks:
                M.put('drums', t0 + st * s16, K, 0.95)
                kicks.append(t0 + st * s16)
            for st in (4, 12):
                M.put('drums', t0 + st * s16, SN, 0.75)
                M.put('drums', t0 + st * s16, CL, 0.3)
            for st in (14,) + ((9,) if pi % 2 == 0 else ()):
                M.put('drums', t0 + st * s16, SN, 0.22)
            for st in range(16):
                v = [0.5, 0.22, 0.36, 0.22][st % 4]
                M.put('perc', t0 + st * s16, HH, v, 0.25 if st % 2 else -0.15)
            if sec == 'L':
                for st in (0, 4, 8, 12):
                    M.put('perc', t0 + st * s16, RD, 0.5, 0.35)
            if sec == 'B':
                for st in (2, 10):
                    M.put('perc', t0 + st * s16, OH, 0.3, -0.25)
            if pi == 7:
                for st in (13, 14, 15):
                    M.put('drums', t0 + st * s16, SN, 0.35 + 0.1 * (st - 13))
        elif quiet:
            M.put('drums', t0, K, 0.7)
            kicks.append(t0)
            M.put('drums', t0 + 8 * s16, SN, 0.55)
            M.put('drums', t0 + 8 * s16, CL, 0.3)
            for st in (4, 12):
                M.put('perc', t0 + st * s16, HH, 0.25)
        else:
            # 盛り上げ：スネアの連打がだんだん細かく
            div = {28: 4, 29: 2, 30: 1, 31: 1}[b]
            for st in range(0, 16, div):
                k = ((b - 28) * 16 + st) / 64
                M.put('drums', t0 + st * s16, snare(185 + 180 * k, 0.25, 1.0 + k), 0.3 + 0.5 * k)
                if st % 4 == 0:
                    M.put('drums', t0 + st * s16, K, 0.8)
                    kicks.append(t0 + st * s16)
            if b == 31:
                for st in range(0, 16, 1):
                    M.put('drums', t0 + (st + 0.5) * s16, snare(380, 0.18, 2.0), 0.4)
            if b == 28:
                M.put('fx', t0, riser(4 * bar - s16 * 2), 1.0)
        if b in (0, 4, 8, 16, 20):
            M.put('fx', t0, crash(), 0.6, 0.25 if b % 8 else -0.2)
        if b in (0, 16):
            M.put('fx', t0, impact(), 0.7)
        if b == 24:
            M.put('fx', t0, downlifter(bar), 0.7)
            M.put('fx', t0, crash(2.8), 0.5)
        # --- ベース ---
        if sec in 'AB':
            pat = growlA if sec == 'A' or pi % 2 == 0 else growlB
            for (st, ln, iv, vw) in pat:
                M.put('bass', t0 + st * s16, growl(root + iv, ln * s16 * 0.95, vw), 0.62)
        elif sec == 'L':
            M.put('bass', t0, reese(root, bar), 0.5)
        elif quiet:
            M.put('bass', t0, reese(root, bar * 0.98), 0.35)
        elif b == 31:
            # 落ちる直前：ベースのしゃくり
            n = int(bar * SR)
            tt = np.arange(n) / SR
            sw = sine(mtof(26) * (1 + 1.5 * (tt / bar) ** 2), n) * np.minimum(1, tt / 0.05) * np.clip((n - np.arange(n)) / (0.03 * SR), 0, 1) * 0.5
            M.put('bass', t0, sw, 0.5)
        # --- 和音 ---
        if sec in 'AB':
            for st in (2, 6, 10, 14):
                M.put('chords', t0 + st * s16, sawchord([m + 12 for m in ch], s16 * 1.3, 7000, 0.002, 0.09, 0.3, 0.05), 0.42)
        if sec == 'L':
            M.put('chords', t0, sawchord(ch, bar, 4800, 0.01, 0.4, 0.8, 0.2), 0.6)
        if sec == 'K':
            M.put('pad', t0, pad(ch, bar, 1600 if quiet else 1600 + (b - 28) * 1500), 0.9)
        # --- アルペジオ（Drop B と盛り上げ）---
        if sec == 'B' or build:
            tones = ch + [m + 12 for m in ch]
            pat = [0, 1, 2, 3, 4, 3, 2, 1, 0, 2, 4, 6, 5, 3, 1, 2]
            for st in range(16):
                br = 0.9 if sec == 'B' else 0.3 + (b - 28) / 4 + st / 64
                M.put('arp', t0 + st * s16, pluck(tones[pat[st] % len(tones)] + 12, s16 * 0.7, br), 0.2, 0.35 if st % 2 else -0.35)
    # --- リード ---
    notes = []
    for i in range(8):
        for (st, ln, m) in lead[i]:
            notes.append(((8 + i) * 16 + st, ln, m))
    # Drop B では、リードの切れはし（呼びかけ）
    for i in (1, 3, 5, 7):
        for (st, ln, m) in lead[i][:2]:
            notes.append(((16 + i) * 16 + st, ln, m))
    notes.sort()
    L, R = lead_line(notes, s16, M.n, bright=7500)
    M.put('lead', 0, (L, R), 0.6)
    notes2 = []
    for i in range(4):
        for (st, ln, m) in lead[i]:
            notes2.append(((24 + i) * 16 + st, ln, m - 12))
    L2, R2 = lead_line(notes2, s16, M.n, oct_layer=False, bright=2600)
    M.put('lead2', 0, (L2, R2), 0.4)
    sc = {'pad': 1.0, 'chords': 0.8, 'bass': 0.45, 'arp': 0.5, 'lead': 0.2, 'lead2': 0.35}
    fx = {'pad': (0.28, None), 'chords': (0.18, None), 'arp': (0.15, (s16 * 3, 0.38, 0.25)), 'lead': (0.2, (s16 * 3, 0.32, 0.2)), 'lead2': (0.3, (s16 * 3, 0.4, 0.3)), 'drums': (0.05, None), 'perc': (0.05, None), 'fx': (0.12, None)}
    return M, kicks, sc, fx, bars * bar


def main():
    which = sys.argv[1] if len(sys.argv) > 1 else 'all'
    outdir = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), 'out')
    infos = {}
    for nm, fn in (('lobby', song_lobby), ('battle', song_battle)):
        if which not in ('all', nm):
            continue
        M, kicks, sc, fx, loop_s = fn()
        infos[nm] = finish(M, kicks, sc, fx, loop_s, nm, outdir, LEVELS[nm])
    p = os.path.join(outdir, 'bgm.json')
    old = {}
    if os.path.exists(p):
        old = json.load(open(p))
    old.update(infos)
    json.dump(old, open(p, 'w'), indent=1)
    print(json.dumps(old))


if __name__ == '__main__':
    main()
