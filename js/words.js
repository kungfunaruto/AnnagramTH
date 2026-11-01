// Thai and English word screens: search (pattern / anagram / length) with the in-app keyboard, and the judge.
import { $, $$, esc, fmt, toast, copyText, Search, Settings, dictionaryInfo, debounce } from "./common.js";
import * as thai from "../engines/thai.js";

const ALL_MARKS = [...thai.ALL_OPTIONAL];       // the keyboard has no above/below marks: they are always optional
const LIMIT = 30000;
const CHUNK = 300;
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

// ---------------------------------------------------------------- keyboards
const key = (k, cls = "", label = k, aria = label) =>
  `<button type="button" class="${cls}" data-key="${esc(k)}" aria-label="${esc(aria)}">${esc(label)}</button>`;
const CMD_ROW = '<div class="kb-row cmd">' + key("?", "fn", "?", "ไทล์ว่าง") + key("*", "fn star", "*", "กี่ตัวก็ได้") +
  key("BACK", "fn", "⌫", "ลบไทล์สุดท้าย") + key("CLEAR", "fn", "ล้าง") + key("GO", "go", "ค้นหา") + "</div>";

function thaiKeyboard() {
  // Kumkom tile set: 28 single consonants (no ฃ ฅ), 8 dual tiles, 8 vowels (no ๅ)
  const DUAL = thai.DUAL_TILES.map(([x, y]) => `${x}/${y}`);
  const IN_DUAL = new Set(thai.DUAL_TILES.flat());
  const SINGLES = [...thai.CONSONANTS].filter((c) => !IN_DUAL.has(c) && c !== "ฃ" && c !== "ฅ").sort();
  const VOWELS = ["เ", "แ", "โ", "ใ", "ไ", "ะ", "า", "ำ"];
  return '<div class="kb-label">พยัญชนะ</div><div class="kb-row r10">' + SINGLES.map((c) => key(c, "cons")).join("") + "</div>" +
    '<div class="kb-label">ตัวคู่ (1 ไทล์ ค้นได้ 2 ตัว)</div><div class="kb-row r4">' + DUAL.map((d) => key(d, "dual")).join("") + "</div>" +
    '<div class="kb-label">สระ</div><div class="kb-row r8">' + VOWELS.map((v) => key(v, "vowel")).join("") + "</div>" + CMD_ROW;
}
function englishKeyboard() {
  return [["qwertyuiop", "r10"], ["asdfghjkl", "r9"], ["zxcvbnm", "r7"]]
    .map(([r, cls]) => `<div class="kb-row ${cls}">` + [...r].map((c) => key(c, "cons", c.toUpperCase())).join("") + "</div>").join("") + CMD_ROW;
}

