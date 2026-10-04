# AureliaSpace launch video — timing sheet

50.0 s total · 60 fps · 1920×1080 (`index.html`) and 1080×1920 (`vertical/index.html`).
Both cuts share one timeline, so every time below applies to both. There's no voiceover, so the music can carry it.

**Hits** are moments you can put a downbeat or accent on. **Beds** are sections that want a steady groove underneath.

| Time | Section | On screen | Music cue |
|---:|---|---|---|
| 0.00 | Hook | Black. Gold cursor appears at 0.25 | Silence or a soft pad |
| 0.45–1.75 | | Types "Running 6 Claude Code agents?" | Light keys/ticks |
| 2.30 | | Line 1 dims | |
| 2.55–3.95 | | Types "Lost track of which one needs you?" | |
| 3.95–4.55 | | Cursor blinks (0.53 s rhythm) | Riser/swell into 5.0 |
| 4.55–5.00 | | Hook fades out | |
| **5.10** | Logo | **Logo mark blooms in** | **HIT 1: main downbeat, track starts properly** |
| 5.40 | | "AureliaSpace" wordmark rises | |
| 6.15 | | Tagline fades in | |
| 9.05–9.70 | | Logo lifts away | Transition fill |
| 9.45–10.45 | Grid | App window rises in | |
| **10.20** | | **⌘G keycap** | **HIT 2** |
| 10.50–11.55 | | Pane splits into 3 columns | Bed starts |
| 11.15–12.25 | | Splits into 3 rows | |
| 11.95–12.55 | | Account chips pop in, one per pane (70 ms apart) | Optional plucks on the stagger |
| 12.25–13.55 | | Agents start (each pane 160 ms after the last) | |
| 12.70–16.90 | | Caption: "Split into a grid. One agent per pane." | Steady bed, slow camera push |
| **17.60** | Attention | **One agent finishes (green "done") and "1 waiting" pill slides in** | **HIT 3 (soft)** |
| **18.00** | | **Cart agent asks for permission (orange "needs input"), pill reads "2 waiting"** | **HIT 4** |
| 18.45–19.75 | | Camera pushes onto the pill | |
| 18.70–23.90 | | Caption: "See who needs you. Jump there with ⌘J." | |
| 20.30–21.30 | | Camera pulls back | |
| **20.80** | | **⌘J keycap** | **HIT 5** |
| 21.25–22.00 | | Focus ring glides to the waiting pane | Whoosh-free, a swell works |
| 21.65–22.90 | | Camera pushes onto the permission prompt | |
| 22.70 | | "1" keycap | |
| **23.10** | | **Prompt approved, agent back to work** | **HIT 6 (release)** |
| 24.00–25.30 | Worktrees | Camera moves to pane headers | Section change |
| 24.60–29.70 | | Caption: "Every agent on its own branch." | |
| 25.50–28.60 | | Slow pan across the branch chips | Calm bed |
| 28.85–30.15 | | Pull back to the full app | |
| **30.15** | Review | **⇧⌘R keycap** | **HIT 7: section change** |
| 30.55 | | Diff review modal opens | |
| 30.85–32.10 | | Camera pushes onto the diff | |
| 30.90–35.80 | | Caption: "Review the diff. Send notes straight to Claude." | |
| 32.75 | | Click on line 22 | Tick |
| 33.05–34.50 | | Comment types out | |
| 34.98 | | Click Save | Tick |
| **35.62** | | **Click "Send to Claude"** | **HIT 8** |
| 35.85–36.05 | | Modal closes. Toast reads "Sent 1 comment to Claude" | |
| 36.05 | | Comment lands in the agent's transcript | |
| **37.00** | Small wins | **Hard cut 1: drag a file onto a pane** | **HIT 9: cut on the beat** |
| 38.00 | | Drop, and the escaped path appears at the prompt | Tick |
| **38.70** | | **Hard cut 2: ⌘-click `src/app.ts:42`** | **HIT 10** |
| 39.32 | | Link highlights | |
| 39.50 | | Click | Tick |
| **40.40** | | **Hard cut 3: usage meters** | **HIT 11** |
| 40.55–42.10 | | Meters fill per account (work crosses 70% and turns orange) | |
| **42.00** | Close | **Hard cut to the full app, slow pull back** | **HIT 12: final section** |
| 44.55–45.35 | | App fades | |
| **45.00** | | **Logo mark** | **HIT 13: closing downbeat** |
| 45.20 | | Wordmark | |
| 45.75 | | "Free on GitHub" | |
| 46.00 | | github.com/aurelia-works/AureliaSpace | |
| 46.30 | | "macOS · Apple silicon" | |
| 46.60 | | Disclaimer line | |
| 49.35–50.00 | | Fade to black | Music tail / button ending |

## The included score

The renders now include an original score from `audio/compose.py` at 105.33 BPM, so beat 0 is 5.10 s and beat 56 is 37.0 s. A riser leads into the logo, and the pulse comes in at the ⌘G grid split (beat 9). The kick drops out for the worktrees section and returns at ⇧⌘R (beat 44). Bells mark the hits, the three quick cuts land on beats 56, 59 and 62, and the final chord hits at beat 70 (45.0 s). It's mixed to −16 LUFS integrated and fades with the picture. To use your own track, swap it in with the mux command in README.md.

## Cutting music to it

- The three hard cuts at 37.0, 38.7 and 40.4 are 1.7 s apart. At **106 BPM** a beat is 0.566 s, so three beats is 1.698 s and the cuts land on every third beat. That tempo also puts 5.10 → 45.00 at almost exactly 70.5 beats. Nudge your track so a downbeat sits at 5.10 and the cuts line up.
- If your track has a different tempo, cut the music at the 5.10, 30.15, 37.00 and 45.00 hits. Everything else in the edit is calm motion that doesn't need to land on a beat.
- To change a hit, edit the times in `src/video.js`. Captions are `CAPS`, keycaps are `KEYS` and the camera is `CAM`. The terminal events are on each pane's `lines`, and the constants `T_NEED`, `T_ANSWER`, `T_DONE` and `T_FOCUS` set the attention beat.
