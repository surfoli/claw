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

  const voices = {

    kick(ctx, dest, t, vel) {
      const g = env(ctx, dest, t, vel, 0.4);
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(160, t);
      osc.frequency.exponentialRampToValueAtTime(44, t + 0.11);
      osc.connect(g);
      osc.start(t);
      osc.stop(t + 0.45);
      // attack click
      const click = noise(ctx);
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 1200;
      const cg = env(ctx, dest, t, vel * 0.5, 0.02);
      click.connect(hp).connect(cg);
      click.start(t);
      click.stop(t + 0.03);
    },

    snare(ctx, dest, t, vel) {
      const n = noise(ctx);
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 1900;
      bp.Q.value = 0.8;
      const ng = env(ctx, dest, t, vel * 0.9, 0.18);
      n.connect(bp).connect(ng);
      n.start(t);
      n.stop(t + 0.2);
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(190, t);
      const og = env(ctx, dest, t, vel * 0.55, 0.09);
      osc.connect(og);
      osc.start(t);
      osc.stop(t + 0.1);
    },

    clap(ctx, dest, t, vel) {
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 1300;
      bp.Q.value = 1.4;
      bp.connect(dest);
      for (let i = 0; i < 3; i++) {
        const n = noise(ctx);
        const g = env(ctx, bp, t + i * 0.012, vel * 0.6, i === 2 ? 0.22 : 0.02);
        n.connect(g);
        n.start(t + i * 0.012);
        n.stop(t + i * 0.012 + (i === 2 ? 0.25 : 0.03));
      }
    },

    chh(ctx, dest, t, vel) {
      const n = noise(ctx);
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 8200;
      const g = env(ctx, dest, t, vel * 0.5, 0.045);
      n.connect(hp).connect(g);
      n.start(t);
      n.stop(t + 0.06);
    },

    ohh(ctx, dest, t, vel) {
      const n = noise(ctx);
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 7200;
      const g = env(ctx, dest, t, vel * 0.45, 0.28);
      n.connect(hp).connect(g);
      n.start(t);
      n.stop(t + 0.32);
    },

    bass(ctx, dest, t, vel, midi, dur) {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = midiHz(midi);
      const sub = ctx.createOscillator();
      sub.type = "sine";
      sub.frequency.value = midiHz(midi - 12);
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.setValueAtTime(90, t);
      lp.frequency.exponentialRampToValueAtTime(320, t + 0.03);
      lp.frequency.exponentialRampToValueAtTime(100, t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(vel * 0.85, t);
      g.gain.setValueAtTime(vel * 0.85, t + dur * 0.7);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(lp);
      sub.connect(lp);
      lp.connect(g).connect(dest);
      osc.start(t); sub.start(t);
      osc.stop(t + dur + 0.02); sub.stop(t + dur + 0.02);
    },

    acid(ctx, dest, t, vel, midi, dur) {
      const accent = vel > 0.9;
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = midiHz(midi);
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.Q.value = accent ? 16 : 11;
      const peak = accent ? 3400 : 1700;
      lp.frequency.setValueAtTime(peak, t);
      lp.frequency.exponentialRampToValueAtTime(210, t + dur * 1.3);
      const g = ctx.createGain();
      g.gain.setValueAtTime(vel * 0.5, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur * 1.2);
      osc.connect(lp).connect(g).connect(dest);
      osc.start(t);
      osc.stop(t + dur * 1.3 + 0.02);
    },

    stab(ctx, dest, t, vel, midi, dur) {
      // minor chord stab: root, minor third, fifth
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 900;
      bp.Q.value = 0.7;
      const g = env(ctx, dest, t, vel * 0.45, Math.max(0.16, dur * 0.9));
      bp.connect(g);
      [0, 3, 7].forEach((iv, i) => {
        const osc = ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.value = midiHz(midi + iv);
        osc.detune.value = (i - 1) * 7;
        osc.connect(bp);
        osc.start(t);
        osc.stop(t + dur + 0.05);
      });
    },
  };

  // Master chain factory: returns { input, filter, gain } wired to ctx.destination
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
    input.connect(filter).connect(gain).connect(comp).connect(ctx.destination);
    return { input, filter, gain };
  }

  window.ClawSynth = { voices, masterChain, midiHz };
})();