const k = (s, cls = "") => `<span class="k ${cls}">${esc(s)}</span>`;
const LANGS = {
  thai: {
    label: "ไทย", maxTiles: 40, spaced: true, latin: false, lengths: range(2, 15), keyboard: thaiKeyboard,
    placeholder: { anagram: "แตะเพื่อพิมพ์ เช่น ก ล ม ?", pattern: "แตะเพื่อพิมพ์ เช่น ก ? ม" },
    judgePlaceholder: "เช่น กลม กลุ้ม ลม",
    anagramParams: (text) => ({ text, mode: "partial", optional_marks: ALL_MARKS }),
    count(text, mode) {
      if (mode === "pattern") return thai.parsePattern(text).filter((t) => t.type !== "star").length;
      const t = thai.parseTileInput(text);
      return t.chars.length + t.wildcards.length;
    },
    help: {
      anagram: `<h3>อนาแกรม</h3><p>แตะช่องด้านบนแล้วพิมพ์ไทล์ที่มี ลำดับไม่สำคัญ แอปจะหาคำที่ใช้ไทล์<b>ทั้งหมดหรือบางตัว</b></p>
        <p>ผลแบ่งเป็นหมวดตามจำนวนตัวที่ใช้ มาก → น้อย ในหมวดเรียงตามพจนานุกรม</p>
        <p>${k("?")} ไทล์ว่าง แทนพยัญชนะหรือสระได้ทุกตัว</p>
        <p>${k("ศ/ฤ", "dual")} ตัวคู่ 1 ไทล์ ค้นทั้ง 2 ตัว</p>
        <p>ไม่ต้องป้อนสระบน สระล่าง วรรณยุกต์ ไม้หันอากาศ ไม้ไต่คู้ และการันต์</p>`,
      pattern: `<h3>แบบแผน</h3><p>พิมพ์ตามตำแหน่งจากซ้ายไปขวา</p>
        <p>${k("?")} = 1 ตัวใดก็ได้ · ${k("*")} = กี่ตัวก็ได้ (หรือไม่มีเลย)</p>
        <p>เช่น ${k("ก")} ${k("?")} ${k("ม")} → กลม กรม กลุ้ม</p>
        <p>${k("*")} ${k("ก")} ${k("า", "vowel")} ${k("ร")} → คำที่ลงท้ายด้วย “การ”</p>
        <p>ไม่นับสระบน สระล่าง วรรณยุกต์ และเครื่องหมาย</p>`,
      length: `<h3>ความยาว</h3><p>เลือกจำนวนตัว แอปจะแสดงทุกคำที่มีจำนวนตัวเท่านั้น เรียงตามพจนานุกรม</p>
        <p>ไม่นับสระบน สระล่าง วรรณยุกต์ และเครื่องหมาย (เช่น “กลุ้ม” = 3 ตัว)</p>`,
    },
  },
  english: {
    label: "อังกฤษ", maxTiles: 30, spaced: false, latin: true, lengths: range(2, 15), keyboard: englishKeyboard,
    placeholder: { anagram: "แตะเพื่อพิมพ์ เช่น RETAIN?", pattern: "แตะเพื่อพิมพ์ เช่น C?T" },
    judgePlaceholder: "เช่น qi za retains",
    anagramParams: (text) => ({ letters: text, mode: "partial" }),
    count: (text) => [...text].filter((c) => /[a-z?]/i.test(c)).length,
    help: {
      anagram: `<h3>อนาแกรม</h3><p>แตะช่องด้านบนแล้วพิมพ์ตัวอักษรที่มี ลำดับไม่สำคัญ แอปจะหาคำที่ใช้<b>ทั้งหมดหรือบางตัว</b></p>
        <p>ผลแบ่งเป็นหมวดตามจำนวนตัวที่ใช้ มาก → น้อย ในหมวดเรียง A → Z</p>
        <p>${k("?")} ตัวว่าง แทนตัวอักษรใดก็ได้</p>`,
      pattern: `<h3>แบบแผน</h3><p>พิมพ์ตามตำแหน่งจากซ้ายไปขวา</p>
        <p>${k("?")} = 1 ตัวใดก็ได้ · ${k("*")} = กี่ตัวก็ได้ (หรือไม่มีเลย)</p>
        <p>เช่น ${k("C")}${k("?")}${k("T")} → CAT COT CUT · ${k("*")}${k("I")}${k("N")}${k("G")} → คำที่ลงท้ายด้วย ING</p>`,
      length: `<h3>ความยาว</h3><p>เลือกจำนวนตัวอักษร แอปจะแสดงทุกคำที่ยาวเท่านั้น เรียง A → Z</p>`,
    },
  },
};

const MODE_HINT = { anagram: "ใช้ทั้งหมดหรือบางตัว · ? = ตัวใดก็ได้", pattern: "? = 1 ตัว · * = กี่ตัวก็ได้", length: "เลือกจำนวนตัว" };
const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="#0b1530" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CROSS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" fill="none" stroke="#0b1530" stroke-width="3.2" stroke-linecap="round"/></svg>';

