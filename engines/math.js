// A-Math style equation anagram solver (port of the verified Python solver).
//
// Position model: positions are 1-based slots of the final equation, read left to right.
// A tile locked at position p is the p-th tile of every equation. Equations always start at
// slot 1, so unused tiles (Partial mode) never shift a locked tile.
//
// Search: work is split into pieces (equation length L, slots of "="; several "=" only when the
// rule allow_multiple_equals is on: A = B = C, every side has the same value). The shorter side is
// enumerated by backtracking over distinct tile types (identical copies are never permuted
// twice), with syntax checked at every step and values computed incrementally with exact
// arithmetic. Shorter sides are grouped by remaining tiles and value; the longer side is then
// streamed from exactly those tiles and joined when the values match (meet-in-the-middle).
// Every equation is re-checked by validateArrangement() before it is returned.
import { InputError } from "./errors.js";

export const NUMBER_TILES = Array.from({ length: 21 }, (_, i) => String(i));
export const OPERATOR_TILES = ["+", "-", "×", "÷"];
export const EQUALS = "=";
export const PLUS_MINUS = "+/-";
export const TIMES_DIVIDE = "×/÷";
export const WILDCARD = "?";
export const SPECIAL_TILES = [PLUS_MINUS, TIMES_DIVIDE, WILDCARD];
export const ALL_TILES = [...NUMBER_TILES, ...OPERATOR_TILES, EQUALS, ...SPECIAL_TILES];
const TILE_INDEX = new Map(ALL_TILES.map((t, i) => [t, i]));
const TILE_ALIASES = {
  x: "×", X: "×", "*": "×", "/": "÷", ":": "÷", "−": "-", "–": "-",
  "±": PLUS_MINUS, "+-": PLUS_MINUS, "-/+": PLUS_MINUS, "+/−": PLUS_MINUS,
  "x/÷": TIMES_DIVIDE, "*/": TIMES_DIVIDE, "*//": TIMES_DIVIDE, "×÷": TIMES_DIVIDE, "x/": TIMES_DIVIDE,
  "*/÷": TIMES_DIVIDE, "x//": TIMES_DIVIDE, "×//": TIMES_DIVIDE, blank: WILDCARD, _: WILDCARD,
};
export const MAX_TOTAL_TILES = 20;
export const MAX_COPIES_PER_TILE = 20;
export const MAX_RESULTS_LIMIT = 10000;
export const MAX_TIMEOUT_SECONDS = 60;
export const WILDCARD_MODES = ["any", "numbers", "operators", "custom", "disabled"];
const START = 0, UNARY = 1, NUM = 2, OP = 3;

export function canonicalTile(raw) {
  let s = String(raw ?? "").trim().replace(/[๐-๙]/g, (d) => String(d.charCodeAt(0) - 0x0E50));
  s = TILE_ALIASES[s] ?? s;
  if (/^\d+$/.test(s)) s = String(parseInt(s, 10));
  if (!TILE_INDEX.has(s)) throw new InputError("invalid_tile", `ไม่รู้จักไทล์ '${raw}'`, { allowed: ALL_TILES });
  return s;
}
export const isSpecial = (t) => SPECIAL_TILES.includes(t);

// ---------------------------------------------------------------- exact arithmetic
// A value is a JS number when it is a safe integer, otherwise {n, d} with BigInt parts.
const MAXS = BigInt(Number.MAX_SAFE_INTEGER);
const bigAbs = (x) => (x < 0n ? -x : x);
function bgcd(a, b) { while (b) [a, b] = [b, a % b]; return a; }
function frac(n, d) {
  if (d < 0n) { n = -n; d = -d; }
  const g = bgcd(bigAbs(n), d);
  if (g > 1n) { n /= g; d /= g; }
  if (d === 1n && bigAbs(n) <= MAXS) return Number(n);
  return { n, d };
}
const big = (v) => (typeof v === "number" ? { n: BigInt(v), d: 1n } : v);
const zero = (r) => (r === 0 ? 0 : r);   // avoid -0
export function add(a, b) {
  if (typeof a === "number" && typeof b === "number") { const r = a + b; if (Number.isSafeInteger(r)) return zero(r); }
  const A = big(a), B = big(b);
  return frac(A.n * B.d + B.n * A.d, A.d * B.d);
}
export function neg(a) { return typeof a === "number" ? zero(-a) : { n: -a.n, d: a.d }; }
export function mul(a, b) {
  if (typeof a === "number" && typeof b === "number") { const r = a * b; if (Number.isSafeInteger(r)) return zero(r); }
  const A = big(a), B = big(b);
  return frac(A.n * B.n, A.d * B.d);
}
export function div(a, b) {
  if (typeof a === "number" && typeof b === "number") {
    if (a % b === 0) { const r = a / b; if (Number.isSafeInteger(r)) return zero(r); }
    return frac(BigInt(a), BigInt(b));
  }
  const A = big(a), B = big(b);
  return frac(A.n * B.d, A.d * B.n);
}
export const isInt = (v) => typeof v === "number" || v.d === 1n;
export const isZero = (v) => v === 0;
export function valueKey(v) {
  if (typeof v === "number") return String(v);
  return v.d === 1n ? String(v.n) : `${v.n}/${v.d}`;
}
export const formatValue = valueKey;

// ---------------------------------------------------------------- rules
export const DEFAULT_RULES = Object.freeze({
  allow_concatenation: true, max_number_digits: 3, allow_leading_zero: false, negative_numbers: "side_start",
  allow_negative_zero: false, division: "rational", require_integer_sides: false, special_tiles_enabled: true,
  plus_minus_faces: ["+", "-"], times_divide_faces: ["×", "÷"], wildcard_mode: "any", wildcard_values: [],
  allow_multiple_equals: false,
});

