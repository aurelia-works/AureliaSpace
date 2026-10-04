"""Original score for the AureliaSpace launch video (50 s), synthesized from scratch.

Calm, warm ambient: a soft pad in D major, a plucked arpeggio, a low-passed pulse
and bell accents. The tempo is chosen so that the downbeat at 5.10 s (logo) and
the hard cuts at 37.0 / 38.7 / 40.4 s fall on beats (see TIMING.md).

    python3 audio/compose.py            # writes audio/score.wav (48 kHz stereo)

Deterministic: the noise generator is seeded.
"""

from pathlib import Path

import numpy as np

SR = 48_000
DUR = 50.0
N = int(SR * DUR)
T0 = 5.10                    # first downbeat (logo reveal)
BEAT = (37.0 - T0) / 56      # ≈0.5696 s → ≈105.3 BPM; 37.0 s is beat 56
BAR = 4 * BEAT
rng = np.random.default_rng(7)


def beat_t(b):
    return T0 + b * BEAT


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def place(buf, t, sig, pan=0.0, gain=1.0):
    """Mix a mono signal into the stereo buffer at time t with constant-power pan."""
    i = max(0, int(round(t * SR)))
    if i >= N:
        return
    j = min(N, i + len(sig))
    s = sig[: j - i]
    a = (pan + 1) * np.pi / 4
    buf[0, i:j] += s * np.cos(a) * gain
    buf[1, i:j] += s * np.sin(a) * gain


def env_ar(n, attack, release):
    e = np.ones(n)
    a = max(1, int(attack * SR))
    r = max(1, int(release * SR))
    e[:a] = np.linspace(0, 1, a) ** 2
    e[-r:] *= np.linspace(1, 0, r) ** 2
    return e


# Brightness of the pad over time (low-pass cutoff in Hz).
def cutoff(t):
    pts = [(0, 380), (4.8, 900), (5.1, 1900), (10.2, 2300), (24.0, 1500), (30.15, 2600),
           (42.1, 1700), (45.0, 2400), (50.0, 900)]
    xs, ys = zip(*pts)
    return np.interp(t, xs, ys)


CHORDS = [
    [50, 57, 61, 64, 66],  # Dmaj9
    [47, 54, 57, 62, 64],  # Bm11
    [43, 50, 54, 57, 59],  # Gmaj9 (add6)
    [45, 52, 59, 61, 64],  # A6/9
]


