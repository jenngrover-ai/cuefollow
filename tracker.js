/* Script-following logic: aligns recognized words to the script and holds when the speaker goes off-script. */
(function (root) {
  'use strict';

  function norm(w) {
    return String(w).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');
  }

  /* Split script text into display tokens plus a flat list of spoken words.
     Text inside [square brackets] is a cue: shown, never tracked. Hyphenated words count as separate spoken words. */
  function parseScript(text) {
    const paras = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    const tokens = [], words = [];
    paras.forEach((line, p) => {
      let inCue = false;
      line.split(/\s+/).filter(Boolean).forEach((raw) => {
        const opens = raw.includes('[');
        const cue = inCue || opens;
        if (opens) inCue = true;
        if (raw.includes(']')) inCue = false;
        const tok = { text: raw, para: p, cue, first: -1 };
        if (!cue) {
          raw.split(/[-\u2010-\u2015\/]+/).forEach((part) => {
            const n = norm(part);
            if (!n) return;
            if (tok.first < 0) tok.first = words.length;
            words.push({ n, t: tokens.length, raw: part });
          });
        }
        tokens.push(tok);
      });
    });
    return { tokens, words, paraCount: paras.length };
  }

  /* Word list for the on-device recognizer's vocabulary (keeps apostrophes, which its dictionary uses). */
  function vocab(words) {
    const set = new Set();
    words.forEach((w) => {
      const v = w.raw.toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[^a-z']+/g, '').replace(/^'+|'+$/g, '');
      if (v) set.add(v);
    });
    return Array.from(set);
  }

  function lev(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev = [];
    for (let j = 0; j <= b.length; j++) prev[j] = j;
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      let best = cur[0];
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (cur[j] < best) best = cur[j];
      }
      if (best > max) return max + 1;
      prev = cur;
    }
    return prev[b.length];
  }

  function eq(a, b) {
    if (a === b) return true;
    if (!a || !b) return false;
    const mn = Math.min(a.length, b.length), mx = Math.max(a.length, b.length);
    if (mn >= 4 && mx - mn <= 2 && (a.startsWith(b) || b.startsWith(a))) return true; // plurals, tenses
    if (mn >= 5 && lev(a, b, 1) <= 1) return true;
    if (mn >= 9 && lev(a, b, 2) <= 2) return true;
    return false;
  }

  class Tracker {
    constructor(words, opts) {
      this.S = words;
      this.o = Object.assign({ ahead: 60, back: 15, wideAhead: 250, stallAfter: 10 }, opts || {});
      this.reset(0);
    }
    reset(pos) {
      this.pos = Math.max(0, Math.min(pos || 0, this.S.length));
      this.buf = [];
      this.streak = 0;
      this.stall = 0;
      this.prev = [];
      this.lastAdv = -1;
    }
    get done() { return this.pos >= this.S.length; }

    /* Feed the full word list of the utterance in progress (partials get revised, so we diff). */
    update(rawWords) {
      const words = rawWords.filter((w) => w && w !== '[unk]').map(norm).filter(Boolean);
      const prev = this.prev;
      if (words.length + 2 < prev.length) this.lastAdv = -1; // transcript restarted
      let common = 0;
      while (common < prev.length && common < words.length && prev[common] === words[common]) common++;
      const start = Math.max(common, this.lastAdv + 1);
      const before = this.pos;
      for (let i = start; i < words.length; i++) {
        if (this._feed(words[i])) this.lastAdv = i;
      }
      this.prev = words;
      return this.pos !== before;
    }
    endUtterance() { this.prev = []; this.lastAdv = -1; }

    _feed(w) {
      const S = this.S;
      if (this.done) return false;
      this.buf.push(w);
      if (this.buf.length > 8) this.buf.shift();
      // 1. Next expected word. Short words only count when we are already in step.
      if (eq(w, S[this.pos]) && (this.streak >= 1 || w.length >= 4 || this.pos === 0)) {
        this.pos++; this.streak++; this.stall = 0;
        return true;
      }
      // 2. Re-align using the last few heard words.
      const wide = this.stall >= this.o.stallAfter;
      const lo = Math.max(0, this.pos - this.o.back);
      const hi = Math.min(S.length, this.pos + (wide ? this.o.wideAhead : this.o.ahead));
      let best = null;
      for (let e = lo; e < hi; e++) {
        if (!eq(w, S[e])) continue;
        const m = this._backMatch(e, lo);
        const d = e - this.pos;
        const need = d < 0 ? 4 : d <= 3 ? 2 : d <= this.o.ahead ? 3 : 4;
        if (d < 0 && d > -3) continue; // repeating the last word or two is not a jump back
        if (m.matches < need) continue;
        const score = m.matches - m.gaps * 0.5 - Math.abs(d) * 0.01 - (d < 0 ? 0.5 : 0);
        if (!best || score > best.score) best = { e, score };
      }
      if (best) {
        this.pos = best.e + 1; this.streak = 1; this.stall = 0;
        return true;
      }
      this.streak = 0; this.stall++;
      return false;
    }

    _backMatch(e, lo) {
      const S = this.S, b = this.buf;
      let i = b.length - 2, j = e - 1, matches = 1, gaps = 0;
      while (i >= 0 && j >= lo && gaps <= 2) {
        if (eq(b[i], S[j])) { matches++; i--; j--; }
        else if (i > 0 && eq(b[i - 1], S[j])) { i--; gaps++; }       // extra heard word
        else if (j > lo && eq(b[i], S[j - 1])) { j--; gaps++; }      // script word missed
        else break;
      }
      return { matches, gaps };
    }
  }

  const api = { norm, parseScript, vocab, eq, Tracker };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.CueTracker = api;
})(typeof self !== 'undefined' ? self : globalThis);