export function parseRules(data) {
  const r = { ...DEFAULT_RULES, plus_minus_faces: [...DEFAULT_RULES.plus_minus_faces], times_divide_faces: [...DEFAULT_RULES.times_divide_faces] };
  const unknown = Object.keys(data || {}).filter((k) => !(k in DEFAULT_RULES));
  if (unknown.length) throw new InputError("invalid_rules", "ไม่รู้จักกฎ: " + unknown.join(", "));
  Object.assign(r, data || {});
  for (const name of ["allow_concatenation", "allow_leading_zero", "allow_negative_zero", "require_integer_sides", "special_tiles_enabled", "allow_multiple_equals"]) {
    if (typeof r[name] !== "boolean") throw new InputError("invalid_rules", `กฎ ${name} ต้องเป็น true/false`);
  }
  if (!Number.isInteger(r.max_number_digits) || r.max_number_digits < 1 || r.max_number_digits > 3) {
    throw new InputError("invalid_rules", "max_number_digits ต้องเป็น 1-3");
  }
  if (!["none", "side_start"].includes(r.negative_numbers)) throw new InputError("invalid_rules", "negative_numbers ต้องเป็น none หรือ side_start");
  if (!["rational", "integer_only"].includes(r.division)) throw new InputError("invalid_rules", "division ต้องเป็น rational หรือ integer_only");
  r.plus_minus_faces = [...r.plus_minus_faces].map(canonicalTile);
  r.times_divide_faces = [...r.times_divide_faces].map(canonicalTile);
  if (!r.plus_minus_faces.length || !r.plus_minus_faces.every((x) => x === "+" || x === "-")) {
    throw new InputError("invalid_rules", "ไทล์ +/- แทนได้เฉพาะ + และ/หรือ -");
  }
  if (!r.times_divide_faces.length || !r.times_divide_faces.every((x) => x === "×" || x === "÷")) {
    throw new InputError("invalid_rules", "ไทล์ ×/÷ แทนได้เฉพาะ × และ/หรือ ÷");
  }
  if (!WILDCARD_MODES.includes(r.wildcard_mode)) throw new InputError("invalid_rules", "wildcard_mode ต้องเป็น " + WILDCARD_MODES.join(" / "));
  r.wildcard_values = [...(r.wildcard_values || [])].map(canonicalTile);
  if (r.wildcard_values.some(isSpecial)) throw new InputError("invalid_rules", "ไทล์ ? ไม่สามารถแทนไทล์พิเศษอื่นได้");
  if (r.wildcard_mode === "custom" && !r.wildcard_values.length) {
    throw new InputError("invalid_rules", "โหมด custom ต้องระบุ wildcard_values อย่างน้อย 1 ค่า");
  }
  return r;
}

export function wildcardChoices(r) {
  switch (r.wildcard_mode) {
    case "any": return [...NUMBER_TILES, ...OPERATOR_TILES, EQUALS];
    case "numbers": return [...NUMBER_TILES];
    case "operators": return [...OPERATOR_TILES];
    case "custom": return [...r.wildcard_values];
    default: return [];
  }
}
export const wildcardCanBeEquals = (r) => wildcardChoices(r).includes(EQUALS);

/** What a tile can be inside an expression: number for numbers, string for operators. */
export function sideFaces(r, tile) {
  if (TILE_INDEX.get(tile) <= 20) return [Number(tile)];
  if (OPERATOR_TILES.includes(tile)) return [tile];
  if (tile === PLUS_MINUS) return r.plus_minus_faces;
  if (tile === TIMES_DIVIDE) return r.times_divide_faces;
  if (tile === WILDCARD) return wildcardChoices(r).filter((t) => t !== EQUALS).map((t) => (TILE_INDEX.get(t) <= 20 ? Number(t) : t));
  return [];
}

// ---------------------------------------------------------------- request
function toInt(value, name) {
  if (typeof value === "boolean" || value === null || value === undefined || value === "") {
    throw new InputError("invalid_number", `${name} ต้องเป็นจำนวนเต็ม`);
  }
  const f = Number(value);
  if (!Number.isFinite(f) || !Number.isInteger(f)) throw new InputError("invalid_number", `${name} ต้องเป็นจำนวนเต็ม`);
  return f;
}

