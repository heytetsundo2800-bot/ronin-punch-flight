# Suno の曲から、つなぎ目のない BGM ファイルを作る
#   ファイル = [曲のはじめ〜A][A〜B（B の直前1拍を、A の直前1拍へ重ねて切りかえ）][A のあとの0.5秒]
#   ゲームは 0 秒から鳴らして、B まで来たら A へもどる（loopStart=A, loopEnd=B）
#   デコーダーのずれ（AAC・MP3 の頭の無音）があっても、重ねた1拍のぶんまではつなぎ目がずれない
#   python3 make_loop.py lobby 11 235
import sys, json, subprocess
import numpy as np

SR = 44100
name = sys.argv[1]
ia, ib = int(sys.argv[2]), int(sys.argv[3])
XB = float(sys.argv[4]) if len(sys.argv) > 4 else 1.0  # 重ねる長さ（拍）
J = json.load(open(name + '_beats.json'))
beats = np.array(J['beats']); P = J['P']
x = np.fromfile(name + '_src.f32', dtype=np.float32).reshape(-1, 2).astype(np.float64)
mono = x.mean(axis=1)

# ---- 細かい位置合わせ：A と B の直前の「音の立ち上がり」がいちばん重なるように B をずらす ----
H = 64
def env(t0, t1):
    a, b = int(t0 * SR), int(t1 * SR)
    seg = mono[a:b]
    w = 512
    E = []
    prev = None
    for i in range(0, len(seg) - w, H):
        X = np.log1p(30 * np.abs(np.fft.rfft(seg[i:i + w] * np.hanning(w)))[:180])
        E.append(0 if prev is None else np.maximum(0, X - prev).sum())
        prev = X
    E = np.array(E)
    return (E - E.mean()) / (E.std() + 1e-9)

tA, tB = beats[ia], beats[ib]
W = 4 * P  # 1小節ぶん見る
ea = env(tA - W, tA + 0.05)
best = (-1e9, 0)
for d in range(-40, 41):  # ±40×64サンプル ≒ ±58ms
    dt = d * H / SR
    eb = env(tB - W + dt, tB + 0.05 + dt)
    m = min(len(ea), len(eb))
    c = float(np.dot(ea[:m], eb[:m]) / m)
    if c > best[0]:
        best = (c, d)
# さらに 1 サンプル単位（波形の相関）で細かく
dt0 = best[1] * H / SR
sA = int(round(tA * SR))
sB0 = int(round((tB + dt0) * SR))
win = int(XB * P * SR)
ref = mono[sA - win:sA]
bestf = (-1e9, 0)
for d in range(-H, H + 1):
    seg = mono[sB0 + d - win:sB0 + d]
    c = float(np.dot(ref, seg) / (np.linalg.norm(ref) * np.linalg.norm(seg) + 1e-12))
    if c > bestf[0]:
        bestf = (c, d)
sB = sB0 + bestf[1]
print('%s: A %.4fs  B %.4fs (grid %.4fs, shift %+.1f ms)  onset-corr %.3f  wave-corr %.3f' % (name, sA / SR, sB / SR, tB, (sB / SR - tB) * 1000, best[0], bestf[0]))

N = sB - sA
nX = int(XB * P * SR)
body = x[sA:sB].copy()
# 重ねて切りかえ（合計が1になる形）：B の直前 → A の直前
r = 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, nX))[:, None]
body[-nX:] = x[sB - nX:sB] * (1 - r) + x[sA - nX:sA] * r
pre = x[:sA]
post = x[sA:sA + int(0.5 * SR)]
y = np.concatenate([pre, body, post])
peak = np.abs(y).max()
print('length %.2fs  loop %.3f..%.3f  peak %.3f' % (len(y) / SR, sA / SR, sB / SR, peak))
if peak > 0.999:
    y *= 0.999 / peak
out = name + '_loop.f32'
y.astype(np.float32).tofile(out)

# ---- つなぎ目のチェック：ループを2回まわした音を作って、つなぎ目の前後を見る ----
def seam_report(buf, ls, le, tag):
    # buf：デコードした音。ls・le：ループの位置（サンプル）
    a = buf[le - 3 * SR:le]
    b = buf[ls:ls + 3 * SR]
    z = np.concatenate([a, b]).mean(axis=1)
    jump = abs(z[3 * SR] - z[3 * SR - 1])
    d = np.abs(np.diff(z))
    pct = (d < jump).mean() * 100
    # 10ms ごとの音量の変化
    fr = int(0.01 * SR)
    rms = np.sqrt(np.convolve(z ** 2, np.ones(fr) / fr, mode='valid'))[::fr]
    db = 20 * np.log10(rms + 1e-9)
    k = 3 * SR // fr
    around = db[k - 5:k + 5]
    print('  [%s] sample step at seam %.4f (larger than %.1f%% of steps)  level around seam (dB): %s' % (tag, jump, pct, ' '.join('%.1f' % v for v in around)))

seam_report(y, sA, sB, 'pcm')
json.dump({'start': sA / SR, 'end': sB / SR, 'len': len(y) / SR, 'bpm': J['bpm']}, open(name + '_loop.json', 'w'))