def chord_at(t):
    if t < T0:
        return CHORDS[0]
    return CHORDS[int((t - T0) // (2 * BAR)) % 4]


def pad(buf, start, end, notes, level):
    n = int((end - start + 1.6) * SR)
    tt = np.arange(n) / SR
    cut = cutoff(start + tt)
    e = env_ar(n, 1.1, 1.6)
    out = np.zeros(n)
    for m in notes:
        f0 = hz(m)
        for det in (-0.0035, 0.0035):
            f = f0 * (1 + det)
            ph = rng.uniform(0, 2 * np.pi)
            for k in range(1, 9):
                w = 1 / k ** 1.6 / (1 + (k * f / cut) ** 4)
                out += w * np.sin(2 * np.pi * k * f * tt + ph * k)
    out *= e * level / len(notes)
    # slow stereo movement
    lfo = 0.35 * np.sin(2 * np.pi * 0.07 * (start + tt))
    a = (lfo + 1) * np.pi / 4
    i = int(start * SR)
    j = min(N, i + n)
    buf[0, i:j] += (out * np.cos(a))[: j - i]
    buf[1, i:j] += (out * np.sin(a))[: j - i]


def pluck(f, dur=0.9, tau=0.2):
    n = int(dur * SR)
    tt = np.arange(n) / SR
    s = np.sin(2 * np.pi * f * tt) + 0.28 * np.sin(4 * np.pi * f * tt) + 0.08 * np.sin(6 * np.pi * f * tt)
    e = np.exp(-tt / tau)
    e[: int(0.004 * SR)] *= np.linspace(0, 1, int(0.004 * SR))
    return s * e


def bell(f, dur=3.2):
    n = int(dur * SR)
    tt = np.arange(n) / SR
    s = (np.sin(2 * np.pi * f * tt) * np.exp(-tt / 1.4)
         + 0.45 * np.sin(2 * np.pi * f * 2.76 * tt) * np.exp(-tt / 0.6)
         + 0.2 * np.sin(2 * np.pi * f * 5.40 * tt) * np.exp(-tt / 0.25))
    s[: int(0.003 * SR)] *= np.linspace(0, 1, int(0.003 * SR))
    return s


def kick():
    n = int(0.42 * SR)
    tt = np.arange(n) / SR
    f = 44 + 70 * np.exp(-tt / 0.035)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * np.exp(-tt / 0.16)


def sub(f, dur):
    n = int(dur * SR)
    tt = np.arange(n) / SR
    return np.sin(2 * np.pi * f * tt) * env_ar(n, 0.02, dur * 0.7)


def hat():
    n = int(0.05 * SR)
    x = rng.standard_normal(n)
    x = np.diff(np.concatenate([[0], x]))  # crude high-pass
    return x * np.exp(-np.arange(n) / SR / 0.012)


def riser(dur):
    n = int(dur * SR)
    x = rng.standard_normal(n)
    # progressively brighter noise: one-pole low-pass with a rising coefficient
    y = np.zeros(n)
    a = np.linspace(0.02, 0.35, n)
    acc = 0.0
    for i in range(n):  # short (≈1.7 s), fine in pure Python
        acc += a[i] * (x[i] - acc)
        y[i] = acc
    return y * np.linspace(0, 1, n) ** 2.5


def reverb(x, seconds=2.6, wet=0.26):
    n = int(seconds * SR)
    tt = np.arange(n) / SR
    out = np.empty_like(x)
    size = 1 << int(np.ceil(np.log2(x.shape[1] + n)))
    for ch in range(2):
        ir = rng.standard_normal(n) * np.exp(-tt / 0.75)
        ir[: int(0.012 * SR)] = 0  # pre-delay
        ir /= np.sqrt(np.sum(ir ** 2))
        y = np.fft.irfft(np.fft.rfft(x[ch], size) * np.fft.rfft(ir, size), size)[: x.shape[1]]
        out[ch] = x[ch] * (1 - wet) + y * wet * 2.2
    return out


def delay(x, t, fb=0.33, mix=0.28):
    d = int(t * SR)
    y = x.copy()
    for k in range(1, 6):
        g = fb ** k * mix
        sh = np.zeros_like(x)
        sh[:, d * k:] = x[:, : -d * k] if d * k < x.shape[1] else 0
        if k % 2:  # ping-pong
            sh = sh[::-1]
        y += sh * g
    return y


def main():
    pads = np.zeros((2, N))
    arp = np.zeros((2, N))
    drums = np.zeros((2, N))
    fx = np.zeros((2, N))

    # Pad: intro chord, then a chord every 2 bars from the downbeat.
    pad(pads, 0.0, T0 + 0.25, CHORDS[0], 0.28)
    t = T0
    while t < 47.5:
        end = min(t + 2 * BAR, 47.0)
        pad(pads, t, end, chord_at(t + 0.01), 0.55 if 24.0 <= t < 30.0 else 0.75)
        t += 2 * BAR
    pad(pads, beat_t(70), 49.6, CHORDS[0], 0.6)  # final ring

    # Arpeggio: 8ths from the grid split, softer through worktrees, gone by the end card.
    b = 9.0
    step = 0
    while beat_t(b) < 44.6:
        t = beat_t(b)
        notes = chord_at(t + 0.01)
        tones = sorted(notes[2:]) + [notes[2] + 12, notes[3] + 12]
        order = [0, 2, 1, 3, 2, 4, 3, 1]
        m = tones[order[step % 8]] + 12
        lvl = 0.16 if t < 24.0 else 0.11 if t < 30.15 else 0.15 if t < 42.1 else 0.08
        place(arp, t, pluck(hz(m)), pan=-0.45 if step % 2 else 0.45, gain=lvl)
        b += 0.5
        step += 1
    arp = delay(arp, 0.75 * BEAT)

    # Pulse: soft kick + sub from the grid (beat 9), out for worktrees, back at review.
    for bi in range(9, 70):
        t = beat_t(bi)
        if 24.0 <= t < beat_t(44) - 0.01 or t >= beat_t(65):
            continue
        place(drums, t, kick(), gain=0.42)
        if bi % 2 == 1:
            root = chord_at(t + 0.01)[0]
            place(drums, t, sub(hz(root - 12), 2 * BEAT), gain=0.3)
    for bi in range(44, 65):  # off-beat hats through the review + quick cuts
        place(drums, beat_t(bi + 0.5), hat(), pan=0.3, gain=0.05)

    # Riser into the logo, bells on the hits.
    place(fx, T0 - 1.7, riser(1.7), gain=0.11)
    hits = [(T0, 74), (beat_t(9), 81), (beat_t(22), 78), (beat_t(27.5), 76), (beat_t(31.5), 81),
            (beat_t(44), 74), (beat_t(56), 81), (beat_t(59), 78), (beat_t(62), 76), (beat_t(70), 74)]
    for t, m in hits:
        place(fx, t, bell(hz(m)), pan=0.15, gain=0.22)
        place(fx, t, bell(hz(m + 7)), pan=-0.2, gain=0.1)
    for t in (T0, beat_t(44), beat_t(70)):
        place(fx, t, sub(hz(38), 2.2), gain=0.45)

    mix = reverb(pads * 0.9 + arp + fx) + drums
    tt = np.arange(N) / SR
    mix *= np.clip((DUR - tt) / 0.65, 0, 1) ** 1.5  # follows the 49.35–50 s fade to black
    mix = np.tanh(mix * 1.2) / 1.2
    mix /= np.max(np.abs(mix)) / 0.89

    out = Path(__file__).with_name("score.wav")
    pcm = (mix.T * 32767).astype("<i2")
    import wave

    with wave.open(str(out), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print(f"wrote {out}  tempo={60 / BEAT:.2f} BPM")


if __name__ == "__main__":
    main()
