// Settings tab: display options, clock options, dictionary facts, short help, privacy, about.
import { $, $$, esc, fmt, Settings, dictionaryInfo } from "./common.js";

export const APP_VERSION = "1.0.0";
const WORD_SIZES = { s: "20px", m: "24px", l: "30px" };

function applyWordSize() {
  document.documentElement.style.setProperty("--word-size", WORD_SIZES[Settings.get("wordSize")] || WORD_SIZES.m);
}

const toggle = (key, label, note = "") => `<div class="set-row"><span class="lbl">${label}${note ? `<small>${note}</small>` : ""}</span>
  <label class="toggle"><input type="checkbox" data-set="${key}" aria-label="${esc(label)}"><span></span></label></div>`;

export function initSettings() {
  $("#settings-body").innerHTML = `
  <div class="card"><h2>การแสดงผล</h2>
    <div class="set-row"><span class="lbl">ขนาดตัวอักษรของคำ</span>
      <div class="seg" data-seg="wordSize" role="radiogroup" aria-label="ขนาดตัวอักษรของคำ">
        <button type="button" data-v="s">เล็ก</button><button type="button" data-v="m">กลาง</button><button type="button" data-v="l">ใหญ่</button>
      </div></div>
    ${toggle("live", "ค้นหาทันทีขณะพิมพ์", "ถ้าปิด ให้กดปุ่ม “ค้นหา” บนแป้นพิมพ์เอง")}
  </div>
  <div class="card"><h2>นาฬิกาจับเวลา</h2>
    ${toggle("rotateTop", "หมุนนาฬิกาฝั่งบนให้คู่แข่ง", "สำหรับวางเครื่องไว้ตรงกลางระหว่างผู้เล่น")}
    ${toggle("beep", "เสียงและสั่นเมื่อหมดเวลา")}
  </div>
  <div class="card"><h2>คลังคำในแอป</h2>
    <dl class="facts" id="dict-facts"><dt>สถานะ</dt><dd>กำลังโหลด…</dd></dl>
    <p class="hint">คลังคำติดมากับแอป ใช้ได้โดยไม่ต้องต่ออินเทอร์เน็ต — อัปเดตคลังคำได้ด้วยการออกแอปเวอร์ชันใหม่</p>
  </div>
  <div class="card"><h2>วิธีใช้โดยย่อ</h2>
    <p><b>อนาแกรม</b> — ป้อนไทล์ที่มี แอปหาคำที่ใช้ทั้งหมดหรือบางตัว แบ่งหมวดตามจำนวนตัวที่ใช้ มาก → น้อย</p>
    <p><b>แบบแผน</b> — ป้อนตามตำแหน่ง <b>?</b> = 1 ตัว <b>*</b> = กี่ตัวก็ได้</p>
    <p><b>ความยาว</b> — แสดงทุกคำที่มีจำนวนตัวที่เลือก</p>
    <p><b>ตัดสิน</b> — ป้อนหลายคำ ✓ = ทุกคำมีในคลังคำ ✗ = มีคำที่ไม่มี</p>
    <p><b>ตัวคู่</b> ฆ/ซ ฌ/ษ ฎ/ฏ ฐ/ฑ ฒ/ณ ศ/ฤ ฬ/ญ ฮ/ฦ — 1 ไทล์ ค้นทั้ง 2 ตัว · ไม่ต้องป้อนสระบน-ล่าง วรรณยุกต์ และเครื่องหมาย</p>
    <p><b>คณิต บิงโก</b> — ป้อนไทล์ในมือ หาสมการทีละ 10 สมการต่อหมวด · <b>ล็อกตำแหน่ง</b> — วางไทล์บนกระดานในแถว 15 ช่อง แอปบอกช่องที่วางสมการได้</p>
    <p>แตะคำหรือสมการในผลลัพธ์เพื่อคัดลอก</p>
  </div>
  <div class="card"><h2>กติกาคณิต (A-Math) ที่แอปใช้</h2>
    <ul class="rules-list">
      <li>ไทล์ 0–9 วางติดกันเป็นจำนวนได้ไม่เกิน 3 หลัก (เช่น 125) และห้ามมีศูนย์นำหน้า (05)</li>
      <li>ไทล์ 10–20 เป็นไทล์เดียว วางติดกับไทล์ตัวเลขอื่นไม่ได้</li>
      <li>คูณ หาร ก่อน บวก ลบ · ผลหารระหว่างทางเป็นเศษส่วนได้ (3 ÷ 2 × 4 = 6) · หารด้วย 0 ไม่ได้</li>
      <li>ใช้ − นำหน้าเป็นจำนวนลบได้เฉพาะตัวแรกของแต่ละข้าง (−3 + 5 = 2) ห้าม −0</li>
      <li>มี = ได้หลายตัว ทุกข้างต้องมีค่าเท่ากัน (6 = 2 × 3 = 3 + 3)</li>
      <li>+/- แทน + หรือ − · ×/÷ แทน × หรือ ÷ · ? แทนได้ทุกไทล์</li>
      <li>สมการยาวอย่างน้อย 3 ไทล์</li>
    </ul>
  </div>
  <div class="card"><h2>ความเป็นส่วนตัว</h2>
    <p>แอปนี้ทำงานในเครื่องทั้งหมด ใช้ได้โดยไม่ต้องต่ออินเทอร์เน็ต ไม่ต้องลงชื่อเข้าใช้ ไม่มีโฆษณา และไม่เก็บหรือส่งข้อมูลใด ๆ ออกจากเครื่อง</p>
    <p>การตั้งค่าบันทึกไว้ในเครื่องนี้เท่านั้น</p>
  </div>
  <div class="card"><h2>เกี่ยวกับ</h2>
    <dl class="facts"><dt>แอป</dt><dd>AnagramTH</dd><dt>เวอร์ชัน</dt><dd>${APP_VERSION}</dd></dl>
    <p class="hint">คลังคำภาษาอังกฤษ: ENABLE (Enhanced North American Benchmark Lexicon) — สาธารณสมบัติ (public domain)</p>
  </div>`;

  // controls
  const paint = () => {
    $$('[data-seg="wordSize"] button').forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === Settings.get("wordSize"))));
    $$("#settings-body [data-set]").forEach((c) => { c.checked = Boolean(Settings.get(c.dataset.set)); });
  };
  $$('[data-seg="wordSize"] button').forEach((b) => b.addEventListener("click", () => { Settings.set("wordSize", b.dataset.v); applyWordSize(); paint(); }));
  $$("#settings-body [data-set]").forEach((c) => c.addEventListener("change", () => Settings.set(c.dataset.set, c.checked)));
  paint();
  applyWordSize();

  dictionaryInfo().then((info) => {
    const m = info.manifest;
    const files = (lang) => (m.languages?.[lang]?.files || []).map((f) => f.file).join(", ");
    const built = new Date(m.built_at).toLocaleDateString("th-TH", { year: "numeric", month: "long", day: "numeric" });
    $("#dict-facts").innerHTML = `
      <dt>ไทย</dt><dd>${fmt(info.thai)} คำ <span class="muted">(${esc(files("thai"))})</span></dd>
      <dt>อังกฤษ</dt><dd>${fmt(info.english)} คำ <span class="muted">(ENABLE)</span></dd>
      <dt>สร้างเมื่อ</dt><dd>${esc(built)}</dd>` +
      (m.source === "test-fixtures" ? '<dt>หมายเหตุ</dt><dd>คลังคำทดสอบชุดเล็ก</dd>' : "");
  }).catch((err) => {
    $("#dict-facts").innerHTML = `<dt>สถานะ</dt><dd>${esc(err.message || "โหลดคลังคำไม่สำเร็จ")}</dd>`;
  });
}
