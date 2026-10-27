# Suno の曲を BGM のループにするための分析：テンポ・拍・小節の頭・似ている場所
#   python3 analyze.py lobby_src.f32
import sys, json
import numpy as np
from scipy.signal import stft, find_peaks
from scipy.ndimage import uniform_filter1d

SR = 44100
HOP = 441  # 10ms
src = sys.argv[1]
BMIN = float(sys.argv[2]) if len(sys.argv) > 2 else 70
BMAX = float(sys.argv[3]) if len(sys.argv) > 3 else 181
x = np.fromfile(src, dtype=np.float32).reshape(-1, 2)
mono = x.mean(axis=1)
dur = len(mono) / SR
print('duration %.2f s' % dur)

# ---- スペクトル ----
f, t, Z = stft(mono, fs=SR, nperseg=2048, noverlap=2048 - HOP, boundary=None, padded=False)
M = np.abs(Z).astype(np.float32)
fr = SR / HOP
times = (np.arange(M.shape[1]) * HOP + 1024) / SR
L = np.log1p(100 * M)
# オンセットの強さ（スペクトルの増え方）
band = f < 8000
flux = np.maximum(0, np.diff(L[band], axis=1)).sum(axis=0)
flux = np.concatenate([[0], flux])
flux = flux - uniform_filter1d(flux, int(fr * 1.0))  # ゆっくりした変化をのぞく
flux = np.maximum(flux, 0)
flux /= flux.std() + 1e-9
low = np.maximum(0, np.diff(L[f < 160], axis=1)).sum(axis=0)
low = np.concatenate([[0], low])

# ---- テンポ（自己相関 → こまかく合わせる）----
ac = np.correlate(flux, flux, mode='full')[len(flux) - 1:]
lags = np.arange(len(ac))
bpm_of = lambda lag: 60 * fr / lag
cands = []
for bpm in np.arange(BMIN, BMAX, 0.5):
    lag = 60 * fr / bpm
    i = int(round(lag))
    v = ac[i - 1:i + 2].max()
    # 倍・半分のテンポも少し足す
    v2 = ac[int(round(lag * 2)) - 1:int(round(lag * 2)) + 2].max() if lag * 2 < len(ac) - 2 else 0
    cands.append((v + 0.5 * v2, bpm))
cands.sort(reverse=True)
print('coarse bpm top:', [(round(b, 1), round(float(v), 1)) for v, b in cands[:6]])


def fold_score(bpm):
    P = 60.0 / bpm
    ph = np.mod(times, P) / P
    nb = 60
    h = np.bincount(np.minimum((ph * nb).astype(int), nb - 1), weights=flux, minlength=nb)
    c = np.bincount(np.minimum((ph * nb).astype(int), nb - 1), minlength=nb)
    m = h / np.maximum(c, 1)
    k = int(np.argmax(m))
    return m[k] - m.mean(), (k + 0.5) / nb * P


best = None
for v, b0 in cands[:4]:
    for bpm in np.arange(b0 - 1.5, b0 + 1.5, 0.002):
        s, off = fold_score(bpm)
        if best is None or s > best[0]:
            best = (s, bpm, off)
s, bpm, off = best
print('fine bpm %.3f  phase %.4f s  sharpness %.3f' % (bpm, off, s))
# 整数のテンポに近ければ、整数にしておく（Suno の曲はたいてい整数）
for cand in (round(bpm), round(bpm * 2) / 2):
    sc, of2 = fold_score(cand)
    if abs(cand - bpm) < 0.06 and sc > s * 0.97:
        print('  -> use %.2f (score %.3f)' % (cand, sc))
        bpm, off, s = cand, of2, sc
        break
P = 60.0 / bpm
# 拍の位置（最初の拍）
t0 = off % P
beats = np.arange(t0, dur - P, P)
print('beats', len(beats), 'first %.3f' % t0)

