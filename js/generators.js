/* CLAW pattern generators — pure functions, no DOM, no audio, no globals.
   Each call takes a seeded rng and a small helpers bundle, so the same code
   is reproducible per seed (style packs ship a seed and replay exactly).

   helpers h = { STEPS, PENTA, TRACKS, withMods } supplied by the app so this
   module never reaches back into app state. */

(function () {
  "use strict";

  function build(rng, h) {
    const { STEPS, PENTA, withMods } = h;
    const rnd = (n) => Math.floor(rng() * n);
    const chance = (p) => rng() < p;

    // NOTE draw order matters for seed-reproducibility: octave first, then the
    // scale degree — must match the pre-extraction statement form exactly.
    const pentaNote = (root, range = 2) => {
      const oct = rnd(range) * 12;
      return root + PENTA[rnd(PENTA.length - 1)] + oct;
    };

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
    const ghostifyHats = (arr) => arr.map((v) => (v && chance(0.4) ? withMods(1, 0.55, 100) : v));

    return { rng, rnd, chance, pentaNote, euclid, noteLine, ghostifyHats };
  }

  const STYLES = {
    techno(p, g) {
      const { rnd, chance, euclid, noteLine, ghostifyHats } = g;
      p.kick = [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0];
      if (chance(0.4)) p.kick[14] = 1;
      p.clap = [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0];
      p.snare = chance(0.3) ? euclid(3, 16, 6).map((v, i) => (i > 11 && v ? 1 : 0)) : new Array(16).fill(0);
      p.chh = ghostifyHats(euclid(10 + rnd(6), 16, rnd(2)));
      p.ohh = [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0];
      p.bass = noteLine(33, 0.45, 0.25);
      p.acid = noteLine(45, 0.35 + g.rng() * 0.25, 0.5);
      p.stab = new Array(16).fill(0);
      if (chance(0.5)) p.stab[8 + rnd(4)] = 57;
      return 128 + rnd(8);
    },
    house(p, g) {
      const { rnd, chance, pentaNote, ghostifyHats } = g;
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
    acid(p, g) {
      const { rnd, chance, pentaNote, euclid, ghostifyHats } = g;
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
    breaks(p, g) {
      const { rnd, chance, pentaNote, euclid, noteLine, ghostifyHats } = g;
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

  window.ClawGen = {
    STYLE_NAMES: Object.keys(STYLES),

    // Fill `pattern` in place for `style`; returns a suggested BPM.
    generate(style, pattern, rng, h) {
      return STYLES[style](pattern, build(rng, h));
    },

    // Nudge `pattern` in place — a few random flips per track.
    mutate(pattern, rng, h) {
      const g = build(rng, h);
      h.TRACKS.forEach((t) => {
        const arr = pattern[t.id];
        const flips = g.rnd(3);
        for (let i = 0; i < flips; i++) {
          const s = g.rnd(h.STEPS);
          if (t.type === "drum") arr[s] = arr[s] ? 0 : (g.chance(0.5) ? 1 : 0);
          else arr[s] = arr[s] ? (g.chance(0.3) ? 0 : g.pentaNote(t.root)) : (g.chance(0.4) ? g.pentaNote(t.root) : 0);
        }
      });
    },
  };
})();
