// A-Math screen: the rules the app plays by, and where an equation can go on one board row.
import { parseRequest, solve, MAX_RESULTS_LIMIT } from "./math.js";
import { InputError } from "./errors.js";

export const ROW_LENGTH = 15;
const BAD_FIRST = new Set(["=", "+", "×", "÷"]);          // "-" may start a negative number
const BAD_LAST = new Set(["=", "+", "-", "×", "÷"]);

/** Fixed rules of the app (see the rule summary in the Settings tab). */
export const APP_RULES = Object.freeze({
  allow_concatenation: true, max_number_digits: 3, allow_leading_zero: false, negative_numbers: "side_start",
  allow_negative_zero: false, division: "rational", require_integer_sides: false, special_tiles_enabled: true,
  plus_minus_faces: ["+", "-"], times_divide_faces: ["×", "÷"], wildcard_mode: "any", wildcard_values: [],
  allow_multiple_equals: true,
});

/**
 * Places on a row where a new equation can go: a run of cells that
 *   - holds at least one board tile and uses every board tile inside it,
 *   - has empty cells (or the edge of the board) right before and right after it,
 *   - leaves 1..rackSize empty cells for tiles from the rack,
 *   - does not start with = + × ÷ or end with = or an operator (no equation can).
 * board: array of ROW_LENGTH cells (tile string or null). Positions are 1-based.
 */
export function rowSegments(board, rackSize) {
  const n = board.length;
  const out = [];
  for (let start = 1; start <= n; start++) {
    if (start > 1 && board[start - 2]) continue;
    for (let end = start + 2; end <= n; end++) {
      if (end < n && board[end]) continue;
      const locks = [];
      for (let p = start; p <= end; p++) if (board[p - 1]) locks.push({ tile: board[p - 1], position: p - start + 1 });
      const length = end - start + 1, free = length - locks.length;
      if (!locks.length || free < 1 || free > rackSize) continue;
      if (BAD_FIRST.has(board[start - 1]) || BAD_LAST.has(board[end - 1])) continue;
      out.push({ start, end, length, free, locks });
    }
  }
  return out;
}

/** Solver request for one place on the row: rack tiles fill the empty cells, board tiles stay put. */
export function segmentRequest(rack, seg) {
  return {
    tiles: [...rack, ...seg.locks.map((l) => l.tile)],
    locks: seg.locks,
    mode: "partial",
    min_length: seg.length,
    max_length: seg.length,
  };
}

/** Bingo screen: equations made of exactly n rack tiles. */
export function rackRequest(rack, n) {
  return { tiles: rack, mode: "partial", min_length: n, max_length: n };
}

/**
 * One batch of a result group: run the jobs in order until `need` new equations are found.
 * jobs: [{request, start?, end?, taken}] (taken = equations of this job already shown).
 * seen: keys already shown ("start:equation"). Each job reports whether it can give more.
 */
export function runGroupBatch({ jobs, need, seen = [], rules = APP_RULES, timeoutSeconds = 10 }) {
  const seenSet = new Set(seen);
  const results = [];
  const report = [];
  let error = null;
  for (const job of jobs) {
    if (results.length >= need) break;
    let status, found = [];
    try {
      const req = parseRequest({ ...job.request, rules, max_results: Math.min(MAX_RESULTS_LIMIT, job.taken + need - results.length), timeout_seconds: timeoutSeconds });
      const out = solve(req);
      status = out.status;
      found = out.results;
    } catch (err) {
      if (!(err instanceof InputError)) throw err;
      status = "invalid";                       // e.g. "=" would be the first tile of this place
      if (jobs.length === 1) error = { code: err.code, message: err.message };
    }
    let added = 0;
    for (const r of found) {
      const key = `${job.start || 0}:${r.equation}`;
      if (seenSet.has(key)) continue;
      if (results.length >= need) break;
      seenSet.add(key);
      results.push({ key, equation: r.equation, start: job.start || null, end: job.end || null });
      added++;
    }
    report.push({ taken: job.taken + added, exhausted: status !== "limit_reached", timeout: status === "timeout" || status === "error" });
  }
  return { results, jobs: report, error };
}
