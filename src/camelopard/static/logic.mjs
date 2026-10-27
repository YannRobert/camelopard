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
// Beyond this many removed × added lines in one change, its lines are not compared for likeness (each comparison
// being a word diff of its own): they face each other row by row, none marked as edited.
export const DIFF_MAX_PAIRS = 20_000;
// What an unchanged blank line weighs when matching a change's lines, an edited line weighing its likeness.
export const DIFF_BLANK_WEIGHT = 0.01;

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
  return likeness(parts) >= DIFF_SIMILAR;
}

// The share of the longer of two lines that they have in common, from 0 to 1.
export function likeness(parts) {
  const length = type => parts.filter(p => p.type === type || p.type === "same").reduce((sum, p) => sum + p.text.length, 0);
  const kept = parts.filter(p => p.type === "same" && p.text.trim()).reduce((sum, p) => sum + p.text.length, 0);
  return kept / Math.max(length("del"), length("add"), 1);
}

// Blank lines are the commonest of lines: the line diff keeps them unchanged even between two changes, which
// cuts a rewritten passage into pieces too small for its lines to find their former versions (a list turned
// into a table, each item an edited line). A change, blank lines alone, then a change are one change, the blank
// lines on both sides of it.
function joinChanges(blocks) {
  const joined = [];
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const previous = joined.at(-1);
    const gap = block.type === "same" && block.lines.every(line => !line.text.trim());
    if (gap && previous?.type === "change" && blocks[i + 1]?.type === "change") {
      const next = blocks[++i];
      previous.del.push(...block.lines, ...next.del);
      previous.add.push(...block.lines, ...next.add);
    } else {
      joined.push(block);
    }
  }
  return joined;
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
  const joined = joinChanges(blocks);
  if (context === Infinity) return joined;
  return joined.flatMap((block, index) => {
    if (block.type !== "same") return [block];
    const head = index === 0 ? 0 : context;
    const tail = index === joined.length - 1 ? 0 : context;
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
// (parts: their word diff), otherwise each alone; an unchanged blank line the change holds stays one row
// (same). Lines are matched in order, so that an edited line far down a rewritten passage still finds its
// former version; among the ways to match them, the one keeping the most text in common wins, not the one
// with the most pairs: a line alike to two new ones faces the closer. Lines left alone on both sides still
// share rows, so that a side-by-side view lays a rewritten passage next to its former version.
export function pairLines(block) {
  const compare = block.del.length * block.add.length <= DIFF_MAX_PAIRS;
  const n = block.del.length;
  const m = block.add.length;
  const words = new Map();
  const wordsOf = (i, j) => words.get(i * m + j);
  // How much facing del[i] with add[j] is worth: 0 when they are not alike.
  const score = (i, j) => {
    const del = block.del[i];
    const add = block.add[j];
    // A blank line kept between two changes says nothing of what became of the text: it counts for little,
    // or it would make the passages either side of it face themselves rather than their former versions.
    if (del.type === "same" || add.type === "same") return del === add ? DIFF_BLANK_WEIGHT : 0;
    if (!compare) return 0;
    const parts = diffWords(
      del.text,
      add.text
    );
    const share = likeness(parts);
    if (share < DIFF_SIMILAR) return 0;
    words.set(
      i * m + j,
      parts
    );
    return share;
  };
  // best[i * (m + 1) + j]: the most that del[i…] and add[j…] can keep in common.
  const best = new Float64Array((n + 1) * (m + 1));
  const scores = new Float64Array(n * m);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      scores[i * m + j] = score(
        i,
        j
      );
      best[i * (m + 1) + j] = Math.max(
        best[(i + 1) * (m + 1) + j],
        best[i * (m + 1) + j + 1],
        scores[i * m + j] && scores[i * m + j] + best[(i + 1) * (m + 1) + j + 1]
      );
    }
  }
  const rows = [];
  const dels = [];
  const adds = [];
  // A rewritten passage reads removed then added.
  const flush = () => {
    rows.push(...dels.splice(0), ...adds.splice(0));
  };
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    const here = best[i * (m + 1) + j];
    if (i < n && j < m && scores[i * m + j] && here === scores[i * m + j] + best[(i + 1) * (m + 1) + j + 1]) {
      flush();
      rows.push(block.del[i] === block.add[j]
        ? { same: block.del[i], del: null, add: null, parts: null }
        : { del: block.del[i], add: block.add[j], parts: wordsOf(i, j) });
      i++;
      j++;
    } else if (j >= m || (i < n && here === best[(i + 1) * (m + 1) + j])) {
      dels.push({ del: block.del[i++], add: null, parts: null });
    } else {
      adds.push({ del: null, add: block.add[j++], parts: null });
    }
  }
  flush();
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
      const [del, add] = [dels[k] ?? null, adds[k] ?? null];
      // Matching lines in order leaves some blank lines out (nothing to tell one from another): facing each
      // other, they read unchanged.
      const blank = del && add && !del.text.trim() && !add.text.trim();
      merged.push({ del, add, parts: blank ? [{ type: "same", text: "" }] : null });
    }
  }
  return merged;
}

