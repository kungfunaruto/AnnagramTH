// Two-player game clock (like a chess clock). Tap your own side when your turn ends: your clock stops and
// the other one starts. The first tap also starts the opponent's clock, so the player who did not tap moves first.
// Time keeps counting below zero (shown in red) so overtime can be scored.
import { $, $$, toast, Settings, confirmBox } from "./common.js";

const PRESETS = [10, 15, 20, 22, 25, 30, 45, 60];
const T = { remaining: [0, 0], active: null, running: false, started: false, last: 0, moves: [0, 0], alarmed: [false, false], raf: 0, wake: null };
const clocks = () => $$("#screen-timer .clock");

function fmtTime(ms) {
  const over = ms <= -1000;
  const s = ms > 0 ? Math.ceil(ms / 1000) : Math.floor(-ms / 1000);
  const m = Math.floor(s / 60), ss = String(s % 60).padStart(2, "0");
  return `${over ? "−" : ""}${String(m).padStart(2, "0")}:${ss}`;
}

function reset() {
  const ms = Settings.get("timerMinutes") * 60000;
  Object.assign(T, { remaining: [ms, ms], active: null, running: false, started: false, moves: [0, 0], alarmed: [false, false] });
  cancelAnimationFrame(T.raf);
  releaseWake();
  $("#t-minutes").textContent = `${Settings.get("timerMinutes")} นาที`;
  draw();
}

function account() {
  const now = Date.now();
  if (T.running && T.active !== null) {
    T.remaining[T.active] -= now - T.last;
    if (T.remaining[T.active] <= 0 && !T.alarmed[T.active]) { T.alarmed[T.active] = true; alarm(); }
  }
  T.last = now;
}

function draw() {
  clocks().forEach((el) => {
    const p = Number(el.dataset.p);
    const ms = T.remaining[p];
    $(".time", el).textContent = fmtTime(ms);
    el.classList.toggle("active", T.active === p);
    el.classList.toggle("over", ms <= 0);
    let sub;
    if (!T.started) sub = "แตะเพื่อเริ่ม — เวลาอีกฝั่งจะเริ่มเดิน";
    else if (ms <= 0) sub = `เกินเวลา · ตาที่ ${T.moves[p]}`;
    else if (T.active === p) sub = T.running ? `ตาที่ ${T.moves[p]} · แตะเมื่อจบตา` : "หยุดชั่วคราว";
    else sub = T.moves[p] ? `เล่นไป ${T.moves[p]} ตา` : "รอ";
    $(".sub", el).textContent = sub;
  });
  const pause = $("#t-pause");
  pause.textContent = T.running ? "⏸" : "▶";
  pause.setAttribute("aria-label", T.running ? "หยุดชั่วคราว" : "เล่นต่อ");
  pause.disabled = !T.started;
}

function loop() {
  account();
  draw();
  if (T.running) T.raf = requestAnimationFrame(loop);
}

function run(on) {
  account();
  T.running = on;
  cancelAnimationFrame(T.raf);
  if (on) { T.last = Date.now(); loop(); requestWake(); } else { releaseWake(); draw(); }
}

function tap(p) {
  if (!T.started) {
    T.started = true;
    T.active = 1 - p;                                // the clock goes to the opponent
    T.moves[1 - p] = 1;
    click();
    run(true);
    return;
  }
  if (!T.running) { toast("นาฬิกาหยุดอยู่ — กด ▶ เพื่อเล่นต่อ"); return; }
  if (p !== T.active) return;                       // only the player whose clock is running can end the turn
  account();
  T.active = 1 - p;
  T.moves[T.active]++;
  click();
  draw();
}

// ---- sound, vibration, screen kept on
let audio;
function tone(freq, start, dur, vol = 0.25) {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, audio.currentTime + start);
    g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + start + dur);
    o.connect(g).connect(audio.destination);
    o.start(audio.currentTime + start);
    o.stop(audio.currentTime + start + dur);
  } catch { /* no audio */ }
}
function click() { if (Settings.get("beep")) tone(880, 0, 0.05, 0.12); }
function alarm() {
  if (!Settings.get("beep")) return;
  [0, 0.35, 0.7].forEach((t) => tone(1046, t, 0.25));
  try { navigator.vibrate && navigator.vibrate([300, 150, 300, 150, 300]); } catch { /* ignore */ }
}
async function requestWake() {
  try { if ("wakeLock" in navigator && !T.wake) { T.wake = await navigator.wakeLock.request("screen"); T.wake.addEventListener("release", () => { T.wake = null; }); } }
  catch { /* not supported: the screen may turn off */ }
}
function releaseWake() { try { T.wake && T.wake.release(); } catch { /* ignore */ } T.wake = null; }
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  if (T.running) { requestWake(); cancelAnimationFrame(T.raf); loop(); }
});

// ---- minutes dialog
function openMinutes() {
  if (T.running) { toast("หยุดนาฬิกาก่อนตั้งเวลา"); return; }
  let v = Settings.get("timerMinutes");
  const d = $("#minutes-dialog");
  const paint = () => {
    $("#minutes-value").textContent = v;
    $$("#minutes-chips .chip").forEach((c) => c.setAttribute("aria-pressed", String(Number(c.dataset.min) === v)));
  };
  $("#minutes-chips").innerHTML = PRESETS.map((m) => `<button type="button" class="chip" data-min="${m}">${m}</button>`).join("");
  $("#minutes-chips").onclick = (e) => { const c = e.target.closest("[data-min]"); if (c) { v = Number(c.dataset.min); paint(); } };
  $$("[data-step]", d).forEach((b) => { b.onclick = () => { v = Math.max(1, Math.min(180, v + Number(b.dataset.step))); paint(); }; });
  paint();
  d.returnValue = "";
  d.showModal();
  d.addEventListener("close", () => {
    if (d.returnValue !== "ok") return;
    Settings.set("timerMinutes", v);
    reset();
  }, { once: true });
}

export function initTimer() {
  clocks().forEach((el) => el.addEventListener("click", () => tap(Number(el.dataset.p))));
  $("#t-pause").addEventListener("click", () => { if (T.started) run(!T.running); });
  $("#t-reset").addEventListener("click", async () => {
    if (T.started && !(await confirmBox("เริ่มเกมใหม่? เวลาทั้งสองฝั่งจะกลับเป็นค่าเริ่มต้น", "เริ่มใหม่"))) return;
    reset();
  });
  $("#t-minutes").addEventListener("click", openMinutes);
  const rotate = () => $("#screen-timer").classList.toggle("rotate", Boolean(Settings.get("rotateTop")));
  Settings.on((key) => { if (key === "rotateTop") rotate(); });
  rotate();
  reset();
}
