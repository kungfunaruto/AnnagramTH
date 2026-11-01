// A-Math screen, laid out like the Thai tab.
//   บิงโก        equations from the rack, one group per number of tiles used (most first)
//   ล็อกตำแหน่ง  a 15-cell board row: equations placed through the tiles already on the board
// Each group computes 10 equations at a time in a background worker; "ดูเพิ่มอีก 10" computes more.
import { $, $$, esc, fmt, toast, copyText, Settings, debounce } from "./common.js";
import { ROW_LENGTH, rowSegments, segmentRequest, rackRequest } from "../engines/board.js";

const NUMBERS = Array.from({ length: 21 }, (_, i) => String(i));
const OPS = ["+", "-", "×", "÷", "="];
const SPECIALS = ["+/-", "×/÷"];
const MAX_RACK = 12;
const PAGE = 10;
const show = (t) => (t === "-" ? "−" : t);
const showEq = (e) => e.replace(/-/g, "−");
const tileKind = (t) => (NUMBERS.includes(t) ? "num" : SPECIALS.includes(t) || t === "?" ? "special" : "op");

const key = (k, cls, aria = `ไทล์ ${show(k)}`) => `<button type="button" class="${cls}" data-key="${esc(k)}" aria-label="${esc(aria)}">${esc(show(k))}</button>`;
const KEYBOARD =
  '<div class="kb-label">ตัวเลข</div>' +
  '<div class="kb-row r10">' + NUMBERS.slice(0, 10).map((k) => key(k, "cons")).join("") + "</div>" +
  '<div class="kb-row r11">' + NUMBERS.slice(10).map((k) => key(k, "cons num2")).join("") + "</div>" +
  '<div class="kb-label">เครื่องหมาย<span class="rack-only"> · ไทล์พิเศษ</span></div>' +
  '<div class="kb-row flex">' + OPS.map((k) => key(k, "vowel")).join("") + SPECIALS.map((k) => key(k, "dual rack-only")).join("") + "</div>" +
  '<div class="kb-row cmd">' + key("?", "fn rack-only", "ไทล์ว่าง") + key("BACK", "fn", "ลบ").replace(">BACK<", ">⌫<") +
  key("CLEAR", "fn", "ล้าง").replace(">CLEAR<", ">ล้าง<") + key("GO", "go", "ค้นหา").replace(">GO<", ">ค้นหา<") + "</div>";

const HELP = {
  bingo: `<h3>บิงโก</h3><p>แตะช่องด้านบนแล้วใส่ไทล์ในมือ แอปจะหาสมการที่ใช้ไทล์<b>ทั้งหมดหรือบางตัว</b> แบ่งหมวดตามจำนวนไทล์ที่ใช้ มาก → น้อย</p>
    <p>คิดทีละ 10 สมการต่อหมวด กด “ดูเพิ่มอีก 10” เพื่อคิดต่อ</p>
    <p><span class="k">?</span> ไทล์ว่าง แทนได้ทุกไทล์ · <span class="k dual">+/-</span> <span class="k dual">×/÷</span> ไทล์พิเศษ</p>
    <p>แตะสมการเพื่อคัดลอก · กติกาที่ใช้ดูได้ในแท็บตั้งค่า</p>`,
  board: `<h3>ล็อกตำแหน่ง</h3><p>ใส่ไทล์ในมือ แล้วแตะช่องในแถว 15 ช่องเพื่อวางไทล์ที่อยู่บนกระดานแล้ว</p>
    <p>แอปจะหาที่วางสมการในแถวนี้: ต้องผ่านไทล์บนกระดานอย่างน้อย 1 ตัว และช่องก่อนหน้า-หลังสมการต้องว่าง</p>
    <p>แบ่งหมวดตามจำนวนไทล์ในมือที่ใช้ มาก → น้อย และบอกช่องที่วาง เช่น “ช่อง 2–9”</p>`,
};