// Comments and history entries in one stream, newest first: a comment followed by the changes its author
// made right after reads in order, which Jira shows in two separate tabs. Each entry keeps its index in
// its own list, for the page to render it as it renders that list. Jira stamps a comment and the status
// change made with it at the same second: the change is then the newer one, the comment came with it.
export function timeline(
  comments,
  histories
) {
  return [
    ...comments.map((entry, index) => ({ kind: "comment", index, at: Date.parse(entry.created) })),
    ...histories.map((entry, index) => ({ kind: "history", index, at: Date.parse(entry.created) })),
  ].sort((a, b) => b.at - a.at
    || (a.kind === b.kind ? b.index - a.index : a.kind === "history" ? -1 : 1));
}

// The latest change of a field in an issue's history, by whom and when: who moved the issue to its status or
// assigned it is what one scrolls the history for. Jira lists the history oldest first; null when the field
// never changed (still as created).
export function lastFieldChange(
  histories,
  field
) {
  for (let i = histories.length - 1; i >= 0; i--) {
    if (histories[i].items?.some(item => item.field === field)) {
      return { author: histories[i].author ?? null, at: Date.parse(histories[i].created) };
    }
  }
  return null;
}

// The changes the activity list shows, by whom: someone else's ("others"), the user's own ("mine") or
// everyone's ("all"). An issue with none left is left out.
export const ACTIVITY_SCOPES = ["others", "mine", "all"];

export function activityBy(
  issues,
  scope,
  isMine
) {
  const kept = scope === "mine" ? isMine : scope === "all" ? () => true : change => !isMine(change);
  return issues
    .map(issue => ({ ...issue, changes: issue.changes.filter(kept) }))
    .filter(issue => issue.changes.length);
}

// The issue a link points to, when it is Jira's own page of one (jiraWeb/browse/KEY): the page opens it in
// its panel rather than in a Jira tab. Null for any other link, a Jira page that is not an issue included.
const ISSUE_KEY = /^[A-Z][A-Z0-9_]*-\d+$/;

export function issueKeyOf(
  href,
  jiraWeb
) {
  let url, base;
  try {
    url = new URL(href);
    base = new URL(jiraWeb.replace(/\/*$/, "/"));
  } catch (ignored) {
    return null;
  }
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname + "browse/")) return null;
  const key = decodeURIComponent(url.pathname.slice(base.pathname.length + "browse/".length));
  return ISSUE_KEY.test(key) ? key : null;
}

// Values of one filter criterion over the issues, most frequent first, then by name: what the filters panel
// offers, each with how many issues it would show. An issue without one (no epic, no reporter) counts under "".
export function criterionValues(
  issues,
  valueOf,
  nameOf
) {
  const counts = new Map();
  for (const issue of issues) {
    const value = String(valueOf(issue) ?? "");
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts]
    .map(([value, count]) => ({ value, count, name: nameOf(value) }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

// As in Jira's basic search: the values picked for one criterion add up (OR), the criteria narrow (AND), and
// a criterion with nothing picked lets every issue through.
export function matchesCriteria(
  issue,
  picked,
  valueOf
) {
  return Object.entries(picked).every(([id, values]) => !values.size || values.has(String(valueOf[id](issue) ?? "")));
}
