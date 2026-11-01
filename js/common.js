// Shared helpers: DOM, settings, toast, clipboard (native plugin with web fallback), word-search worker.
import { ThaiIndex, EnglishIndex, parseWordList } from "../engines/dictionary.js";

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const fmt = (n) => Number(n).toLocaleString("th-TH");
export const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

export const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable: settings last until the app closes */ } },
};

// ---------------------------------------------------------------- settings (kept on this phone only)
const DEFAULTS = { wordSize: "m", live: true, timerMinutes: 25, rotateTop: true, beep: true };
const listeners = new Set();
export const Settings = {
  data: (() => { try { return { ...DEFAULTS, ...JSON.parse(store.get("settings") || "{}") }; } catch { return { ...DEFAULTS }; } })(),
  get(k) { return this.data[k]; },
  set(k, v) {
    this.data[k] = v;
    store.set("settings", JSON.stringify(this.data));
    listeners.forEach((f) => f(k, v));
  },
  on(f) { listeners.add(f); },
};

// ---------------------------------------------------------------- native plugins (Capacitor)
export const nativePlugin = (name) => {
  const C = window.Capacitor;
  if (!C || !C.isNativePlatform || !C.isNativePlatform()) return null;
  return (C.Plugins && C.Plugins[name]) || (C.registerPlugin ? C.registerPlugin(name) : null);
};

let toastTimer;
export function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 1700);
}

export async function copyText(text, label = text) {
  try {
    const clip = nativePlugin("Clipboard");
    if (clip) await clip.write({ string: text });
    else await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); } catch { /* ignore */ }
    ta.remove();
  }
  toast(`คัดลอก “${label}” แล้ว`);
}

export function confirmBox(text, okLabel = "ตกลง") {
  const d = $("#confirm-dialog");
  $("#confirm-text").textContent = text;
  $("#confirm-ok").textContent = okLabel;
  d.returnValue = "";
  d.showModal();
  return new Promise((resolve) => d.addEventListener("close", () => resolve(d.returnValue === "ok"), { once: true }));
}

// ---------------------------------------------------------------- word search (background worker)
export const SYSTEM_ERROR = { code: "dictionary_unavailable", system: true,
  message: "โหลดคลังคำในแอปไม่สำเร็จ — ยังไม่ทราบว่ามีคำนี้หรือไม่ ลองปิดแล้วเปิดแอปใหม่" };

export const Search = {
  worker: null, nextId: 1, pending: new Map(), local: null,
  start() {
    try {
      this.worker = new Worker(new URL("../workers/search-worker.js", import.meta.url), { type: "module" });
      this.worker.onmessage = (e) => {
        const { id, ok, result, error } = e.data;
        const p = this.pending.get(id);
        if (!p) return;
        this.pending.delete(id);
        ok ? p.resolve(result) : p.reject(error);
      };
      this.worker.onerror = () => {
        for (const p of this.pending.values()) p.reject(SYSTEM_ERROR);
        this.pending.clear();
        this.worker = null;          // fall back to the main thread from now on
      };
    } catch {
      this.worker = null;
    }
  },
  async localIndexes() {             // only used if module workers are not supported
    if (!this.local) {
      this.local = (async () => {
        const load = async (n) => { const r = await fetch(`data/${n}`); if (!r.ok) throw SYSTEM_ERROR; return r.text(); };
        const manifest = JSON.parse(await load("manifest.json"));
        return { manifest, thai: new ThaiIndex(parseWordList(await load("thai.txt"))), english: new EnglishIndex(parseWordList(await load("english.txt"))) };
      })();
    }
    return this.local;
  },
  async ask(op, lang, params = {}) {
    if (this.worker) {
      const id = this.nextId++;
      return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.worker.postMessage({ id, op, lang, params }); });
    }
    let L;
    try { L = await this.localIndexes(); } catch { throw SYSTEM_ERROR; }
    try {
      if (op === "info") return { manifest: L.manifest, thai: L.thai.size, english: L.english.size };
      return L[lang][op](op === "lookup" ? params.text : params);
    } catch (err) {
      throw err.code ? { code: err.code, message: err.message } : { code: "internal_error", system: true, message: "เกิดข้อผิดพลาดภายในแอป" };
    }
  },
};

let infoPromise = null;
/** Word counts and the dictionary manifest (cached). */
export function dictionaryInfo() {
  if (!infoPromise) infoPromise = Search.ask("info").catch((err) => { infoPromise = null; throw err; });
  return infoPromise;
}
