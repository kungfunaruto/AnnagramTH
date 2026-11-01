// English text processing for word lookup and the English anagram solver.
import { InputError } from "./errors.js";
import { counterEquals, counterLe, counter } from "./signatures.js";

export const MAX_INPUT_LETTERS = 30;
const INVISIBLE = /[​‌‍⁠﻿­]/g;
const SPACES = /\s+/g;
const WHITESPACE = /\s/;
const COMBINING_MARK = /\p{Mn}/u;
const IGNORED_IN_WORD = new Set([..." -‐‑–—'’."]);
const INPUT_SEPARATORS = new Set([...",;/|-_."]);

export function normalizeEnglish(text) {
  return String(text ?? "").normalize("NFC").replace(INVISIBLE, "").replace(SPACES, " ").trim().toLowerCase();
}

/** Remove accents (café -> cafe) and expand compatibility forms (ﬁ -> fi). */
export function fold(text) {
  return [...String(text).normalize("NFKD")].filter((ch) => !COMBINING_MARK.test(ch)).join("").toLowerCase();
}

/** Sorted a-z letters of a word, or null if it contains other letters or digits. */
export function letterSignature(normalizedWord) {
  const letters = [];
  for (const ch of fold(normalizedWord)) {
    if (WHITESPACE.test(ch) || IGNORED_IN_WORD.has(ch)) continue;
    if (ch >= "a" && ch <= "z") letters.push(ch);
    else return null;
  }
  if (!letters.length) return null;
  return letters.sort().join("");
}

export function letterMask(sig) {
  let m = 0;
  for (const ch of sig) m |= 1 << (ch.charCodeAt(0) - 97);
  return m;
}

export function englishFeatures(word) {
  const normalized = normalizeEnglish(word);
  const sig = letterSignature(normalized);
  return { normalized, letter_sig: sig, letter_count: sig ? sig.length : null, letter_mask: sig ? letterMask(sig) : null };
}

export function containsLatinLetter(text) {
  return /[a-z]/.test(fold(text));
}

/** User input "e a t" / "EAT" / "e,a,t" -> ["e", "a", "t"]. */
export function parseLetters(text, maxLetters = MAX_INPUT_LETTERS) {
  const s = String(text ?? "").normalize("NFC").replace(INVISIBLE, "");
  const raw = [...s].filter((ch) => !(WHITESPACE.test(ch) || INPUT_SEPARATORS.has(ch)));
  if (!raw.length) throw new InputError("empty_input", "กรุณาป้อนตัวอักษรภาษาอังกฤษอย่างน้อย 1 ตัว");
  const letters = [];
  const bad = new Set();
  for (const ch of raw) {
    const f = fold(ch);
    if (f.length === 1 && f >= "a" && f <= "z") letters.push(f);
    else bad.add(ch);
  }
  if (bad.size) {
    const b = [...bad].sort();
    throw new InputError("unsupported_characters", "รองรับเฉพาะตัวอักษร a-z พบตัวอักษรที่ไม่รองรับ: " + b.join(" "), { characters: b });
  }
  if (letters.length > maxLetters) {
    throw new InputError("input_too_long", `ป้อนได้ไม่เกิน ${maxLetters} ตัวอักษร (ป้อนมา ${letters.length} ตัว)`);
  }
  return letters;
}

/** Rack with blank tiles: "e a ? t" -> { letters: ["e", "a", "t"], blanks: 1 }. */
export function parseRack(text, maxLetters = MAX_INPUT_LETTERS) {
  const s = String(text ?? "");
  const blanks = [...s].filter((ch) => ch === "?" || ch === "\uFF1F").length;
  let letters = [];
  try { letters = parseLetters(s.replace(/[?\uFF1F]/g, " "), Infinity); }
  catch (err) { if (!(blanks && err.code === "empty_input")) throw err; }
  if (letters.length + blanks > maxLetters) {
    throw new InputError("input_too_long", `ป้อนได้ไม่เกิน ${maxLetters} ตัวอักษร (ป้อนมา ${letters.length + blanks} ตัว)`);
  }
  return { letters, blanks };
}

/** Pattern: letters in order, "?" one letter, "*" any number of letters (also none). */
export function parsePattern(text, maxLetters = MAX_INPUT_LETTERS) {
  const tokens = [];
  const bad = new Set();
  for (const ch of String(text ?? "").normalize("NFC").replace(INVISIBLE, "")) {
    if (ch === "?" || ch === "\uFF1F") tokens.push({ type: "any", label: "?" });
    else if (ch === "*" || ch === "\uFF0A") { if (tokens.at(-1)?.type !== "star") tokens.push({ type: "star", label: "*" }); }
    else if (WHITESPACE.test(ch) || INPUT_SEPARATORS.has(ch)) continue;
    else {
      const f = fold(ch);
      if (f.length === 1 && f >= "a" && f <= "z") tokens.push({ type: "char", ch: f, label: f });
      else bad.add(ch);
    }
  }
  if (bad.size) {
    const b = [...bad].sort();
    throw new InputError("unsupported_characters", "รองรับเฉพาะตัวอักษร a-z ? และ * พบตัวอักษรที่ไม่รองรับ: " + b.join(" "), { characters: b });
  }
  const n = tokens.filter((t) => t.type !== "star").length;
  if (!n) throw new InputError("empty_input", "ป้อนตัวอักษรหรือ ? อย่างน้อย 1 ตัว");
  if (n > maxLetters) throw new InputError("input_too_long", `ป้อนได้ไม่เกิน ${maxLetters} ตัวอักษร (ป้อนมา ${n} ตัว)`);
  return tokens;
}

/** a-z letters of a word in order (accents folded, spaces/hyphens dropped). */
export function lettersOnly(normalizedWord) {
  return [...fold(normalizedWord)].filter((ch) => ch >= "a" && ch <= "z").join("");
}

export function matchLetters(wordSig, available, mode) {
  const wc = counter(wordSig);
  if (mode === "exact") return counterEquals(wc, available);
  if (mode === "partial") return counterLe(wc, available);
  throw new Error(`unknown mode ${mode}`);
}
