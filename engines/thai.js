// Thai text processing for word lookup and the Thai anagram solver.
//
// * normalizeThai(): canonical form used to compare words (the original spelling is kept for display).
// * Characters are split into "core" characters (always required: consonants, า เ แ โ ะ ใ ไ ำ …)
//   and toggleable marks grouped in categories. By default only upper vowels (ิ ี ึ ื), lower vowels
//   (ุ ู) and tone marks (่ ้ ๊ ๋) may be left out of the input; ั ็ ์ are required unless switched on.
// * Matching compares character counts, so typing order does not matter (also for เ แ โ ใ ไ).
import { InputError } from "./errors.js";
import { counter, counterEquals, counterLe } from "./signatures.js";

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => String.fromCharCode(a + i));
const set = (s) => new Set(typeof s === "string" ? [...s] : s);

export const VOWEL_LETTERS = set("ฤฦ");                                   // ฤ ฦ
export const CONSONANTS = set(range(0x0E01, 0x0E2E).filter((c) => !VOWEL_LETTERS.has(c)));
export const LEADING_VOWELS = set("เแโใไ");                // เ แ โ ใ ไ
export const FOLLOWING_VOWELS = set("ะาำๅ");                    // ะ า ำ ๅ
export const UPPER_VOWELS = set("ิีึื");                        // ิ ี ึ ื
export const LOWER_VOWELS = set("ุู");                                    // ุ ู
export const TONE_MARKS = set("่้๊๋");                          // ่ ้ ๊ ๋
export const MAI_HAN_AKAT = "ั";
export const MAI_TAIKHU = "็";
export const THANTHAKHAT = "์";
export const OTHER_MARKS = set("ฺํ๎");                               // ฺ ํ ๎
export const THAI_DIGITS = set(range(0x0E50, 0x0E59));
export const THAI_SYMBOLS = set("ฯๆ฿๏๚๛");            // ฯ ๆ ฿ ๏ ๚ ๛

export const MARK_CATEGORIES = {
  upper: UPPER_VOWELS,
  lower: LOWER_VOWELS,
  tone: TONE_MARKS,
  mai_han_akat: set(MAI_HAN_AKAT),
  mai_taikhu: set(MAI_TAIKHU),
  thanthakhat: set(THANTHAKHAT),
};
export const CATEGORY_NAMES = Object.keys(MARK_CATEGORIES);
export const DEFAULT_OPTIONAL = new Set(["upper", "lower", "tone"]);
export const ALL_OPTIONAL = new Set(Object.keys(MARK_CATEGORIES));

// Kumkom game: one tile carries two letters and may be played as either of them.
export const DUAL_TILES = [["ฆ", "ซ"], ["ฌ", "ษ"], ["ฎ", "ฏ"], ["ฐ", "ฑ"], ["ฒ", "ณ"], ["ศ", "ฤ"], ["ฬ", "ญ"], ["ฮ", "ฦ"]];
const DUAL_OF = new Map();
for (const [a, b] of DUAL_TILES) { DUAL_OF.set(a + b, [a, b]); DUAL_OF.set(b + a, [a, b]); }
export const CHAR_CATEGORY = new Map();
for (const [cat, chars] of Object.entries(MARK_CATEGORIES)) for (const ch of chars) CHAR_CATEGORY.set(ch, cat);
export const TOGGLEABLE = new Set(CHAR_CATEGORY.keys());

// Non-spacing marks of the Thai block: ั ิ ี ึ ื ุ ู ฺ ็ ่ ้ ๊ ๋ ์ ํ ๎
const COMBINING = set(["ั", ...range(0x0E34, 0x0E3A), ...range(0x0E47, 0x0E4E)]);
const MARK_RANK = new Map();
for (const ch of COMBINING) MARK_RANK.set(ch, 0);
for (const ch of TONE_MARKS) MARK_RANK.set(ch, 1);
for (const ch of "์ํ๎") MARK_RANK.set(ch, 2);

