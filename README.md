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
- **WAV export** — render your loop as a clean 2-bar 44.1 kHz WAV, named with its BPM, ready for your DAW, CDJs, or sampler.
- **Loop sharing** — every pattern serializes into a URL. Send a loop to someone in a chat message.

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
| Play / stop | space bar or the orange button |
| Mute a track | the small circle left of the steps |

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

## Support the project

CLAW is free and MIT-licensed and will stay that way. If it earned a place in your workflow you can sponsor development — see the Sponsor button on this repo. Planned: premium generator styles, longer patterns, song mode.

## License

[MIT](LICENSE) — do whatever you want, credit is appreciated, loops you make are 100% yours.