function screenHtml(L) {
  const latin = L.latin ? "latin" : "";
  return `
  <header class="top">
    <div class="seg seg-main" role="tablist" aria-label="ค้นหาหรือตัดสิน">
      <button role="tab" data-view="search" aria-selected="true">ค้นหา</button>
      <button role="tab" data-view="judge" aria-selected="false">ตัดสิน</button>
    </div>
    <span class="pill lex">${esc(L.label)}</span>
  </header>
  <div class="view view-search">
    <div class="controls">
      <form class="q-form"><input class="field q ${latin}" type="text" inputmode="none" enterkeyhint="search" autocomplete="off"
        autocorrect="off" autocapitalize="off" spellcheck="false" aria-label="ไทล์ที่มี"></form>
      <div class="seg seg-modes" role="radiogroup" aria-label="โหมดค้นหา">
        <button type="button" data-mode="pattern" aria-pressed="false">แบบแผน</button>
        <button type="button" data-mode="anagram" aria-pressed="true">อนาแกรม</button>
        <button type="button" data-mode="length" aria-pressed="false">ความยาว</button>
      </div>
      <div class="len-picker" hidden>${L.lengths.map((n) => `<button type="button" data-len="${n}" aria-pressed="false">${n}</button>`).join("")}</div>
      <div class="meta-row"><span class="mode-hint"></span><span class="tiles-wrap">ไทล์: <b class="tiles">0</b></span></div>
    </div>
    <div class="scroll results ${latin}">
      <div class="count" aria-live="polite"></div><div class="subcount"></div><div class="jump"></div>
      <div class="groups"></div><div class="sentinel"></div>
    </div>
    <div class="kb" hidden>
      <button type="button" class="kb-handle" aria-label="ซ่อนแป้นพิมพ์">⌄ ซ่อนแป้นพิมพ์</button>
      <div class="kb-keys">${L.keyboard()}</div>
    </div>
  </div>
  <div class="view view-judge scroll ${latin}" hidden>
    <div class="judge">
      <p class="prompt">ป้อนคำที่ต้องการตัดสิน คั่นด้วยเว้นวรรค:</p>
      <textarea class="area judge-input" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
        aria-label="คำที่ต้องการตัดสิน" placeholder="${esc(L.judgePlaceholder)}"></textarea>
      <div class="judge-actions">
        <button type="button" class="text-btn judge-clear">ล้าง</button>
        <button type="button" class="text-btn accent judge-go">ตัดสิน</button>
      </div>
      <div class="verdict" aria-live="polite"></div>
    </div>
  </div>`;
}

export class WordScreen {
  constructor(root) {
    this.root = root;
    this.lang = root.dataset.lang;
    this.L = LANGS[this.lang];
    root.innerHTML = screenHtml(this.L);
    const q = (s) => $(s, root);
    Object.assign(this, {
      q: q(".q"), qForm: q(".q-form"), lenPicker: q(".len-picker"), tilesEl: q(".tiles"), tilesWrap: q(".tiles-wrap"), hintEl: q(".mode-hint"),
      res: q(".results"), countEl: q(".count"), subEl: q(".subcount"), jumpEl: q(".jump"), groupsEl: q(".groups"), sentinel: q(".sentinel"),
      kb: q(".kb"), searchView: q(".view-search"), judgeView: q(".view-judge"),
      ji: q(".judge-input"), jgo: q(".judge-go"), verdict: q(".verdict"),
    });
    this.view = "search";
    this.mode = "anagram";
    this.text = { anagram: "", pattern: "" };
    this.len = null;
    this.seq = 0;
    this.state = null;
    this.liveRun = debounce(() => this.run(), 160);
    // On the phone the box is filled only by the in-app keyboard: read-only avoids Android's cursor handle.
    if (window.Capacitor?.isNativePlatform?.()) this.q.readOnly = true;
    this.wire();
    this.setMode("anagram");
    dictionaryInfo().then((i) => { q(".lex").textContent = `${this.L.label} · ${fmt(i[this.lang])} คำ`; }).catch(() => {});
  }