const INVISIBLE = /[​‌‍⁠﻿­]/g;
const SPACES = /\s+/g;
const NIKHAHIT_AA = /ํ([่-๋]?)า/g;     // ํ (+tone) + า -> (tone) + ำ
const AM_THEN_TONE = /ำ([่-๋])/g;            // ำ + tone      -> tone + ำ
const MARK_RUN = /[ัิ-ฺ็-๎]{2,}/g;
const IGNORED_IN_WORD = set(" -‐‑–—.'’·()/,");
const INPUT_SEPARATORS = set(",;/|+-_.、");
const UNASSIGNED = /\p{Cn}/u;
const WHITESPACE = /\s/;
export const MAX_INPUT_CHARS = 40;

export function classifyChar(ch) {
  if (CONSONANTS.has(ch)) return "consonant";
  if (LEADING_VOWELS.has(ch)) return "leading_vowel";
  if (FOLLOWING_VOWELS.has(ch)) return "following_vowel";
  if (VOWEL_LETTERS.has(ch)) return "vowel_letter";
  if (UPPER_VOWELS.has(ch)) return "upper_vowel";
  if (LOWER_VOWELS.has(ch)) return "lower_vowel";
  if (TONE_MARKS.has(ch)) return "tone_mark";
  if (ch === MAI_HAN_AKAT) return "mai_han_akat";
  if (ch === MAI_TAIKHU) return "mai_taikhu";
  if (ch === THANTHAKHAT) return "thanthakhat";
  if (OTHER_MARKS.has(ch)) return "other_mark";
  if (THAI_DIGITS.has(ch)) return "digit";
  if (THAI_SYMBOLS.has(ch)) return "symbol";
  return "other";
}

export function isOptionalChar(ch, optional) {
  const cat = CHAR_CATEGORY.get(ch);
  return cat !== undefined && optional.has(cat);
}

function fixMarkRun(run) {
  const marks = [...run].map((ch, i) => [ch, i]).sort((a, b) => MARK_RANK.get(a[0]) - MARK_RANK.get(b[0]) || a[1] - b[1]);
  const out = [];
  for (const [ch] of marks) if (!out.length || out[out.length - 1] !== ch) out.push(ch);   // drop doubles like ่่
  return out.join("");
}

/** Canonical form of a Thai word (see docs). The original spelling is never changed. */
export function normalizeThai(text) {
  let s = String(text ?? "").normalize("NFC");
  s = s.replace(INVISIBLE, "");
  s = s.replace(SPACES, " ").trim();
  s = s.replaceAll("เเ", "แ");
  s = s.replace(NIKHAHIT_AA, "$1ำ");
  s = s.replace(AM_THEN_TONE, "$1ำ");
  s = s.replace(MARK_RUN, fixMarkRun);
  return s;
}

const ignoredInWord = (ch) => WHITESPACE.test(ch) || IGNORED_IN_WORD.has(ch);

/** Bitmasks of core characters (three 31-bit words) for the fast pre-filter of large searches. */
export function coreMasks(chars) {
  const m = [0, 0, 0];
  for (const ch of chars) {
    const off = ch.charCodeAt(0) - 0x0E00;
    if (off >= 1 && off <= 0x5B) {
      const bit = off - 1;                       // 0..90
      m[Math.floor(bit / 31)] |= 1 << (bit % 31);
    } else {
      m[2] |= 1 << 30;                           // any non-Thai character
    }
  }
  return m;
}

export function thaiFeatures(word) {
  const norm = normalizeThai(word);
  const core = [];
  const marks = [];
  let skeleton = "";
  for (const ch of norm) {
    if (ignoredInWord(ch)) continue;
    if (TOGGLEABLE.has(ch)) marks.push(ch);
    else { core.push(ch); skeleton += ch; }
  }
  core.sort();
  marks.sort();
  return {
    normalized: norm,
    skeleton,
    core_sig: core.join(""),
    marks_sig: marks.join(""),
    core_len: core.length,
    consonant_count: core.filter((ch) => CONSONANTS.has(ch)).length,
    char_len: core.length + marks.length,
  };
}

export function containsThai(text) {
  for (const ch of String(text)) { const c = ch.charCodeAt(0); if (c >= 0x0E01 && c <= 0x0E5B) return true; }
  return false;
}