/** Validate a solver request and explain incompatible settings (messages in Thai). */
export function parseRequest(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new InputError("invalid_request", "รูปแบบคำขอไม่ถูกต้อง");
  const rules = parseRules(data.rules);

  // --- inventory (Map keeps insertion order)
  const raw = data.tiles;
  let items;
  if (raw instanceof Map) items = [...raw.entries()];
  else if (Array.isArray(raw)) items = raw.map((it) => (it && typeof it === "object" ? [it.tile, it.count ?? 1] : [it, 1]));
  else if (raw && typeof raw === "object") items = Object.entries(raw);
  else throw new InputError("no_tiles", "กรุณาเลือกไทล์อย่างน้อย 1 ตัว");
  let tiles = new Map();
  for (const [tile, count] of items) {
    const t = canonicalTile(tile);
    const n = toInt(count, `จำนวนไทล์ ${t}`);
    if (n < 0) throw new InputError("invalid_quantity", `จำนวนไทล์ ${t} ต้องไม่ติดลบ`);
    tiles.set(t, (tiles.get(t) || 0) + n);
  }
  tiles = new Map([...tiles].filter(([, n]) => n > 0));
  for (const [t, n] of tiles) {
    if (n > MAX_COPIES_PER_TILE) throw new InputError("invalid_quantity", `ไทล์ ${t} มีได้ไม่เกิน ${MAX_COPIES_PER_TILE} ตัว`);
  }
  const total = [...tiles.values()].reduce((a, b) => a + b, 0);
  if (total === 0) throw new InputError("no_tiles", "กรุณาเลือกไทล์อย่างน้อย 1 ตัว");
  if (total > MAX_TOTAL_TILES) throw new InputError("too_many_tiles", `ใช้ไทล์ได้ไม่เกิน ${MAX_TOTAL_TILES} ตัวต่อการค้นหา (เลือกมา ${total} ตัว)`);
  if (total < 3) throw new InputError("too_few_tiles", "สมการต้องมีอย่างน้อย 3 ไทล์ เช่น 1 = 1");

  const specials = [...tiles.keys()].filter(isSpecial);
  if (specials.length && !rules.special_tiles_enabled) {
    throw new InputError("special_tiles_disabled", "ปิดการใช้ไทล์พิเศษอยู่ แต่มีไทล์พิเศษในชุด: " + specials.join(", "));
  }
  if (tiles.has(WILDCARD) && rules.wildcard_mode === "disabled") {
    throw new InputError("wildcard_rule_required", "มีไทล์ ? แต่ยังไม่ได้กำหนดกฎว่า ? แทนอะไรได้ (wildcard_mode)");
  }

  // --- locks
  const locks = new Map();
  const rawLocks = data.locks || [];
  if (!Array.isArray(rawLocks)) throw new InputError("invalid_locks", "locks ต้องเป็นรายการ");
  for (const item of rawLocks) {
    if (!item || typeof item !== "object") throw new InputError("invalid_locks", "แต่ละ lock ต้องมี tile และ position");
    const t = canonicalTile(item.tile);
    const p = toInt(item.position, "ตำแหน่งที่ล็อก");
    if (p < 1) throw new InputError("invalid_lock_position", "ตำแหน่งเริ่มที่ 1");
    if (locks.has(p)) {
      throw new InputError("conflicting_locks", `ตำแหน่ง ${p} ถูกล็อกซ้ำ (${locks.get(p)} และ ${t}) — หนึ่งตำแหน่งล็อกได้ไทล์เดียว`, { position: p });
    }
    locks.set(p, t);
  }
  const lockedCounts = new Map();
  for (const t of locks.values()) lockedCounts.set(t, (lockedCounts.get(t) || 0) + 1);
  for (const [t, n] of lockedCounts) {
    if (n > (tiles.get(t) || 0)) {
      throw new InputError("lock_exceeds_inventory",
        `ล็อกไทล์ ${t} ไว้ ${n} ตำแหน่ง แต่มีไทล์ ${t} ในชุดเพียง ${tiles.get(t) || 0} ตัว (ไทล์ที่ล็อกต้องเป็นไทล์จากชุดที่เลือก ไม่ใช่ไทล์เพิ่ม)`);
    }
  }

  // --- mode and length
  const mode = data.mode ?? "exact";
  if (mode !== "exact" && mode !== "partial") throw new InputError("invalid_mode", "mode ต้องเป็น exact หรือ partial");
  let minLen = data.min_length == null || data.min_length === "" ? null : toInt(data.min_length, "ความยาวขั้นต่ำ");
  let maxLen = data.max_length == null || data.max_length === "" ? null : toInt(data.max_length, "ความยาวสูงสุด");
  const warnings = [];
  const maxLock = locks.size ? Math.max(...locks.keys()) : 0;
  if (mode === "exact") {
    if ((minLen !== null && minLen > total) || (maxLen !== null && maxLen < total)) {
      throw new InputError("incompatible_length",
        `โหมด Exact ใช้ไทล์ครบทั้ง ${total} ตัว สมการจึงยาว ${total} ช่องเสมอ แต่ช่วงความยาวที่กำหนด (${minLen || "-"}–${maxLen || "-"}) ไม่รวม ${total} — ให้แก้ช่วงความยาว หรือเปลี่ยนเป็นโหมด Partial`);
    }
    minLen = maxLen = total;
    if (maxLock > total) throw new InputError("lock_out_of_range", `ล็อกไว้ที่ตำแหน่ง ${maxLock} แต่สมการในโหมด Exact ยาวเพียง ${total} ช่อง`);
  } else {
    minLen = minLen === null ? 3 : minLen;
    maxLen = maxLen === null ? total : maxLen;
    if (maxLen > total) { warnings.push(`ความยาวสูงสุดถูกลดเป็น ${total} ตามจำนวนไทล์ที่มี`); maxLen = total; }
    if (minLen < 3) throw new InputError("invalid_length", "ความยาวขั้นต่ำต้องอย่างน้อย 3");
    if (minLen > maxLen) throw new InputError("invalid_length", `ความยาวขั้นต่ำ (${minLen}) มากกว่าความยาวสูงสุด (${maxLen})`);
    if (maxLock > maxLen) throw new InputError("lock_out_of_range", `ล็อกไว้ที่ตำแหน่ง ${maxLock} แต่ความยาวสูงสุดของสมการคือ ${maxLen}`);
    if (maxLock > minLen) {
      warnings.push(`ไทล์ที่ล็อกต้องอยู่ในสมการเสมอ จึงค้นหาเฉพาะสมการยาวอย่างน้อย ${maxLock} ช่อง`);
      minLen = maxLock;
    }
  }

  // --- exactly one "="
  const nEq = tiles.get(EQUALS) || 0;
  const wildEq = tiles.has(WILDCARD) && wildcardCanBeEquals(rules);
  if (mode === "exact" && nEq > 1 && !rules.allow_multiple_equals) {
    throw new InputError("too_many_equals", `โหมด Exact ต้องใช้ทุกไทล์ แต่สมการมีเครื่องหมาย = ได้เพียงตัวเดียว (มี = ${nEq} ตัว)`);
  }
  if (nEq === 0 && !wildEq) throw new InputError("missing_equals", "ต้องมีไทล์ = อย่างน้อย 1 ตัว (หรือไทล์ ? ที่กำหนดให้แทน = ได้)");
  const eqLocks = [...locks].filter(([, t]) => t === EQUALS).map(([p]) => p);
  if (eqLocks.length > 1 && !rules.allow_multiple_equals) throw new InputError("conflicting_locks", "ล็อก = ไว้มากกว่า 1 ตำแหน่ง แต่สมการมี = ได้ตัวเดียว");
  for (const p of eqLocks) {
    if (p === 1 || p >= maxLen) {
      throw new InputError("invalid_lock_position", `= ที่ตำแหน่ง ${p} ใช้ไม่ได้ ต้องมีไทล์อย่างน้อย 1 ตัวทั้งซ้ายและขวาของ =`);
    }
  }
  for (const [p, t] of locks) {
    if (OPERATOR_TILES.includes(t) && p === 1 && !(t === "-" && rules.negative_numbers === "side_start")) {
      throw new InputError("invalid_lock_position", `ไทล์ ${t} ที่ตำแหน่งแรกของสมการใช้ไม่ได้`);
    }
  }

  const maxResults = toInt(data.max_results ?? 500, "จำนวนผลลัพธ์สูงสุด");
  if (maxResults < 1 || maxResults > MAX_RESULTS_LIMIT) {
    throw new InputError("invalid_max_results", `จำนวนผลลัพธ์สูงสุดต้องอยู่ระหว่าง 1–${MAX_RESULTS_LIMIT}`);
  }
  const timeout = Number(data.timeout_seconds ?? 10);
  if (!Number.isFinite(timeout)) throw new InputError("invalid_timeout", "timeout_seconds ต้องเป็นตัวเลข");
  if (timeout < 0.1 || timeout > MAX_TIMEOUT_SECONDS) {
    throw new InputError("invalid_timeout", `timeout ต้องอยู่ระหว่าง 0.1–${MAX_TIMEOUT_SECONDS} วินาที`);
  }
  if ((tiles.get(WILDCARD) || 0) >= 2 && rules.wildcard_mode === "any") warnings.push("มีไทล์ ? หลายตัวที่แทนได้ทุกค่า การค้นหาอาจใช้เวลานาน");
  const dedupe = data.dedupe ?? "equation";
  if (dedupe !== "equation" && dedupe !== "arrangement") throw new InputError("invalid_dedupe", "dedupe ต้องเป็น equation หรือ arrangement");

  return { tiles, locks, mode, minLength: minLen, maxLength: maxLen, rules, maxResults, timeoutSeconds: timeout, dedupe, warnings, total };
}