  wire() {
    $$(".seg-main button", this.root).forEach((b) => b.addEventListener("click", () => this.setView(b.dataset.view)));
    $$(".seg-modes button", this.root).forEach((b) => b.addEventListener("click", () => this.setMode(b.dataset.mode)));
    this.lenPicker.addEventListener("click", (e) => {
      const b = e.target.closest("[data-len]");
      if (!b) return;
      this.len = Number(b.dataset.len);
      $$("button", this.lenPicker).forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      this.run();
    });
    this.qForm.addEventListener("submit", (e) => { e.preventDefault(); this.closeKeyboard(); this.run(); });
    this.q.addEventListener("focus", () => this.openKeyboard());
    this.q.addEventListener("click", () => this.openKeyboard());
    this.q.addEventListener("input", () => this.setText(this.q.value));          // typing on a hardware keyboard
    const keys = $(".kb-keys", this.root);
    keys.addEventListener("pointerdown", (e) => e.preventDefault());           // keep focus; no phone keyboard
    keys.addEventListener("click", (e) => { const b = e.target.closest("[data-key]"); if (b) this.press(b.dataset.key); });
    $(".kb-handle", this.root).addEventListener("click", () => this.closeKeyboard());
    this.res.addEventListener("click", (e) => {
      const w = e.target.closest(".wchip");
      if (w) { copyText(w.textContent); return; }
      const j = e.target.closest("[data-tiles]");
      if (j && j.closest(".jump")) this.jumpTo(Number(j.dataset.tiles));
    });
    new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) this.renderMore(); },
      { root: this.res, rootMargin: "0px 0px 800px 0px" }).observe(this.sentinel);
    // judge
    this.ji.addEventListener("input", () => { this.verdict.innerHTML = ""; this.jgo.disabled = !this.ji.value.trim(); });
    $(".judge-clear", this.root).addEventListener("click", () => { this.ji.value = ""; this.verdict.innerHTML = ""; this.jgo.disabled = true; });
    this.jgo.addEventListener("click", () => { this.ji.blur(); this.judge(); });
    this.jgo.disabled = true;
  }

  // ---- views, modes, keyboard
  setView(v) {
    this.view = v;
    $$(".seg-main button", this.root).forEach((b) => b.setAttribute("aria-selected", String(b.dataset.view === v)));
    this.searchView.hidden = v !== "search";
    this.judgeView.hidden = v !== "judge";
    this.closeKeyboard();
  }
  setMode(m) {
    this.mode = m;
    $$(".seg-modes button", this.root).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === m)));
    const typed = m !== "length";
    this.qForm.hidden = !typed;
    this.tilesWrap.hidden = !typed;
    this.lenPicker.hidden = typed;
    this.hintEl.textContent = MODE_HINT[m];
    this.kb.classList.toggle("pattern", m === "pattern");
    if (typed) {
      this.q.value = this.text[m];
      this.q.placeholder = this.L.placeholder[m];
      this.updateCount();
    } else this.closeKeyboard();
    this.run();
  }
  openKeyboard() {
    if (this.view !== "search" || this.mode === "length") return;
    this.kb.hidden = false;
    document.body.classList.add("kb-open");
  }
  closeKeyboard() {
    this.kb.hidden = true;
    document.body.classList.remove("kb-open");
    if (document.activeElement === this.q) this.q.blur();
  }
  get keyboardOpen() { return !this.kb.hidden; }
  /** Android back button: close the keyboard first. Returns true if handled. */
  back() { if (this.keyboardOpen) { this.closeKeyboard(); return true; } return false; }

  count(text) {
    if (!text.trim()) return 0;
    try { return this.L.count(text, this.mode); } catch { return text.trim().split(/\s+/).filter((t) => t !== "*").length; }
  }
  updateCount() { this.tilesEl.textContent = this.count(this.q.value); }
  setText(t) {
    this.q.value = t;
    this.text[this.mode] = t;
    this.updateCount();
    if (Settings.get("live")) this.liveRun();
  }
  press(key) {
    let t = this.q.value;
    if (key === "BACK") t = this.L.spaced ? t.replace(/\s*\S+\s*$/u, "") : t.replace(/\s+$/, "").slice(0, -1);
    else if (key === "CLEAR") t = "";
    else if (key === "GO") { this.closeKeyboard(); this.run(); return; }
    else {
      if (key === "*" && (this.mode !== "pattern" || /\*\s*$/.test(t))) return;
      if (key !== "*" && this.count(t) >= this.L.maxTiles) { toast(`ป้อนได้ไม่เกิน ${this.L.maxTiles} ไทล์`); return; }
      t = this.L.spaced ? (t.trim() ? t.trim() + " " : "") + key : t + key;
    }
    this.setText(t);
  }

  // ---- search
  request() {
    if (this.mode === "length") {
      if (!this.len) return null;
      return { op: "pattern", kind: "length", params: { text: Array(this.len).fill("?").join(" "), sort: "alpha", limit: LIMIT } };
    }
    const text = this.q.value.trim();
    if (!text) return null;
    if (this.mode === "pattern") return { op: "pattern", kind: "pattern", params: { text, sort: "tiles_desc", limit: LIMIT } };
    return { op: "anagram", kind: "anagram", full: this.count(text), params: { ...this.L.anagramParams(text), sort: "tiles_desc", limit: LIMIT } };
  }
  async run() {
    const seq = ++this.seq;
    const req = this.request();
    if (!req) { this.showHelp(); return; }
    const spin = setTimeout(() => { if (seq === this.seq) this.countEl.innerHTML = '<span class="spinner"></span>กำลังค้นหา…'; }, 250);
    try {
      const r = await Search.ask(req.op, this.lang, req.params);
      if (seq === this.seq) this.render(r, req);
    } catch (err) {
      if (seq === this.seq) this.showError(err);
    } finally {
      clearTimeout(spin);
    }
  }
  clearResults() {
    this.state = null;
    this.countEl.textContent = ""; this.subEl.textContent = ""; this.jumpEl.innerHTML = ""; this.groupsEl.innerHTML = "";
    this.res.scrollTop = 0;
  }
  showHelp() {
    this.clearResults();
    this.groupsEl.innerHTML = `<div class="help">${this.L.help[this.mode]}</div>`;
  }
  showError(err) {
    this.clearResults();
    this.groupsEl.innerHTML = `<div class="notice ${err && err.system ? "err" : "warn"}">${err && err.system ? "<b>ระบบในแอปขัดข้อง</b> — " : ""}${esc(err && err.message)}</div>`;
  }
  groupLabel(tiles, req) {
    if (req.kind === "anagram") return tiles === req.full ? `ใช้ครบ ${tiles} ตัว` : `ใช้ ${tiles} ตัว`;
    return `${tiles} ตัว`;
  }
  render(r, req) {
    this.clearResults();
    if (!r.total) {
      this.groupsEl.innerHTML = `<div class="empty-hint">ไม่พบคำในคลังคำที่ตรงกับ${req.kind === "length" ? `ความยาว ${req.params.text.split(" ").length} ตัว` : "ไทล์ชุดนี้"}</div>`;
      return;
    }
    const shown = new Map();
    for (const x of r.results) shown.set(x.tiles, (shown.get(x.tiles) || 0) + 1);
    this.countEl.textContent = `พบ ${fmt(r.total)} คำ`;
    const order = this.lang === "thai" ? "เรียงตามพจนานุกรม" : "เรียง A → Z";
    this.subEl.textContent = (r.groups.length > 1 ? `แบ่งหมวดตามจำนวนตัว มาก → น้อย · ในหมวด${order}` : order) +
      (r.truncated ? ` · แสดง ${fmt(r.returned)} คำแรก` : "");
    if (r.groups.length > 1) {
      this.jumpEl.innerHTML = r.groups.filter((g) => shown.has(g.tiles)).map((g) => {
        const full = req.kind === "anagram" && g.tiles === req.full;
        return `<button type="button" data-tiles="${g.tiles}" class="${full ? "full" : ""}"><b>${full ? "ครบ " : ""}${g.tiles} ตัว</b> · ${fmt(g.count)}</button>`;
      }).join("");
    }
    this.state = { items: r.results, pos: 0, cur: null, chips: null, req, groups: new Map(r.groups.map((g) => [g.tiles, g.count])), shown };
    this.renderMore();
  }
  renderMore(n = CHUNK) {
    const st = this.state;
    if (!st || st.pos >= st.items.length) return;
    const end = Math.min(st.items.length, st.pos + n);
    let html = "";
    for (let i = st.pos; i < end; i++) {
      const x = st.items[i];
      if (x.tiles !== st.cur) {
        if (html) { st.chips.insertAdjacentHTML("beforeend", html); html = ""; }
        st.cur = x.tiles;
        const total = st.groups.get(x.tiles) || 0, seen = st.shown.get(x.tiles) || 0;
        const sec = document.createElement("section");
        sec.className = "grp" + (st.req.kind === "anagram" && x.tiles === st.req.full ? " full" : "");
        sec.dataset.group = x.tiles;
        sec.innerHTML = `<h3 class="grp-h"><span>${this.groupLabel(x.tiles, st.req)}</span>` +
          `<span class="n">${fmt(total)} คำ${seen < total ? ` (แสดง ${fmt(seen)})` : ""}</span></h3><div class="grp-words"></div>`;
        this.groupsEl.appendChild(sec);
        st.chips = sec.lastElementChild;
      }
      html += `<button type="button" class="wchip">${esc(x.word)}</button>`;
    }
    if (html) st.chips.insertAdjacentHTML("beforeend", html);
    st.pos = end;
  }
  jumpTo(tiles) {
    const find = () => $(`[data-group="${tiles}"]`, this.groupsEl);
    while (!find() && this.state && this.state.pos < this.state.items.length) this.renderMore(CHUNK * 4);
    const el = find();
    if (el) this.res.scrollTo({ top: el.offsetTop - 6, behavior: "smooth" });
  }

  // ---- judge
  async judge() {
    const words = this.ji.value.split(/[\s,]+/).filter(Boolean).slice(0, 60);
    if (!words.length) return;
    this.verdict.innerHTML = '<p class="summary"><span class="spinner"></span>กำลังตรวจ…</p>';
    const results = await Promise.all(words.map((w) => Search.ask("lookup", this.lang, { text: w })
      .then((r) => ({ w, ok: r.status === "found" }))
      .catch((err) => ({ w, ok: false, err }))));
    const broken = results.find((r) => r.err && r.err.system);
    if (broken) {
      this.verdict.innerHTML = `<div class="notice err"><b>ระบบในแอปขัดข้อง — ยังไม่ทราบผล</b><br>${esc(broken.err.message)}</div>`;
      return;
    }
    const all = results.every((r) => r.ok);
    this.verdict.innerHTML = `<h2>${all ? "ผ่าน — ทุกคำมีในคลังคำ" : "ไม่ผ่าน — มีคำที่ไม่อยู่ในคลังคำ"}</h2>
      <div class="circle ${all ? "ok" : "no"}" role="img" aria-label="${all ? "ผ่าน" : "ไม่ผ่าน"}">${all ? CHECK : CROSS}</div>
      <ul class="judge-list">${results.map((r) => `<li class="${r.ok ? "" : "bad"}">${r.ok ? "✓" : "✗"} ${esc(r.w)}${r.err ? ` <small>(${esc(r.err.message)})</small>` : ""}</li>`).join("")}</ul>`;
  }
}
