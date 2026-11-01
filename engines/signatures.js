// Multiset signatures shared by the Thai and English anagram searches.
// A signature is the word's characters sorted by code point ("tea" -> "aet").

export function signature(chars) {
  return [...chars].sort().join("");
}

/** Count characters: string or array -> Map(char -> count). */
export function counter(chars) {
  const m = new Map();
  for (const ch of chars) m.set(ch, (m.get(ch) || 0) + 1);
  return m;
}

export function counterEquals(a, b) {
  if (a.size !== b.size) return false;
  for (const [k, n] of a) if (b.get(k) !== n) return false;
  return true;
}

/** True when multiset a is contained in multiset b. */
export function counterLe(a, b) {
  for (const [k, n] of a) if ((b.get(k) || 0) < n) return false;
  return true;
}

export function countSubmultisets(cnt) {
  let p = 1;
  for (const n of cnt.values()) p *= n + 1;
  return p - 1;
}

/** Every signature that can be built from a subset of `cnt`, or null if more than maxCount. */
export function submultisetSignatures(cnt, maxCount) {
  if (countSubmultisets(cnt) > maxCount) return null;
  let out = [""];
  for (const [ch, n] of [...cnt.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    const next = [];
    for (const s of out) for (let k = 0; k <= n; k++) next.push(s + ch.repeat(k));
    out = next;
  }
  return out.filter((s) => s);
}
