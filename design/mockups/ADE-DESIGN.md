# AureliaSpace, redesign mockup

## Brief
App UI (an agentic development environment), not a website. Owner: Jah. Pure black for a
Samsung C32R50 (VA, 1080p, 32"). Keep the jellyfish mark by the traffic lights. Must not read
as a T3 Code copy. Features asked for: always-visible usage with "left" label and reset time on
hover (erza / Eclar Khalid thread), plus what ADE users ask for: a plan you can edit before the
agent runs, worktree per thread, per-turn diffs, inline approvals, PR babysitting, phone access.

## Concepts
1. Name: Aurelia aurita, the moon jellyfish. The app is the deep: black water, agents are
   living things that glow and pulse while they work. Anchor: the app is named after it and the
   mark is one. Orig 4, fit 5, feasible 4, portability 1. **Picked.**
2. Material: a ship's log / tide table. Threads as log entries, usage as tide. Orig 3, fit 3, port 3.
3. Formal: everything is one line of mono text, weight is the only hierarchy. Orig 3, fit 2, port 4.

## Concept card
Idea:        Your agents live in the deep; you see them by their light.
Metaphor:    a moon jellyfish bloom in black water
Signature:   one pulse clock. The title-bar jellyfish contracts at the tempo of how many agents
             are working, and every working thread's bell beats on the same clock. The start
             screen has a faint bloom drifting up through the black.
Emotion:     calm, nocturnal, alive
Motion verb: pulse and drift (contract fast, release slow; nothing snaps)
Screenshot:  start screen: italic "tonight?" headline over the faint gold bloom, usage strip lit

## System
Palette: ground #000 · ink #F1EEE7 (moonlight, warm) · muted #8A857B · line rgba(241,238,231,.09)
         · aurum #E9B04B (needs you, primary) · bio #8FD3FF (working glow). Green/red only for checks.
Type:    Geist (UI), Geist Mono (paths, numbers, usage), Instrument Serif italic (one word per
         screen, never UI).
Shape:   8px controls, 14px composer and cards, full round only for the send button.
Motion:  ease cubic-bezier(.22,1,.36,1); pulse = fast contract 30%, slow release 70%.
         Reduced motion: no pulse, no bloom, all static.
Genericness test: a generic model would ship T3's neutral greys and system font. Changed:
warm moonlight ink, serif accent word, state-grouped sidebar with lineage, bio-blue working glow.