// ---------------------------------------------------------------- formatting and validation
const isNum = (f) => typeof f === "number";

/** Faces -> "12 × 2 = 24". Adjacent single digits are one number; unary minus is attached. */
export function formatEquation(faces) {
  const tokens = [];
  let prevDigit = false, attachMinus = false, sideStart = true;
  for (const f of faces) {
    if (isNum(f)) {
      if (prevDigit && f < 10) tokens[tokens.length - 1] += String(f);
      else tokens.push((attachMinus ? "-" : "") + String(f));
      attachMinus = false;
      prevDigit = f < 10;
      sideStart = false;
    } else {
      prevDigit = false;
      if (f === "-" && sideStart) { attachMinus = true; continue; }
      tokens.push(f);
      sideStart = f === EQUALS;
    }
  }
  return tokens.join(" ");
}

export class InvalidEquation extends Error {}

function evalSide(faces, rules) {
  if (!faces.length) throw new InvalidEquation("empty side");
  const tokens = [];
  let j = 0, negative = false;
  if (faces[0] === "-") {
    if (rules.negative_numbers !== "side_start") throw new InvalidEquation("negative numbers not allowed");
    negative = true;
    j = 1;
  }
  let expectNumber = true;
  while (j < faces.length) {
    const f = faces[j];
    if (expectNumber) {
      if (!isNum(f)) throw new InvalidEquation("operator where a number is expected");
      let n;
      if (f >= 10) { n = f; j++; }
      else {
        const digits = [f];
        j++;
        while (j < faces.length && isNum(faces[j])) {
          if (faces[j] >= 10) throw new InvalidEquation("two-digit tile next to another number tile");
          digits.push(faces[j]);
          j++;
        }
        if (digits.length > 1) {
          if (!rules.allow_concatenation) throw new InvalidEquation("concatenation not allowed");
          if (digits.length > rules.max_number_digits) throw new InvalidEquation("number has too many digits");
          if (digits[0] === 0 && !rules.allow_leading_zero) throw new InvalidEquation("leading zero");
        }
        n = Number(digits.join(""));
      }
      if (j < faces.length && isNum(faces[j])) throw new InvalidEquation("two-digit tile next to another number tile");
      if (negative) {
        if (n === 0 && !rules.allow_negative_zero) throw new InvalidEquation("negative zero");
        n = -n;
        negative = false;
      }
      tokens.push(n);
      expectNumber = false;
    } else {
      if (!OPERATOR_TILES.includes(f)) throw new InvalidEquation("unexpected tile");
      tokens.push(f);
      j++;
      expectNumber = true;
    }
  }
  if (expectNumber) throw new InvalidEquation("side ends with an operator");
  const terms = [], ops = [];
  let cur = tokens[0];
  for (let k = 1; k < tokens.length; k += 2) {
    const op = tokens[k], n = tokens[k + 1];
    if (op === "×") cur = mul(cur, n);
    else if (op === "÷") {
      if (n === 0) throw new InvalidEquation("division by zero");
      cur = div(cur, n);
      if (rules.division === "integer_only" && !isInt(cur)) throw new InvalidEquation("division does not give an integer");
    } else { terms.push(cur); ops.push(op); cur = n; }
  }
  terms.push(cur);
  let value = terms[0];
  for (let k = 0; k < ops.length; k++) value = ops[k] === "+" ? add(value, terms[k + 1]) : add(value, neg(terms[k + 1]));
  if (rules.require_integer_sides && !isInt(value)) throw new InvalidEquation("side is not an integer");
  return value;
}

