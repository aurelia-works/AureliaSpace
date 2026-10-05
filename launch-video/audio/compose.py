"""Original score for the AureliaSpace launch video: "anthem x soul".

Inspired by (not copied from) two moods: a European football anthem, with its
string ostinatos, choir, brass swells and timpani rolls, and a soul-sample
hip-hop production, with a lo-fi Rhodes on minor-ninth chords, boom-bap drums,
chopped vocal stabs, vinyl crackle and a crying guitar solo on the outro. Every
melody, progression and sound here is original and synthesized from scratch
with numpy. No samples, no quoted melodies.

D minor, resolving to D major on the end card. The tempo is locked to the
video: 105.33 BPM, beat 0 = 5.10 s (logo), beat 56 = 37.0 s (first quick cut).

    python3 audio/compose.py      # writes audio/score.wav (48 kHz stereo)

Deterministic: all randomness is seeded.
"""

import wave
from pathlib import Path

import numpy as np

SR = 48_000
DUR = 50.0
N = int(SR * DUR)
T0 = 5.10
BEAT = (37.0 - T0) / 56
BAR = 4 * BEAT
rng = np.random.default_rng(11)


def bt(b):
    """Time of beat b (beat 0 = logo hit)."""
    return T0 + b * BEAT


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def tvec(dur):
    return np.arange(int(dur * SR)) / SR


def new_bus():
    return np.zeros((2, N))


def place(bus, t, sig, pan=0.0, gain=1.0):
    i = max(0, int(round(t * SR)))
    if i >= N or len(sig) == 0:
        return
    j = min(N, i + len(sig))
    s = sig[: j - i] * gain
    a = (np.clip(pan, -1, 1) + 1) * np.pi / 4
    bus[0, i:j] += s * np.cos(a)
    bus[1, i:j] += s * np.sin(a)


def ar(n, attack, release, curve=2.0):
    e = np.ones(n)
    a = min(n, max(1, int(attack * SR)))
    r = min(n, max(1, int(release * SR)))
    e[:a] *= np.linspace(0, 1, a) ** curve
    e[n - r:] *= np.linspace(1, 0, r) ** curve
    return e


def shelf(x, fc, gain_db):
    """Zero-phase high shelf above fc."""
    n = x.shape[-1]
    f = np.fft.rfftfreq(n, 1 / SR)
    g = 10 ** (gain_db / 20)
    m = 1 + (g - 1) * f ** 2 / (f ** 2 + fc ** 2)
    return np.fft.irfft(np.fft.rfft(x, axis=-1) * m, n, axis=-1)


def eq(x, lo=None, hi=None, order=2):
    """Zero-phase high/low-pass on a whole bus (FFT mask)."""
    n = x.shape[-1]
    X = np.fft.rfft(x, axis=-1)
    f = np.fft.rfftfreq(n, 1 / SR)
    m = np.ones_like(f)
    if hi:
        m /= np.sqrt(1 + (f / hi) ** (2 * order))
    if lo:
        m /= np.sqrt(1 + (lo / np.maximum(f, 1e-3)) ** (2 * order))
    return np.fft.irfft(X * m, n, axis=-1)


# ---------------------------------------------------------------- harmony

# Voicings: (bass midi, [upper voices]). Minor-9th soul colours over an anthem cadence.
DM9 = (38, [57, 60, 64, 65])     # D  - A C E F
BBMAJ9 = (34, [57, 60, 62, 65])  # Bb - A C D F
GM9 = (43, [58, 62, 65, 69])     # G  - Bb D F A
A7B9 = (33, [55, 61, 64, 70])    # A  - G C# E Bb
A7SUS = (33, [55, 62, 64, 69])   # A  - G D E A
DMAJ9 = (38, [54, 57, 61, 64])   # D  - F# A C# E (the lift)
CYCLE = [DM9, BBMAJ9, GM9, A7B9]