function screenHtml() {
  const cells = Array.from({ length: ROW_LENGTH }, (_, i) =>
    `<button type="button" class="cell" data-cell="${i + 1}" aria-label="ช่อง ${i + 1}"><span class="ci">${i + 1}</span><span class="ct"></span></button>`).join("");
  return `
  <header class="top">
    <div class="seg seg-main" role="tablist" aria-label="โหมดคณิต">
      <button role="tab" data-mode="bingo" aria-selected="true">บิงโก</button>
      <button role="tab" data-mode="board" aria-selected="false">ล็อกตำแหน่ง</button>
    </div>
    <span class="pill lex">A-Math</span>
  </header>
  <div class="view">
    <div class="controls">
      <form class="q-form"><input class="field q" id="m-rack" type="text" inputmode="none" autocomplete="off" spellcheck="false"
        aria-label="ไทล์ในมือ" placeholder="แตะเพื่อใส่ไทล์ในมือ เช่น 1 2 + = ?"></form>
      <div class="board-wrap" hidden>
        <div class="board-head"><span>แถวบนกระดาน — แตะช่องเพื่อวางไทล์</span><button type="button" class="link board-clear">ล้างแถว</button></div>
        <div class="board" role="group" aria-label="แถว 15 ช่อง">${cells}</div>
      </div>
      <div class="meta-row"><span class="mode-hint"></span><span>ไทล์ในมือ: <b class="tiles">0</b></span></div>
    </div>
    <div class="scroll results">
      <div class="count" aria-live="polite"></div><div class="subcount"></div><div class="jump"></div>
      <div class="groups"></div>
    </div>
    <div class="kb" hidden>
      <button type="button" class="kb-handle" aria-label="ซ่อนแป้นพิมพ์">⌄ ซ่อนแป้นพิมพ์</button>
      <div class="kb-target"></div>
      <div class="kb-keys">${KEYBOARD}</div>
    </div>
  </div>`;
}

class MathScreen {
  constructor(root) {
    this.root = root;
    root.innerHTML = screenHtml();
    const q = (s) => $(s, root);
    Object.assign(this, {
      rackEl: q(".q"), boardWrap: q(".board-wrap"), boardEl: q(".board"), tilesEl: q(".tiles"), hintEl: q(".mode-hint"),
      res: q(".results"), countEl: q(".count"), subEl: q(".subcount"), jumpEl: q(".jump"), groupsEl: q(".groups"),
      kb: q(".kb"), kbTarget: q(".kb-target"),
    });
    if (window.Capacitor?.isNativePlatform?.()) this.rackEl.readOnly = true;   // filled only by the in-app keyboard
    this.mode = "bingo";
    this.rack = [];
    this.board = Array(ROW_LENGTH).fill(null);
    this.target = "rack";             // "rack" or a cell number 1..15
    this.worker = null;
    this.msgId = 0;
    this.pending = new Map();
    this.gen = 0;
    this.groups = [];
    this.liveRun = debounce(() => this.run(), 400);
    this.wire();
    this.setMode("bingo");
  }

  wire() {
    $$(".seg-main button", this.root).forEach((b) => b.addEventListener("click", () => this.setMode(b.dataset.mode)));
    $(".q-form", this.root).addEventListener("submit", (e) => { e.preventDefault(); this.closeKeyboard(); this.run(); });
    const openRack = () => { this.target = "rack"; this.openKeyboard(); };
    this.rackEl.addEventListener("focus", openRack);
    this.rackEl.addEventListener("click", openRack);
    this.rackEl.addEventListener("input", () => {                     // hardware keyboard (browser preview)
      this.rack = this.rackEl.value.split(/\s+/).filter(Boolean).slice(0, MAX_RACK);
      this.changed();
    });
    this.boardEl.addEventListener("click", (e) => {
      const c = e.target.closest("[data-cell]");
      if (!c) return;
      this.target = Number(c.dataset.cell);
      this.openKeyboard();
    });
    $(".board-clear", this.root).addEventListener("click", () => { this.board.fill(null); this.changed(); });
    const keys = $(".kb-keys", this.root);
    keys.addEventListener("pointerdown", (e) => e.preventDefault());
    keys.addEventListener("click", (e) => { const b = e.target.closest("[data-key]"); if (b) this.press(b.dataset.key); });
    $(".kb-handle", this.root).addEventListener("click", () => this.closeKeyboard());
    this.res.addEventListener("click", (e) => {
      const chip = e.target.closest(".eqchip");
      if (chip) { copyText(chip.dataset.copy); return; }
      const more = e.target.closest(".more");
      if (more) { this.more(Number(more.dataset.group)); return; }
      const j = e.target.closest(".jump [data-group]");
      if (j) { const el = $(`.grp[data-group="${j.dataset.group}"]`, this.groupsEl); if (el) this.res.scrollTo({ top: el.offsetTop - 6, behavior: "smooth" }); }
    });
  }

  // ---- modes, keyboard, input
  setMode(m) {
    this.mode = m;
    $$(".seg-main button", this.root).forEach((b) => b.setAttribute("aria-selected", String(b.dataset.mode === m)));
    this.boardWrap.hidden = m !== "board";
    this.hintEl.textContent = m === "bingo" ? "ใช้ทั้งหมดหรือบางตัว · ? = ไทล์ใดก็ได้" : "สมการต้องผ่านไทล์บนกระดาน";
    if (m === "bingo" && this.target !== "rack") this.target = "rack";
    this.paint();
    this.run();
  }
  openKeyboard() {
    this.kb.hidden = false;
    document.body.classList.add("kb-open");
    this.paint();
  }
  closeKeyboard() {
    this.kb.hidden = true;
    document.body.classList.remove("kb-open");
    if (document.activeElement === this.rackEl) this.rackEl.blur();
    this.paint();
  }
  get keyboardOpen() { return !this.kb.hidden; }
  back() { if (this.keyboardOpen) { this.closeKeyboard(); return true; } return false; }

