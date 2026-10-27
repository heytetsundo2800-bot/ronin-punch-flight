# ループの区間 [A, B) を決める（つなぎ目＝B の直前を A の直前へ重ねて切りかえる方式）
#   大事なのは「A の直前」と「B の直前」が似ていること（重ねるところ）。拍・小節の位置もそろえる
#   python3 loop_search2.py lobby 50 150
import sys, json
import numpy as np

name = sys.argv[1]
LMIN = float(sys.argv[2]) if len(sys.argv) > 2 else 50
BMAX = float(sys.argv[3]) if len(sys.argv) > 3 else 150
J = json.load(open(name + '_beats.json'))
S = np.load(name + '_S.npy')
loud = np.load(name + '_loud.npy')
beats = np.array(J['beats']); P = J['P']; down = J['down']
n = len(beats)
x = np.fromfile(name + '_src.f32', dtype=np.float32).reshape(-1, 2)
SR = 44100
mono = x.mean(axis=1)

# こまかいスペクトル（重ねるところの似ている度を、フレーム単位で見る）
def spec(t0, t1):
    a, b = int(t0 * SR), int(t1 * SR)
    seg = mono[a:b]
    w = 2048; h = 512
    fr = []
    for i in range(0, len(seg) - w, h):
        X = np.abs(np.fft.rfft(seg[i:i + w] * np.hanning(w)))[:700]
        fr.append(np.log1p(50 * X))
    return np.array(fr)

def xsim(ta, tb, dur):
    A = spec(ta - dur, ta); B = spec(tb - dur, tb)
    m = min(len(A), len(B))
    A, B = A[:m], B[:m]
    A = A - A.mean(axis=1, keepdims=True); B = B - B.mean(axis=1, keepdims=True)
    num = (A * B).sum(axis=1); den = np.linalg.norm(A, axis=1) * np.linalg.norm(B, axis=1) + 1e-9
    return float(np.mean(num / den))

bars = list(range(down, n, 4))
res = []
for a in bars:
    if a < 8:
        continue
    for b in bars:
        L = (b - a) * P
        if L < LMIN or beats[b] > BMAX:
            continue
        bn = np.mean([S[a - k, b - k] for k in range(1, 5)])  # 直前1小節
        bf = np.mean([S[a - k, b - k] for k in range(1, 17)])  # 直前4小節
        an = np.mean([S[a + k, b + k] for k in range(0, 8)]) if b + 8 < n else 0  # 直後2小節（流れの自然さ）
        sc = 1.0 * bn + 0.5 * bf + 0.3 * an + 0.002 * L
        res.append((sc, a, b, bn, bf, an, L))
res.sort(reverse=True)
seen = []
out = []
for sc, a, b, bn, bf, an, L in res:
    if any(abs(a - p) < 8 and abs(b - q) < 8 for p, q in seen):
        continue
    seen.append((a, b))
    fx = xsim(beats[a], beats[b], 2 * P)  # 重ねる2拍ぶんのスペクトルの似ている度
    out.append((sc, a, b, bn, bf, an, L, fx))
    if len(out) >= 10:
        break
out.sort(key=lambda r: -(r[0] + 1.5 * r[7]))
for sc, a, b, bn, bf, an, L, fx in out:
    print('total %.3f  A=beat %d %.2fs  B=beat %d %.2fs  len %.1fs | before1bar %.3f before4 %.3f after2 %.3f | spectral(xfade 2 beats) %.3f' % (sc + 1.5 * fx, a, beats[a], b, beats[b], L, bn, bf, an, fx))