/** Split the user's input into single Thai characters (order is irrelevant). */
export function parseThaiInput(text, maxChars = MAX_INPUT_CHARS) {
  const s = String(text ?? "").normalize("NFC").replace(INVISIBLE, "");
  const chars = [...s].filter((ch) => !(WHITESPACE.test(ch) || INPUT_SEPARATORS.has(ch)));
  if (!chars.length) throw new InputError("empty_input", "กรุณาป้อนตัวอักษรภาษาไทยอย่างน้อย 1 ตัว");
  const bad = [...new Set(chars.filter((ch) => {
    const c = ch.codePointAt(0);
    return c < 0x0E01 || c > 0x0E5B || UNASSIGNED.test(ch);
  }))].sort();
  if (bad.length) {
    throw new InputError("unsupported_characters", "รองรับเฉพาะตัวอักษรภาษาไทย พบตัวอักษรที่ไม่รองรับ: " + bad.join(" "), { characters: bad });
  }
  if (chars.length > maxChars) {
    throw new InputError("input_too_long", `ป้อนได้ไม่เกิน ${maxChars} ตัวอักษร (ป้อนมา ${chars.length} ตัว)`);
  }
  return chars;
}

/**
 * Tiles typed by the user: fixed Thai characters plus wildcard tiles.
 *   "?"      blank tile: any consonant or vowel (any always-required character)
 *   "ศ/ฤ"    dual tile (see DUAL_TILES): either of its two letters
 * Returns { chars: [...fixed], wildcards: [{label, set}] }  (set === null means "any").
 */
export function parseTileInput(text, maxTiles = MAX_INPUT_CHARS) {
  const s = [...String(text ?? "").normalize("NFC").replace(INVISIBLE, "")];
  const fixed = [];
  const wildcards = [];
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "?" || ch === "\uFF1F") { wildcards.push({ label: "?", set: null }); continue; }
    if (s[i + 1] === "/" && i + 2 < s.length && DUAL_OF.has(ch + s[i + 2])) {
      const [a, b] = DUAL_OF.get(ch + s[i + 2]);
      wildcards.push({ label: `${a}/${b}`, set: new Set([a, b]) });
      i += 2;
      continue;
    }
    if (WHITESPACE.test(ch) || INPUT_SEPARATORS.has(ch)) continue;
    fixed.push(ch);
  }
  if (!fixed.length && !wildcards.length) throw new InputError("empty_input", "กรุณาป้อนตัวอักษรภาษาไทยอย่างน้อย 1 ตัว");
  const bad = [...new Set(fixed.filter((ch) => {
    const c = ch.codePointAt(0);
    return c < 0x0E01 || c > 0x0E5B || UNASSIGNED.test(ch);
  }))].sort();
  if (bad.length) {
    throw new InputError("unsupported_characters", "รองรับเฉพาะตัวอักษรภาษาไทย พบตัวอักษรที่ไม่รองรับ: " + bad.join(" "), { characters: bad });
  }
  if (fixed.length + wildcards.length > maxTiles) {
    throw new InputError("input_too_long", `ป้อนได้ไม่เกิน ${maxTiles} ไทล์ (ป้อนมา ${fixed.length + wildcards.length} ไทล์)`);
  }
  return { chars: fixed, wildcards };
}

/**
 * Pattern typed by the user, tiles in written order: Thai letters, "?" (one tile), "*" (any number of
 * tiles, also none) and dual tiles "ศ/ฤ". Above/below marks are not tiles and are skipped.
 * Returns [{type: "char"|"any"|"star"|"set", ch?, chars?, label}].
 */