# 拍ごとのずれ（局所的に合っているか）
def local_dev():
    devs = []
    for tb in beats[8:-8:8]:
        i0 = int((tb - 0.06) * fr)
        i1 = int((tb + 0.06) * fr)
        seg = flux[max(0, i0):i1]
        if len(seg) < 3 or seg.max() < 1.0:
            continue
        devs.append((np.argmax(seg) + i0) / fr - tb)
    return np.array(devs)
d = local_dev()
# 拍の位置を、実際の音の立ち上がりに合わせる
t0 = (t0 + float(np.median(d))) % P
beats = np.arange(t0, dur - P, P)
d2 = local_dev()
print('after phase fix: median %.1f ms' % (1000 * np.median(d2)))
print('beat alignment: median %.1f ms, abs-median %.1f ms, n=%d, early-half %.1f ms, late-half %.1f ms' % (
    1000 * np.median(d), 1000 * np.median(np.abs(d)), len(d), 1000 * np.median(d[:len(d) // 2]), 1000 * np.median(d[len(d) // 2:])))

# ---- 拍ごとの特徴（音色＝帯域のエネルギー、和音＝クロマ）----
nb = 24
edges = np.geomspace(60, 12000, nb + 1)
bands = [(f >= edges[i]) & (f < edges[i + 1]) for i in range(nb)]
E = np.stack([L[b].mean(axis=0) for b in bands])  # (24, frames)
# クロマ
freqs = f[1:]
pc = np.mod(np.round(12 * np.log2(freqs / 440.0)) + 9, 12).astype(int)
sel = (freqs > 80) & (freqs < 5000)
C = np.zeros((12, M.shape[1]), np.float32)
for k in range(12):
    C[k] = M[1:][sel & (pc == k)].sum(axis=0)
C = C / (C.sum(axis=0, keepdims=True) + 1e-9)
rms = np.sqrt((M ** 2).mean(axis=0))
feat_b, chroma_b, loud_b, lowon_b = [], [], [], []
for i in range(len(beats)):
    a = int(beats[i] * fr)
    b = int((beats[i] + P) * fr)
    feat_b.append(E[:, a:b].mean(axis=1))
    chroma_b.append(C[:, a:b].mean(axis=1))
    loud_b.append(20 * np.log10(rms[a:b].mean() + 1e-9))
    lowon_b.append(low[max(0, a - 2):a + 3].max())
F = np.array(feat_b)
Ch = np.array(chroma_b)
loud = np.array(loud_b)
lowon = np.array(lowon_b)
# 小節の頭：和音の変わり目（クロマの差）がいちばん多い拍の位置
nov = np.r_[0, np.linalg.norm(np.diff(Ch, axis=0), axis=1)]
ph_nov = [nov[k::4].mean() for k in range(4)]
ph_low = [lowon[k::4].mean() for k in range(4)]
down = int(np.argmax(np.array(ph_nov) / max(ph_nov) + 0.3 * np.array(ph_low) / max(ph_low)))
print('downbeat phase', down, 'novelty by phase', np.round(ph_nov, 3), 'low by phase', np.round(ph_low, 2))

# 特徴を正規化
Fz = (F - F.mean(axis=0)) / (F.std(axis=0) + 1e-9)
Cz = (Ch - Ch.mean(axis=0)) / (Ch.std(axis=0) + 1e-9)
G = np.concatenate([Fz, 0.8 * Cz], axis=1)
G /= np.linalg.norm(G, axis=1, keepdims=True) + 1e-9
S = G @ G.T  # 拍どうしの似ている度

# 大まかな構成（8小節ごとの音量）を表示
print('loudness per 4 bars (dB):')
row = []
for i in range(down, len(beats), 16):
    row.append('%5.1f@%5.1fs' % (loud[i:i + 16].mean(), beats[i]))
print('  ' + '  '.join(row))

json.dump({'bpm': bpm, 'P': P, 't0': t0, 'down': down, 'beats': beats.tolist(), 'dur': dur}, open(src.replace('_src.f32', '_beats.json'), 'w'))
np.save(src.replace('_src.f32', '_S.npy'), S)
np.save(src.replace('_src.f32', '_loud.npy'), loud)
