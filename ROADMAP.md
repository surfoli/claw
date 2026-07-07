# CLAW Roadmap — from loop machine to studio

Three capabilities separate a groovebox from a studio: **finish** (get past one
16-step loop), **shape** (sound design, FX, mixing), and **integrate** (files,
stems, MIDI into your real workflow). Each release below climbs that ladder
without breaking a single principle in [PRINCIPLES.md](PRINCIPLES.md).

Progress is tracked in issues; ship order matters more than ship dates.

## v0.2 — Foundation ✅ (shipped)

- [x] One trigger path: live playback and WAV export share `triggerStep()` — what you hear is what you export
- [x] Per-track gain buses (the seam that pan/solo/FX sends plug into later)
- [x] Project format v1: `{format:'claw', v:1}` — one schema for share links, project files, and autosave, one sanitizer; legacy share URLs parse forever
- [x] SAVE/LOAD as `.json` files you own + localStorage autosave (works on `file://`)
- [x] Remix provenance: deterministic loop names (IRON-MOTH), generation counter, parent hash — the share chain is visible
- [x] WAV as carrier: `claw-iron-moth-131bpm.wav` + share URL in the file's INFO chunk
- [x] Seeded PRNG in the generators (style packs become reproducible)
- [x] PWA: installable, offline after one visit

## v0.3 — Sequencer depth (2–3 weeks)

- [x] Pattern banks A–D — instant switch while stopped, quantized to the next bar while playing (the live-performance move)
- [x] Per-step velocity (normal/accent/ghost via alt-click) and probability (25/50/75/100% via wheel) — step cells are objects internally, wire format stays int-compatible; generators now sprinkle ghost hats automatically
- [ ] Per-track pattern length (polymeter) — not yet; banks shipped without it to keep the format change contained
- [ ] Ratchets (sub-step retriggers) — deferred, no visual/gesture budget left this pass
- [ ] AudioWorklet tick clock with setInterval fallback (fixes background-tab throttling; `file://` keeps working)
- [ ] QWERTY keyboard play + quantized REC into the pattern
- [ ] 15 € Supporter Edition desktop build (Tauri) — see PRINCIPLES.md: packaging, never gates

## v0.4 — Sound: mixer, FX, parametric voices, p-locks (3–4 weeks)

- [x] Channel strips: pan + solo (level + mute existed) — a collapsible MIXER drawer
- [x] FX sends: tempo-synced (dotted-⅛) feedback delay + procedural-IR reverb (zero samples), per-track sends, longer export tail that folds wet tails into the loop seam
- [x] Named, clamped params per voice via a data-driven `VOICE_PARAMS` table (kick tune/decay/click, acid cutoff/reso/env-mod, bass cutoff/sub, …) + a SOUND drawer; defaults reproduce the original voices exactly
- [x] Refactor: pattern generators extracted to `js/generators.js` (pure, seeded, no app-state) — the monolith gets thinner as it grows
- [ ] 303 slide (glide between consecutive acid notes) — needs a per-step slide flag; deferred
- [ ] Elektron-style p-locks: per-step param overrides — deferred
- [ ] AI sound designer: "describe a kick, get a kick" (params JSON through the existing BYO-key plumbing) — deferred

## v0.5 — Studio I/O + ecosystem (2–3 weeks)

- [ ] Standard MIDI File export (drums ch10, notes with velocities) — CLAW becomes a front-end to every DAW
- [ ] Stem export (one offline render per track, zipped)
- [ ] WebMIDI in + MIDI clock out (feature-detected)
- [ ] Freeze the plugin contract: `CLAW.registerVoice({id, name, type, params, render})`; packs are data-only JSON
- [ ] First paid style packs (open format, same as free packs)

## v1.0 — Song mode: "it's a studio now" (3–4 weeks)

- [ ] Song timeline: ordered pattern rows with repeats, per-row track mutes (mute automation is 80 % of EDM arrangement), fills, filter sweeps
- [ ] Full-song WAV + MP3 export; live-jam recording
- [ ] LLM arranger: one call returns the whole timeline
- [ ] Co-producer chat: tool-use AI that edits the grid while the loop plays
- [ ] The relaunch. Everything above ships free in the browser.

## v1.1 — Samples + Pro packaging (4–6 weeks)

- [ ] Sample track type (import, start/end/pitch) via the frozen voice contract
- [ ] Local sample library (OPFS/IndexedDB); projects embed samples; URL share degrades gracefully
- [ ] BYO-key one-shot sample generation (after a CORS spike)
- [ ] CLAW Pro 29 € — paid desktop packaging with packs included; browser keeps every feature

## Parked (deliberately)

Per-pattern OG-card workers, `?embed=1` player, hum-to-pattern, in-browser stem
separation, SharedArrayBuffer anything, TypeScript, bundlers. See PRINCIPLES.md
for why.
