/* CLAW — Create Loops, Algorithms, Waveforms
   Browser groovebox: 8 tracks × 16 steps, algorithmic generators,
   optional AI pattern generation via your own API key, WAV export.
   No build step, no server, no accounts. */

(function () {
  "use strict";

  const { voices, masterChain, VOICE_PARAMS } = window.ClawSynth;

  // default sound params for one track, straight from the metadata table
  function defaultVoice(id) {
    const o = {};
    VOICE_PARAMS[id].forEach((m) => { o[m.k] = m.def; });
    return o;
  }

  // ---------- data model ----------

  const STEPS = 16;

  const TRACKS = [
    { id: "kick",  name: "KICK",  type: "drum" },
    { id: "snare", name: "SNARE", type: "drum" },
    { id: "clap",  name: "CLAP",  type: "drum" },
    { id: "chh",   name: "HAT C", type: "drum" },
    { id: "ohh",   name: "HAT O", type: "drum" },
    { id: "bass",  name: "BASS",  type: "note", root: 33 }, // A1
    { id: "acid",  name: "ACID",  type: "note", root: 45 }, // A2
    { id: "stab",  name: "STAB",  type: "note", root: 57 }, // A3
  ];

  const PENTA = [0, 3, 5, 7, 10]; // minor pentatonic degrees
  const BANKS = 4; // A-D

  // A step cell is 0 (off), a plain number (on, default vel/prob — the
  // compact/backward-compatible form), or {n, vel, prob} when it carries
  // per-step dynamics. Helpers below are the only code that should read
  // these shapes directly.
  const VEL_CYCLE = [1, 1.15, 0.55]; // normal -> accent -> ghost -> normal
  const PROB_CYCLE = [100, 75, 50, 25];
  const cellOn = (c) => !!c;
  const cellNote = (c) => (typeof c === "object" ? c.n : c);
  const cellVel = (c) => (typeof c === "object" && c.vel != null ? c.vel : 1);
  const cellProb = (c) => (typeof c === "object" && c.prob != null ? c.prob : 100);
  function withMods(n, vel, prob) {
    if (vel === 1 && prob === 100) return n; // keep the compact form when nothing's modified
    return { n, vel, prob };
  }
  function cycleVel(v) {
    const i = VEL_CYCLE.findIndex((x) => Math.abs(x - v) < 0.01);
    return VEL_CYCLE[(i + 1) % VEL_CYCLE.length];
  }
  function cycleProb(p) {
    const i = PROB_CYCLE.indexOf(p);
    return PROB_CYCLE[(i < 0 ? 0 : i + 1) % PROB_CYCLE.length];
  }
  function sanitizeCell(raw, t) {
    if (raw == null || raw === 0) return 0;
    if (typeof raw === "object") {
      const n = Math.max(0, Math.round(Number(raw.n) || 0));
      if (!n) return 0;
      const note = t.type === "drum" ? 1 : Math.min(80, Math.max(24, n));
      const velRaw = Number(raw.vel);
      const vel = VEL_CYCLE.includes(velRaw) ? velRaw : 1;
      const probRaw = clampInt(raw.prob, 0, 100, 100);
      const prob = PROB_CYCLE.includes(probRaw) ? probRaw : 100;
      return withMods(note, vel, prob);
    }
    const v = Math.max(0, Math.round(Number(raw) || 0));
    if (!v) return 0;
    return t.type === "drum" ? 1 : Math.min(80, Math.max(24, v));
  }

  function emptyPatternSet() {
    const p = {};
    TRACKS.forEach((t) => { p[t.id] = new Array(STEPS).fill(0); });
    return p;
  }

  // Default pattern: plays something good the second you land. Lives in bank A.
  const DEFAULT_PATTERN = {
    kick:  [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0],
    snare: [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
    clap:  [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
    chh:   [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,1],
    ohh:   [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0],
    bass:  [33,0,0,33, 0,0,33,0, 33,0,0,33, 0,0,36,0],
    acid:  [45,0,48,0, 45,0,52,45, 0,45,0,48, 45,0,57,0],
    stab:  [0,0,0,0, 0,0,0,0, 57,0,0,0, 0,0,0,0],
  };

  const state = {
    bpm: 128,
    swing: 0,          // 0..60 (%)
    filter: 100,       // 0..100
    volume: 85,        // 0..100
    banks: [{ pattern: DEFAULT_PATTERN }, { pattern: emptyPatternSet() }, { pattern: emptyPatternSet() }, { pattern: emptyPatternSet() }],
    activeBank: 0,
    pattern: null, // set below — always the same object reference as banks[activeBank].pattern
    mutes: {},
    levels: {},
    pans: {},    // -100..100 (L..R)
    solos: {},   // bool — if any track is soloed, only soloed tracks sound
    sends: {},   // { delay: 0..100, reverb: 0..100 } per track
    fx: { delayFb: 35, reverbSend: 0, reverbDecay: 60 }, // global FX character (0..100)
    voice: {},   // per-track sound-design params, keyed per VOICE_PARAMS
    mode: "loop",                        // "loop" jams one bank; "song" plays the arrangement
    song: [{ bank: 0, repeats: 4 }],     // ordered rows: play bank N for `repeats` bars
    // remix provenance: gen counts edited-then-reshared hops, parent is the
    // 8-hex pattern hash this loop was remixed from
    meta: { gen: 0, parent: null, src: "hand" },
  };
  state.pattern = state.banks[state.activeBank].pattern;
  TRACKS.forEach((t) => {
    state.mutes[t.id] = false;
    state.levels[t.id] = 0.8;
    state.pans[t.id] = 0;
    state.solos[t.id] = false;
    state.sends[t.id] = { delay: 0, reverb: 0 };
    state.voice[t.id] = defaultVoice(t.id);
  });

  // set when the session started from a shared link — the remix chain anchor
  let arrival = null;
  // a bank queued to take over at the next bar boundary while playing
  let queuedBank = null;

  // ---------- dot matrix wordmark ----------

  const GLYPHS = {
    C: [".###", "#...", "#...", "#...", ".###"],
    L: ["#...", "#...", "#...", "#...", "####"],
    A: [".##.", "#..#", "####", "#..#", "#..#"],
    W: ["#...#", "#...#", "#.#.#", "#.#.#", ".#.#."],
  };

  function renderWordmark(el, word) {
    const D = 7, R = 2.6;
    let x = 0;
    let dots = "";
    for (const ch of word) {
      const rows = GLYPHS[ch];
      const w = rows[0].length;
      rows.forEach((row, ry) => {
        for (let rx = 0; rx < row.length; rx++) {
          if (row[rx] === "#") {
            dots += `<circle cx="${(x + rx) * D + R}" cy="${ry * D + R}" r="${R}" fill="currentColor"/>`;
          }
        }
      });
      x += w + 1.3;
    }
    // signal dot after the wordmark
    dots += `<circle cx="${x * D + R}" cy="${4 * D + R}" r="${R}" fill="#ff3d00"/>`;
    const width = (x + 1) * D + R * 2;
    el.innerHTML = `<svg width="${width}" height="${4 * D + R * 2 + 2}" viewBox="0 0 ${width} ${4 * D + R * 2 + 2}" role="img" aria-label="${word}">${dots}</svg>`;
  }

  // ---------- build sequencer UI ----------

  const gridEl = document.getElementById("grid");
  const stepEls = {}; // trackId -> [button]
  const rowEls = {};  // trackId -> track row div (for solo/mute dimming)

  // a track is silenced by an explicit mute, or by another track being soloed
  function anySolo() { return TRACKS.some((t) => state.solos[t.id]); }
  function isSilenced(id) { return state.mutes[id] || (anySolo() && !state.solos[id]); }
  function refreshRowStates() {
    TRACKS.forEach((t) => {
      if (rowEls[t.id]) rowEls[t.id].classList.toggle("muted-row", isSilenced(t.id));
    });
  }

  function noteName(midi) {
    const names = ["A","A#","B","C","C#","D","D#","E","F","F#","G","G#"];
    return names[(midi - 33 + 120) % 12] + (Math.floor((midi - 24) / 12) + 1);
  }

  function buildGrid() {
    gridEl.innerHTML = "";
    TRACKS.forEach((t, ti) => {
      const row = document.createElement("div");
      row.className = "track";
      rowEls[t.id] = row;

      const name = document.createElement("div");
      name.className = "track-name";
      name.innerHTML = `<span class="idx">T${ti + 1}</span> ${t.name}`;
      row.appendChild(name);

      const mute = document.createElement("button");
      mute.className = "mute-btn" + (state.mutes[t.id] ? " muted" : "");
      mute.setAttribute("aria-label", `Mute ${t.name}`);
      mute.setAttribute("aria-pressed", String(state.mutes[t.id]));
      mute.addEventListener("click", () => {
        state.mutes[t.id] = !state.mutes[t.id];
        mute.classList.toggle("muted", state.mutes[t.id]);
        mute.setAttribute("aria-pressed", String(state.mutes[t.id]));
        refreshRowStates();
        autosave();
      });
      row.appendChild(mute);

      const steps = document.createElement("div");
      steps.className = "steps";
      stepEls[t.id] = [];
      for (let s = 0; s < STEPS; s++) {
        const b = document.createElement("button");
        b.className = "step" + (s % 4 === 0 ? " beat" : "");
        b.setAttribute("aria-label", `${t.name} step ${s + 1}`);
        b.addEventListener("click", (ev) => onStepClick(t, s, ev));
        b.addEventListener("contextmenu", (ev) => { ev.preventDefault(); onStepClick(t, s, { shiftKey: true }); });
        b.addEventListener("wheel", (ev) => onStepWheel(t, s, ev), { passive: false });
        steps.appendChild(b);
        stepEls[t.id].push(b);
      }
      row.appendChild(steps);

      const level = document.createElement("input");
      level.type = "range";
      level.className = "level";
      level.min = 0; level.max = 100; level.value = state.levels[t.id] * 100;
      level.setAttribute("aria-label", `${t.name} level`);
      level.title = `${t.name} level ${level.value} — double-click resets`;
      level.addEventListener("input", () => {
        state.levels[t.id] = level.value / 100;
        level.title = `${t.name} level ${level.value} — double-click resets`;
        if (buses) buses[t.id].gain.gain.setTargetAtTime(state.levels[t.id], ctx.currentTime, 0.02);
        autosave();
      });
      level.addEventListener("dblclick", () => {
        level.value = 80;
        state.levels[t.id] = 0.8;
        if (buses) buses[t.id].gain.gain.setTargetAtTime(0.8, ctx.currentTime, 0.02);
        autosave();
      });
      row.appendChild(level);

      gridEl.appendChild(row);
    });
    paintGrid();
    refreshRowStates();
  }

  function onStepClick(t, s, ev) {
    const arr = state.pattern[t.id];
    const cur = arr[s];
    if (ev.altKey && cur) {
      // alt-click: cycle velocity (normal -> accent -> ghost), keep note/prob
      arr[s] = withMods(cellNote(cur), cycleVel(cellVel(cur)), cellProb(cur));
    } else if (t.type === "drum") {
      arr[s] = cur ? 0 : 1;
    } else if (ev.shiftKey && cur) {
      // shift-click / right-click: walk up the pentatonic scale, wrap after an octave
      const deg = (((cellNote(cur) - t.root) % 12) + 12) % 12;
      const idx = PENTA.indexOf(deg); // -1 for off-scale notes (AI can emit any pitch)
      const nextNote = t.root + PENTA[(idx < 0 ? 0 : idx + 1) % PENTA.length];
      arr[s] = withMods(nextNote, cellVel(cur), cellProb(cur));
    } else {
      arr[s] = cur ? 0 : t.root;
    }
    paintStep(t, s);
    autosave();
  }

  function onStepWheel(t, s, ev) {
    const arr = state.pattern[t.id];
    const cur = arr[s];
    if (!cur) return; // only active steps have a probability to adjust
    ev.preventDefault();
    arr[s] = withMods(cellNote(cur), cellVel(cur), cycleProb(cellProb(cur)));
    paintStep(t, s);
    autosave();
  }

  function paintStep(t, s) {
    const cell = state.pattern[t.id][s];
    const el = stepEls[t.id][s];
    const on = cellOn(cell);
    el.classList.toggle("on", on);
    el.setAttribute("aria-pressed", String(on));
    const vel = on ? cellVel(cell) : 1;
    el.classList.toggle("accent", on && vel > 1.05);
    el.classList.toggle("ghost", on && vel < 0.95);
    const prob = on ? cellProb(cell) : 100;
    el.style.opacity = on && prob < 100 ? String(0.4 + (prob / 100) * 0.6) : "";
    if (t.type === "note") el.textContent = on ? noteName(cellNote(cell)) : "";
    if (on) {
      const bits = [];
      if (t.type === "note") bits.push(noteName(cellNote(cell)));
      if (vel > 1.05) bits.push("accent"); else if (vel < 0.95) bits.push("ghost");
      if (prob < 100) bits.push(prob + "% chance");
      el.title = `${bits.join(" · ")} — alt-click: velocity · wheel: probability${t.type === "note" ? " · shift-click: next note" : ""}`;
    } else {
      el.title = "";
    }
  }

  function paintGrid() {
    TRACKS.forEach((t) => { for (let s = 0; s < STEPS; s++) paintStep(t, s); });
  }

  // ---------- audio engine ----------

  let ctx = null;
  let master = null;
  let playing = false;
  let currentStep = 0;
  let nextNoteTime = 0;
  let timerId = null;
  const notesInQueue = [];

  // per-track channel strips: voices -> gain(level) -> pan -> master.input (dry)
  //                                                        -> sendDelay -> master.delayIn
  //                                                        -> sendReverb -> master.reverbIn
  // Voices connect to `.gain`; the rest of the strip is the mixer.
  let buses = null;
  const sendScale = (v) => (v / 100) * 1.2; // a little headroom so full send is audibly wet
  function makeBuses(c, m) {
    const b = {};
    TRACKS.forEach((t) => {
      const gain = c.createGain();
      gain.gain.value = state.levels[t.id];
      const pan = c.createStereoPanner();
      pan.pan.value = state.pans[t.id] / 100;
      gain.connect(pan);
      pan.connect(m.input);
      const sendDelay = c.createGain();
      sendDelay.gain.value = sendScale(state.sends[t.id].delay);
      pan.connect(sendDelay).connect(m.delayIn);
      const sendReverb = c.createGain();
      sendReverb.gain.value = sendScale(state.sends[t.id].reverb);
      pan.connect(sendReverb).connect(m.reverbIn);
      b[t.id] = { gain, pan, sendDelay, sendReverb };
    });
    return b;
  }

  function reverbSeconds(v) { return 0.4 + (v / 100) * 4.6; } // 0.4s..5s

  // apply the global FX character to the live master chain
  function applyFx() {
    if (!master) return;
    master.delay.delayTime.setTargetAtTime(delayTimeSec(), ctx.currentTime, 0.05);
    master.fb.gain.setTargetAtTime((state.fx.delayFb / 100) * 0.85, ctx.currentTime, 0.02);
    // reverb decay changes rebuild the IR — do it only when the value moves
    if (master._reverbDecay !== state.fx.reverbDecay) {
      master.convolver.buffer = window.ClawSynth.makeIR(ctx, reverbSeconds(state.fx.reverbDecay), 2.5);
      master._reverbDecay = state.fx.reverbDecay;
    }
  }

  function delayTimeSec() {
    // dotted-eighth = 3 sixteenths, the classic dub-delay sync
    return Math.min(1.0, (60 / state.bpm) * 0.75);
  }

  function ensureCtx() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = masterChain(ctx);
      master._reverbDecay = null; // force applyFx() to build the IR from state on init
      buses = makeBuses(ctx, master);
      applyFilter();
      applyVolume();
      applyFx();
    }
    if (ctx.state === "suspended") ctx.resume();
  }

  function secondsPerStep() {
    return 60 / state.bpm / 4;
  }

  function swungTime(base, step, spb) {
    return step % 2 === 1 ? base + (state.swing / 100) * spb * 0.5 : base;
  }

  // THE single trigger path — live playback, WAV export, stem renders and the
  // full-song render all call this, so what you hear is exactly what you get.
  // opts: { rollProb, decide, pattern, only }
  //   rollProb — live dice for per-step probability, rolled every pass
  //   decide   — (trackId, step) => bool; a FIXED decision table, so one export
  //              renders identical hits into the WAV, every stem, and the MIDI
  //   pattern  — render a bank other than the live one (song export)
  //   only     — render a single track id (stem export)
  function triggerStep(c, b, step, time, spb, opts = {}) {
    const pat = opts.pattern || state.pattern;
    const anySolo = TRACKS.some((t) => state.solos[t.id]);
    TRACKS.forEach((t) => {
      if (opts.only && t.id !== opts.only) return; // stems: one track per pass
      const cell = pat[t.id][step];
      if (!cell || state.mutes[t.id]) return;
      // a stem pass renders its own track even if another track is soloed
      if (!opts.only && anySolo && !state.solos[t.id]) return;
      const prob = cellProb(cell);
      if (opts.decide) { if (!opts.decide(t.id, step)) return; }
      else if (prob < 100 && opts.rollProb && !opts.rollProb(prob)) return;
      const stepVel = cellVel(cell);
      const vp = state.voice[t.id]; // per-track sound-design params
      if (t.type === "drum") {
        voices[t.id](c, b[t.id].gain, time, stepVel, 0, 0, vp);
      } else {
        // deliberate since v0.2: quarter-step vel 0.95 drives the acid accent
        // branch (higher Q + cutoff) — in v0.1 velocity was scaled by track
        // level, which silenced the accent unintentionally. A per-step accent
        // (stepVel 1.15) can now push any acid step over that threshold too.
        const baseVel = t.id === "acid" && step % 4 === 0 ? 0.95 : 0.8;
        voices[t.id](c, b[t.id].gain, time, baseVel * stepVel, cellNote(cell), spb * (t.id === "stab" ? 2 : 0.9), vp);
      }
    });
  }

  const rollProb = (prob) => rng() * 100 < prob;

  function scheduleStep(step, time) {
    if (step === 0) {
      if (state.mode === "song") songTick();
      else if (queuedBank != null) applyBankSwitch(queuedBank);
    }
    const spb = secondsPerStep();
    const swung = swungTime(time, step, spb);
    notesInQueue.push({ step, time: swung });
    triggerStep(ctx, buses, step, swung, spb, { rollProb });
  }

  function scheduler() {
    while (nextNoteTime < ctx.currentTime + 0.12) {
      scheduleStep(currentStep, nextNoteTime);
      nextNoteTime += secondsPerStep();
      currentStep = (currentStep + 1) % STEPS;
    }
  }

  let lastDrawnStep = -1;
  function draw() {
    if (!playing) return;
    let stepToDraw = lastDrawnStep;
    while (notesInQueue.length && notesInQueue[0].time <= ctx.currentTime) {
      stepToDraw = notesInQueue.shift().step;
    }
    if (stepToDraw !== lastDrawnStep) {
      TRACKS.forEach((t) => {
        stepEls[t.id].forEach((el, i) => el.classList.toggle("now", i === stepToDraw));
      });
      lastDrawnStep = stepToDraw;
    }
    requestAnimationFrame(draw);
  }

  function play() {
    ensureCtx();
    playing = true;
    currentStep = 0;
    if (state.mode === "song" && state.song.length) {
      songReset();
      setActiveBank(state.song[0].bank); // start on the arrangement's first row
    }
    nextNoteTime = ctx.currentTime + 0.06;
    timerId = setInterval(scheduler, 25);
    playBtn.classList.add("playing");
    playBtn.setAttribute("aria-pressed", "true");
    requestAnimationFrame(draw);
  }

  function stop() {
    playing = false;
    clearInterval(timerId);
    notesInQueue.length = 0;
    lastDrawnStep = -1;
    TRACKS.forEach((t) => stepEls[t.id].forEach((el) => el.classList.remove("now")));
    playBtn.classList.remove("playing");
    playBtn.setAttribute("aria-pressed", "false");
    highlightSong();
  }

  // ---------- pattern banks ----------
  // 4 independent 16-step patterns (A-D). Switching while stopped is instant;
  // switching while playing queues until the bar wraps — the live-performance
  // move hardware groove boxes are built around.

  function selectBank(i) {
    if (i === state.activeBank && queuedBank == null) return;
    // queuing is a LOOP-mode performance move. In song mode the arrangement
    // owns the bank, so a click just moves the edit focus straight away —
    // otherwise the queue would sit unused and later fire in loop mode.
    if (playing && state.mode === "loop") {
      queuedBank = i;
    } else {
      applyBankSwitch(i);
    }
    paintBankButtons();
  }

  // move the edit/playback focus to a bank. Repaint, don't rebuild: track and
  // step counts never change between banks, only cell contents — a full
  // buildGrid() teardown can run inside the audio scheduler's tick and stall
  // it right on the downbeat.
  function setActiveBank(i) {
    state.banks[state.activeBank].pattern = state.pattern; // save edits back first
    state.activeBank = i;
    state.pattern = state.banks[i].pattern;
    undoBuf = null; // undo history doesn't cross a bank switch
    if (playing) lastDrawnStep = -1;
    paintGrid();
    paintBankButtons();
  }

  // a user-initiated switch: also clears the queue and persists
  function applyBankSwitch(i) {
    setActiveBank(i);
    queuedBank = null;
    autosave();
  }

  function paintBankButtons() {
    // the active bank stays highlighted even while a switch is queued, so a
    // performer can see both "what's playing now" and "what's coming next"
    bankBtns.forEach((b, i) => {
      b.classList.toggle("active", i === state.activeBank);
      b.classList.toggle("queued", queuedBank === i);
      b.setAttribute("aria-pressed", String(i === state.activeBank));
    });
  }

  // ---------- song arrangement ----------
  // The song is a list of rows ("play bank B for 8 bars"). In SONG mode the
  // playhead walks it and loops; EXPORT renders exactly one pass.

  let songPos = 0, songBar = 0, songFirstBar = true;

  function songReset() {
    songPos = 0; songBar = 0; songFirstBar = true;
  }

  // called at the top of every bar while playing in song mode. Only toggles a
  // class on the chips — never rebuilds them, since this runs inside the
  // audio scheduler's tick.
  function songTick() {
    if (!state.song.length) return;
    if (songFirstBar) { songFirstBar = false; highlightSong(); return; } // row 0 already active
    songBar++;
    if (songBar >= state.song[songPos].repeats) {
      songBar = 0;
      songPos = (songPos + 1) % state.song.length; // the arrangement loops
      setActiveBank(state.song[songPos].bank);
      highlightSong();
    }
  }

  // one pattern reference per bar of the arrangement — what export walks
  function songPatterns() {
    const bars = [];
    state.song.forEach((row) => {
      for (let i = 0; i < row.repeats; i++) bars.push(state.banks[row.bank].pattern);
    });
    return bars;
  }

  // what WAV/stem/MIDI export should render: the whole song, or 2 bars of the loop
  function renderBars() {
    if (state.mode === "song") {
      const bars = songPatterns();
      if (bars.length) return bars;
    }
    return [state.pattern, state.pattern];
  }

  const songTotalBars = () => state.song.reduce((n, r) => n + r.repeats, 0);

  // ---------- algorithmic generators ----------
  // The pattern-filling logic lives in js/generators.js (window.ClawGen) as
  // pure functions; this file just wires them to state + the seeded rng.

  // seeded PRNG (mulberry32): generators are reproducible per seed, so future
  // style packs can ship a seed and replay the exact same pattern. rng also
  // rolls per-step probability during playback.
  let rng = Math.random;
  function reseed() {
    let a = crypto.getRandomValues(new Uint32Array(1))[0];
    const seed = a;
    rng = function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return seed;
  }
  // the helpers bundle generators need — keeps ClawGen free of app-state access
  const genHelpers = () => ({ STEPS, PENTA, TRACKS, withMods });

  // one-deep undo for every destructive pattern change (Ctrl/Cmd+Z)
  let undoBuf = null;
  function snapshot() {
    undoBuf = JSON.parse(JSON.stringify(state.pattern));
  }
  function undo() {
    if (!undoBuf) return;
    state.pattern = undoBuf;
    state.banks[state.activeBank].pattern = state.pattern; // keep bank storage in sync
    undoBuf = null;
    paintGrid();
    autosave();
    toast("Undone");
  }

  function generate(style) {
    snapshot();
    reseed();
    const bpm = window.ClawGen.generate(style, state.pattern, rng, genHelpers());
    state.bpm = bpm;
    bpmInput.value = bpm;
    if (master) applyFx(); // tempo changed → re-sync the dub delay
    // fresh material: the remix chain starts over
    state.meta = { gen: 0, parent: null, src: "gen" };
    arrival = null;
    hideArrival();
    paintGrid();
    autosave();
    toast(`${style.toUpperCase()} pattern generated`);
  }

  function mutate() {
    snapshot();
    reseed();
    window.ClawGen.mutate(state.pattern, rng, genHelpers());
    paintGrid();
    autosave();
    toast("Pattern mutated");
  }

  function clearPattern() {
    snapshot();
    TRACKS.forEach((t) => { state.pattern[t.id] = new Array(STEPS).fill(0); });
    state.meta = { gen: 0, parent: null, src: "hand" };
    arrival = null;
    hideArrival();
    paintGrid();
    autosave();
    toast("Pattern cleared — Ctrl+Z to undo");
  }

  // ---------- AI generation ----------

  const AI_SYSTEM = `You are a drum machine pattern programmer for CLAW, a 16-step groovebox.
Reply with ONLY a JSON object, no prose, no markdown fences. Schema:
{
 "bpm": <int 60-200>,
 "swing": <int 0-60>,
 "kick":  [16 ints, 0=off 1=hit],
 "snare": [16 ints, 0/1],
 "clap":  [16 ints, 0/1],
 "chh":   [16 ints, 0/1, closed hihat],
 "ohh":   [16 ints, 0/1, open hihat],
 "bass":  [16 ints, 0=off or MIDI note 28-45],
 "acid":  [16 ints, 0=off or MIDI note 40-69, resonant 303-style lead],
 "stab":  [16 ints, 0=off or MIDI note 50-65, minor chord stab]
}
Musical rules: steps 0,4,8,12 are the quarter-note beats. Prefer the A minor
pentatonic (A,C,D,E,G). Make basslines and acid lines groove against the kick.
Use rests — silence is part of the groove.`;

  async function aiGenerate() {
    const provider = document.getElementById("ai-provider").value;
    const model = document.getElementById("ai-model").value.trim();
    const key = document.getElementById("ai-key").value.trim();
    const prompt = document.getElementById("ai-prompt").value.trim() || "peak time techno loop";
    const status = document.getElementById("ai-status");
    if (!key) { status.textContent = "ADD YOUR API KEY FIRST — IT NEVER LEAVES THIS BROWSER"; return; }
    localStorage.setItem("claw-ai", JSON.stringify({
      provider, model, url: document.getElementById("ai-url").value,
    }));
    status.textContent = "THINKING…";
    try {
      let text;
      if (provider === "anthropic") {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true",
          },
          body: JSON.stringify({
            model, max_tokens: 1500, system: AI_SYSTEM,
            messages: [{ role: "user", content: prompt }],
          }),
        });
        if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 200)}`);
        text = (await res.json()).content[0].text;
      } else {
        const base = document.getElementById("ai-url").value.trim().replace(/\/$/, "");
        const res = await fetch(`${base}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: AI_SYSTEM },
              { role: "user", content: prompt },
            ],
          }),
        });
        if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 200)}`);
        text = (await res.json()).choices[0].message.content;
      }
      applyAiPattern(text);
      status.textContent = "PATTERN LOADED ●";
    } catch (err) {
      status.textContent = `ERROR — ${String(err.message || err).toUpperCase().slice(0, 120)}`;
    }
  }

  function applyAiPattern(text) {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("no JSON in reply");
    const data = JSON.parse(m[0]);
    snapshot();
    TRACKS.forEach((t) => {
      if (!Array.isArray(data[t.id])) return;
      const src = data[t.id];
      const arr = [];
      for (let s = 0; s < STEPS; s++) arr.push(sanitizeCell(src[s], t));
      state.pattern[t.id] = arr;
    });
    if (data.bpm) { state.bpm = Math.min(200, Math.max(60, data.bpm | 0)); bpmInput.value = state.bpm; if (master) applyFx(); }
    if (data.swing != null) {
      state.swing = Math.min(60, Math.max(0, data.swing | 0));
      swingInput.value = state.swing;
      swingVal.textContent = state.swing + "%";
    }
    // AI output is fresh material: the remix chain starts over
    state.meta = { gen: 0, parent: null, src: "ai" };
    arrival = null;
    hideArrival();
    paintGrid();
    autosave();
  }

  // ---------- export: WAV, stems, MIDI ----------
  // All three walk the same bars and the same triggerStep, so a stem sums back
  // into the mix and the MIDI lines up with the audio.

  function download(blob, filename) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }

  /* A bounce must be deterministic: roll every probabilistic step ONCE, seeded
     from the material itself. The WAV, each stem and the MIDI then agree, and
     exporting the same thing twice gives the same file. Live playback still
     rolls fresh dice every pass — that's the point of probability. */
  function exportDecisions(bars) {
    let a = hash32(JSON.stringify(bars)) || 1;
    const r = () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return bars.map((pat) => {
      const bar = {};
      TRACKS.forEach((t) => {
        bar[t.id] = pat[t.id].map((cell) => {
          if (!cell) return false;
          const p = cellProb(cell);
          return p >= 100 ? true : r() * 100 < p;
        });
      });
      return bar;
    });
  }

  // render `bars` (one pattern reference per bar) offline; `only` isolates a
  // single track for stem passes; `decisions` fixes the probability rolls
  async function renderOffline(bars, only, decisions) {
    const spb = secondsPerStep();
    const dur = spb * STEPS * bars.length;
    // tail must outlast the wet FX so reverb/delay decay isn't chopped
    const tail = Math.min(6, reverbSeconds(state.fx.reverbDecay) + 1.5);
    const sr = 44100;
    const durSamples = Math.round(dur * sr);
    const off = new OfflineAudioContext(2, durSamples + Math.ceil(tail * sr), sr);
    const m = masterChain(off);
    const ob = makeBuses(off, m);
    m.filter.frequency.value = filterFreq();
    m.gain.gain.value = state.volume / 100;
    // match the live FX character in the render
    m.delay.delayTime.value = delayTimeSec();
    m.fb.gain.value = (state.fx.delayFb / 100) * 0.85;
    // fixed IR seed → identical reverb on the mix and every stem, and a
    // re-export is byte-identical
    m.convolver.buffer = window.ClawSynth.makeIR(off, reverbSeconds(state.fx.reverbDecay), 2.5, 0x51ee5eed);
    bars.forEach((pat, bar) => {
      const d = decisions[bar];
      for (let s = 0; s < STEPS; s++) {
        const t = swungTime(bar * STEPS * spb + s * spb, s, spb);
        triggerStep(off, ob, s, t, spb, { pattern: pat, only, decide: (id, st) => d[id][st] });
      }
    });
    const buf = await off.startRendering();
    return { buf, durSamples, sr };
  }

  // A loop must be seamless, so its FX tail wraps back onto the start (modulo:
  // the tail can be longer than the loop). A song ends, so it keeps its tail.
  function toChannels(buf, durSamples, fold) {
    const chans = [];
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const src = buf.getChannelData(c);
      if (!fold) { chans.push(new Float32Array(src)); continue; }
      const out = new Float32Array(durSamples);
      out.set(src.subarray(0, durSamples));
      for (let i = 0; i < src.length - durSamples; i++) out[i % durSamples] += src[durSamples + i];
      chans.push(out);
    }
    return chans;
  }

  const isSong = () => state.mode === "song";
  const trackHasNotes = (id, bars) => bars.some((pat) => pat[id].some(cellOn));

  async function exportWav() {
    bumpGenIfRemixed(); // the WAV's embedded URL must match what COPY LINK gives
    const bars = renderBars();
    toast(isSong() ? `Rendering ${bars.length}-bar song…` : "Rendering 2-bar loop…");
    const { buf, durSamples, sr } = await renderOffline(bars, null, exportDecisions(bars));
    const chans = toChannels(buf, durSamples, !isSong());
    const name = loopName().toLowerCase();
    const comment = `Made with CLAW — remix this exact loop: ${buildShareUrl(serializeProject())}`;
    const blob = window.ClawExport.encodeWav(chans, sr, comment);
    download(blob, `claw-${name}${isSong() ? "-song" : ""}-${state.bpm}bpm.wav`);
    toast(`Exported ${name.toUpperCase()} @ ${state.bpm} BPM`);
  }

  // one WAV per track, zipped — drag the folder straight into a DAW. Muted
  // tracks are out of the mix, so they get no stem (never ship a silent file).
  async function exportStems() {
    const bars = renderBars();
    const parts = TRACKS.filter((t) => !state.mutes[t.id] && trackHasNotes(t.id, bars));
    if (!parts.length) { toast("Nothing to export — the pattern is empty"); return; }
    const decisions = exportDecisions(bars); // one table → the stems sum to the mix
    const name = loopName().toLowerCase();
    const files = [];
    for (let i = 0; i < parts.length; i++) {
      toast(`Rendering stem ${i + 1}/${parts.length} — ${parts[i].name}…`);
      const { buf, durSamples, sr } = await renderOffline(bars, parts[i].id, decisions);
      const chans = toChannels(buf, durSamples, !isSong());
      const blob = window.ClawExport.encodeWav(chans, sr, null);
      files.push({ name: `claw-${name}-${parts[i].id}.wav`, data: new Uint8Array(await blob.arrayBuffer()) });
    }
    download(window.ClawExport.zipStore(files), `claw-${name}-stems.zip`);
    toast(`Exported ${files.length} stems`);
  }

  // General MIDI drum map so the kit lands on the right pads in any DAW
  const GM_DRUM = { kick: 36, snare: 38, clap: 39, chh: 42, ohh: 46 };
  const NOTE_CH = { bass: 0, acid: 1, stab: 2 };
  const PPQ = 480;

  function exportMidi() {
    const bars = renderBars();
    const decisions = exportDecisions(bars); // same hits as the WAV and the stems
    const tps = PPQ / 4; // ticks per 16th step
    const tracks = [];
    TRACKS.forEach((t) => {
      const events = [];
      bars.forEach((pat, bar) => {
        for (let s = 0; s < STEPS; s++) {
          const cell = pat[t.id][s];
          if (!cell || !decisions[bar][t.id][s]) continue;
          const swingTicks = s % 2 === 1 ? Math.round((state.swing / 100) * 0.5 * tps) : 0;
          const tick = bar * STEPS * tps + s * tps + swingTicks;
          const vel = Math.max(1, Math.min(127, Math.round(100 * cellVel(cell))));
          const note = t.type === "drum" ? GM_DRUM[t.id] : cellNote(cell);
          const durTicks = t.type === "drum" ? 60 : (t.id === "stab" ? tps * 2 : Math.round(tps * 0.9));
          events.push({ tick, note, vel, durTicks });
        }
      });
      // A long note must not overlap the next hit of the same pitch — the audio
      // layers two voices, but a DAW would cut the first note short instead.
      events.sort((a, b) => a.tick - b.tick);
      for (let i = 0; i < events.length; i++) {
        for (let j = i + 1; j < events.length; j++) {
          if (events[j].note === events[i].note) {
            events[i].durTicks = Math.max(1, Math.min(events[i].durTicks, events[j].tick - events[i].tick - 1));
            break;
          }
        }
      }
      // MIDI carries the notes, not the mix — muted tracks still export so you
      // can rebuild the arrangement in your DAW
      if (events.length) {
        tracks.push({ name: t.name, channel: t.type === "drum" ? 9 : NOTE_CH[t.id], events });
      }
    });
    if (!tracks.length) { toast("Nothing to export — the pattern is empty"); return; }
    const blob = window.ClawExport.encodeMidi({ bpm: state.bpm, ppq: PPQ, tracks });
    download(blob, `claw-${loopName().toLowerCase()}${isSong() ? "-song" : ""}.mid`);
    toast(`Exported MIDI — ${tracks.length} tracks @ ${state.bpm} BPM`);
  }

  // ---------- project format v1 ----------
  // ONE schema for share links, project files, and autosave — and ONE sanitizer.
  // Legacy pre-v1 hashes ({bpm, swing, pattern}) parse through the same path
  // forever: never break an old share URL.

  const ADJ = ["IRON","NEON","ACID","VELVET","CHROME","DELTA","RAPID","STATIC",
    "HOLLOW","PRIME","NIGHT","SOLAR","MAGNET","VAPOR","TURBO","ZERO",
    "ECHO","PULSE","NOVA","GRID","WIRE","CARBON","COBALT","LUNAR",
    "PANIC","ROGUE","SIGNAL","STROBE","TIGER","ULTRA","VOID","AMBER"];
  const NOUN = ["MOTH","WOLF","ENGINE","GARDEN","MIRROR","HAMMER","ORBIT","RITUAL",
    "CIRCUIT","METEOR","PANTHER","REACTOR","SIREN","TUNNEL","VECTOR","BUNKER",
    "CANYON","DYNAMO","FALCON","GLACIER","HORIZON","JAGUAR","KERNEL","LAGOON",
    "MOTOR","NEEDLE","OCEAN","PISTON","QUARTZ","ROTOR","SPIDER","TURBINE"];

  function hash32(str) { // FNV-1a
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }
  const patternHash = () => hash32(JSON.stringify(state.pattern));
  // deterministic 2-word loop name: same pattern, same name, on every machine
  const loopName = (h = patternHash()) => `${ADJ[h & 31]}-${NOUN[(h >>> 5) & 31]}`;
  const hash8 = (h = patternHash()) => h.toString(16).padStart(8, "0");

  function serializeProject() {
    // keep the bank store in sync with whatever's live before reading it out
    state.banks[state.activeBank].pattern = state.pattern;
    return {
      format: "claw", v: 1,
      bpm: state.bpm, swing: state.swing, filter: state.filter, volume: state.volume,
      // top-level `pattern` mirrors the active bank — additive fields never
      // bump the version, so anything reading only v1's original shape still
      // gets a sensible single pattern; `banks` is for consumers that know it
      pattern: state.pattern,
      banks: state.banks.map((b) => ({ pattern: b.pattern })),
      activeBank: state.activeBank,
      levels: state.levels, mutes: state.mutes,
      // v0.4 mixer/FX + sound-design, v0.5 arrangement — additive fields,
      // format version stays 1
      pans: state.pans, solos: state.solos, sends: state.sends, fx: state.fx,
      voice: state.voice,
      mode: state.mode, song: state.song.map((r) => ({ bank: r.bank, repeats: r.repeats })),
      meta: { name: loopName(), gen: state.meta.gen, parent: state.meta.parent, src: state.meta.src },
    };
  }

  const clampInt = (v, lo, hi, dflt) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
  };

  // the single sanitize/clamp entry point: share links, project files, and
  // autosave all flow through here — never trust serialized input
  function applyProject(data, src) {
    if (!data || typeof data !== "object") throw new Error("not a CLAW project");
    const banksData = Array.isArray(data.banks) && data.banks.length
      ? data.banks
      : (data.pattern ? [{ pattern: data.pattern }] : null); // legacy: one pattern, no banks
    if (!banksData) throw new Error("not a CLAW project");
    state.banks = Array.from({ length: BANKS }, (_, i) => {
      const p = emptyPatternSet();
      const raw = banksData[i] && banksData[i].pattern;
      if (raw) {
        TRACKS.forEach((t) => {
          if (!Array.isArray(raw[t.id])) return;
          const arr = [];
          for (let s = 0; s < STEPS; s++) arr.push(sanitizeCell(raw[t.id][s], t));
          p[t.id] = arr;
        });
      }
      return { pattern: p };
    });
    state.activeBank = clampInt(data.activeBank, 0, BANKS - 1, 0);
    state.pattern = state.banks[state.activeBank].pattern;
    queuedBank = null; // a freshly loaded project replaces the whole bank set
    undoBuf = null; // a stale undo buffer must never overwrite freshly loaded data
    if (data.bpm != null) state.bpm = clampInt(data.bpm, 60, 200, 128);
    if (data.swing != null) state.swing = clampInt(data.swing, 0, 60, 0);
    if (data.filter != null) state.filter = clampInt(data.filter, 0, 100, 100);
    if (data.volume != null) state.volume = clampInt(data.volume, 0, 100, 85);
    if (data.levels && typeof data.levels === "object") {
      TRACKS.forEach((t) => {
        if (data.levels[t.id] != null) {
          const l = Number(data.levels[t.id]);
          state.levels[t.id] = Number.isFinite(l) ? Math.min(1, Math.max(0, l)) : 0.8;
        }
      });
    }
    if (data.mutes && typeof data.mutes === "object") {
      TRACKS.forEach((t) => { state.mutes[t.id] = !!data.mutes[t.id]; });
    }
    // v0.4 mixer/FX — all optional, absent fields keep their defaults
    TRACKS.forEach((t) => {
      state.pans[t.id] = data.pans && data.pans[t.id] != null ? clampInt(data.pans[t.id], -100, 100, 0) : 0;
      state.solos[t.id] = !!(data.solos && data.solos[t.id]);
      const sd = data.sends && data.sends[t.id];
      state.sends[t.id] = {
        delay: sd ? clampInt(sd.delay, 0, 100, 0) : 0,
        reverb: sd ? clampInt(sd.reverb, 0, 100, 0) : 0,
      };
    });
    const fx = data.fx && typeof data.fx === "object" ? data.fx : {};
    state.fx = {
      delayFb: clampInt(fx.delayFb, 0, 100, 35),
      reverbSend: clampInt(fx.reverbSend, 0, 100, 0),
      reverbDecay: clampInt(fx.reverbDecay, 0, 100, 60),
    };
    // sound-design params: clamp each against its VOICE_PARAMS range, default
    // any missing one — one data-driven pass, so adding a param can't desync
    // arrangement — clamp rows, drop junk, always leave at least one row
    state.mode = data.mode === "song" ? "song" : "loop";
    const rows = Array.isArray(data.song) ? data.song.slice(0, 64) : [];
    state.song = rows
      .filter((r) => r && typeof r === "object")
      .map((r) => ({ bank: clampInt(r.bank, 0, BANKS - 1, 0), repeats: clampInt(r.repeats, 1, 64, 4) }));
    if (!state.song.length) state.song = [{ bank: 0, repeats: 4 }];
    songReset();

    TRACKS.forEach((t) => {
      // typeof null === "object", so guard null explicitly (a null voice entry
      // must fall back to defaults, not throw and reject the whole project)
      const vsrc = data.voice && data.voice[t.id];
      const src = (vsrc && typeof vsrc === "object") ? vsrc : {};
      const v = {};
      VOICE_PARAMS[t.id].forEach((m) => {
        const n = Number(src[m.k]);
        v[m.k] = Number.isFinite(n) ? Math.min(m.max, Math.max(m.min, n)) : m.def;
      });
      state.voice[t.id] = v;
    });
    const m = data.meta && typeof data.meta === "object" ? data.meta : {};
    state.meta = {
      gen: clampInt(m.gen, 0, 9999, 0),
      parent: typeof m.parent === "string" ? m.parent.slice(0, 8) : null,
      src: src || (typeof m.src === "string" ? m.src.slice(0, 8) : "hand"),
    };
    // keep live playback in sync: loaded mixer/FX settings must reach the
    // audio graph too, or what you hear diverges from what you'd export
    pushAllBusParams();
  }

  // shove every mixer param from state onto the live audio graph
  function pushAllBusParams() {
    if (!buses) return;
    const now = ctx.currentTime;
    TRACKS.forEach((t) => {
      buses[t.id].gain.gain.setTargetAtTime(state.levels[t.id], now, 0.02);
      buses[t.id].pan.pan.setTargetAtTime(state.pans[t.id] / 100, now, 0.02);
      buses[t.id].sendDelay.gain.setTargetAtTime(sendScale(state.sends[t.id].delay), now, 0.02);
      buses[t.id].sendReverb.gain.setTargetAtTime(sendScale(state.sends[t.id].reverb), now, 0.02);
    });
    applyFx();
  }

  function syncTransportUI() {
    bpmInput.value = state.bpm;
    swingInput.value = state.swing;
    swingVal.textContent = state.swing + "%";
    filterInput.value = state.filter;
    filterVal.textContent = state.filter == 100 ? "OPEN" : Math.round(filterFreq()) + " Hz";
    volumeInput.value = state.volume;
    volumeVal.textContent = state.volume;
    applyFilter();
    applyVolume();
  }

  function autosave() {
    try { localStorage.setItem("claw-autosave", JSON.stringify(serializeProject())); } catch { /* quota */ }
  }

  // ---------- share link ----------

  function buildShareUrl(proj) {
    const hash = btoa(unescape(encodeURIComponent(JSON.stringify(proj))));
    // location.origin is the string "null" on file:// — fall back to the raw href
    const base = !location.origin || location.origin === "null"
      ? location.href.split("#")[0]
      : location.origin + location.pathname;
    return `${base}#p=${hash}`;
  }

  // arriving via a shared link and changing the pattern extends the chain —
  // shared by COPY LINK and EXPORT WAV so both publish the same provenance
  function bumpGenIfRemixed() {
    if (arrival && hash8() !== arrival.hash8) {
      state.meta.gen = arrival.gen + 1;
      state.meta.parent = arrival.hash8;
      arrival = { hash8: hash8(), gen: state.meta.gen };
      autosave();
    }
  }

  function shareLink() {
    bumpGenIfRemixed();
    const proj = serializeProject();
    const url = buildShareUrl(proj);
    navigator.clipboard.writeText(url).then(
      () => toast(`${proj.meta.name} GEN ${proj.meta.gen} copied — send it on`),
      () => { prompt("Copy this link:", url); }
    );
  }

  function loadFromHash() {
    const m = location.hash.match(/#p=(.+)/);
    if (!m) return false;
    try {
      const data = JSON.parse(decodeURIComponent(escape(atob(m[1]))));
      applyProject(data, "link");
      arrival = { hash8: hash8(), gen: state.meta.gen };
      showArrival(`LOADED: ${loopName()} · GEN ${state.meta.gen} — remix it, then COPY LINK to extend the chain`);
      return true;
    } catch { return false; /* bad hash — boot with defaults */ }
  }

  // ---------- save / load project files ----------

  function saveProject() {
    const proj = serializeProject();
    const blob = new Blob([JSON.stringify(proj, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `claw-${proj.meta.name.toLowerCase()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    toast(`Saved ${proj.meta.name} as a file you own`);
  }

  function loadProjectFile(file) {
    file.text().then((txt) => {
      try {
        applyProject(JSON.parse(txt), "file");
        // a loaded file is its own lineage — never chain it to a previous link
        arrival = null;
        hideArrival();
        buildGrid();
        syncTransportUI();
        paintBankButtons();
        paintMode();
        syncMixerUI();
        syncSoundUI();
        autosave();
        toast(`Loaded ${loopName()}`);
      } catch {
        toast("That is not a CLAW project file");
      }
    }).catch(() => toast("Could not read that file"));
  }

  // ---------- controls wiring ----------

  const playBtn = document.getElementById("play");
  const bpmInput = document.getElementById("bpm");
  const swingInput = document.getElementById("swing");
  const swingVal = document.getElementById("swing-val");
  const filterInput = document.getElementById("filter");
  const filterVal = document.getElementById("filter-val");
  const volumeInput = document.getElementById("volume");
  const volumeVal = document.getElementById("volume-val");
  const toastEl = document.getElementById("toast");

  playBtn.addEventListener("click", () => (playing ? stop() : play()));

  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "z" && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) {
      e.preventDefault();
      undo();
      return;
    }
    if (e.code === "Space" && !e.repeat && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) {
      e.preventDefault();
      playing ? stop() : play();
    }
  });

  bpmInput.addEventListener("change", () => {
    state.bpm = Math.min(200, Math.max(60, +bpmInput.value || 128));
    bpmInput.value = state.bpm;
    if (master) applyFx(); // the dub delay is tempo-synced
    updateSongLen();       // song duration is tempo-dependent
    autosave();
  });
  document.querySelectorAll("[data-bpm]").forEach((b) =>
    b.addEventListener("click", () => {
      state.bpm = Math.min(200, Math.max(60, state.bpm + +b.dataset.bpm));
      bpmInput.value = state.bpm;
      if (master) applyFx();
      updateSongLen();
      autosave();
    })
  );

  swingInput.addEventListener("input", () => {
    state.swing = +swingInput.value;
    swingVal.textContent = state.swing + "%";
    autosave();
  });

  function filterFreq() {
    // 0..100 → 120 Hz .. 18 kHz, exponential
    return 120 * Math.pow(150, filterInput.value / 100);
  }
  function applyFilter() {
    if (!master) return;
    master.filter.frequency.setTargetAtTime(filterFreq(), ctx.currentTime, 0.02);
  }
  filterInput.addEventListener("input", () => {
    state.filter = +filterInput.value;
    filterVal.textContent = state.filter == 100 ? "OPEN" : Math.round(filterFreq()) + " Hz";
    applyFilter();
    autosave();
  });

  function applyVolume() {
    if (!master) return;
    master.gain.gain.setTargetAtTime(state.volume / 100, ctx.currentTime, 0.02);
  }
  volumeInput.addEventListener("input", () => {
    state.volume = +volumeInput.value;
    volumeVal.textContent = state.volume;
    applyVolume();
    autosave();
  });

  document.querySelectorAll("[data-style]").forEach((b) =>
    b.addEventListener("click", () => generate(b.dataset.style))
  );
  const bankBtns = [...document.querySelectorAll(".bank-btn")];
  bankBtns.forEach((b, i) => b.addEventListener("click", () => selectBank(i)));

  // ---------- mode toggle + song timeline ----------

  const songEl = document.getElementById("song");
  const songChipsEl = document.getElementById("song-chips");
  const songLenEl = document.getElementById("song-len");
  const modeBtns = [...document.querySelectorAll(".seg-btn")];
  const BANK_LETTERS = ["A", "B", "C", "D"];
  const REPEAT_CYCLE = [1, 2, 4, 8, 16];

  modeBtns.forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));

  function setMode(mode) {
    state.mode = mode === "song" ? "song" : "loop";
    songReset();
    if (state.mode === "song" && playing && state.song.length) setActiveBank(state.song[0].bank);
    paintMode();
    autosave();
  }

  function paintMode() {
    modeBtns.forEach((b) => {
      const on = b.dataset.mode === state.mode;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", String(on));
    });
    songEl.hidden = state.mode !== "song";
    if (state.mode === "song") paintSong();
  }

  function paintSong() {
    songChipsEl.innerHTML = "";
    state.song.forEach((row, i) => {
      const chip = document.createElement("div");
      chip.className = "chip" + (playing && state.mode === "song" && i === songPos ? " playing" : "");

      const bank = document.createElement("button");
      bank.className = "chip-bank";
      bank.textContent = BANK_LETTERS[row.bank];
      bank.title = "Click to change bank";
      bank.setAttribute("aria-label", `Section ${i + 1} bank ${BANK_LETTERS[row.bank]}`);
      // update this chip's own label rather than repainting the row — a
      // rebuild would destroy the button under the cursor and drop focus
      bank.addEventListener("click", () => {
        row.bank = (row.bank + 1) % BANKS;
        bank.textContent = BANK_LETTERS[row.bank];
        bank.setAttribute("aria-label", `Section ${i + 1} bank ${BANK_LETTERS[row.bank]}`);
        autosave();
      });

      const rep = document.createElement("button");
      rep.className = "chip-rep";
      rep.textContent = row.repeats + "×";
      rep.title = "Click to change length in bars";
      rep.setAttribute("aria-label", `Section ${i + 1} length ${row.repeats} bars`);
      rep.addEventListener("click", () => {
        const idx = REPEAT_CYCLE.indexOf(row.repeats);
        row.repeats = REPEAT_CYCLE[(idx < 0 ? 0 : idx + 1) % REPEAT_CYCLE.length];
        rep.textContent = row.repeats + "×";
        rep.setAttribute("aria-label", `Section ${i + 1} length ${row.repeats} bars`);
        updateSongLen();
        autosave();
      });

      const del = document.createElement("button");
      del.className = "chip-del";
      del.textContent = "✕";
      del.title = "Remove section";
      del.setAttribute("aria-label", `Remove section ${i + 1}`);
      del.addEventListener("click", () => {
        if (state.song.length <= 1) { toast("A song needs at least one section"); return; }
        state.song.splice(i, 1);
        songReset();
        // the playhead jumped back to section 0 — the sounding bank must follow,
        // or the audio keeps playing the deleted section's bank
        if (playing && state.mode === "song") setActiveBank(state.song[0].bank);
        paintSong(); autosave();
      });

      chip.append(bank, rep, del);
      songChipsEl.appendChild(chip);
    });
    updateSongLen();
  }

  function updateSongLen() {
    const bars = songTotalBars();
    const secs = bars * STEPS * secondsPerStep();
    songLenEl.textContent = `${bars} bars · ${Math.floor(secs / 60)}:${String(Math.round(secs % 60)).padStart(2, "0")}`;
  }

  // playhead only — safe to call from the audio scheduler
  function highlightSong() {
    [...songChipsEl.children].forEach((c, i) => {
      c.classList.toggle("playing", playing && state.mode === "song" && i === songPos);
    });
  }

  document.getElementById("song-add").addEventListener("click", () => {
    if (state.song.length >= 64) { toast("64 sections is the limit"); return; }
    const last = state.song[state.song.length - 1];
    state.song.push({ bank: last ? (last.bank + 1) % BANKS : 0, repeats: 4 });
    paintSong(); autosave();
  });

  document.getElementById("mutate").addEventListener("click", mutate);
  document.getElementById("clear").addEventListener("click", clearPattern);
  document.getElementById("export").addEventListener("click", exportWav);
  document.getElementById("export-stems").addEventListener("click", exportStems);
  document.getElementById("export-midi").addEventListener("click", exportMidi);
  document.getElementById("share").addEventListener("click", shareLink);
  document.getElementById("save").addEventListener("click", saveProject);
  const loadFileInput = document.getElementById("load-file");
  document.getElementById("load").addEventListener("click", () => loadFileInput.click());
  loadFileInput.addEventListener("change", () => {
    if (loadFileInput.files[0]) loadProjectFile(loadFileInput.files[0]);
    loadFileInput.value = "";
  });

  const arrivalEl = document.getElementById("arrival");
  function showArrival(msg) { arrivalEl.textContent = msg; arrivalEl.hidden = false; }
  function hideArrival() { arrivalEl.hidden = true; }

  const aiDrawer = document.getElementById("ai-drawer");
  const aiToggle = document.getElementById("ai-toggle");
  aiToggle.addEventListener("click", () => {
    const open = aiDrawer.hidden;
    aiDrawer.hidden = !open;
    aiToggle.setAttribute("aria-expanded", String(open));
    aiToggle.textContent = open ? "AI ⌃" : "AI ⌄";
  });

  // ---------- mixer + FX drawer ----------

  const mixerDrawer = document.getElementById("mixer-drawer");
  const mixToggle = document.getElementById("mix-toggle");
  const stripsEl = document.getElementById("strips");
  const fxDecay = document.getElementById("fx-decay");
  const fxDecayVal = document.getElementById("fx-decay-val");
  const fxFb = document.getElementById("fx-fb");
  const fxFbVal = document.getElementById("fx-fb-val");
  let mixerBuilt = false;

  mixToggle.addEventListener("click", () => {
    const open = mixerDrawer.hidden;
    mixerDrawer.hidden = !open;
    mixToggle.setAttribute("aria-expanded", String(open));
    mixToggle.textContent = open ? "MIX ⌃" : "MIX ⌄";
    // first open builds fresh from state; later opens resync (rebuild)
    if (open) {
      if (!mixerBuilt) { buildMixer(); mixerBuilt = true; } else { syncMixerUI(); }
    }
  });

  fxDecay.addEventListener("input", () => {
    state.fx.reverbDecay = +fxDecay.value;
    fxDecayVal.textContent = reverbSeconds(state.fx.reverbDecay).toFixed(1) + " s";
    if (master) applyFx();
    autosave();
  });
  fxFb.addEventListener("input", () => {
    state.fx.delayFb = +fxFb.value;
    fxFbVal.textContent = state.fx.delayFb + "%";
    if (master) applyFx();
    autosave();
  });

  // one compact channel strip per track: SOLO · PAN · DLY send · RVB send
  const stripEls = {}; // trackId -> { solo, pan, dly, rvb }
  function buildMixer() {
    stripsEl.innerHTML = "";
    TRACKS.forEach((t) => {
      const strip = document.createElement("div");
      strip.className = "strip";

      const label = document.createElement("span");
      label.className = "strip-name silk";
      label.textContent = t.name;
      strip.appendChild(label);

      const solo = document.createElement("button");
      solo.className = "solo-btn" + (state.solos[t.id] ? " on" : "");
      solo.textContent = "S";
      solo.setAttribute("aria-label", `Solo ${t.name}`);
      solo.setAttribute("aria-pressed", String(state.solos[t.id]));
      solo.addEventListener("click", () => {
        state.solos[t.id] = !state.solos[t.id];
        solo.classList.toggle("on", state.solos[t.id]);
        solo.setAttribute("aria-pressed", String(state.solos[t.id]));
        refreshRowStates();
        autosave();
      });
      strip.appendChild(solo);

      strip.appendChild(makeStripKnob("PAN", -100, 100, state.pans[t.id],
        (v) => {
          state.pans[t.id] = v;
          if (buses) buses[t.id].pan.pan.setTargetAtTime(v / 100, ctx.currentTime, 0.02);
          autosave();
        },
        (v) => (v === 0 ? "C" : (v < 0 ? "L" : "R") + Math.abs(v)), 0));

      strip.appendChild(makeStripKnob("DLY", 0, 100, state.sends[t.id].delay,
        (v) => {
          state.sends[t.id].delay = v;
          if (buses) buses[t.id].sendDelay.gain.setTargetAtTime(sendScale(v), ctx.currentTime, 0.02);
          autosave();
        },
        (v) => v + "%", 0));

      strip.appendChild(makeStripKnob("RVB", 0, 100, state.sends[t.id].reverb,
        (v) => {
          state.sends[t.id].reverb = v;
          if (buses) buses[t.id].sendReverb.gain.setTargetAtTime(sendScale(v), ctx.currentTime, 0.02);
          autosave();
        },
        (v) => v + "%", 0));

      stripsEl.appendChild(strip);
      stripEls[t.id] = strip;
    });
  }

  function makeStripKnob(name, min, max, value, onChange, fmt, resetTo, step = 1) {
    const wrap = document.createElement("div");
    wrap.className = "strip-ctl";
    const lab = document.createElement("label");
    lab.className = "silk strip-ctl-label";
    lab.textContent = name;
    const input = document.createElement("input");
    input.type = "range";
    // step BEFORE value: a range input sanitizes value against the current
    // step, so a fractional default set while step is still 1 snaps to min
    input.min = min; input.max = max; input.step = step; input.value = value;
    input.className = "strip-slider";
    input.dataset.ctl = name;
    input.setAttribute("aria-label", name);
    const read = document.createElement("span");
    read.className = "strip-read";
    read.textContent = fmt(value);
    input.addEventListener("input", () => {
      const v = +input.value;
      read.textContent = fmt(v);
      onChange(v);
    });
    input.addEventListener("dblclick", () => {
      input.value = resetTo;
      read.textContent = fmt(resetTo);
      onChange(resetTo);
    });
    wrap.appendChild(lab);
    wrap.appendChild(input);
    wrap.appendChild(read);
    return wrap;
  }

  // repaint the whole mixer drawer from state (after load/share arrival).
  // Rebuilding the strips is cheap (8 rows) and reads every value fresh from
  // state, so there's no slider/readout desync to chase.
  function syncMixerUI() {
    fxDecay.value = state.fx.reverbDecay;
    fxDecayVal.textContent = reverbSeconds(state.fx.reverbDecay).toFixed(1) + " s";
    fxFb.value = state.fx.delayFb;
    fxFbVal.textContent = state.fx.delayFb + "%";
    if (mixerBuilt) buildMixer();
  }

  // ---------- sound-design drawer ----------
  // One strip per track, one knob per VOICE_PARAMS entry. Changes write into
  // state.voice[id][k]; the next triggered step reads them — no live node to
  // update, so it always matches what export renders.

  const soundDrawer = document.getElementById("sound-drawer");
  const soundToggle = document.getElementById("sound-toggle");
  const soundStripsEl = document.getElementById("sound-strips");
  let soundBuilt = false;

  soundToggle.addEventListener("click", () => {
    const open = soundDrawer.hidden;
    soundDrawer.hidden = !open;
    soundToggle.setAttribute("aria-expanded", String(open));
    soundToggle.textContent = open ? "SOUND ⌃" : "SOUND ⌄";
    if (open) {
      if (!soundBuilt) { buildSound(); soundBuilt = true; } else { buildSound(); }
    }
  });

  function buildSound() {
    soundStripsEl.innerHTML = "";
    TRACKS.forEach((t) => {
      const strip = document.createElement("div");
      strip.className = "strip strip--sound";
      const label = document.createElement("span");
      label.className = "strip-name silk";
      label.textContent = t.name;
      strip.appendChild(label);
      VOICE_PARAMS[t.id].forEach((m) => {
        // finer step for small ranges so short-decay defaults (e.g. chh 0.045)
        // land exactly on the grid and stay reachable
        const step = m.max <= 0.2 ? 0.005 : (m.max <= 5 ? 0.01 : 1);
        strip.appendChild(makeStripKnob(m.label, m.min, m.max, state.voice[t.id][m.k],
          (v) => { state.voice[t.id][m.k] = v; autosave(); },
          m.fmt, m.def, step));
      });
      soundStripsEl.appendChild(strip);
    });
  }

  function syncSoundUI() { if (soundBuilt) buildSound(); }

  document.getElementById("ai-provider").addEventListener("change", (e) => {
    const isOpenai = e.target.value === "openai";
    document.getElementById("ai-url-wrap").hidden = !isOpenai;
    document.getElementById("ai-model").value = isOpenai ? "gpt-4o-mini" : "claude-haiku-4-5";
  });
  document.getElementById("ai-generate").addEventListener("click", aiGenerate);

  // restore AI settings (never the key)
  try {
    const saved = JSON.parse(localStorage.getItem("claw-ai") || "null");
    if (saved && (saved.provider === "anthropic" || saved.provider === "openai")) {
      document.getElementById("ai-provider").value = saved.provider;
      if (typeof saved.model === "string" && saved.model) document.getElementById("ai-model").value = saved.model;
      if (typeof saved.url === "string" && saved.url) document.getElementById("ai-url").value = saved.url;
      document.getElementById("ai-url-wrap").hidden = saved.provider !== "openai";
    }
  } catch { /* ignore */ }

  let toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2200);
  }

  // ---------- boot ----------

  renderWordmark(document.getElementById("wordmark"), "CLAW");
  if (!loadFromHash()) {
    // no shared link: pick up where you left off — a closed tab never loses work
    try {
      const saved = JSON.parse(localStorage.getItem("claw-autosave") || "null");
      if (saved) applyProject(saved);
    } catch { /* corrupt autosave — boot with defaults */ }
  }
  buildGrid();
  syncTransportUI();
  paintBankButtons();
  paintMode();

  // installable + offline once visited; skipped on file:// and on localhost
  // (a cache-first worker would serve stale files during development)
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")
      && !["localhost", "127.0.0.1"].includes(location.hostname)) {
    navigator.serviceWorker.register("sw.js").catch(() => { /* unsupported */ });
  }
})();