export function parsePattern(text, maxTiles = MAX_INPUT_CHARS) {
  const s = [...String(text ?? "").normalize("NFC").replace(INVISIBLE, "")];
  const tokens = [];
  const bad = new Set();
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "?" || ch === "\uFF1F") { tokens.push({ type: "any", label: "?" }); continue; }
    if (ch === "*" || ch === "\uFF0A") { if (tokens.at(-1)?.type !== "star") tokens.push({ type: "star", label: "*" }); continue; }
    if (s[i + 1] === "/" && i + 2 < s.length && DUAL_OF.has(ch + s[i + 2])) {
      const [a, b] = DUAL_OF.get(ch + s[i + 2]);
      tokens.push({ type: "set", chars: [a, b], label: `${a}/${b}` });
      i += 2;
      continue;
    }
    if (WHITESPACE.test(ch) || INPUT_SEPARATORS.has(ch)) continue;
    const c = ch.codePointAt(0);
    if (c < 0x0E01 || c > 0x0E5B || UNASSIGNED.test(ch)) { bad.add(ch); continue; }
    if (TOGGLEABLE.has(ch)) continue;
    tokens.push({ type: "char", ch, label: ch });
  }
  if (bad.size) {
    const b = [...bad].sort();
    throw new InputError("unsupported_characters", "รองรับเฉพาะตัวอักษรภาษาไทย ? และ * พบตัวอักษรที่ไม่รองรับ: " + b.join(" "), { characters: b });
  }
  const tiles = tokens.filter((t) => t.type !== "star").length;
  if (!tiles) throw new InputError("empty_input", "ป้อนตัวอักษรหรือ ? อย่างน้อย 1 ตัว");
  if (tiles > maxTiles) throw new InputError("input_too_long", `ป้อนได้ไม่เกิน ${maxTiles} ไทล์ (ป้อนมา ${tiles} ไทล์)`);
  return tokens;
}

/** {upper: true, ...} or ["upper", ...] -> Set of optional categories. */
export function parseOptionalCategories(value) {
  if (value == null) return new Set(DEFAULT_OPTIONAL);
  const names = Array.isArray(value) ? value : Object.keys(value).filter((k) => value[k]);
  const keys = Array.isArray(value) ? value : Object.keys(value);
  const unknown = keys.filter((k) => !(k in MARK_CATEGORIES));
  if (unknown.length) throw new InputError("invalid_optional_marks", "ไม่รู้จักหมวดเครื่องหมาย: " + unknown.join(", "));
  return new Set(names);
}

export function buildQuery(chars, optional = DEFAULT_OPTIONAL, { allowEmptyCore = false } = {}) {
  const core = new Map(), requiredMarks = new Map(), hints = new Map();
  const add = (m, ch) => m.set(ch, (m.get(ch) || 0) + 1);
  for (const ch of chars) {
    const cat = CHAR_CATEGORY.get(ch);
    if (cat === undefined) add(core, ch);
    else if (optional.has(cat)) add(hints, ch);
    else add(requiredMarks, ch);
  }
  if (!core.size && !allowEmptyCore) {
    throw new InputError("no_required_characters",
      "ต้องป้อนพยัญชนะหรือสระที่จำเป็นอย่างน้อย 1 ตัว (ป้อนเพียงวรรณยุกต์/สระบน-ล่างอย่างเดียวไม่ได้)");
  }
  const coreSig = [...core.entries()].flatMap(([ch, n]) => Array(n).fill(ch)).sort().join("");
  let consonants = 0;
  for (const [ch, n] of core) if (CONSONANTS.has(ch)) consonants += n;
  return { chars: [...chars], optional, core, requiredMarks, hints, coreSig, consonantCount: consonants };
}

/** Check one word (by its signatures) against a query. Returns null or match info. */
export function matchWord(coreSig, marksSig, q, mode) {
  const wcore = counter(coreSig);
  const wRequired = new Map(), wOptional = new Map();
  for (const ch of marksSig) {
    const m = q.optional.has(CHAR_CATEGORY.get(ch)) ? wOptional : wRequired;
    m.set(ch, (m.get(ch) || 0) + 1);
  }
  const exact = counterEquals(wcore, q.core) && counterEquals(wRequired, q.requiredMarks);
  if (mode === "exact") {
    if (!exact || !counterLe(q.hints, wOptional)) return null;
  } else if (mode === "partial") {
    if (!wcore.size || !counterLe(wcore, q.core) || !counterLe(wRequired, q.requiredMarks)) return null;
  } else {
    throw new Error(`unknown mode ${mode}`);
  }
  const omitted = [];
  for (const [ch, n] of wOptional) for (let i = 0; i < n - (q.hints.get(ch) || 0); i++) omitted.push(ch);
  omitted.sort();
  let consonants = 0;
  for (const [ch, n] of wcore) if (CONSONANTS.has(ch)) consonants += n;
  return { match_mode: exact ? "exact" : "partial", consonants_matched: consonants, omitted_marks: omitted };
}

