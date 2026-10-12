// The page's pure logic: no screen, no state, no request. Kept apart so that it can be tested on its own
// (tests/js, with Node's built-in runner), the page importing it like any other module. .mjs: a module for
// Node as for the browser, without a package.json to say so.

// The status line's age is redrawn this often and, under SECONDS_SHOWN_MS, counted in steps of this size:
// "10 s" tells a refresh just made from one a minute old, without a counter ticking every second. Past a
// minute it keeps moving rather than stay at "1 min" for a minute, which looks stuck.
export const STATUS_TICK_MS = 5 * 1000;
export const SECONDS_SHOWN_MS = 2 * 60 * 1000;

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

export function compactDuration(ms) {
  const minutes = Math.max(0, Math.floor(ms / 60000));
  const step = STATUS_TICK_MS / 1000;
  const seconds = Math.max(0, Math.floor(ms / STATUS_TICK_MS)) * step;
  if (ms < SECONDS_SHOWN_MS) return seconds ? `${seconds} s` : `< ${step} s`;
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h${minutes % 60 ? String(minutes % 60).padStart(2, "0") : ""}`;
  const rest = hours % 24;
  return `${Math.floor(hours / 24)} d${rest ? ` ${rest}h` : ""}`;
}

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function toJiraDate(iso) {
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, "0");
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

// Default sprint: the most recently started active sprint (Jira dates as dd/mm/yyyy hh:mm).
export function latestSprint(sprints) {
  const started = s => {
    const m = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})/.exec(s.start ?? "");
    return m ? Date.UTC(m[3], m[2] - 1, m[1], m[4], m[5]) : 0;
  };
  return [...sprints].sort((a, b) => started(b) - started(a) || b.id - a.id)[0]?.id ?? null;
}

// Since the start of the previous working day: on Monday, Friday's changes are still news.
export function standupSince(now = new Date()) {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  do day.setDate(day.getDate() - 1); while (day.getDay() === 0 || day.getDay() === 6);
  return day.getTime();
}

// Accents and case ignored: "Réglé" is found by "regle".
export const normalize = text => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const SEARCH_ALIASES = { prio: "priority", labels: "label", who: "assignee" };
// [-][field:]("quoted value"|word); an unclosed quote runs to the end, as the value is still being typed.
const SEARCH_TERM = /(-?)(?:([a-z]+):)?(?:"([^"]*)"?|(\S+))/gi;

// "-label:back @alice "in progress"" → [{negate, field, value}]. An unknown prefix ("http:", "ABC:")
// stays a plain word. fields: the keywords understood, as the keys of an object (the page's matchers).
export function parseSearch(
  query,
  fields
) {
  const known = field => Object.hasOwn(fields, field);
  const terms = [];
  for (const [, minus, prefix, quoted, bare] of query.matchAll(SEARCH_TERM)) {
    let field = prefix && searchField(prefix);
    let value = quoted ?? bare;
    // "type:" alone: a keyword still being typed filters nothing yet.
    if (!prefix && /^[a-z]+:$/i.test(value) && known(searchField(value.slice(0, -1)))) continue;
    if (field && !known(field)) {
      value = `${prefix}:${value}`;
      field = null;
    }
    if (!field && quoted === undefined && value.length > 1 && value.startsWith("@")) {
      field = "assignee";
      value = value.slice(1);
    }
    value = normalize(value).trim();
    if (value && value !== "-") terms.push({ negate: !!minus, field, value });
  }
  return terms;
}

const searchField = prefix => SEARCH_ALIASES[prefix.toLowerCase()] ?? prefix.toLowerCase();

// ---------- Text diff, for the history's long values (a description rewritten) ----------

// Beyond this many comparisons (items before × items after, once the common start and end are set aside),
// matching would freeze the page: the whole span is then shown as removed, then added.
export const DIFF_MAX_CELLS = 4_000_000;
// Unchanged lines kept around each change, as git does; the rest folds into "n unchanged lines".
export const DIFF_CONTEXT = 3;
// Two lines are shown as one edited line, their changed words marked, only when they share at least this
// share of their characters: marking most of a line rewritten whole hides it rather than shows it.
export const DIFF_SIMILAR = 0.5;

// Longest common subsequence of two arrays → [type, indexBefore, indexAfter], "del" before "add" within a
// change so that a rewritten line reads removed then added.
function matchItems(
  before,
  after,
  same
) {
  const ops = [];
  let start = 0;
  while (start < before.length && start < after.length && same(before[start], after[start])) {
    ops.push(["same", start, start]);
    start++;
  }
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && same(before[endBefore - 1], after[endAfter - 1])) {
    endBefore--;
    endAfter--;
  }
  const n = endBefore - start;
  const m = endAfter - start;
  if (n * m > DIFF_MAX_CELLS) {
    for (let i = start; i < endBefore; i++) ops.push(["del", i, null]);
    for (let j = start; j < endAfter; j++) ops.push(["add", null, j]);
  } else {
    // lengths[i * (m + 1) + j]: longest common run of before[start + i…] and after[start + j…].
    const lengths = new Uint32Array((n + 1) * (m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lengths[i * (m + 1) + j] = same(before[start + i], after[start + j])
          ? lengths[(i + 1) * (m + 1) + j + 1] + 1
          : Math.max(lengths[(i + 1) * (m + 1) + j], lengths[i * (m + 1) + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    const dels = [];
    const adds = [];
    const flush = () => {
      ops.push(...dels.splice(0), ...adds.splice(0));
    };
    while (i < n || j < m) {
      if (i < n && j < m && same(before[start + i], after[start + j])) {
        flush();
        ops.push(["same", start + i, start + j]);
        i++;
        j++;
      } else if (j >= m || (i < n && lengths[(i + 1) * (m + 1) + j] >= lengths[i * (m + 1) + j + 1])) {
        dels.push(["del", start + i++, null]);
      } else {
        adds.push(["add", null, start + j++]);
      }
    }
    flush();
  }
  for (let k = 0; endBefore + k < before.length; k++) ops.push(["same", endBefore + k, endAfter + k]);
  return ops;
}

// Jira returns the same description with "\r\n" or "\n" from one save to the next: only the text counts.
const textLines = text => text ? String(text).replace(/\r\n?/g, "\n").split("\n") : [];

// Line by line, ignoring line endings and trailing spaces → [{type: "same"|"del"|"add", text, before,
// after}], before and after being 1-based line numbers (null on the side the line is missing from).
export function diffLines(
  before,
  after
) {
  const a = textLines(before);
  const b = textLines(after);
  return matchItems(
    a,
    b,
    (x, y) => x.trimEnd() === y.trimEnd()
  ).map(([type, i, j]) => ({
    type,
    text: type === "add" ? b[j] : a[i],
    before: i === null ? null : i + 1,
    after: j === null ? null : j + 1,
  }));
}

const WORD = /\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu;

// Word by word, within one edited line → [{type, text}], neighbours of the same type merged.
export function diffWords(
  before,
  after
) {
  const a = before.match(WORD) ?? [];
  const b = after.match(WORD) ?? [];
  const parts = [];
  for (const [type, i, j] of matchItems(a, b, (x, y) => x === y)) {
    const text = type === "add" ? b[j] : a[i];
    if (parts.at(-1)?.type === type) parts.at(-1).text += text;
    else parts.push({ type, text });
  }
  return parts;
}

// Whether two lines are one line edited (its changed words worth marking) rather than two different lines.
export function similarLines(parts) {
  const length = type => parts.filter(p => p.type === type || p.type === "same").reduce((sum, p) => sum + p.text.length, 0);
  const kept = parts.filter(p => p.type === "same" && p.text.trim()).reduce((sum, p) => sum + p.text.length, 0);
  return kept >= DIFF_SIMILAR * Math.max(length("del"), length("add"), 1);
}

// The lines in blocks: {type: "same", lines} or {type: "change", del, add}; with a context, the middle of a
// long unchanged block becomes {type: "skip", lines}, still holding its lines to unfold them.
export function diffBlocks(
  lines,
  context = Infinity
) {
  const blocks = [];
  for (const line of lines) {
    const kind = line.type === "same" ? "same" : "change";
    let block = blocks.at(-1);
    if (block?.type !== kind) {
      block = kind === "same" ? { type: "same", lines: [] } : { type: "change", del: [], add: [] };
      blocks.push(block);
    }
    (kind === "same" ? block.lines : block[line.type]).push(line);
  }
  if (context === Infinity) return blocks;
  return blocks.flatMap((block, index) => {
    if (block.type !== "same") return [block];
    const head = index === 0 ? 0 : context;
    const tail = index === blocks.length - 1 ? 0 : context;
    // Folding fewer lines than the fold's own line saves nothing.
    if (block.lines.length <= head + tail + 1) return [block];
    return [
      { type: "same", lines: block.lines.slice(0, head) },
      { type: "skip", lines: block.lines.slice(head, block.lines.length - tail) },
      { type: "same", lines: block.lines.slice(block.lines.length - tail) },
    ].filter(part => part.lines.length);
  });
}

export function diffStats(lines) {
  return {
    added: lines.filter(line => line.type === "add").length,
    removed: lines.filter(line => line.type === "del").length,
  };
}

// A change block's lines as rows: a removed line next to the added line it became, when they are alike
// (parts: their word diff), otherwise each alone. Lines left alone on both sides still share rows, so that a
// side-by-side view lays a rewritten passage next to its former version.
export function pairLines(block) {
  const rows = [];
  let next = 0;
  for (const del of block.del) {
    let match = -1;
    let parts = null;
    for (let k = next; k < block.add.length && match < 0; k++) {
      const candidate = diffWords(
        del.text,
        block.add[k].text
      );
      if (similarLines(candidate)) {
        match = k;
        parts = candidate;
      }
    }
    if (match < 0) {
      rows.push({ del, add: null, parts: null });
      continue;
    }
    while (next < match) rows.push({ del: null, add: block.add[next++], parts: null });
    rows.push({ del, add: block.add[next++], parts });
  }
  while (next < block.add.length) rows.push({ del: null, add: block.add[next++], parts: null });
  // Removed lines alone followed by added lines alone: side by side, row by row.
  const merged = [];
  for (let i = 0; i < rows.length;) {
    if (rows[i].parts || !rows[i].del) {
      merged.push(rows[i++]);
      continue;
    }
    const dels = [];
    while (i < rows.length && rows[i].del && !rows[i].add) dels.push(rows[i++].del);
    const adds = [];
    while (i < rows.length && rows[i].add && !rows[i].del) adds.push(rows[i++].add);
    for (let k = 0; k < Math.max(dels.length, adds.length); k++) {
      merged.push({ del: dels[k] ?? null, add: adds[k] ?? null, parts: null });
    }
  }
  return merged;
}
