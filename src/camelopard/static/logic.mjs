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
