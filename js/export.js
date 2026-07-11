/* CLAW export encoders — pure byte-pushing, no DOM, no audio, no app state.
   WAV (16-bit PCM + a share URL in a LIST/INFO/ICMT chunk), Standard MIDI
   File (type 1), and a store-only ZIP for stem bundles. Everything a DAW
   needs to accept CLAW's output, written by hand so we stay dependency-free. */

(function () {
  "use strict";

  // ---------- WAV ----------

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

  // ---------- Standard MIDI File (type 1) ----------

  // variable-length quantity, MIDI's delta-time encoding
  function vlq(n) {
    const out = [n & 0x7f];
    n >>>= 7;
    while (n > 0) { out.unshift((n & 0x7f) | 0x80); n >>>= 7; }
    return out;
  }

  const str = (s) => [...s].map((c) => c.charCodeAt(0));
  const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const u16 = (n) => [(n >>> 8) & 255, n & 255];

  function chunk(id, data) {
    return [...str(id), ...u32(data.length), ...data];
  }

  /* tracks: [{ name, channel, events: [{ tick, note, vel, durTicks }] }]
     A type-1 file gets a tempo/meta track first, then one track per part, so
     a DAW imports each CLAW track onto its own lane. */
  function encodeMidi({ bpm, ppq = 480, tracks }) {
    const usPerQuarter = Math.round(60000000 / bpm);

    // track 0: tempo + time signature
    const meta = [
      0, 0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08,            // 4/4
      0, 0xff, 0x51, 0x03, (usPerQuarter >>> 16) & 255, (usPerQuarter >>> 8) & 255, usPerQuarter & 255,
      0, 0xff, 0x2f, 0x00,                                     // end of track
    ];

    const trackChunks = [chunk("MTrk", meta)];

    for (const t of tracks) {
      // expand notes into on/off, then sort by tick (note-off first on ties so
      // a repeated note retriggers cleanly instead of being cut by its own off)
      const evs = [];
      for (const e of t.events) {
        evs.push({ tick: e.tick, kind: 1, note: e.note, vel: e.vel });
        evs.push({ tick: e.tick + Math.max(1, e.durTicks), kind: 0, note: e.note, vel: 0 });
      }
      evs.sort((a, b) => a.tick - b.tick || a.kind - b.kind);

      // TextEncoder (not charCodeAt) so non-ASCII names stay valid bytes, and
      // a VLQ length so names > 127 bytes don't corrupt the meta event
      const nameBytes = [...new TextEncoder().encode(t.name)];
      const data = [0, 0xff, 0x03, ...vlq(nameBytes.length), ...nameBytes];
      let last = 0;
      for (const e of evs) {
        data.push(...vlq(e.tick - last));
        data.push((e.kind ? 0x90 : 0x80) | (t.channel & 0x0f), e.note & 0x7f, e.vel & 0x7f);
        last = e.tick;
      }
      data.push(0, 0xff, 0x2f, 0x00);
      trackChunks.push(chunk("MTrk", data));
    }

    const header = chunk("MThd", [...u16(1), ...u16(trackChunks.length), ...u16(ppq)]);
    const all = [...header, ...trackChunks.flat()];
    return new Blob([new Uint8Array(all)], { type: "audio/midi" });
  }

  // ---------- store-only ZIP (for stem bundles) ----------

  let crcTable = null;
  function crc32(buf) {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        crcTable[i] = c >>> 0;
      }
    }
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  /* files: [{ name, data: Uint8Array }] — stored (method 0), no compression.
     WAVs barely compress, and this keeps the writer to a page of code. */
  function zipStore(files) {
    const DOS_TIME = 0, DOS_DATE = 0x0021; // 1980-01-01, a valid fixed stamp
    const parts = [];
    const central = [];
    let offset = 0;

    for (const f of files) {
      const nameBytes = new TextEncoder().encode(f.name);
      const crc = crc32(f.data);
      const size = f.data.length;

      const local = new Uint8Array(30 + nameBytes.length);
      const ldv = new DataView(local.buffer);
      ldv.setUint32(0, 0x04034b50, true);   // local file header
      ldv.setUint16(4, 20, true);           // version needed
      ldv.setUint16(6, 0, true);            // flags
      ldv.setUint16(8, 0, true);            // method: store
      ldv.setUint16(10, DOS_TIME, true);
      ldv.setUint16(12, DOS_DATE, true);
      ldv.setUint32(14, crc, true);
      ldv.setUint32(18, size, true);        // compressed size
      ldv.setUint32(22, size, true);        // uncompressed size
      ldv.setUint16(26, nameBytes.length, true);
      ldv.setUint16(28, 0, true);           // extra len
      local.set(nameBytes, 30);
      parts.push(local, f.data);

      const cen = new Uint8Array(46 + nameBytes.length);
      const cdv = new DataView(cen.buffer);
      cdv.setUint32(0, 0x02014b50, true);   // central directory header
      cdv.setUint16(4, 20, true);           // version made by
      cdv.setUint16(6, 20, true);           // version needed
      cdv.setUint16(8, 0, true);
      cdv.setUint16(10, 0, true);
      cdv.setUint16(12, DOS_TIME, true);
      cdv.setUint16(14, DOS_DATE, true);
      cdv.setUint32(16, crc, true);
      cdv.setUint32(20, size, true);
      cdv.setUint32(24, size, true);
      cdv.setUint16(28, nameBytes.length, true);
      cdv.setUint32(42, offset, true);      // local header offset
      cen.set(nameBytes, 46);
      central.push(cen);

      offset += local.length + size;
    }

    const centralSize = central.reduce((n, c) => n + c.length, 0);
    const eocd = new Uint8Array(22);
    const edv = new DataView(eocd.buffer);
    edv.setUint32(0, 0x06054b50, true);
    edv.setUint16(8, files.length, true);
    edv.setUint16(10, files.length, true);
    edv.setUint32(12, centralSize, true);
    edv.setUint32(16, offset, true);
    return new Blob([...parts, ...central, eocd], { type: "application/zip" });
  }

  window.ClawExport = { encodeWav, encodeMidi, zipStore, crc32 };
})();
