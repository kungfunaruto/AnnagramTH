// Background worker that owns the word indexes (keeps the screen responsive).
// Protocol: {id, op: "info"|"lookup"|"anagram"|"pattern", lang: "thai"|"english", params} -> {id, ok, result|error}
import { ThaiIndex, EnglishIndex, parseWordList } from "../engines/dictionary.js";

const indexes = {};
const load = async (name) => {
  const r = await fetch(new URL(`../data/${name}`, import.meta.url));
  if (!r.ok) throw new Error(`cannot load ${name}: HTTP ${r.status}`);
  return r.text();
};

const ready = (async () => {
  const t0 = performance.now();
  const manifest = JSON.parse(await load("manifest.json"));
  indexes.thai = new ThaiIndex(parseWordList(await load("thai.txt")));
  indexes.english = new EnglishIndex(parseWordList(await load("english.txt")));
  return { manifest, thai: indexes.thai.size, english: indexes.english.size, build_ms: Math.round(performance.now() - t0) };
})();

self.onmessage = async (event) => {
  const { id, op, lang, params } = event.data || {};
  try {
    let info;
    try { info = await ready; } catch (err) {
      throw Object.assign(new Error("โหลดคลังคำในแอปไม่สำเร็จ — ยังไม่ทราบว่ามีคำนี้หรือไม่ ลองปิดแล้วเปิดแอปใหม่"),
        { code: "dictionary_unavailable", detail: String(err && err.message) });
    }
    let result;
    if (op === "info") result = info;
    else {
      const idx = indexes[lang];
      if (!idx) throw Object.assign(new Error("ไม่รู้จักภาษา"), { code: "invalid_language" });
      if (op === "lookup") result = idx.lookup(params.text);
      else if (op === "anagram") result = idx.anagram(params);
      else if (op === "pattern") result = idx.pattern(params);
      else throw Object.assign(new Error("คำสั่งไม่ถูกต้อง"), { code: "invalid_op" });
    }
    self.postMessage({ id, ok: true, result });
  } catch (err) {
    const known = Boolean(err && err.code);
    self.postMessage({ id, ok: false, error: {
      code: known ? err.code : "internal_error",
      message: known ? err.message : "เกิดข้อผิดพลาดภายในแอป",
      system: !known || err.code === "dictionary_unavailable",
      detail: err && (err.detail || err.message),
    } });
  }
};