/** Value of every side ([lhs, rhs] for one "=") or throws InvalidEquation. */
export function evaluateFaces(faces, rules) {
  const n = faces.filter((f) => f === EQUALS).length;
  if (n === 0 || (n > 1 && !rules.allow_multiple_equals)) {
    throw new InvalidEquation(rules.allow_multiple_equals ? "an equation needs at least one '='" : "an equation needs exactly one '='");
  }
  const sides = [[]];
  for (const f of faces) { if (f === EQUALS) sides.push([]); else sides[sides.length - 1].push(f); }
  return sides.map((side) => evalSide(side, rules));
}

/** Full check of an arrangement [[tile, face], ...] against inventory, locks and rules. */
export function validateArrangement(slots, req) {
  const used = new Map();
  for (const [t] of slots) used.set(t, (used.get(t) || 0) + 1);
  for (const [t, n] of used) if (n > (req.tiles.get(t) || 0)) throw new InvalidEquation(`tile ${t} used more often than available`);
  if (req.mode === "exact") {
    for (const [t, n] of req.tiles) if (used.get(t) !== n) throw new InvalidEquation("exact mode must use every tile");
  }
  if (slots.length < req.minLength || slots.length > req.maxLength) throw new InvalidEquation("length outside the allowed range");
  for (const [p, t] of req.locks) if (p > slots.length || slots[p - 1][0] !== t) throw new InvalidEquation(`locked tile ${t} is not at position ${p}`);
  const wildEq = wildcardCanBeEquals(req.rules);
  for (const [t, f] of slots) {
    let allowed = t === EQUALS ? [EQUALS] : sideFaces(req.rules, t);
    if (t === WILDCARD && wildEq) allowed = [...allowed, EQUALS];
    if (!allowed.includes(f)) throw new InvalidEquation(`tile ${t} cannot stand for ${f}`);
  }
  const values = evaluateFaces(slots.map(([, f]) => f), req.rules);
  const first = valueKey(values[0]);
  if (values.some((v) => valueKey(v) !== first)) throw new InvalidEquation("sides are not equal");
  return [values[0], values[values.length - 1]];
}

// ---------------------------------------------------------------- search
export class SearchStopped extends Error {
  constructor(reason) { super(reason); this.reason = reason; }
}

export class SearchControl {
  constructor(timeoutSeconds, { now = () => Date.now(), isCancelled = () => false, onTick = null } = {}) {
    this.now = now;
    this.started = now();
    this.deadline = this.started + timeoutSeconds * 1000;
    this.sliceDeadline = null;
    this.isCancelled = isCancelled;
    this.onTick = onTick;
    this.nodes = 0;
    this.found = 0;
    this.piecesTotal = 0;
    this.piecesDone = 0;
  }
  check() {
    if (this.onTick) this.onTick(this);
    if (this.isCancelled()) throw new SearchStopped("cancelled");
    const t = this.now();
    if (t > this.deadline) throw new SearchStopped("timeout");
    if (this.sliceDeadline !== null && t > this.sliceDeadline) throw new SearchStopped("slice");
  }
  get elapsedMs() { return Math.round(this.now() - this.started); }
}

class Side {
  constructor(solver, start, maxLen, endLengths, emit) {
    this.s = solver;
    this.start = start;
    this.maxLen = maxLen;
    this.endLengths = endLengths;
    this.emit = emit;
    this.seq = [];
  }
  run() { this.step(0, START, 0, 0, false, false, false, 0, null, null, 1); }

  fold(total, term, termOp, sign, negative, nval) {
    let n = nval;
    if (negative) {
      if (n === 0 && !this.s.negZero) return null;
      n = -n;
    }
    if (termOp === null) return [total, sign === 1 ? n : zero(-n)];
    if (termOp === "×") return [total, mul(term, n)];
    if (n === 0) return null;                              // division by zero
    const q = div(term, n);
    if (this.s.intDiv && !isInt(q)) return null;
    return [total, q];
  }

