<img src="assets/wordmark.svg" alt="CLAW" width="240">

**Create Loops, Algorithms, Waveforms.**

**[▶ Open CLAW — live demo](https://surfoli.github.io/claw/)**

CLAW is a groovebox that lives in your browser. No install. No account. No cloud. No samples — every sound is synthesized live with the Web Audio API. Open it, press play, and you have a techno loop running in under three seconds.

Built for DJs who want a quick idea machine, producers who want a sketchpad, and anyone who thinks drum machines should look like hardware and cost nothing.

## What it does

- **8 synthesized tracks** — kick, snare, clap, closed/open hats, sub bass, 303-style acid lead, minor chord stabs. Pure synthesis, zero samples, ~40 kB of code.
- **16-step sequencer** — swing, master filter, per-track level and mute. Space bar starts and stops.
- **Algorithmic generators** — one-press TECHNO / HOUSE / ACID / BREAKS patterns built on Euclidean rhythms and pentatonic note walks. MUTATE nudges the pattern while it plays.
- **Bring-your-own AI** — describe a loop in plain language ("dark rolling techno, minimal hats, hypnotic acid line") and let a model program the sequencer. Works with an Anthropic API key or any OpenAI-compatible endpoint. Your key is stored in your browser and sent directly to the provider — CLAW has no servers.
- **Song mode** — arrange your banks into an actual track: `A ×4 · B ×8 · C ×16`. Switch LOOP/SONG in the transport, click a chip to change its bank or length. The playhead follows; export renders the whole arrangement.
- **Exports a DAW accepts** — **WAV** (seamless 2-bar loop, or the full song), **STEMS** (one WAV per track, zipped), and **MIDI** (Standard MIDI File type 1: drums on the GM map, one track per part, with your velocities and swing). Drag any of it into Ableton, FL, Logic, or a sampler.
- **WAV export** — a clean 44.1 kHz WAV (`claw-iron-moth-131bpm.wav` — every loop gets a deterministic name). The file carries its own share URL in the WAV comment field, so a loop can always find its way home.
- **Loop sharing & remix chains** — every pattern serializes into a URL. Open someone's loop, change it, share again: the link tracks the remix generation (`HOLLOW-KERNEL · GEN 3`).
- **Projects are files you own** — SAVE/LOAD as `.json`, plus autosave in your browser. Works offline; CLAW is an installable PWA.

## Run it

**Option 1 — just open it.** Download this repo (green button → *Download ZIP*), unzip, double-click `index.html`. Done.

**Option 2 — local server** (nicer URLs, needed for clipboard on some browsers):

```bash
git clone https://github.com/surfoli/claw.git
cd claw
python3 -m http.server 4173
# open http://localhost:4173
```

No build step. No dependencies. Vanilla HTML/CSS/JS.

## Using the sequencer

| Action | How |
|---|---|
| Toggle a drum step | click it |
| Toggle a note step (BASS/ACID/STAB) | click it |
| Change the note | shift-click or right-click — walks up the A-minor pentatonic |
| Change velocity (normal/accent/ghost) | alt-click a lit step |
| Change probability (100/75/50/25%) | scroll/wheel over a lit step |
| Switch pattern bank (A–D) | click a bank button — instant when stopped, queued to the next bar when playing |
| Build a track | switch to **SONG**, add sections, click a chip's letter/length to change it |
| Mixer: pan, solo, delay/reverb sends | open the **MIX** drawer |
| Shape the sounds | open the **SOUND** drawer |
| Play / stop | space bar or the orange button |
| Mute a track | the small circle left of the steps |

The **MIX** drawer gives every track a channel strip (solo, pan, and sends to a tempo-synced dub delay and a procedural reverb — both synthesized, still zero samples). Reverb decay and delay feedback are global. It exports exactly what you hear, wet tails and all.

The **SOUND** drawer is a sound-design page: every voice exposes named knobs (kick tune/decay/click, acid cutoff/reso/env-mod, bass cutoff/sub, …). Shape a kick into a boom or a click, open the 303 up, detune the stab. Double-click a knob to reset it. Each loop carries its own sound in the project/share link.

## Using AI generation

1. Open the **AI** drawer (bottom right).
2. Pick a provider: **Anthropic** (default model `claude-haiku-4-5`) or **OpenAI-compatible** (set base URL + model — works with OpenAI, Vercel AI Gateway, Groq, local Ollama with CORS enabled, anything speaking `/chat/completions`).
3. Paste your API key. It is kept in this browser only and sent straight to the provider you chose.
4. Describe the loop. Generate. Argue with the result. Press MUTATE.

## Why it sounds like that

The drums are classic analog recipes: the kick is a sine wave pitch-diving from 160 Hz to 44 Hz, the snare is band-passed noise over a 190 Hz triangle, the acid line is a sawtooth through a resonant low-pass with an envelope on the cutoff — the same trick a TB-303 does with actual capacitors. Read [`js/synth.js`](js/synth.js); it's short on purpose.

## Feedback loops

CLAW improves through feedback loops — the other kind. If a generator makes something boring, a browser misbehaves, or you want a ninth track:

- [Give feedback / request a feature](https://github.com/surfoli/claw/issues/new?template=feedback.yml)
- [Report a bug](https://github.com/surfoli/claw/issues/new?template=bug.yml)

Patterns you make and share are the best bug reports.

## Where this is going

Shipped: pattern banks and step dynamics (v0.3), mixer + FX + sound design (v0.4), song mode and MIDI/stem export (v0.5). Next: an AI arranger and a co-producer chat that edits the grid while it plays, then sample import. The full plan is in [ROADMAP.md](ROADMAP.md).

## The pledge

The browser app is the full instrument, forever — no accounts, no cloud, no feature gates, no ads, no telemetry, and AI stays bring-your-own-key. If CLAW ever charges for anything, it's packaging and content (desktop builds, style packs), never capability. The long version is [PRINCIPLES.md](PRINCIPLES.md).

## Support the project

CLAW is free and MIT-licensed and will stay that way. If it earned a place in your workflow you can sponsor development — see the Sponsor button on this repo.

## License

[MIT](LICENSE) — do whatever you want, credit is appreciated, loops you make are 100% yours.
