# AureliaSpace launch video

A 50-second HyperFrames composition (HTML + GSAP) that recreates the AureliaSpace UI, with no screen recordings.

- `index.html` is the 1920×1080 cut.
- `vertical/index.html` is the 1080×1920 cut (2×3 grid). `vertical/src` and `vertical/assets` are symlinks to the shared files.
- `src/app.css` holds the app UI, with values taken from `../src/styles.css` and `../src/lib/theme.ts`.
- `src/video.js` contains the whole video. One paused GSAP timeline tweens a clock, and every frame is a pure function of time, so any seek renders the same frame.
- `TIMING.md` is the timing sheet for cutting music.
- `storyboard/` holds one still per scene for each cut.
- `audio/compose.py` generates the original score (about 105.3 BPM, D major, synthesized with numpy, so there's nothing to license). `audio/score-master.wav` is the score normalized to −16 LUFS.

## Commands

```bash
npx hyperframes@0.8.125 lint . && npx hyperframes@0.8.125 lint vertical
npx hyperframes@0.8.125 preview                         # studio preview
npx hyperframes@0.8.125 render . -f 60 -q delivery -o renders/aureliaspace-1920x1080-60fps.mp4
npx hyperframes@0.8.125 render vertical -f 60 -q delivery -o renders/aureliaspace-1080x1920-60fps.mp4

# music: regenerate, normalize, then mux (video stream is copied)
python3 audio/compose.py   # → audio/score.wav (needs numpy)
ffmpeg -i audio/score.wav -af "volume=-5.2dB,alimiter=limit=0.84:level=false" audio/score-master.wav
ffmpeg -i renders/aureliaspace-1920x1080-60fps.mp4 -i audio/score-master.wav -map 0:v -map 1:a -c:v copy -c:a aac -b:a 256k -shortest out.mp4

# stills at given times (Playwright)
node tools/stills.mjs index.html out/ 15.2,22.3
```

On a Linux renderer, Inter stands in for SF Pro. On macOS the UI text uses SF Pro, as the app does.

## Renders (`renders/`)

| File | What |
|---|---|
| `aureliaspace-1920x1080-60fps.mp4` | Final landscape master (H.264 ~10 Mbps, AAC 256k score) |
| `aureliaspace-1080x1920-60fps.mp4` | Final vertical master for X/TikTok (~8.4 Mbps, with score) |
| `aureliaspace-draft-720p.mp4` | 720p30 draft |
| `aureliaspace-grid-attention-1280x720.gif` | README GIF, 10–24s, 15 fps (25 MB) |
| `aureliaspace-grid-attention-960x540-lite.gif` | Lighter GIF version, 12 fps (11 MB) |
| `preview/*-preview.mp4` | Compressed copies of the masters (not committed) |