  press(k) {
    if (k === "GO") { this.closeKeyboard(); this.run(); return; }
    if (this.target === "rack") {
      if (k === "BACK") this.rack.pop();
      else if (k === "CLEAR") this.rack = [];
      else if (this.rack.length >= MAX_RACK) { toast(`ไทล์ในมือได้ไม่เกิน ${MAX_RACK} ตัว`); return; }
      else this.rack.push(k);
    } else {
      const i = this.target;
      if (k === "BACK") {
        if (this.board[i - 1]) this.board[i - 1] = null;
        else if (i > 1) { this.target = i - 1; this.board[i - 2] = null; }
      } else if (k === "CLEAR") this.board.fill(null);
      else if (k === "?" || SPECIALS.includes(k)) return;                // board tiles are already fixed
      else { this.board[i - 1] = k; if (i < ROW_LENGTH) this.target = i + 1; }
    }
    this.changed();
  }
  changed() {
    this.paint();
    if (Settings.get("live")) this.liveRun();
  }
  paint() {
    if (document.activeElement !== this.rackEl || this.rackEl.readOnly) this.rackEl.value = this.rack.map(show).join(" ");
    this.tilesEl.textContent = this.rack.length;
    const editingBoard = this.target !== "rack" && this.keyboardOpen;
    $$(".cell", this.boardEl).forEach((c) => {
      const t = this.board[Number(c.dataset.cell) - 1];
      $(".ct", c).textContent = t ? show(t) : "";
      c.className = "cell" + (t ? ` filled ${tileKind(t)}` : "") + (editingBoard && Number(c.dataset.cell) === this.target ? " sel" : "");
    });
    this.rackEl.classList.toggle("editing", this.keyboardOpen && this.target === "rack");
    this.kb.classList.toggle("board-target", this.target !== "rack");
    this.kbTarget.textContent = this.target === "rack" ? "กำลังใส่: ไทล์ในมือ" : `กำลังวาง: ช่อง ${this.target} บนกระดาน`;
  }

  // ---- search: groups of 10, computed in a background worker
  stopWorker() {
    if (this.worker) this.worker.terminate();
    this.worker = null;
    this.pending.clear();
  }
  send(batch) {
    if (!this.worker) {
      this.worker = new Worker(new URL("../workers/math-worker.js", import.meta.url), { type: "module" });
      this.worker.onmessage = (e) => { const p = this.pending.get(e.data.id); if (p) { this.pending.delete(e.data.id); p(e.data); } };
      this.worker.onerror = () => { for (const p of this.pending.values()) p({ ok: false, error: { message: "เกิดข้อผิดพลาดระหว่างค้นหา" } }); this.pending.clear(); this.worker = null; };
    }
    const id = ++this.msgId;
    return new Promise((resolve) => { this.pending.set(id, resolve); this.worker.postMessage({ id, batch }); });
  }

  buildGroups() {
    const n = this.rack.length;
    if (this.mode === "bingo") {
      if (n < 3) return { help: true };
      const groups = [];
      for (let k = n; k >= 3; k--) {
        groups.push({ id: k, label: k === n ? `ใช้ครบ ${k} ตัว (บิงโก)` : `ใช้ ${k} ตัว`, short: k === n ? `ครบ ${k} ตัว` : `${k} ตัว`, full: k === n,
          jobs: [{ request: rackRequest(this.rack, k), taken: 0, exhausted: false }] });
      }
      return { groups };
    }
    if (!n || !this.board.some(Boolean)) return { help: true };
    const segs = rowSegments(this.board, n);
    const groups = [];
    for (let k = n; k >= 1; k--) {
      const jobs = segs.filter((s) => s.free === k)
        .map((s) => ({ request: segmentRequest(this.rack, s), start: s.start, end: s.end, taken: 0, exhausted: false }));
      if (jobs.length) {
        groups.push({ id: k, label: k === n ? `ใช้ไทล์ในมือครบ ${k} ตัว (บิงโก)` : `ใช้ไทล์ในมือ ${k} ตัว`, short: k === n ? `ครบ ${k} ตัว` : `${k} ตัว`,
          full: k === n, jobs });
      }
    }
    return { groups, noPlace: !groups.length };
  }