/** Give each extra letter of the word its own wildcard tile (restricted tiles first). */
function assignWildcards(extra, wildcards) {
  const order = wildcards.map((_, i) => i).sort((a, b) => (wildcards[a].set ? 0 : 1) - (wildcards[b].set ? 0 : 1));
  const used = new Array(wildcards.length).fill(null);
  const rec = (e) => {
    if (e === extra.length) return true;
    const ch = extra[e];
    for (const i of order) {
      if (used[i] !== null) continue;
      const w = wildcards[i];
      if (w.set && !w.set.has(ch)) continue;
      used[i] = ch;
      if (rec(e + 1)) return true;
      used[i] = null;
    }
    return false;
  };
  if (!rec(0)) return null;
  return wildcards.map((w, i) => ({ label: w.label, as: used[i] }));   // as === null: tile not used (partial)
}

/**
 * matchWord() with wildcard tiles. The word's always-required characters must be the fixed tiles
 * plus one letter per wildcard tile (exact: every tile used; partial: any subset of tiles).
 */
export function matchWordWild(coreSig, marksSig, q, wildcards, mode) {
  const wcore = counter(coreSig);
  const extra = [];
  let missing = 0;
  for (const [ch, n] of wcore) for (let d = n - (q.core.get(ch) || 0); d > 0; d--) extra.push(ch);
  for (const [ch, n] of q.core) { const d = n - (wcore.get(ch) || 0); if (d > 0) missing += d; }
  if (mode === "exact") {
    if (missing || extra.length !== wildcards.length) return null;
  } else if (mode === "partial") {
    if (!wcore.size || extra.length > wildcards.length) return null;
  } else {
    throw new Error(`unknown mode ${mode}`);
  }
  const wRequired = new Map(), wOptional = new Map();
  for (const ch of marksSig) {
    const m = q.optional.has(CHAR_CATEGORY.get(ch)) ? wOptional : wRequired;
    m.set(ch, (m.get(ch) || 0) + 1);
  }
  if (mode === "exact") {
    if (!counterEquals(wRequired, q.requiredMarks) || !counterLe(q.hints, wOptional)) return null;
  } else if (!counterLe(wRequired, q.requiredMarks)) return null;
  const assigned = assignWildcards(extra, wildcards);
  if (!assigned) return null;
  const omitted = [];
  for (const [ch, n] of wOptional) for (let i = 0; i < n - (q.hints.get(ch) || 0); i++) omitted.push(ch);
  omitted.sort();
  let consonants = 0;
  for (const [ch, n] of wcore) if (CONSONANTS.has(ch)) consonants += n;
  const allUsed = !missing && extra.length === wildcards.length && counterEquals(wRequired, q.requiredMarks);
  return { match_mode: allUsed ? "exact" : "partial", consonants_matched: consonants, omitted_marks: omitted, wildcards: assigned };
}

const SECONDARY_ONLY = new Set([...TONE_MARKS, MAI_TAIKHU, THANTHAKHAT]);

/** Approximate Thai dictionary order: leading vowels sort after the following consonant. */
export function thaiSortKey(word) {
  const s = normalizeThai(word);
  const chars = [...s];
  const out = [];
  for (let i = 0; i < chars.length; i++) {
    if (LEADING_VOWELS.has(chars[i]) && i + 1 < chars.length && CONSONANTS.has(chars[i + 1])) {
      out.push(chars[i + 1], chars[i]);
      i++;
    } else out.push(chars[i]);
  }
  const full = out.join("");
  const primary = out.filter((ch) => !SECONDARY_ONLY.has(ch)).join("");
  return [primary, full];
}

export function compareThai(a, b) {
  const ka = thaiSortKey(a), kb = thaiSortKey(b);
  return cmp(ka[0], kb[0]) || cmp(ka[1], kb[1]);
}

/** Code-point string comparison (same as Python's default str ordering for Thai/BMP text). */
export function cmp(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
