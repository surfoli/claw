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

  // Default pattern: plays something good the second you land.
  const state = {
    bpm: 128,
    swing: 0,          // 0..60 (%)
    filter: 100,       // 0..100
    volume: 85,        // 0..100
    pattern: {
      kick:  [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0],
      snare: [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
      clap:  [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
      chh:   [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,1],
      ohh:   [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0],
      bass:  [33,0,0,33, 0,0,33,0, 33,0,0,33, 0,0,36,0],
      acid:  [45,0,48,0, 45,0,52,45, 0,45,0,48, 45,0,57,0],
      stab:  [0,0,0,0, 0,0,0,0, 57,0,0,0, 0,0,0,0],
    },
    mutes: {},
    levels: {},
  };
  TRACKS.forEach((t) => { state.mutes[t.id] = false; state.levels[t.id] = 0.8; });

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
      mute.className = "mute-btn";
      mute.setAttribute("aria-label", `Mute ${t.name}`);
      mute.setAttribute("aria-pressed", "false");
      mute.addEventListener("click", () => {
        state.mutes[t.id] = !state.mutes[t.id];
        mute.classList.toggle("muted", state.mutes[t.id]);
        mute.setAttribute("aria-pressed", String(state.mutes[t.id]));
        row.classList.toggle("muted-row", state.mutes[t.id]);
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
      });
      level.addEventListener("dblclick", () => {
        level.value = 80;
        state.levels[t.id] = 0.8;
      });
      row.appendChild(level);

      gridEl.appendChild(row);
    });
    paintGrid();
  }

  function onStepClick(t, s, ev) {
    const arr = state.pattern[t.id];
    if (t.type === "drum") {
      arr[s] = arr[s] ? 0 : 1;
    } else if (ev.shiftKey && arr[s]) {
      // shift-click / right-click: walk up the pentatonic scale, wrap after an octave
      const deg = (((arr[s] - t.root) % 12) + 12) % 12;
      const idx = PENTA.indexOf(deg); // -1 for off-scale notes (AI can emit any pitch)
      arr[s] = t.root + PENTA[(idx < 0 ? 0 : idx + 1) % PENTA.length];
    } else {
      arr[s] = arr[s] ? 0 : t.root;
    }
    paintStep(t, s);
  }

  function paintStep(t, s) {
    const v = state.pattern[t.id][s];
    const el = stepEls[t.id][s];
    el.classList.toggle("on", !!v);
    el.setAttribute("aria-pressed", String(!!v));
    if (t.type === "note") {
      el.textContent = v ? noteName(v) : "";
      el.title = v ? `${noteName(v)} — shift-click: next note` : "";
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

  function ensureCtx() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = masterChain(ctx);
      applyFilter();
      applyVolume();
    }
    if (ctx.state === "suspended") ctx.resume();
  }

  function secondsPerStep() {
    return 60 / state.bpm / 4;
  }

  function scheduleStep(step, time) {
    const spb = secondsPerStep();
    const swung = step % 2 === 1 ? time + (state.swing / 100) * spb * 0.5 : time;
    notesInQueue.push({ step, time: swung });

    TRACKS.forEach((t) => {
      const v = state.pattern[t.id][step];
      if (!v || state.mutes[t.id]) return;
      const lvl = state.levels[t.id];
      if (t.type === "drum") {
        voices[t.id](ctx, master.input, swung, lvl);
      } else {
        const vel = (t.id === "acid" && step % 4 === 0 ? 0.95 : 0.8) * lvl;
        voices[t.id](ctx, master.input, swung, vel, v, spb * (t.id === "stab" ? 2 : 0.9));
      }
    });
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

  // ---------- algorithmic generators ----------

  const rnd = (n) => Math.floor(Math.random() * n);
  const chance = (p) => Math.random() < p;

  // one-deep undo for every destructive pattern change (Ctrl/Cmd+Z)
  let undoBuf = null;
  function snapshot() {
    undoBuf = JSON.parse(JSON.stringify(state.pattern));
  }
  function undo() {
    if (!undoBuf) return;
    state.pattern = undoBuf;
    undoBuf = null;
    paintGrid();
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

  const STYLES = {
    techno(p) {
      p.kick = [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0];
      if (chance(0.4)) p.kick[14] = 1;
      p.clap = [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0];
      p.snare = chance(0.3) ? euclid(3, 16, 6).map((v, i) => (i > 11 && v ? 1 : 0)) : new Array(16).fill(0);
      p.chh = euclid(10 + rnd(6), 16, rnd(2));
      p.ohh = [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0];
      p.bass = noteLine(33, 0.45, 0.25);
      p.acid = noteLine(45, 0.35 + Math.random() * 0.25, 0.5);
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
      p.chh = euclid(12 + rnd(4), 16);
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
      p.chh = euclid(8 + rnd(6), 16, 1);
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
    const bpm = STYLES[style](state.pattern);
    state.bpm = bpm;
    bpmInput.value = bpm;
    paintGrid();
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
    toast("Pattern mutated");
  }

  function clearPattern() {
    snapshot();
    TRACKS.forEach((t) => { state.pattern[t.id] = new Array(STEPS).fill(0); });
    paintGrid();
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
      const arr = data[t.id].slice(0, STEPS).map((v) => Math.max(0, Math.round(Number(v) || 0)));
      while (arr.length < STEPS) arr.push(0);
      if (t.type === "drum") state.pattern[t.id] = arr.map((v) => (v ? 1 : 0));
      else state.pattern[t.id] = arr.map((v) => (v ? Math.min(80, Math.max(24, v)) : 0));
    });
    if (data.bpm) { state.bpm = Math.min(200, Math.max(60, data.bpm | 0)); bpmInput.value = state.bpm; }
    if (data.swing != null) {
      state.swing = Math.min(60, Math.max(0, data.swing | 0));
      swingInput.value = state.swing;
      swingVal.textContent = state.swing + "%";
    }
    paintGrid();
  }

  // ---------- WAV export ----------

  async function exportWav() {
    toast("Rendering 2-bar loop…");
    const bars = 2;
    const spb = secondsPerStep();
    const dur = spb * STEPS * bars;
    const tail = 1.0; // extra render so ringing voices aren't cut at the seam
    const sr = 44100;
    const durSamples = Math.round(dur * sr);
    const off = new OfflineAudioContext(2, durSamples + Math.ceil(tail * sr), sr);
    const m = masterChain(off);
    m.filter.frequency.value = filterFreq();
    m.gain.gain.value = state.volume / 100;
    for (let bar = 0; bar < bars; bar++) {
      for (let s = 0; s < STEPS; s++) {
        const t = bar * STEPS * spb + s * spb + (s % 2 === 1 ? (state.swing / 100) * spb * 0.5 : 0);
        TRACKS.forEach((tr) => {
          const v = state.pattern[tr.id][s];
          if (!v || state.mutes[tr.id]) return;
          const lvl = state.levels[tr.id];
          if (tr.type === "drum") voices[tr.id](off, m.input, t, lvl);
          else {
            const vel = (tr.id === "acid" && s % 4 === 0 ? 0.95 : 0.8) * lvl;
            voices[tr.id](off, m.input, t, vel, v, spb * (tr.id === "stab" ? 2 : 0.9));
          }
        });
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
    const blob = encodeWav(chans, sr);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `claw-loop-${state.bpm}bpm.wav`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    toast(`Exported ${bars}-bar loop @ ${state.bpm} BPM`);
  }

  function encodeWav(chans, sr) {
    const ch = chans.length, len = chans[0].length;
    const bytes = 44 + len * ch * 2;
    const ab = new ArrayBuffer(bytes);
    const dv = new DataView(ab);
    const wstr = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
    wstr(0, "RIFF"); dv.setUint32(4, bytes - 8, true); wstr(8, "WAVE");
    wstr(12, "fmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true);
    dv.setUint16(22, ch, true); dv.setUint32(24, sr, true);
    dv.setUint32(28, sr * ch * 2, true); dv.setUint16(32, ch * 2, true); dv.setUint16(34, 16, true);
    wstr(36, "data"); dv.setUint32(40, len * ch * 2, true);
    let o = 44;
    for (let i = 0; i < len; i++) {
      for (let c = 0; c < ch; c++) {
        const s = Math.max(-1, Math.min(1, chans[c][i]));
        dv.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        o += 2;
      }
    }
    return new Blob([ab], { type: "audio/wav" });
  }

  // ---------- share link ----------

  function shareLink() {
    const data = { bpm: state.bpm, swing: state.swing, pattern: state.pattern };
    const hash = btoa(unescape(encodeURIComponent(JSON.stringify(data))));
    // location.origin is the string "null" on file:// — fall back to the raw href
    const base = !location.origin || location.origin === "null"
      ? location.href.split("#")[0]
      : location.origin + location.pathname;
    const url = `${base}#p=${hash}`;
    navigator.clipboard.writeText(url).then(
      () => toast("Loop link copied — send it to someone"),
      () => { prompt("Copy this link:", url); }
    );
  }

  function loadFromHash() {
    const m = location.hash.match(/#p=(.+)/);
    if (!m) return;
    try {
      const data = JSON.parse(decodeURIComponent(escape(atob(m[1]))));
      // never trust a URL: clamp everything like applyAiPattern does
      if (data.pattern) {
        TRACKS.forEach((t) => {
          const src = Array.isArray(data.pattern[t.id]) ? data.pattern[t.id] : null;
          if (!src) return;
          const arr = [];
          for (let s = 0; s < STEPS; s++) {
            const v = Math.max(0, Math.round(Number(src[s]) || 0));
            arr.push(t.type === "drum" ? (v ? 1 : 0) : (v ? Math.min(80, Math.max(24, v)) : 0));
          }
          state.pattern[t.id] = arr;
        });
      }
      if (data.bpm) state.bpm = Math.min(200, Math.max(60, Math.round(Number(data.bpm)) || 128));
      if (data.swing != null) state.swing = Math.min(60, Math.max(0, Math.round(Number(data.swing)) || 0));
      toast("Shared loop loaded");
    } catch { /* bad hash — ignore */ }
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
  });
  document.querySelectorAll("[data-bpm]").forEach((b) =>
    b.addEventListener("click", () => {
      state.bpm = Math.min(200, Math.max(60, state.bpm + +b.dataset.bpm));
      bpmInput.value = state.bpm;
    })
  );

  swingInput.addEventListener("input", () => {
    state.swing = +swingInput.value;
    swingVal.textContent = state.swing + "%";
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
  });

  function applyVolume() {
    if (!master) return;
    master.gain.gain.setTargetAtTime(state.volume / 100, ctx.currentTime, 0.02);
  }
  volumeInput.addEventListener("input", () => {
    state.volume = +volumeInput.value;
    volumeVal.textContent = state.volume;
    applyVolume();
  });

  document.querySelectorAll("[data-style]").forEach((b) =>
    b.addEventListener("click", () => generate(b.dataset.style))
  );
  document.getElementById("mutate").addEventListener("click", mutate);
  document.getElementById("clear").addEventListener("click", clearPattern);
  document.getElementById("export").addEventListener("click", exportWav);
  document.getElementById("share").addEventListener("click", shareLink);

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
  loadFromHash();
  buildGrid();
  bpmInput.value = state.bpm;
  swingInput.value = state.swing;
  swingVal.textContent = state.swing + "%";
})();
