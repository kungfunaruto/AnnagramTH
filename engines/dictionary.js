// On-device word index for lookup and anagram search (runs inside the search worker).
// Every result comes from the bundled word list; nothing is generated.
import * as thai from "./thai.js";
import * as english from "./english.js";
import { counter, submultisetSignatures } from "./signatures.js";
import { InputError } from "./errors.js";

export const SUBSET_SIGNATURE_LIMIT = 4096;   // above this, partial search scans bitmasks instead
export const MAX_RESULT_LIMIT = 30000;
export const SORTS = ["tiles_desc", "length_desc", "length_asc", "alpha", "alpha_desc", "consonants_desc"];
export const MAX_PATTERN_TOKENS = 40;

function checkCommon({ mode, limit, sort, min_length, max_length }) {
  mode = mode || "exact";
  if (mode !== "exact" && mode !== "partial") throw new InputError("invalid_mode", "โหมดต้องเป็น exact หรือ partial");
  limit = limit === undefined || limit === null || limit === "" ? 200 : Number(limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RESULT_LIMIT) {
    throw new InputError("invalid_limit", `จำนวนผลลัพธ์ต้องอยู่ระหว่าง 1–${MAX_RESULT_LIMIT}`);
  }
  sort = sort || "length_desc";
  if (!SORTS.includes(sort)) throw new InputError("invalid_sort", "การเรียงไม่ถูกต้อง");
  const len = (v, name) => {
    if (v === undefined || v === null || v === "") return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 200) throw new InputError("invalid_length", `${name} ต้องอยู่ระหว่าง 1–200`);
    return n;
  };
  const minL = len(min_length, "ความยาวขั้นต่ำ"), maxL = len(max_length, "ความยาวสูงสุด");
  if (minL && maxL && minL > maxL) throw new InputError("invalid_length", "ความยาวขั้นต่ำมากกว่าความยาวสูงสุด");
  return { mode, limit, sort, minL, maxL };
}

function lowerBound(arr, x) {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] < x) lo = mid + 1; else hi = mid; }
  return lo;
}

const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const thaiKey = (w) => thai.thaiSortKey(w);                       // Thai dictionary order
const englishKey = (w) => [w.toLowerCase(), w];                   // a → z, then exact spelling

/**
 * Filter, sort, count per tile group and cut to the limit.
 * sortKey(word) gives [primary, secondary] dictionary-order keys (computed once per word).
 * groups: how many matches use each number of tiles (before the limit), most tiles first.
 */
function finish(matches, { mode, limit, sort, minL, maxL }, contains, normalize, sortKey, t0, extra) {
  let items = matches;
  if (minL) items = items.filter((m) => m.length >= minL);
  if (maxL) items = items.filter((m) => m.length <= maxL);
  const needle = contains ? normalize(contains).toLowerCase() : "";
  if (needle) items = items.filter((m) => m.normalized.toLowerCase().includes(needle));
  const keys = new Map();
  const key = (w) => { let k = keys.get(w); if (!k) { k = sortKey(w); keys.set(w, k); } return k; };
  const byWord = (a, b) => { const ka = key(a.word), kb = key(b.word); return cmpStr(ka[0], kb[0]) || cmpStr(ka[1], kb[1]); };
  const cmps = {
    tiles_desc: (a, b) => b.tiles - a.tiles || byWord(a, b),
    length_desc: (a, b) => b.length - a.length || byWord(a, b),
    length_asc: (a, b) => a.length - b.length || byWord(a, b),
    alpha: byWord,
    alpha_desc: (a, b) => byWord(b, a),
    consonants_desc: (a, b) => (b.consonants_matched || 0) - (a.consonants_matched || 0) || b.length - a.length || byWord(a, b),
  };
  items = [...items].sort(cmps[sort]);
  const perTiles = new Map();
  for (const m of items) perTiles.set(m.tiles, (perTiles.get(m.tiles) || 0) + 1);
  const groups = [...perTiles.entries()].sort((a, b) => b[0] - a[0]).map(([tiles, count]) => ({ tiles, count }));
  const total = items.length;
  const results = items.slice(0, limit).map(({ normalized, ...r }) => r);
  return {
    mode, total, returned: results.length, limit, truncated: total > limit, results, groups,
    elapsed_ms: Math.round((performance.now() - t0) * 10) / 10, ...extra,
  };
}

/** Pattern tokens -> anchored RegExp over a word's tiles in written order. */
function patternRegExp(tokens) {
  const escape = (ch) => ch.replace(/[\\^$.*+?()[\]{}|\/-]/g, "\\$&");
  const src = tokens.map((t) => (t.type === "any" ? "." : t.type === "star" ? ".*"
    : t.type === "set" ? `[${t.chars.map(escape).join("")}]` : escape(t.ch))).join("");
  return new RegExp(`^${src}$`, "u");
}