  step(i, phase, nval, ndig, nbig, nzero, negative, total, term, termOp, sign) {
    const s = this.s, ctl = s.ctl;
    ctl.nodes++;
    if ((ctl.nodes & 0x7ff) === 0) ctl.check();

    if (phase === NUM && this.endLengths.has(i)) {
      const fin = this.fold(total, term, termOp, sign, negative, nval);
      if (fin) {
        const value = add(fin[0], fin[1]);
        if (!s.intSides || isInt(value)) this.emit(this.seq, value, i);
      }
    }
    if (i === this.maxLen) return;

    const pos = this.start + i;
    const lock = s.locks.get(pos);
    const pool = s.pool;
    const options = [];
    if (lock !== undefined) for (const f of s.faces.get(lock)) options.push([lock, f, true]);
    else for (const [t, n] of pool) if (n > 0) for (const f of s.faces.get(t)) options.push([t, f, false]);

    const seq = this.seq;
    for (const [tile, face, locked] of options) {
      let nxt;
      if (isNum(face)) {
        if (phase === NUM) {
          if (nbig || face >= 10 || !s.concat || ndig >= s.maxDigits || (nzero && !s.leadingZero)) continue;
          nxt = [i + 1, NUM, nval * 10 + face, ndig + 1, false, nzero, negative, total, term, termOp, sign];
        } else {
          nxt = [i + 1, NUM, face, 1, face >= 10, face === 0, negative, total, term, termOp, sign];
        }
      } else if (phase === NUM) {
        const fin = this.fold(total, term, termOp, sign, negative, nval);
        if (!fin) continue;
        if (face === "+" || face === "-") nxt = [i + 1, OP, 0, 0, false, false, false, add(fin[0], fin[1]), null, null, face === "+" ? 1 : -1];
        else nxt = [i + 1, OP, 0, 0, false, false, false, fin[0], fin[1], face, sign];
      } else if (phase === START && face === "-" && s.unary) {
        nxt = [i + 1, UNARY, 0, 0, false, false, true, total, term, termOp, sign];
      } else continue;
      if (!locked) pool.set(tile, pool.get(tile) - 1);
      seq.push([tile, face]);
      this.step(...nxt);
      seq.pop();
      if (!locked) pool.set(tile, pool.get(tile) + 1);
    }
  }
}

const poolKey = (pool) => [...pool].filter(([, n]) => n).sort((a, b) => TILE_INDEX.get(a[0]) - TILE_INDEX.get(b[0])).map(([t, n]) => `${t}:${n}`).join(",");

export class MathSolver {
  static BUFFER_LIMIT = 200000;
  static MIN_SLICE_MS = 20;

  constructor(req, ctl, onResult = null) {
    this.req = req;
    this.ctl = ctl;
    this.onResult = onResult;
    const r = req.rules;
    this.concat = r.allow_concatenation;
    this.maxDigits = r.max_number_digits;
    this.leadingZero = r.allow_leading_zero;
    this.unary = r.negative_numbers === "side_start";
    this.negZero = r.allow_negative_zero;
    this.intDiv = r.division === "integer_only";
    this.intSides = r.require_integer_sides;
    this.multiEq = r.allow_multiple_equals;
    this.locks = req.locks;
    this.faces = new Map(ALL_TILES.map((t) => [t, sideFaces(r, t)]));
    this.pool = new Map();
    const lockedCounts = new Map();
    for (const t of req.locks.values()) lockedCounts.set(t, (lockedCounts.get(t) || 0) + 1);
    for (const [t, n] of req.tiles) { const m = n - (lockedCounts.get(t) || 0); if (m > 0) this.pool.set(t, m); }
    this.lengths = [];
    for (let L = req.maxLength; L >= req.minLength; L--) this.lengths.push(L);
    this.results = [];
    this.index = new Map();
  }

  solve() {
    try { this.search(); return "complete"; } catch (e) { if (e instanceof SearchStopped) return e.reason; throw e; }
  }

  /** [L, [slots of "="]] — one "=" first (balanced sides first), then two or more if the rule allows. */
  pieces() {
    const req = this.req, wildEq = wildcardCanBeEquals(req.rules);
    const eqLocks = [], notEq = new Set();
    for (const [p, t] of req.locks) {
      if (t === EQUALS) eqLocks.push(p);
      else if (!(t === WILDCARD && wildEq)) notEq.add(p);
    }
    const maxEq = this.multiEq ? (req.tiles.get(EQUALS) || 0) + (wildEq ? req.tiles.get(WILDCARD) || 0 : 0) : 1;
    const out = [];
    for (const L of this.lengths) {
      const slots = [];
      for (let e = 2; e < L; e++) if (eqLocks.every((p) => p === e)) slots.push(e);
      slots.sort((a, b) => Math.abs((a - 1) - (L - a)) - Math.abs((b - 1) - (L - b)) || a - b);
      for (const e of slots) out.push([L, [e]]);
      for (let k = 2; k <= Math.min(maxEq, Math.floor((L - 1) / 2)); k++) {
        const chosen = [];
        const rec = (from) => {
          if (chosen.length === k) { if (eqLocks.every((p) => chosen.includes(p))) out.push([L, [...chosen]]); return; }
          const last = L - 1 - 2 * (k - chosen.length - 1);
          for (let e = from; e <= last; e++) {
            if (notEq.has(e)) continue;
            chosen.push(e);
            rec(e + 2);
            chosen.pop();
          }
        };
        rec(2);
      }
    }
    return out;
  }

  search() {
    const pieces = this.pieces();
    const ctl = this.ctl;
    ctl.piecesTotal = pieces.length;
    let unfinished = [];
    pieces.forEach((piece, i) => { if (this.runPiece(piece, pieces.length - i)) ctl.piecesDone++; else unfinished.push(piece); });
    const second = [...unfinished];
    second.forEach((piece, i) => {
      if (this.runPiece(piece, second.length - i)) { ctl.piecesDone++; unfinished = unfinished.filter((p) => p !== piece); }
    });
    if (unfinished.length) throw new SearchStopped("timeout");
  }

