/* CLAW — Create Loops, Algorithms, Waveforms
   Browser groovebox: 8 tracks × 16 steps, algorithmic generators,
   optional AI pattern generation via your own API key, WAV export.
   No build step, no server, no accounts. */

(function () {
  "use strict";

  const { voices, masterChain } = window.ClawSynth;

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
    // remix provenance: gen counts edited-then-reshared hops, parent is the
    // 8-hex pattern hash this loop was remixed from
    meta: { gen: 0, parent: null, src: "hand" },
  };
  state.pattern = state.banks[state.activeBank].pattern;
  TRACKS.forEach((t) => { state.mutes[t.id] = false; state.levels[t.id] = 0.8; });

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

  function noteName(midi) {
    const names = ["A","A#","B","C","C#","D","D#","E","F","F#","G","G#"];
    return names[(midi - 33 + 120) % 12] + (Math.floor((midi - 24) / 12) + 1);
  }

  function buildGrid() {
    gridEl.innerHTML = "";
    TRACKS.forEach((t, ti) => {
      const row = document.createElement("div");
      row.className = "track";

      const name = document.createElement("div");
      name.className = "track-name";
      name.innerHTML = `<span class="idx">T${ti + 1}</span> ${t.name}`;
      row.appendChild(name);

      const mute = document.createElement("button");
      mute.className = "mute-btn" + (state.mutes[t.id] ? " muted" : "");
      mute.setAttribute("aria-label", `Mute ${t.name}`);
      mute.setAttribute("aria-pressed", String(state.mutes[t.id]));
      row.classList.toggle("muted-row", state.mutes[t.id]);
      mute.addEventListener("click", () => {
        state.mutes[t.id] = !state.mutes[t.id];
        mute.classList.toggle("muted", state.mutes[t.id]);
        mute.setAttribute("aria-pressed", String(state.mutes[t.id]));
        row.classList.toggle("muted-row", state.mutes[t.id]);
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
        if (buses) buses[t.id].gain.setTargetAtTime(state.levels[t.id], ctx.currentTime, 0.02);
        autosave();
      });
      level.addEventListener("dblclick", () => {
        level.value = 80;
        state.levels[t.id] = 0.8;
        if (buses) buses[t.id].gain.setTargetAtTime(0.8, ctx.currentTime, 0.02);
        autosave();
      });
      row.appendChild(level);

      gridEl.appendChild(row);
    });
    paintGrid();
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

  // per-track gain buses: the channel-strip seam that pan/solo/FX sends will
  // plug into later — voices never connect to the master input directly
  let buses = null;
  function makeBuses(c, m) {
    const b = {};
    TRACKS.forEach((t) => {
      b[t.id] = c.createGain();
      b[t.id].gain.value = state.levels[t.id];
      b[t.id].connect(m.input);
    });
    return b;
  }

  function ensureCtx() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = masterChain(ctx);
      buses = makeBuses(ctx, master);
      applyFilter();
      applyVolume();
    }
    if (ctx.state === "suspended") ctx.resume();
  }

  function secondsPerStep() {
    return 60 / state.bpm / 4;
  }

  function swungTime(base, step, spb) {
    return step % 2 === 1 ? base + (state.swing / 100) * spb * 0.5 : base;
  }

  // THE single trigger path — live playback and offline export both call this,
  // so what you hear is exactly what you export. Track level lives on the bus.
  // rollProb is injected so exportWav can render deterministically (always
  // hit) while live playback rolls the dice per repeat, per step.
  function triggerStep(c, b, step, time, spb, rollProb) {
    TRACKS.forEach((t) => {
      const cell = state.pattern[t.id][step];
      if (!cell || state.mutes[t.id]) return;
      const prob = cellProb(cell);
      if (prob < 100 && rollProb && !rollProb(prob)) return;
      const stepVel = cellVel(cell);
      if (t.type === "drum") {
        voices[t.id](c, b[t.id], time, stepVel);
      } else {
        // deliberate since v0.2: quarter-step vel 0.95 drives the acid accent
        // branch (higher Q + cutoff) — in v0.1 velocity was scaled by track
        // level, which silenced the accent unintentionally. A per-step accent
        // (stepVel 1.15) can now push any acid step over that threshold too.
        const baseVel = t.id === "acid" && step % 4 === 0 ? 0.95 : 0.8;
        voices[t.id](c, b[t.id], time, baseVel * stepVel, cellNote(cell), spb * (t.id === "stab" ? 2 : 0.9));
      }
    });
  }

  const rollProb = (prob) => rng() * 100 < prob;

  function scheduleStep(step, time) {
    if (step === 0 && queuedBank != null) applyBankSwitch(queuedBank);
    const spb = secondsPerStep();
    const swung = swungTime(time, step, spb);
    notesInQueue.push({ step, time: swung });
    triggerStep(ctx, buses, step, swung, spb, rollProb);
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
  }

  // ---------- pattern banks ----------
  // 4 independent 16-step patterns (A-D). Switching while stopped is instant;
  // switching while playing queues until the bar wraps — the live-performance
  // move hardware groove boxes are built around.

  function selectBank(i) {
    if (i === state.activeBank && queuedBank == null) return;
    if (playing) {
      queuedBank = i;
    } else {
      applyBankSwitch(i);
    }
    paintBankButtons();
  }

  function applyBankSwitch(i) {
    state.banks[state.activeBank].pattern = state.pattern; // save edits back first
    state.activeBank = i;
    state.pattern = state.banks[i].pattern;
    queuedBank = null;
    undoBuf = null; // undo history doesn't cross a bank switch
    if (playing) lastDrawnStep = -1;
    // repaint, don't rebuild: track/step counts never change between banks,
    // only cell contents — a full buildGrid() teardown here can run inside
    // the audio scheduler's tick and risks stalling it right on the downbeat
    paintGrid();
    paintBankButtons();
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

  // ---------- algorithmic generators ----------

  // seeded PRNG (mulberry32): generators are reproducible per seed, so future
  // style packs can ship a seed and replay the exact same pattern
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
  const rnd = (n) => Math.floor(rng() * n);
  const chance = (p) => rng() < p;

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

  // Euclidean rhythm (Bresenham form): distribute k hits over n steps
  function euclid(k, n, rot = 0) {
    const out = new Array(n).fill(0);
    if (k <= 0) return out;
    for (let i = 0; i < n; i++) {
      out[(i + rot) % n] = Math.floor(i * k / n) !== Math.floor((i - 1) * k / n) ? 1 : 0;
    }
    out[rot % n] = 1;
    return out;
  }

  function pentaNote(root, range = 2) {
    const oct = rnd(range) * 12;
    return root + PENTA[rnd(PENTA.length - 1)] + oct;
  }

  function noteLine(root, density, mover) {
    const line = new Array(STEPS).fill(0);
    let cur = root;
    for (let s = 0; s < STEPS; s++) {
      if (chance(density)) {
        if (chance(mover)) cur = pentaNote(root);
        line[s] = cur;
      }
    }
    return line;
  }

  // a few hats at ghost velocity reads as a human hand, not a demo loop
  function ghostifyHats(arr) {
    return arr.map((v) => (v && chance(0.4) ? withMods(1, 0.55, 100) : v));
  }

  const STYLES = {
    techno(p) {
      p.kick = [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0];
      if (chance(0.4)) p.kick[14] = 1;
      p.clap = [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0];
      p.snare = chance(0.3) ? euclid(3, 16, 6).map((v, i) => (i > 11 && v ? 1 : 0)) : new Array(16).fill(0);
      p.chh = ghostifyHats(euclid(10 + rnd(6), 16, rnd(2)));
      p.ohh = [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0];
      p.bass = noteLine(33, 0.45, 0.25);
      p.acid = noteLine(45, 0.35 + rng() * 0.25, 0.5); // was Math.random() — now uses the seeded stream too
      p.stab = new Array(16).fill(0);
      if (chance(0.5)) p.stab[8 + rnd(4)] = 57;
      return 128 + rnd(8);
    },
    house(p) {
      p.kick = [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0];
      p.clap = [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0];
      p.snare = new Array(16).fill(0);
      p.chh = [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0];
      if (chance(0.5)) p.chh = p.chh.map((v, i) => (i % 2 === 0 && chance(0.3) ? 1 : v));
      p.chh = ghostifyHats(p.chh);
      p.ohh = [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,1];
      p.bass = new Array(16).fill(0);
      [3, 6, 11, 14].forEach((s) => { if (chance(0.85)) p.bass[s] = pentaNote(33, 1); });
      p.acid = new Array(16).fill(0);
      p.stab = new Array(16).fill(0);
      [2, 10].forEach((s) => { if (chance(0.7)) p.stab[s] = pentaNote(57, 1); });
      return 122 + rnd(6);
    },
    acid(p) {
      p.kick = [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0];
      p.clap = [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0];
      p.snare = new Array(16).fill(0);
      p.chh = ghostifyHats(euclid(12 + rnd(4), 16));
      p.ohh = [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0];
      p.bass = new Array(16).fill(0);
      // rolling 303 line: mostly 16ths, walks the scale, octave jumps
      let cur = 45;
      p.acid = new Array(16).fill(0).map(() => {
        if (chance(0.78)) {
          if (chance(0.4)) cur = pentaNote(45);
          if (chance(0.15)) cur += 12;
          if (cur > 69) cur -= 24;
          return cur;
        }
        return 0;
      });
      p.stab = new Array(16).fill(0);
      return 130 + rnd(10);
    },
    breaks(p) {
      p.kick = new Array(16).fill(0);
      [0, 7, 10].forEach((s) => { p.kick[s] = 1; });
      if (chance(0.5)) p.kick[13] = 1;
      p.snare = [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,1];
      p.clap = new Array(16).fill(0);
      p.chh = ghostifyHats(euclid(8 + rnd(6), 16, 1));
      p.ohh = new Array(16).fill(0);
      if (chance(0.6)) p.ohh[6] = 1;
      p.bass = noteLine(33, 0.4, 0.4);
      p.acid = chance(0.4) ? noteLine(45, 0.3, 0.5) : new Array(16).fill(0);
      p.stab = new Array(16).fill(0);
      [1, 9].forEach((s) => { if (chance(0.5)) p.stab[s] = pentaNote(57, 1); });
      return 136 + rnd(14);
    },
  };

  function generate(style) {
    snapshot();
    reseed();
    const bpm = STYLES[style](state.pattern);
    state.bpm = bpm;
    bpmInput.value = bpm;
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
    TRACKS.forEach((t) => {
      const arr = state.pattern[t.id];
      const flips = rnd(3);
      for (let i = 0; i < flips; i++) {
        const s = rnd(STEPS);
        if (t.type === "drum") arr[s] = arr[s] ? 0 : (chance(0.5) ? 1 : 0);
        else arr[s] = arr[s] ? (chance(0.3) ? 0 : pentaNote(t.root)) : (chance(0.4) ? pentaNote(t.root) : 0);
      }
    });
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
    if (data.bpm) { state.bpm = Math.min(200, Math.max(60, data.bpm | 0)); bpmInput.value = state.bpm; }
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

  // ---------- WAV export ----------

  async function exportWav() {
    bumpGenIfRemixed(); // the WAV's embedded URL must match what COPY LINK gives
    toast("Rendering 2-bar loop…");
    const bars = 2;
    const spb = secondsPerStep();
    const dur = spb * STEPS * bars;
    const tail = 1.0; // extra render so ringing voices aren't cut at the seam
    const sr = 44100;
    const durSamples = Math.round(dur * sr);
    const off = new OfflineAudioContext(2, durSamples + Math.ceil(tail * sr), sr);
    const m = masterChain(off);
    const ob = makeBuses(off, m);
    m.filter.frequency.value = filterFreq();
    m.gain.gain.value = state.volume / 100;
    for (let bar = 0; bar < bars; bar++) {
      for (let s = 0; s < STEPS; s++) {
        triggerStep(off, ob, s, swungTime(bar * STEPS * spb + s * spb, s, spb), spb, rollProb);
      }
    }
    const buf = await off.startRendering();
    // fold the tail back onto the loop start — the seam plays seamlessly
    const chans = [];
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const src = buf.getChannelData(c);
      const out = new Float32Array(durSamples);
      out.set(src.subarray(0, durSamples));
      for (let i = 0; i < src.length - durSamples; i++) out[i] += src[durSamples + i];
      chans.push(out);
    }
    const name = loopName().toLowerCase();
    const comment = `Made with CLAW — remix this exact loop: ${buildShareUrl(serializeProject())}`;
    const blob = encodeWav(chans, sr, comment);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `claw-${name}-${state.bpm}bpm.wav`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    toast(`Exported ${name.toUpperCase()} @ ${state.bpm} BPM`);
  }

  function encodeWav(chans, sr, comment) {
    const ch = chans.length, len = chans[0].length;
    const dataBytes = len * ch * 2;
    // LIST/INFO/ICMT chunk carries the share URL inside the file itself —
    // the exported WAV is a carrier that can always find its way home
    const cm = comment ? new TextEncoder().encode(comment) : null;
    const cmLen = cm ? cm.length + 1 : 0;               // + null terminator
    const cmPad = cm ? cmLen + (cmLen & 1) : 0;         // chunks are even-padded
    const listBytes = cm ? 8 + 4 + 8 + cmPad : 0;       // LIST hdr + INFO + ICMT hdr + text
    const bytes = 44 + dataBytes + listBytes;
    const ab = new ArrayBuffer(bytes);
    const dv = new DataView(ab);
    const wstr = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
    wstr(0, "RIFF"); dv.setUint32(4, bytes - 8, true); wstr(8, "WAVE");
    wstr(12, "fmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true);
    dv.setUint16(22, ch, true); dv.setUint32(24, sr, true);
    dv.setUint32(28, sr * ch * 2, true); dv.setUint16(32, ch * 2, true); dv.setUint16(34, 16, true);
    wstr(36, "data"); dv.setUint32(40, dataBytes, true);
    let o = 44;
    for (let i = 0; i < len; i++) {
      for (let c = 0; c < ch; c++) {
        const s = Math.max(-1, Math.min(1, chans[c][i]));
        dv.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        o += 2;
      }
    }
    if (cm) {
      wstr(o, "LIST"); dv.setUint32(o + 4, 4 + 8 + cmPad, true); wstr(o + 8, "INFO");
      wstr(o + 12, "ICMT"); dv.setUint32(o + 16, cmLen, true);
      for (let i = 0; i < cm.length; i++) dv.setUint8(o + 20 + i, cm[i]);
    }
    return new Blob([ab], { type: "audio/wav" });
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
    const m = data.meta && typeof data.meta === "object" ? data.meta : {};
    state.meta = {
      gen: clampInt(m.gen, 0, 9999, 0),
      parent: typeof m.parent === "string" ? m.parent.slice(0, 8) : null,
      src: src || (typeof m.src === "string" ? m.src.slice(0, 8) : "hand"),
    };
    // keep live playback in sync: loaded levels must reach the buses too,
    // or what you hear diverges from what you'd export
    if (buses) {
      TRACKS.forEach((t) => buses[t.id].gain.setTargetAtTime(state.levels[t.id], ctx.currentTime, 0.02));
    }
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
    autosave();
  });
  document.querySelectorAll("[data-bpm]").forEach((b) =>
    b.addEventListener("click", () => {
      state.bpm = Math.min(200, Math.max(60, state.bpm + +b.dataset.bpm));
      bpmInput.value = state.bpm;
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

  document.getElementById("mutate").addEventListener("click", mutate);
  document.getElementById("clear").addEventListener("click", clearPattern);
  document.getElementById("export").addEventListener("click", exportWav);
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

  // installable + offline once visited; skipped on file:// and on localhost
  // (a cache-first worker would serve stale files during development)
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")
      && !["localhost", "127.0.0.1"].includes(location.hostname)) {
    navigator.serviceWorker.register("sw.js").catch(() => { /* unsupported */ });
  }
})();