// ---------------------------------------------------------------- Thai
export class ThaiIndex {
  constructor(words) {
    const n = words.length;
    this.words = words;
    this.norm = new Array(n);
    this.coreSig = new Array(n);
    this.marksSig = new Array(n);
    this.skeleton = new Array(n);           // tiles in written order (no above/below marks)
    this.charLen = new Uint16Array(n);
    this.coreLen = new Uint16Array(n);
    this.mask = [new Int32Array(n), new Int32Array(n), new Int32Array(n)];
    this.byNorm = new Map();
    this.byCore = new Map();
    this.bySkeleton = new Map();
    const push = (m, k, i) => { const a = m.get(k); if (a) a.push(i); else m.set(k, [i]); };
    for (let i = 0; i < n; i++) {
      const f = thai.thaiFeatures(words[i]);
      this.norm[i] = f.normalized;
      this.coreSig[i] = f.core_sig;
      this.marksSig[i] = f.marks_sig;
      this.skeleton[i] = f.skeleton;
      this.charLen[i] = f.char_len;
      this.coreLen[i] = f.core_len;
      const m = thai.coreMasks(f.core_sig);
      this.mask[0][i] = m[0]; this.mask[1][i] = m[1]; this.mask[2][i] = m[2];
      push(this.byNorm, f.normalized, i);
      push(this.byCore, f.core_sig, i);
      push(this.bySkeleton, f.skeleton, i);
    }
    this.sortedNorm = [...this.byNorm.keys()].sort();
    this.subsetLimit = SUBSET_SIGNATURE_LIMIT;
  }

  get size() { return this.words.length; }

  lookup(text) {
    const raw = String(text ?? "").trim();
    if (!raw) throw new InputError("empty_input", "กรุณาป้อนคำที่ต้องการตรวจ");
    if (raw.length > 200) throw new InputError("input_too_long", "คำยาวเกิน 200 ตัวอักษร");
    const norm = thai.normalizeThai(raw);
    if (!thai.containsThai(norm)) throw new InputError("not_thai", "คำนี้ไม่มีตัวอักษรภาษาไทย (ใช้แท็บอังกฤษสำหรับภาษาอังกฤษ)");
    const hits = this.byNorm.get(norm);
    if (hits) return { status: "found", query: raw, normalized: norm, words: hits.map((i) => this.words[i]) };
    const skel = thai.thaiFeatures(norm).skeleton;
    const similar = (this.bySkeleton.get(skel) || []).map((i) => this.words[i]).sort(thai.compareThai).slice(0, 20);
    const startsWith = [];
    for (let k = lowerBound(this.sortedNorm, norm); k < this.sortedNorm.length && startsWith.length < 10; k++) {
      if (!this.sortedNorm[k].startsWith(norm)) break;
      startsWith.push(this.words[this.byNorm.get(this.sortedNorm[k])[0]]);
    }
    return { status: "not_found", query: raw, normalized: norm, words: [], suggestions: { similar, starts_with: startsWith } };
  }

  anagram(params) {
    const t0 = performance.now();
    const tiles = thai.parseTileInput(params.text);
    const optional = thai.parseOptionalCategories(params.optional_marks);
    const wild = tiles.wildcards;
    const q = thai.buildQuery(tiles.chars, optional, { allowEmptyCore: wild.length > 0 });
    const opts = checkCommon(params);
    if (wild.length) return this.anagramWild(q, wild, optional, opts, params, t0);
    const chars = tiles.chars;
    let candidates, strategy;
    if (opts.mode === "exact") {
      candidates = this.byCore.get(q.coreSig) || [];
      strategy = "exact-signature";
    } else {
      const sigs = submultisetSignatures(q.core, this.subsetLimit);
      if (sigs) {
        candidates = sigs.flatMap((s) => this.byCore.get(s) || []);
        strategy = "subset-signatures";
      } else {
        const [m0, m1, m2] = thai.coreMasks(q.coreSig);
        const maxCore = q.coreSig.length;
        const [a0, a1, a2] = this.mask;
        candidates = [];
        for (let i = 0; i < this.words.length; i++) {
          if ((a0[i] & ~m0) || (a1[i] & ~m1) || (a2[i] & ~m2) || this.coreLen[i] > maxCore) continue;
          candidates.push(i);
        }
        strategy = "bitmask-scan";
      }
    }
    const matches = [];
    for (const i of candidates) {
      const m = thai.matchWord(this.coreSig[i], this.marksSig[i], q, opts.mode);
      if (m) matches.push({ word: this.words[i], normalized: this.norm[i], length: this.charLen[i], tiles: this.coreLen[i], ...m });
    }
    return finish(matches, opts, params.contains, thai.normalizeThai, thaiKey, t0, {
      strategy, candidates_checked: candidates.length,
      input: {
        characters: q.chars.map((ch) => ({ char: ch, type: thai.classifyChar(ch), optional: thai.isOptionalChar(ch, optional) })),
        consonant_count: q.consonantCount,
      },
    });
  }
}