  runPiece(piece, piecesLeft) {
    const ctl = this.ctl;
    const now = ctl.now();
    const budget = Math.max(MathSolver.MIN_SLICE_MS, (ctl.deadline - now) / Math.max(piecesLeft, 1));
    ctl.sliceDeadline = now + budget;
    const saved = new Map(this.pool);
    try {
      this.runPair(piece[0], piece[1]);
      return true;
    } catch (e) {
      if (!(e instanceof SearchStopped)) throw e;
      this.pool.clear();
      for (const [t, n] of saved) this.pool.set(t, n);      // give back tiles taken by the interrupted search
      if (e.reason === "slice") return false;
      throw e;
    } finally {
      ctl.sliceDeadline = null;
    }
  }

  runPair(L, E) {
    const req = this.req, wildEq = wildcardCanBeEquals(req.rules);
    const options = [];
    for (const e of E) {
      const lockE = req.locks.get(e);
      if (lockE !== undefined) {
        if (lockE === EQUALS || (lockE === WILDCARD && wildEq)) options.push([[lockE, true]]);
        else return;
      } else options.push(wildEq ? [[EQUALS, false], [WILDCARD, false]] : [[EQUALS, false]]);
    }
    const chosen = [];
    const rec = (i) => {
      if (i === E.length) {
        if (req.mode === "exact" && (this.pool.get(EQUALS) || 0) > 0) return;   // another "=" would stay unused
        if (E.length === 1) this.join(L, E[0], chosen[0]);
        else this.joinChain(L, E, [...chosen]);
        return;
      }
      for (const [tile, locked] of options[i]) {
        if (!locked) {
          if ((this.pool.get(tile) || 0) <= 0) continue;
          this.pool.set(tile, this.pool.get(tile) - 1);
        }
        chosen.push(tile);
        try { rec(i + 1); } finally {
          chosen.pop();
          if (!locked) this.pool.set(tile, this.pool.get(tile) + 1);
        }
      }
    };
    rec(0);
  }

  join(L, e, eqTile) {
    const left = [1, e - 1], right = [e + 1, L - e];
    const leftFirst = left[1] <= right[1];
    const [first, second] = leftFirst ? [left, right] : [right, left];
    let groups = new Map();      // poolKey -> {pool: [[t,n]], byValue: Map(valueKey -> [seq])}
    const feasible = new Map();
    let stored = 0;

    const flush = () => {
      const saved = new Map(this.pool);
      try {
        for (const g of groups.values()) {
          this.pool.clear();
          for (const [t, n] of g.pool) this.pool.set(t, n);
          const onSecond = (seq, value) => {
            const firsts = g.byValue.get(valueKey(value));
            if (firsts) for (const f of firsts) leftFirst ? this.add(f, eqTile, seq, value) : this.add(seq, eqTile, f, value);
          };
          new Side(this, second[0], second[1], new Set([second[1]]), onSecond).run();
        }
      } finally {
        this.pool.clear();
        for (const [t, n] of saved) this.pool.set(t, n);
      }
      groups = new Map();
      stored = 0;
    };

    const onFirst = (seq, value) => {
      const key = poolKey(this.pool);
      if (this.req.mode === "exact") {
        let ok = feasible.get(key);
        if (ok === undefined) { ok = this.sideFeasible(second); feasible.set(key, ok); }
        if (!ok) return;
      }
      let g = groups.get(key);
      if (!g) { g = { pool: [...this.pool].filter(([, n]) => n), byValue: new Map() }; groups.set(key, g); }
      const vk = valueKey(value);
      let list = g.byValue.get(vk);
      if (!list) { list = []; g.byValue.set(vk, list); }
      list.push(seq.map((x) => [x[0], x[1]]));
      stored++;
      if (stored >= MathSolver.BUFFER_LIMIT) flush();
    };

    new Side(this, first[0], first[1], new Set([first[1]]), onFirst).run();
    flush();
  }

  /**
   * Two or more "=": the first side is enumerated once and grouped by remaining tiles and value;
   * the following sides are streamed from those tiles, each one only kept if it has the same value.
   */
  joinChain(L, E, eqTiles) {
    const sides = [];
    let start = 1;
    for (const e of [...E, L + 1]) { sides.push([start, e - start]); start = e + 1; }
    const copy = (seq) => seq.map((x) => [x[0], x[1]]);
    const next = (idx, target, firsts, mids) => {
      const [s, len] = sides[idx];
      new Side(this, s, len, new Set([len]), (seq, value) => {
        if (valueKey(value) !== target) return;
        if (idx === sides.length - 1) for (const f of firsts) this.addChain([f, ...mids, copy(seq)], eqTiles, value);
        else next(idx + 1, target, firsts, [...mids, copy(seq)]);
      }).run();
    };
    let groups = new Map(), stored = 0;
    const flush = () => {
      const saved = new Map(this.pool);
      try {
        for (const g of groups.values()) {
          this.pool.clear();
          for (const [t, n] of g.pool) this.pool.set(t, n);
          const [s, len] = sides[1];
          new Side(this, s, len, new Set([len]), (seq, value) => {
            const vk = valueKey(value);
            const firsts = g.byValue.get(vk);
            if (firsts) next(2, vk, firsts, [copy(seq)]);
          }).run();
        }
      } finally {
        this.pool.clear();
        for (const [t, n] of saved) this.pool.set(t, n);
      }
      groups = new Map();
      stored = 0;
    };
    new Side(this, sides[0][0], sides[0][1], new Set([sides[0][1]]), (seq, value) => {
      const key = poolKey(this.pool);
      let g = groups.get(key);
      if (!g) { g = { pool: [...this.pool].filter(([, n]) => n), byValue: new Map() }; groups.set(key, g); }
      const vk = valueKey(value);
      let list = g.byValue.get(vk);
      if (!list) { list = []; g.byValue.set(vk, list); }
      list.push(copy(seq));
      if (++stored >= MathSolver.BUFFER_LIMIT) flush();
    }).run();
    flush();
  }

