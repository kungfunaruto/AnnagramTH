// AnagramTH — app start-up and bottom tabs. Everything runs on the phone; nothing is sent anywhere.
import { $, $$, store, Search, dictionaryInfo, nativePlugin } from "./js/common.js";
import { WordScreen } from "./js/words.js";
import { initMath } from "./js/math-ui.js";
import { initTimer } from "./js/timer.js";
import { initSettings } from "./js/settings-ui.js";

Search.start();
const words = { thai: new WordScreen($("#screen-thai")), english: new WordScreen($("#screen-english")), math: initMath() };
initTimer();
initSettings();

const SCREENS = ["thai", "english", "math", "timer", "settings"];
let current = "thai";
function show(name) {
  if (!SCREENS.includes(name)) return;
  words[current]?.closeKeyboard();
  current = name;
  $$(".tabbar button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.screen === name)));
  SCREENS.forEach((s) => { $(`#screen-${s}`).hidden = s !== name; });
  store.set("screen", name);
}
$$(".tabbar button").forEach((b) => b.addEventListener("click", () => show(b.dataset.screen)));
show(store.get("screen") || "thai");

dictionaryInfo().then((info) => {
  if (info.manifest.source === "test-fixtures") {
    const b = $("#banner");
    b.textContent = "ใช้คลังคำทดสอบชุดเล็ก — ยังไม่ใช่คลังคำจริง";
    b.hidden = false;
  }
}).catch((err) => {
  const b = $("#banner");
  b.textContent = err.message || "โหลดคลังคำในแอปไม่สำเร็จ";
  b.className = "banner err";
  b.hidden = false;
});

// Android back button: close the in-app keyboard or a dialog first, then go back to the Thai tab, then leave the app.
const App = nativePlugin("App");
if (App) {
  App.addListener("backButton", () => {
    const dlg = $("dialog[open]");
    if (dlg) { dlg.close("cancel"); return; }
    if (words[current]?.back()) return;
    if (current !== "thai") { show("thai"); return; }
    App.minimizeApp();
  });
}