// Thai search with wildcard tiles ("?" and dual tiles) — a linear scan with cheap length filters.
ThaiIndex.prototype.anagramWild = function anagramWild(q, wild, optional, opts, params, t0) {
  const fixedLen = q.coreSig.length, k = wild.length;
  const matches = [];
  let checked = 0;
  for (let i = 0; i < this.words.length; i++) {
    const len = this.coreLen[i];
    if (opts.mode === "exact" ? len !== fixedLen + k : len > fixedLen + k || len === 0) continue;
    checked++;
    const m = thai.matchWordWild(this.coreSig[i], this.marksSig[i], q, wild, opts.mode);
    if (m) matches.push({ word: this.words[i], normalized: this.norm[i], length: this.charLen[i], tiles: this.coreLen[i], ...m });
  }
  return finish(matches, opts, params.contains, thai.normalizeThai, thaiKey, t0, {
    strategy: "wildcard-scan", candidates_checked: checked,
    input: {
      characters: q.chars.map((ch) => ({ char: ch, type: thai.classifyChar(ch), optional: thai.isOptionalChar(ch, optional) })),
      wildcards: wild.map((w) => w.label), consonant_count: q.consonantCount,
    },
  });
};

/**
 * Pattern search over a word's tiles in written order (above/below marks are not tiles):
 *   "?" exactly one tile, "*" any number of tiles (also none), "ศ/ฤ" one tile that is either letter.
 * Example: "ก ? ม" -> กลม, กลุ้ม, กรม …   "* ก า ร" -> words ending in การ
 */
ThaiIndex.prototype.pattern = function pattern(params) {
  const t0 = performance.now();
  const tokens = thai.parsePattern(params.text, MAX_PATTERN_TOKENS);
  const opts = checkCommon({ ...params, mode: "exact", sort: params.sort || "tiles_desc" });
  const re = patternRegExp(tokens);
  const fixed = tokens.filter((t) => t.type !== "star").length;
  const hasStar = tokens.some((t) => t.type === "star");
  const matches = [];
  for (let i = 0; i < this.words.length; i++) {
    const len = this.coreLen[i];
    if (hasStar ? len < fixed : len !== fixed) continue;
    if (re.test(this.skeleton[i])) {
      matches.push({ word: this.words[i], normalized: this.norm[i], length: this.charLen[i], tiles: len, match_mode: "pattern" });
    }
  }
  return finish(matches, { ...opts, mode: "pattern" }, params.contains, thai.normalizeThai, thaiKey, t0, {
    strategy: "pattern-scan", input: { pattern: tokens.map((t) => t.label).join(" "), tiles: fixed, open_ended: hasStar },
  });
};

// ---------------------------------------------------------------- English
export class EnglishIndex {
  constructor(words) {
    const n = words.length;
    this.words = words;
    this.norm = new Array(n);
    this.sig = new Array(n);
    this.mask = new Int32Array(n);
    this.byNorm = new Map();
    this.bySig = new Map();
    const push = (m, k, i) => { const a = m.get(k); if (a) a.push(i); else m.set(k, [i]); };
    for (let i = 0; i < n; i++) {
      const f = english.englishFeatures(words[i]);
      this.norm[i] = f.normalized;
      this.sig[i] = f.letter_sig;
      this.mask[i] = f.letter_mask ?? -1;
      push(this.byNorm, f.normalized, i);
      if (f.letter_sig) push(this.bySig, f.letter_sig, i);
    }
    this.sortedNorm = [...this.byNorm.keys()].sort();
    this.subsetLimit = SUBSET_SIGNATURE_LIMIT;
  }

  get size() { return this.words.length; }

  lookup(text) {
    const raw = String(text ?? "").trim();
    if (!raw) throw new InputError("empty_input", "กรุณาป้อนคำที่ต้องการตรวจ");
    if (raw.length > 200) throw new InputError("input_too_long", "คำยาวเกิน 200 ตัวอักษร");
    const norm = english.normalizeEnglish(raw);
    const hits = this.byNorm.get(norm);
    if (hits) return { status: "found", query: raw, normalized: norm, words: hits.map((i) => this.words[i]) };
    const sig = english.letterSignature(norm);
    const similar = sig ? (this.bySig.get(sig) || []).map((i) => this.words[i]).sort().slice(0, 20) : [];
    const startsWith = [];
    for (let k = lowerBound(this.sortedNorm, norm); k < this.sortedNorm.length && startsWith.length < 10; k++) {
      if (!this.sortedNorm[k].startsWith(norm)) break;
      startsWith.push(this.words[this.byNorm.get(this.sortedNorm[k])[0]]);
    }
    return { status: "not_found", query: raw, normalized: norm, words: [], suggestions: { similar, starts_with: startsWith } };
  }