  async run() {
    this.stopWorker();
    const gen = ++this.gen;
    this.groups = [];
    this.countEl.textContent = ""; this.subEl.textContent = ""; this.jumpEl.innerHTML = ""; this.groupsEl.innerHTML = "";
    this.res.scrollTop = 0;
    const plan = this.buildGroups();
    if (plan.help) { this.groupsEl.innerHTML = `<div class="help">${HELP[this.mode]}</div>`; return; }
    if (plan.noPlace) { this.groupsEl.innerHTML = '<div class="empty-hint">ไม่มีช่องที่วางสมการได้ในแถวนี้ (ต้องผ่านไทล์บนกระดาน และช่องก่อน-หลังต้องว่าง)</div>'; return; }
    this.groups = plan.groups.map((g) => ({ ...g, items: [], seen: [], done: false, incomplete: false, busy: true, error: null }));
    this.subEl.textContent = this.mode === "bingo" ? "คิดทีละ 10 สมการต่อหมวด · หมวดเรียงจากใช้ไทล์มาก → น้อย"
      : "คิดทีละ 10 สมการต่อหมวด · บอกช่องที่วางในแถว";
    this.status();
    // the worker answers in order: groups appear from the most tiles used to the fewest
    await Promise.all(this.groups.map((g) => this.batch(g, gen)));
  }

  async batch(g, gen) {
    g.busy = true;
    this.paintGroup(g);
    const jobs = g.jobs.filter((j) => !j.exhausted);
    const r = await this.send({ jobs: jobs.map(({ request, start, end, taken }) => ({ request, start, end, taken })), need: PAGE, seen: g.seen });
    if (gen !== this.gen) return;
    g.busy = false;
    if (!r.ok) { g.error = r.error.message; g.done = true; }
    else {
      r.jobs.forEach((rep, i) => { jobs[i].taken = rep.taken; jobs[i].exhausted = rep.exhausted; if (rep.timeout) g.incomplete = true; });
      for (const x of r.results) { g.items.push(x); g.seen.push(x.key); }
      g.done = g.jobs.every((j) => j.exhausted);
      if (r.error) g.error = r.error.message;
    }
    this.paintGroup(g);
    this.status();
  }
  more(id) {
    const g = this.groups.find((x) => x.id === id);
    if (g && !g.busy && !g.done) this.batch(g, this.gen);
  }

  status() {
    const shown = this.groups.filter((g) => g.items.length);
    const busy = this.groups.some((g) => g.busy);
    const total = shown.reduce((s, g) => s + g.items.length, 0);
    if (busy) this.countEl.innerHTML = `<span class="spinner"></span>กำลังคิด…${total ? ` แสดงแล้ว ${fmt(total)} สมการ` : ""}`;
    else if (total) this.countEl.textContent = `แสดง ${fmt(total)} สมการ`;
    else {
      this.countEl.textContent = "";
      const err = this.groups.find((g) => g.error);
      this.groupsEl.innerHTML = err ? `<div class="notice warn">${esc(err.error)}</div>`
        : '<div class="empty-hint">ไม่พบสมการที่ถูกต้องจากไทล์ชุดนี้</div>';
    }
    this.jumpEl.innerHTML = shown.length > 1 ? shown.map((g) =>
      `<button type="button" data-group="${g.id}" class="${g.full ? "full" : ""}"><b>${esc(g.short)}</b> · ${fmt(g.items.length)}${g.done ? "" : "+"}</button>`).join("") : "";
  }

  paintGroup(g) {
    let sec = $(`.grp[data-group="${g.id}"]`, this.groupsEl);
    if (!g.items.length) { if (sec) sec.remove(); return; }
    if (!sec) {
      sec = document.createElement("section");
      sec.className = "grp" + (g.full ? " full" : "");
      sec.dataset.group = g.id;
      sec.innerHTML = `<h3 class="grp-h"><span>${esc(g.label)}</span><span class="n"></span></h3><div class="grp-words eqs"></div>
        <button type="button" class="more" data-group="${g.id}"></button>`;
      const after = [...this.groupsEl.querySelectorAll(".grp")].find((s) => Number(s.dataset.group) < g.id);
      this.groupsEl.insertBefore(sec, after || null);
    }
    $(".n", sec).textContent = (g.done ? `ทั้งหมด ${fmt(g.items.length)} สมการ` : `${fmt(g.items.length)} สมการแรก`) + (g.incomplete ? " · ค้นไม่ครบ" : "");
    const box = $(".eqs", sec);
    box.innerHTML = g.items.map((x) => `<button type="button" class="eqchip" data-copy="${esc(showEq(x.equation))}">` +
      `<span class="e">${esc(showEq(x.equation))}</span>${x.start ? `<span class="pos">ช่อง ${x.start}–${x.end}</span>` : ""}</button>`).join("");
    const more = $(".more", sec);
    more.hidden = g.done;
    more.disabled = g.busy;
    more.innerHTML = g.busy ? '<span class="spinner"></span>กำลังคิด…' : `ดูเพิ่มอีก ${PAGE}`;
  }
}

export function initMath() {
  return new MathScreen($("#screen-math"));
}
