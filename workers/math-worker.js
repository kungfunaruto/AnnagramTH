// Background equation search for the A-Math screen. One message = one batch of a result group
// (up to `need` new equations). Cancelling = terminating this worker.
import { runGroupBatch } from "../engines/board.js";

self.onmessage = (event) => {
  const { id, batch } = event.data || {};
  try {
    self.postMessage({ id, ok: true, ...runGroupBatch(batch) });
  } catch (err) {
    self.postMessage({ id, ok: false, error: { code: "internal_error", message: "เกิดข้อผิดพลาดระหว่างค้นหา", detail: String(err && err.message) } });
  }
};