  anagram(params) {
    const t0 = performance.now();
    const { letters, blanks } = english.parseRack(params.letters);
    const opts = checkCommon(params);
    if (opts.sort === "consonants_desc") opts.sort = "length_desc";
    if (blanks) return this.anagramBlanks(letters, blanks, opts, params, t0);
    const avail = counter(letters);
    const sig = [...letters].sort().join("");
    let candidates, strategy;
    if (opts.mode === "exact") {
      candidates = this.bySig.get(sig) || [];
      strategy = "exact-signature";
    } else {
      const sigs = submultisetSignatures(avail, this.subsetLimit);
      if (sigs) { candidates = sigs.flatMap((s) => this.bySig.get(s) || []); strategy = "subset-signatures"; }
      else {
        const m = english.letterMask(sig);
        candidates = [];
        for (let i = 0; i < this.words.length; i++) {
          const s = this.sig[i];
          if (s && !(this.mask[i] & ~m) && s.length <= sig.length) candidates.push(i);
        }
        strategy = "bitmask-scan";
      }
    }
    const matches = [];
    for (const i of candidates) {
      const s = this.sig[i];
      if (english.matchLetters(s, avail, opts.mode)) {
        matches.push({ word: this.words[i], normalized: this.norm[i], length: s.length, tiles: s.length, letters_used: s.length,
          consonants_matched: null, match_mode: s === sig ? "exact" : "partial" });
      }
    }
    return finish(matches, opts, params.contains, english.normalizeEnglish, englishKey, t0, {
      strategy, candidates_checked: candidates.length, input: { letters: sig, letter_count: letters.length, blanks: 0 },
    });
  }

  /** Rack with blank tiles "?": each blank stands for any one letter. */
  anagramBlanks(letters, k, opts, params, t0) {
    const n = letters.length;
    const avail = new Uint8Array(26);
    for (const c of letters) avail[c.charCodeAt(0) - 97]++;
    const matches = [];
    let checked = 0;
    for (let i = 0; i < this.words.length; i++) {
      const s = this.sig[i];
      if (!s) continue;
      const L = s.length;
      if (opts.mode === "exact" ? L !== n + k : L > n + k) continue;
      checked++;
      let deficit = 0;
      for (let j = 0; j < L && deficit <= k;) {          // sig is sorted: count each run of one letter
        const c = s.charCodeAt(j);
        let run = 1;
        while (j + run < L && s.charCodeAt(j + run) === c) run++;
        const d = run - avail[c - 97];
        if (d > 0) deficit += d;
        j += run;
      }
      if (deficit > k) continue;
      matches.push({ word: this.words[i], normalized: this.norm[i], length: L, tiles: L, letters_used: L,
        consonants_matched: null, match_mode: L === n + k ? "exact" : "partial" });
    }
    return finish(matches, opts, params.contains, english.normalizeEnglish, englishKey, t0, {
      strategy: "blank-scan", candidates_checked: checked,
      input: { letters: [...letters].sort().join(""), letter_count: n, blanks: k },
    });
  }

  /** Pattern search: "?" one letter, "*" any number of letters. Example: "c?t", "*ing". */
  pattern(params) {
    const t0 = performance.now();
    const tokens = english.parsePattern(params.text, MAX_PATTERN_TOKENS);
    const opts = checkCommon({ ...params, mode: "exact", sort: params.sort || "tiles_desc" });
    if (!this.letters) this.letters = this.words.map((w, i) => (this.sig[i] ? english.lettersOnly(this.norm[i]) : null));
    const re = patternRegExp(tokens);
    const fixed = tokens.filter((t) => t.type !== "star").length;
    const hasStar = tokens.some((t) => t.type === "star");
    const matches = [];
    for (let i = 0; i < this.words.length; i++) {
      const w = this.letters[i];
      if (!w || (hasStar ? w.length < fixed : w.length !== fixed)) continue;
      if (re.test(w)) matches.push({ word: this.words[i], normalized: this.norm[i], length: w.length, tiles: w.length, match_mode: "pattern" });
    }
    return finish(matches, { ...opts, mode: "pattern" }, params.contains, english.normalizeEnglish, englishKey, t0, {
      strategy: "pattern-scan", input: { pattern: tokens.map((t) => t.label).join(""), tiles: fixed, open_ended: hasStar },
    });
  }
}

/** Split a packed word list (one word per line). */
export function parseWordList(text) {
  return text.split("\n").map((w) => w.trim()).filter(Boolean);
}