  /** Exact mode: the remaining tiles must all fit on the other side (operators need numbers after them). */
  sideFeasible([start, length]) {
    const tiles = [];
    for (const [t, n] of this.pool) for (let k = 0; k < n; k++) tiles.push(t);
    for (let p = start; p < start + length; p++) if (this.req.locks.has(p)) tiles.push(this.req.locks.get(p));
    let opsOnly = 0, numberish = 0, minusPossible = false;
    for (const t of tiles) {
      const faces = this.faces.get(t);
      if (faces.some(isNum)) numberish++;
      else if (faces.length) opsOnly++;
      if (faces.includes("-")) minusPossible = true;
    }
    const bonus = this.unary && minusPossible ? 1 : 0;
    return numberish >= 1 && opsOnly <= numberish - 1 + bonus;
  }

  add(lhsSeq, eqTile, rhsSeq, value) {
    this.record([...lhsSeq.map((x) => [x[0], x[1]]), [eqTile, EQUALS], ...rhsSeq.map((x) => [x[0], x[1]])], value);
  }

  addChain(sideSeqs, eqTiles, value) {
    const slots = [];
    sideSeqs.forEach((seq, i) => {
      if (i) slots.push([eqTiles[i - 1], EQUALS]);
      for (const x of seq) slots.push([x[0], x[1]]);
    });
    this.record(slots, value);
  }

  record(slots, value) {
    const text = formatEquation(slots.map(([, f]) => f));
    const [lhs, rhs] = validateArrangement(slots, this.req);           // never return an unchecked equation
    if (valueKey(lhs) !== valueKey(value) || valueKey(rhs) !== valueKey(value)) throw new Error(`solver/validator mismatch for ${text}`);
    const nSpecial = slots.filter(([t]) => isSpecial(t)).length;
    const key = this.req.dedupe === "equation" ? text : JSON.stringify(slots);
    const existing = this.index.get(key);
    if (existing !== undefined) {
      const old = this.results[existing];
      const alternatives = old.alternative_arrangements + 1;
      if (nSpecial < old._special) this.results[existing] = this.result(slots, text, value, nSpecial);
      this.results[existing].alternative_arrangements = alternatives;
      if (this.onResult) this.onResult(this.results[existing], existing);
      return;
    }
    this.index.set(key, this.results.length);
    this.results.push(this.result(slots, text, value, nSpecial));
    this.ctl.found = this.results.length;
    if (this.onResult) this.onResult(this.results[this.results.length - 1], this.results.length - 1);
    if (this.results.length >= this.req.maxResults) throw new SearchStopped("limit_reached");
  }

  result(slots, text, value, nSpecial) {
    const req = this.req;
    const used = new Map();
    for (const [t] of slots) used.set(t, (used.get(t) || 0) + 1);
    const unused = [];
    for (const [t, n] of req.tiles) for (let k = 0; k < n - (used.get(t) || 0); k++) unused.push(t);
    unused.sort((a, b) => TILE_INDEX.get(a) - TILE_INDEX.get(b));
    const arrangement = [], specials = [];
    slots.forEach(([tile, face], i) => {
      const pos = i + 1, shown = String(face);
      arrangement.push({ position: pos, tile, as: shown, locked: req.locks.has(pos) });
      if (isSpecial(tile)) specials.push({ position: pos, tile, as: shown });
    });
    return {
      equation: text,
      lhs_value: formatValue(value),
      rhs_value: formatValue(value),
      tiles_used: slots.length,
      unused_tiles: unused,
      arrangement,
      locked_positions: [...req.locks].sort((a, b) => a[0] - b[0]).map(([position, tile]) => ({ position, tile })),
      special_assignments: specials,
      mode: req.mode,
      alternative_arrangements: 0,
      _special: nSpecial,
    };
  }
}

/** Run a search. Returns {status, results, elapsedMs, nodes, exhaustive}. */
export function solve(req, options = {}) {
  const ctl = options.control || new SearchControl(req.timeoutSeconds, options);
  const solver = new MathSolver(req, ctl, options.onResult || null);
  const status = solver.solve();
  const results = solver.results.map(({ _special, ...r }) => r);
  return { status, results, elapsedMs: ctl.elapsedMs, nodes: ctl.nodes, exhaustive: status === "complete" };
}

export const STATUS_MESSAGES = {
  complete: "ค้นหาครบทุกความเป็นไปได้แล้ว",
  limit_reached: "หยุดเพราะพบผลลัพธ์ครบตามจำนวนสูงสุดที่ตั้งไว้ — อาจมีสมการอื่นอีก",
  timeout: "หยุดเพราะครบเวลาที่กำหนด — ค้นหาไม่ครบทุกกรณี อาจมีสมการอื่นอีก",
  cancelled: "ยกเลิกการค้นหาแล้ว — ผลลัพธ์ไม่ครบ อาจมีสมการอื่นอีก",
  error: "เกิดข้อผิดพลาดระหว่างค้นหา",
};
