/* CLAW synth engine — pure Web Audio, no samples.
   Every voice takes (ctx, dest, time, ...) so the same code renders
   live playback and offline WAV export. */

(function () {
  "use strict";

  // Shared noise buffer per context (keyed weakly so offline ctxs get their own)
  const noiseBuffers = new WeakMap();

  function noise(ctx) {
    let buf = noiseBuffers.get(ctx);
    if (!buf) {
      buf = ctx.createBuffer(1, ctx.sampleRate * 1, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      noiseBuffers.set(ctx, buf);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    return src;
  }

  function env(ctx, dest, t, peak, decay) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + decay);
    g.connect(dest);
    return g;
  }

  const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

  // Per-voice sound-design parameters. This one table is the single source of
  // truth: it seeds default state, clamps loaded projects, drives the SOUND
  // drawer UI, and its defaults exactly reproduce the pre-v0.4B voices. Each
  // entry: { k: state key, label, min, max, def, fmt(v)->string }.
  const hz = (v) => (v >= 1000 ? (v / 1000).toFixed(1) + "k" : Math.round(v) + "");
  const pct = (v) => Math.round(v) + "%";
  const ms = (v) => Math.round(v * 1000) + "ms";
  const VOICE_PARAMS = {
    kick:  [{ k: "tune", label: "TUNE", min: 90, max: 260, def: 160, fmt: hz },
            { k: "decay", label: "DECAY", min: 0.1, max: 0.8, def: 0.4, fmt: ms },
            { k: "click", label: "CLICK", min: 0, max: 100, def: 50, fmt: pct }],
    snare: [{ k: "tune", label: "TUNE", min: 120, max: 320, def: 190, fmt: hz },
            { k: "decay", label: "DECAY", min: 0.05, max: 0.4, def: 0.18, fmt: ms },
            { k: "snap", label: "SNAP", min: 0, max: 100, def: 90, fmt: pct }],
    clap:  [{ k: "tone", label: "TONE", min: 700, max: 2200, def: 1300, fmt: hz },
            { k: "decay", label: "DECAY", min: 0.1, max: 0.5, def: 0.22, fmt: ms },
            { k: "spread", label: "SPREAD", min: 4, max: 30, def: 12, fmt: (v) => Math.round(v) + "ms" }],
    chh:   [{ k: "tone", label: "TONE", min: 4000, max: 12000, def: 8200, fmt: hz },
            { k: "decay", label: "DECAY", min: 0.02, max: 0.12, def: 0.045, fmt: ms }],
    ohh:   [{ k: "tone", label: "TONE", min: 3000, max: 10000, def: 7200, fmt: hz },
            { k: "decay", label: "DECAY", min: 0.1, max: 0.5, def: 0.28, fmt: ms }],
    bass:  [{ k: "cutoff", label: "CUTOFF", min: 150, max: 1500, def: 320, fmt: hz },
            { k: "sub", label: "SUB", min: 0, max: 150, def: 100, fmt: pct }],
    acid:  [{ k: "cutoff", label: "CUTOFF", min: 400, max: 4000, def: 1700, fmt: hz },
            { k: "reso", label: "RESO", min: 3, max: 20, def: 11, fmt: (v) => Math.round(v) + "" },
            { k: "envmod", label: "ENV MOD", min: 0, max: 100, def: 88, fmt: pct }],
    stab:  [{ k: "tone", label: "TONE", min: 400, max: 1800, def: 900, fmt: hz },
            { k: "decay", label: "DECAY", min: 50, max: 200, def: 100, fmt: pct },
            { k: "spread", label: "SPREAD", min: 0, max: 25, def: 7, fmt: (v) => Math.round(v) + "ct" }],
  };
  // read a param with its documented default when absent
  function param(p, id, k) {
    if (p && p[k] != null) return p[k];
    const meta = VOICE_PARAMS[id].find((m) => m.k === k);
    return meta ? meta.def : 0;
  }

  // Voices take a trailing params object `p` (per-track sound settings). When
  // absent, param() falls back to the VOICE_PARAMS default → identical sound.
  const voices = {

    kick(ctx, dest, t, vel, midi, dur, p) {
      const tune = param(p, "kick", "tune");
      const g = env(ctx, dest, t, vel, param(p, "kick", "decay"));
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(tune, t);
      osc.frequency.exponentialRampToValueAtTime(tune * 0.275, t + 0.11);
      osc.connect(g);
      osc.start(t);
      osc.stop(t + param(p, "kick", "decay") + 0.05);
      // attack click
      const click = noise(ctx);
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 1200;
      const cg = env(ctx, dest, t, vel * (param(p, "kick", "click") / 100), 0.02);
      click.connect(hp).connect(cg);
      click.start(t);
      click.stop(t + 0.03);
    },

    snare(ctx, dest, t, vel, midi, dur, p) {
      const n = noise(ctx);
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 1900;
      bp.Q.value = 0.8;
      const ng = env(ctx, dest, t, vel * (param(p, "snare", "snap") / 100), param(p, "snare", "decay"));
      n.connect(bp).connect(ng);
      n.start(t);
      n.stop(t + param(p, "snare", "decay") + 0.02);
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(param(p, "snare", "tune"), t);
      const og = env(ctx, dest, t, vel * 0.55, 0.09);
      osc.connect(og);
      osc.start(t);
      osc.stop(t + 0.1);
    },

    clap(ctx, dest, t, vel, midi, dur, p) {
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = param(p, "clap", "tone");
      bp.Q.value = 1.4;
      bp.connect(dest);
      const sp = param(p, "clap", "spread") / 1000;
      const dec = param(p, "clap", "decay");
      for (let i = 0; i < 3; i++) {
        const n = noise(ctx);
        const g = env(ctx, bp, t + i * sp, vel * 0.6, i === 2 ? dec : 0.02);
        n.connect(g);
        n.start(t + i * sp);
        n.stop(t + i * sp + (i === 2 ? dec + 0.03 : 0.03));
      }
    },

    chh(ctx, dest, t, vel, midi, dur, p) {
      const n = noise(ctx);
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = param(p, "chh", "tone");
      const dec = param(p, "chh", "decay");
      const g = env(ctx, dest, t, vel * 0.5, dec);
      n.connect(hp).connect(g);
      n.start(t);
      n.stop(t + dec + 0.015);
    },

    ohh(ctx, dest, t, vel, midi, dur, p) {
      const n = noise(ctx);
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = param(p, "ohh", "tone");
      const dec = param(p, "ohh", "decay");
      const g = env(ctx, dest, t, vel * 0.45, dec);
      n.connect(hp).connect(g);
      n.start(t);
      n.stop(t + dec + 0.04);
    },

    bass(ctx, dest, t, vel, midi, dur, p) {
      const cutoff = param(p, "bass", "cutoff");
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = midiHz(midi);
      const sub = ctx.createOscillator();
      sub.type = "sine";
      sub.frequency.value = midiHz(midi - 12);
      const subG = ctx.createGain();
      subG.gain.value = param(p, "bass", "sub") / 100;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.setValueAtTime(90, t);
      lp.frequency.exponentialRampToValueAtTime(cutoff, t + 0.03);
      lp.frequency.exponentialRampToValueAtTime(100, t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(vel * 0.85, t);
      g.gain.setValueAtTime(vel * 0.85, t + dur * 0.7);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(lp);
      sub.connect(subG).connect(lp);
      lp.connect(g).connect(dest);
      osc.start(t); sub.start(t);
      osc.stop(t + dur + 0.02); sub.stop(t + dur + 0.02);
    },

    acid(ctx, dest, t, vel, midi, dur, p) {
      const accent = vel > 0.9;
      const cutoff = param(p, "acid", "cutoff");
      const reso = param(p, "acid", "reso");
      const envmod = param(p, "acid", "envmod") / 100;
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = midiHz(midi);
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.Q.value = accent ? reso + 5 : reso;
      const peak = accent ? cutoff * 2 : cutoff;
      const floor = Math.max(120, cutoff * (1 - envmod));
      lp.frequency.setValueAtTime(peak, t);
      lp.frequency.exponentialRampToValueAtTime(floor, t + dur * 1.3);
      const g = ctx.createGain();
      g.gain.setValueAtTime(vel * 0.5, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur * 1.2);
      osc.connect(lp).connect(g).connect(dest);
      osc.start(t);
      osc.stop(t + dur * 1.3 + 0.02);
    },

    stab(ctx, dest, t, vel, midi, dur, p) {
      // minor chord stab: root, minor third, fifth
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = param(p, "stab", "tone");
      bp.Q.value = 0.7;
      const dec = Math.max(0.16, dur * 0.9) * (param(p, "stab", "decay") / 100);
      const spread = param(p, "stab", "spread");
      const g = env(ctx, dest, t, vel * 0.45, dec);
      bp.connect(g);
      [0, 3, 7].forEach((iv, i) => {
        const osc = ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.value = midiHz(midi + iv);
        osc.detune.value = (i - 1) * spread;
        osc.connect(bp);
        osc.start(t);
        osc.stop(t + dur + 0.05);
      });
    },
  };

  // Procedural reverb impulse: a decaying stereo noise burst. No samples —
  // the whole point of CLAW. `decay` sets the exponential falloff shape.
  function makeIR(ctx, seconds, decay) {
    const rate = ctx.sampleRate;
    const len = Math.max(1, Math.floor(rate * seconds));
    const ir = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return ir;
  }

  // Master chain factory. Returns the dry sum bus plus two send buses (a
  // tempo-synced feedback delay and a convolution reverb) that tracks feed
  // into. Both returns run through the master filter, so a filter sweep pulls
  // the wet tails down too — exactly what you want for a breakdown.
  // Signal: [tracks] -> input ---------------\
  //         [tracks] -> delayIn -> delay ----> filter -> gain -> comp -> out
  //         [tracks] -> reverbIn -> convolver /
  function masterChain(ctx) {
    const input = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 20000;
    filter.Q.value = 0.9;
    const gain = ctx.createGain();
    gain.gain.value = 0.85;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.18;
    input.connect(filter);
    filter.connect(gain).connect(comp).connect(ctx.destination);

    // --- delay send bus (dub-style dotted-eighth, feedback loop) ---
    const delayIn = ctx.createGain();
    const delay = ctx.createDelay(1.0); // max 1s covers dotted-8th down to 60 BPM
    delay.delayTime.value = 0.35;
    const fb = ctx.createGain();
    fb.gain.value = 0.35;
    const damp = ctx.createBiquadFilter(); // tame the feedback so it decays musically
    damp.type = "highpass";
    damp.frequency.value = 280;
    delayIn.connect(delay);
    delay.connect(damp).connect(fb).connect(delay); // feedback
    delay.connect(filter);                          // wet return

    // --- reverb send bus (procedural IR) ---
    const reverbIn = ctx.createGain();
    const convolver = ctx.createConvolver();
    convolver.buffer = makeIR(ctx, 2.4, 2.5);
    reverbIn.connect(convolver).connect(filter);

    return { input, filter, gain, delayIn, delay, fb, reverbIn, convolver };
  }

  window.ClawSynth = { voices, masterChain, makeIR, midiHz, VOICE_PARAMS };
})();