def chord_at(t):
    if t < 2.55:
        return DM9
    if t < 4.0:
        return BBMAJ9
    if t < T0:
        return A7SUS
    b = (t - T0) / BEAT
    if b >= 70:
        return DMAJ9
    if b >= 68:
        return A7B9
    if b >= 66:
        return GM9
    if b >= 64:
        return BBMAJ9
    return CYCLE[int(b // 8) % 4]


# ---------------------------------------------------------------- instruments

def additive(f, dur, weights, vib_depth=0.0, vib_rate=5.5, vib_delay=0.25, cut=None, maxf=9000, phase=0.0):
    """Sum of harmonics with optional delayed vibrato and a time-varying low-pass `cut`."""
    t = tvec(dur)
    vib = vib_depth * np.sin(2 * np.pi * vib_rate * t + phase) * np.clip((t - vib_delay) / 0.4, 0, 1)
    ph = 2 * np.pi * np.cumsum(f * (1 + vib)) / SR + phase
    out = np.zeros_like(t)
    K = max(1, int(maxf // f))
    for k in range(1, K + 1):
        w = weights(k, k * f)
        if w < 1e-4:
            continue
        if cut is not None:
            w = w / (1 + (k * f / cut) ** 4)
        out += w * np.sin(k * ph)
    return out


def saw_w(k, fk):
    return 1.0 / k


VOWELS = {
    "a": [(730, 160, 1.0), (1090, 180, 0.55), (2440, 220, 0.25), (3400, 300, 0.08)],
    "o": [(500, 130, 1.0), (850, 160, 0.5), (2600, 220, 0.12)],
    "u": [(330, 110, 1.0), (800, 160, 0.22), (2400, 220, 0.05)],
}


def vowel_w(v):
    fm = VOWELS[v]
    return lambda k, fk: sum(g * np.exp(-0.5 * ((fk - F) / bw) ** 2) for F, bw, g in fm) + 0.015 / k


def choir_note(m, dur, vowel="a", attack=0.6, release=0.9, voices=4):
    f0 = hz(m)
    out = np.zeros(int((dur + release) * SR))
    for v in range(voices):
        cents = (v - (voices - 1) / 2) * 7
        f = f0 * 2 ** (cents / 1200)
        s = additive(f, dur + release, vowel_w(vowel), vib_depth=0.0055, vib_rate=4.8 + 0.37 * v,
                     vib_delay=0.15, phase=v * 1.7, maxf=5000)
        out += s
    return out * ar(len(out), attack, release, 1.6) / voices


def strings_note(m, dur, attack=0.35, release=0.5, cut=2600, vib=0.003):
    f0 = hz(m)
    out = np.zeros(int((dur + release) * SR))
    for v, c in enumerate((-6, 0, 6)):
        f = f0 * 2 ** (c / 1200)
        out += additive(f, dur + release, saw_w, vib_depth=vib, vib_rate=5.3 + 0.4 * v, cut=cut, phase=v * 2.1, maxf=8000)
    return out * ar(len(out), attack, release, 1.5) / 3


def brass_note(m, dur, swell=True):
    f0 = hz(m)
    n_dur = dur + 0.35
    t = tvec(n_dur)
    cut = 450 + 2800 * (np.clip(t / dur, 0, 1) ** 1.8 if swell else np.exp(-t / 0.35) * 0.8 + 0.25)
    out = np.zeros_like(t)
    for c in (-4, 4):
        out += additive(f0 * 2 ** (c / 1200), n_dur, saw_w, vib_depth=0.002, vib_rate=5, cut=cut, maxf=7000)
    env = (np.clip(t / dur, 0, 1) ** 2.2) if swell else ar(len(t), 0.02, 0.3, 1.2) * np.exp(-t / 0.9)
    if swell:
        env = env * ar(len(t), 0.0, 0.3, 1.0)
    return out * env / 2


def timpani(m, gain=1.0):
    f0 = hz(m)
    t = tvec(2.4)
    fdrift = f0 * (1 + 0.05 * np.exp(-t / 0.04))
    ph = 2 * np.pi * np.cumsum(fdrift) / SR
    s = (np.sin(ph) * np.exp(-t / 0.9) + 0.5 * np.sin(1.5 * ph) * np.exp(-t / 0.5)
         + 0.32 * np.sin(1.98 * ph) * np.exp(-t / 0.4) + 0.18 * np.sin(2.44 * ph) * np.exp(-t / 0.25))
    thump = np.cumsum(rng.standard_normal(len(t))) * np.exp(-t / 0.018)
    thump /= np.max(np.abs(thump)) + 1e-9
    return (s + 0.35 * thump) * gain


def timp_roll(bus, m, a, b, g0=0.08, g1=0.75):
    t = a
    i = 0
    while t < b:
        p = (t - a) / (b - a)
        place(bus, t, timpani(m)[: int(0.5 * SR)] * ar(int(0.5 * SR), 0.002, 0.2), pan=0.1 * (-1) ** i,
              gain=g0 * (g1 / g0) ** p)
        t += 0.062 + 0.006 * np.sin(i * 1.7)
        i += 1


def rhodes(m, dur, vel=0.8):
    f = hz(m)
    t = tvec(dur + 0.35)
    idx = 1.6 * vel * np.exp(-t / 0.22) + 0.25
    s = np.sin(2 * np.pi * f * t + idx * np.sin(2 * np.pi * f * t))
    s *= np.exp(-t / 1.7)
    s += 0.12 * vel * np.sin(2 * np.pi * f * 7.02 * t) * np.exp(-t / 0.035)
    trem = 1 + 0.12 * np.sin(2 * np.pi * 4.6 * t)
    return s * trem * ar(len(t), 0.003, 0.3, 1.3) * vel


def rhodes_chord(bus, t, chord, dur, vel=0.8, spread=0.012):
    bass, ups = chord
    for i, m in enumerate([bass + 24] + ups):
        place(bus, t + i * spread, rhodes(m, dur, vel), pan=-0.35 + 0.7 * i / 4, gain=0.22)


def kick():
    t = tvec(0.5)
    f = 48 + 95 * np.exp(-t / 0.028)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.3)
    s += 0.25 * rng.standard_normal(len(t)) * np.exp(-t / 0.003)
    return np.tanh(1.6 * s)


def snare():
    t = tvec(0.4)
    tone = 0.55 * np.sin(2 * np.pi * 186 * t) * np.exp(-t / 0.07) + 0.25 * np.sin(2 * np.pi * 330 * t) * np.exp(-t / 0.05)
    nz = np.diff(np.concatenate([[0], rng.standard_normal(len(t))])) * np.exp(-t / 0.13)
    return tone + 0.55 * nz


def hat(open_=False):
    t = tvec(0.3 if open_ else 0.08)
    nz = np.diff(np.diff(np.concatenate([[0, 0], rng.standard_normal(len(t))])))
    return 0.35 * nz * np.exp(-t / (0.11 if open_ else 0.022))


def crash():
    t = tvec(3.0)
    nz = np.diff(np.concatenate([[0], rng.standard_normal(len(t))]))
    return 0.5 * nz * np.exp(-t / 1.1) * ar(len(t), 0.004, 0.5)


def bass_note(m, dur):
    f = hz(m)
    t = tvec(dur + 0.08)
    s = np.sin(2 * np.pi * f * t) + 0.22 * np.sin(4 * np.pi * f * t) + 0.08 * np.sin(6 * np.pi * f * t)
    return np.tanh(1.3 * s) * ar(len(t), 0.008, 0.08) * (0.75 + 0.25 * np.exp(-t / 0.25))


def vocal_chop(m, dur, vowel):
    """A short pitched 'oh/ah' with a soul scoop into the note."""
    f0 = hz(m)
    t = tvec(dur + 0.08)
    scoop = 2 ** (-1.2 / 12 * np.exp(-t / 0.045))
    ph = 2 * np.pi * np.cumsum(f0 * scoop * (1 + 0.004 * np.sin(2 * np.pi * 5.6 * t))) / SR
    w = vowel_w(vowel)
    out = np.zeros_like(t)
    for k in range(1, int(5000 // f0) + 1):
        out += w(k, k * f0) * np.sin(k * ph)
    return out * ar(len(t), 0.012, 0.07, 1.3)


def lead_phrase(notes, start):
    """Overdriven guitar-ish lead. notes: (beat_offset, midi, beats, bend_from, vib)."""
    t_end = bt(start + max(b + d for b, _, d, _, _ in notes)) + 1.6
    t0 = bt(start)
    n = int((t_end - t0) * SR)
    t = np.arange(n) / SR
    freq = np.zeros(n)
    amp = np.zeros(n)
    for b, m, d, bend, vib in notes:
        i0 = int((bt(start + b) - t0) * SR)
        i1 = min(n, int((bt(start + b + d) - t0) * SR) + int(0.04 * SR))
        tt = t[: i1 - i0]
        target = hz(m)
        f = target * np.ones_like(tt)
        if bend is not None:
            src = hz(bend)
            f = src + (target - src) * np.clip(tt / 0.12, 0, 1) ** 0.6
        depth = vib * np.clip((tt - 0.18) / 0.35, 0, 1)
        f = f * (1 + depth * np.sin(2 * np.pi * 5.8 * tt))
        freq[i0:i1] = f
        a = np.exp(-tt / (2.2 if d > 1.5 else 1.4)) * 0.85 + 0.15
        amp[i0:i1] = np.maximum(amp[i0:i1], a * ar(len(tt), 0.006, 0.05, 1.0))
    # hold the last pitch through the tail
    last = np.max(np.nonzero(freq)) if np.any(freq) else 0
    freq[last:] = freq[last - 1] if last else 0
    freq[freq == 0] = np.max(freq)
    ph = 2 * np.pi * np.cumsum(freq) / SR
    s = np.zeros(n)
    for k in range(1, 26):
        s += (1 / k) * (1.25 if k % 2 else 1.0) * np.sin(k * ph)
    s = np.tanh(3.2 * s * amp) * (amp > 0.01)
    tail = np.clip((t_end - 1.0 - (t0 + t)) / 1.0, 0, 1)
    return s * tail


def reverb(x, seconds, decay, wet, seed):
    r = np.random.default_rng(seed)
    n = int(seconds * SR)
    t = np.arange(n) / SR
    size = 1 << int(np.ceil(np.log2(x.shape[1] + n)))
    out = np.empty_like(x)
    for ch in range(2):
        ir = r.standard_normal(n) * np.exp(-t / decay)
        ir[: int(0.015 * SR)] = 0
        ir /= np.sqrt(np.sum(ir ** 2))
        y = np.fft.irfft(np.fft.rfft(x[ch], size) * np.fft.rfft(ir, size), size)[: x.shape[1]]
        out[ch] = y
    return x * (1 - wet) + out * wet * 2.0


def delay(x, secs, fb=0.35, mix=0.3, taps=5):
    d = int(secs * SR)
    y = x.copy()
    for k in range(1, taps + 1):
        sh = np.zeros_like(x)
        sh[:, d * k:] = x[:, : -d * k]
        if k % 2:
            sh = sh[::-1]
        y += sh * mix * fb ** (k - 1)
    return y


# ---------------------------------------------------------------- arrangement

def main():
    orch = new_bus()     # strings, choir, brass -> hall
    perc = new_bus()     # timpani, crashes -> hall (less)
    keys = new_bus()     # rhodes -> lo-fi
    radio = new_bus()    # intro rhodes -> narrow band
    drums = new_bus()    # boom-bap -> room
    bass = new_bus()
    chops = new_bus()    # vocal chops -> lo-fi + delay
    lead = new_bus()

    # --- 0–5.1 hook: a soul chord through an old radio, then the anthem builds.
    rhodes_chord(radio, 0.45, DM9, 2.0, 0.75)
    rhodes_chord(radio, 2.55, BBMAJ9, 1.4, 0.7)
    rhodes_chord(radio, 4.0, A7SUS, 1.0, 0.55)
    for m in (57, 62, 64, 69):
        place(orch, 2.9, choir_note(m, T0 - 2.9, "a", attack=2.0, release=0.25), pan=0.0, gain=0.55)
    for m in (45, 52, 57):
        place(orch, 3.7, brass_note(m, T0 - 3.7, swell=True), gain=0.42)
    timp_roll(perc, 33, 3.55, T0 - 0.03)

    # --- hits: timpani, crash, brass stab, choir
    def big_hit(t, chord, choir=True, size=1.0):
        bass_m, ups = chord
        place(perc, t, timpani(bass_m + 12 if bass_m < 36 else bass_m), gain=0.9 * size)
        place(perc, t, crash(), pan=0.25, gain=0.32 * size)
        for m in [bass_m + 12] + ups[:3]:
            place(orch, t, brass_note(m, 0.9, swell=False), gain=0.36 * size)
        if choir:
            for m in ups:
                place(orch, t, choir_note(m + 12, 3.0, "a", attack=0.05, release=1.4), gain=0.36 * size)

    big_hit(T0, DM9)
    big_hit(bt(9), chord_at(bt(9) + 0.01), choir=False, size=0.75)
    big_hit(bt(44), chord_at(bt(44) + 0.01), size=0.9)
    for b in (22, 27.5, 56, 59, 62):  # attention, ⌘J, and the three quick cuts
        c = chord_at(bt(b) + 0.01)
        place(perc, bt(b), timpani(c[0] + 12 if c[0] < 36 else c[0]), gain=0.55)
        for m in c[1][1:]:
            place(orch, bt(b), brass_note(m, 0.5, swell=False), gain=0.24)
        place(perc, bt(b), crash()[: int(1.2 * SR)], pan=-0.3, gain=0.12)

    # --- strings: legato chords all the way through (anthem bed)
    t = T0
    while t < bt(70):
        b = (t - T0) / BEAT
        step = 2 if b >= 64 else 8
        c = chord_at(t + 0.01)
        lvl = 0.30 if t < bt(9) else 0.2 if t < 24.0 else 0.26 if t < bt(44) else 0.22 if t < bt(64) else 0.32
        for m in c[1]:
            place(orch, t, strings_note(m, step * BEAT + 0.05, attack=0.4 if t > T0 else 0.08), gain=lvl, pan=(m - 62) / 14)
        t += step * BEAT
    for m in DMAJ9[1] + [DMAJ9[1][1] + 12]:
        place(orch, bt(70), strings_note(m, 4.0, attack=0.05, release=1.2), gain=0.26, pan=(m - 62) / 14)

    # --- low-string ostinato (the anthem drive): 8ths, then 16ths for the review/cuts
    b = 3.0
    i = 0
    while b < 64:
        t = bt(b)
        if 24.0 <= t < bt(41):  # breathes out during the worktrees section
            b += 0.5
            i += 1
            continue
        c = chord_at(t + 0.01)
        root = c[0] + 12 if c[0] < 40 else c[0]
        pat = [root, root + 7, root + 12, root + 7]
        sixteenths = b >= 44
        step = 0.25 if sixteenths else 0.5
        m = pat[i % 4]
        acc = 1.0 if i % 4 == 0 else 0.7
        lvl = (0.06 + 0.1 * min(1, (b - 3) / 6)) if b < 9 else 0.16 if b < 44 else 0.19
        place(orch, t, strings_note(m, step * BEAT * 0.8, attack=0.008, release=0.07, cut=1700, vib=0.0),
              gain=lvl * acc, pan=-0.25)
        b += step
        i += 1

    # --- choir pads under the body, swelling into the end
    for (a, z, v, g) in [(bt(9), 24.0, "o", 0.14), (24.0, bt(44), "u", 0.22), (bt(44), bt(64), "o", 0.13)]:
        t = a
        while t < z - 0.1:
            c = chord_at(t + 0.01)
            nxt = min(z, T0 + (np.floor((t - T0) / BEAT / 8) + 1) * 8 * BEAT)
            for m in c[1][:3]:
                place(orch, t, choir_note(m + 12, nxt - t, v, attack=0.5, release=0.6), gain=g)
            t = nxt
    for m in (57, 64, 69, 73):  # pull-back crescendo on A
        place(orch, bt(64), choir_note(m, bt(70) - bt(64), "a", attack=2.5, release=0.1), gain=0.42)
    timp_roll(perc, 33, bt(66.5), bt(70) - 0.03, g0=0.06, g1=0.7)
    timp_roll(perc, 33, 29.35, bt(44) - 0.03, g0=0.05, g1=0.45)
    timp_roll(perc, 38, 9.35, bt(9) - 0.03, g0=0.04, g1=0.4)

    # --- the end card: D major lift
    big_hit(bt(70), DMAJ9, size=0.9)
    for m in DMAJ9[1] + [DMAJ9[1][0] + 12, DMAJ9[1][2] + 12]:
        place(orch, bt(70) + 0.05, choir_note(m + 12 if m < 60 else m, 3.6, "a", attack=0.08, release=1.3), gain=0.22)
    rhodes_chord(keys, bt(73), DMAJ9, 2.6, 0.6)

    # --- soul section: Rhodes chops, bass, boom-bap
    for bar in range(int(9 // 4), 16):  # bars from beat 8 to beat 64
        for (ob, d, vel) in [(0, 1.25, 0.9), (1.75, 0.55, 0.6), (2.5, 1.0, 0.8), (3.5, 0.4, 0.5)]:
            b = bar * 4 + ob
            if b < 9 or b >= 64:
                continue
            t = bt(b)
            g = 0.7 if 24.0 <= t < bt(44) else 1.0
            rhodes_chord(keys, t, chord_at(t + 0.01), d * BEAT, vel * g)

    for bar in range(2, 16):
        for (ob, d) in [(0, 1.4), (1.75, 0.5), (2.5, 0.9), (3.5, 0.35)]:
            b = bar * 4 + ob
            t = bt(b)
            if b < 9 or b >= 64 or 24.0 <= t < bt(44):
                continue
            root = chord_at(t + 0.01)[0]
            m = root if ob != 3.5 else root + 7
            place(bass, t, bass_note(m, d * BEAT), gain=0.5)

    swing = 0.09  # of a beat, on the off-8ths
    for bar in range(2, 16):
        for ob in [0, 1.75, 2.5]:  # kick
            b = bar * 4 + ob
            t = bt(b)
            if b < 9 or b >= 64 or 24.0 <= t < bt(44):
                continue
            place(drums, t, kick(), gain=0.75)
        for ob in [1, 3]:  # snare
            b = bar * 4 + ob
            t = bt(b)
            if b < 9 or b >= 64 or 24.0 <= t < bt(44):
                continue
            place(drums, t, snare(), pan=0.05, gain=0.5)
        for e in range(8):  # hats (kept, softer, through the breakdown)
            b = bar * 4 + e * 0.5 + (swing if e % 2 else 0)
            t = bt(b)
            if b < 9 or b >= 64:
                continue
            g = 0.18 if e % 2 else 0.26
            if 24.0 <= t < bt(44):
                g *= 0.6
            place(drums, t, hat(open_=(e == 7 and bar % 2)), pan=0.3, gain=g)

    # --- vocal chops: an original soul hook, from the attention beat on
    HOOK = [(0.5, 69, "o", 0.35), (1.5, 72, "a", 0.3), (2.0, 74, "o", 0.6), (3.5, 72, "o", 0.25),
            (4.5, 77, "a", 0.3), (5.0, 76, "o", 0.5), (6.0, 74, "o", 0.3), (7.0, 69, "a", 0.45)]
    for start in range(16, 64, 8):
        for ob, m, v, d in HOOK:
            b = start + ob
            t = bt(b)
            if b < 21.5 or 24.0 <= t < bt(44) or b >= 64:
                continue
            place(chops, t, vocal_chop(m, d * BEAT, v), pan=0.2 * np.sin(b), gain=0.3)

    # --- the guitar solo over the pull-back and end card (original line)
    SOLO = [(0.0, 74, 0.5, 72, 0.004), (0.5, 77, 0.5, None, 0.0), (1.0, 76, 1.0, None, 0.006),
            (2.0, 74, 0.5, None, 0.0), (2.5, 70, 0.5, None, 0.0), (3.0, 73, 1.0, 72, 0.008),
            (4.0, 76, 0.5, None, 0.0), (4.5, 79, 0.5, None, 0.004), (5.0, 78, 3.0, 76, 0.012),
            (8.0, 76, 0.5, None, 0.0), (8.5, 74, 0.5, None, 0.0), (9.0, 69, 1.5, None, 0.008),
            (10.5, 66, 1.8, 64, 0.01)]
    place(lead, bt(65), lead_phrase(SOLO, 65), pan=0.12, gain=0.16)

    # --- vinyl crackle, loudest under the hook
    crk = np.zeros(N)
    pops = rng.random(N) < 0.0009
    crk[pops] = rng.standard_normal(np.count_nonzero(pops)) * 0.6
    crk = np.diff(np.concatenate([[0], crk])) + 0.012 * eq(rng.standard_normal((1, N)), lo=900, hi=5000)[0]
    tt = np.arange(N) / SR
    crk *= np.interp(tt, [0, 4.9, 5.4, 9.8, 10.3, 49.5, 50], [1.0, 1.0, 0.25, 0.25, 0.5, 0.5, 0])
    place(keys, 0, crk, gain=0.09)

    # ---------------------------------------------------------------- mix
    radio = np.tanh(2.2 * eq(radio, lo=380, hi=2400, order=3)) * 0.9
    keys = np.tanh(1.4 * eq(keys, lo=110, hi=3800))
    chops = delay(eq(np.tanh(1.5 * chops), lo=260, hi=4200), 0.75 * BEAT, fb=0.4, mix=0.3)
    lead = delay(eq(lead, lo=180, hi=4200), 0.75 * BEAT, fb=0.35, mix=0.22)

    # gentle pump: duck keys/bass/chops under the kick for the hip-hop feel
    duck = np.ones(N)
    for bar in range(2, 16):
        for ob in [0, 1.75, 2.5]:
            b = bar * 4 + ob
            t = bt(b)
            if b < 9 or b >= 64 or 24.0 <= t < bt(44):
                continue
            i = int(t * SR)
            n = int(0.22 * SR)
            duck[i:i + n] = np.minimum(duck[i:i + n], 1 - 0.35 * np.exp(-np.arange(min(n, N - i)) / SR / 0.07))

    hall = reverb(orch + 0.5 * perc + 0.35 * chops + 0.4 * lead + 0.25 * keys, 3.2, 0.95, 0.32, 1)
    room = reverb(drums, 0.9, 0.22, 0.18, 2)
    mix = hall + 0.55 * perc + room + (bass + keys * 0.9 + chops * 0.75) * duck + radio + lead * 0.7

    mix = shelf(eq(mix, lo=28), 2800, 5.0)
    mix *= np.clip((DUR - tt) / 0.65, 0, 1) ** 1.5      # follows the fade to black
    mix = np.tanh(mix * 1.1) / 1.1
    mix /= np.max(np.abs(mix)) / 0.9

    out = Path(__file__).with_name("score.wav")
    with wave.open(str(out), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((mix.T * 32767).astype("<i2").tobytes())
    print(f"wrote {out}  tempo={60 / BEAT:.2f} BPM")


if __name__ == "__main__":
    main()
