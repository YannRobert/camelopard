// The page's behaviour: the board, the detail, the filters, the keys. Its pure logic lives in logic.mjs.
import {
  compactDuration,
  diffBlocks,
  DIFF_CONTEXT,
  diffLines,
  diffStats,
  diffWords,
  escapeHtml,
  formatSize,
  latestSprint,
  normalize,
  pairLines,
  parseSearch,
  standupSince,
  STATUS_TICK_MS,
  toJiraDate,
} from "./logic.mjs";

const CONFIG = JSON.parse(document.getElementById("config").textContent);
// Accounts acting on their own, Jira's automation rules: nothing in Jira tells them from a person.
const AUTOMATION = new Set((CONFIG.automation ?? []).map(login => login.toLowerCase()));
const isAutomation = login => !!login && AUTOMATION.has(login.toLowerCase());
// Custom fields by role (storyPoints, developer…): their id differs from one Jira instance to another. A
// role missing from the configuration is simply not shown.
const custom = (fields, role) => CONFIG.fields?.[role] ? fields?.[CONFIG.fields[role]] : undefined;
// No request while the page is hidden.
const AUTO_REFRESH_MS = 5 * 60 * 1000;
const AUTO_REFRESH_KEY = "sprint-board.autoRefresh";
const FRESHNESS_SEGMENTS = 5;
// When coming back to the tab, data older than this is refreshed right away.
const STALE_ON_FOCUS_MS = 30 * 1000;
// Quick filters, current user and board name: they almost never change.
const META_TTL_MS = 12 * 3600 * 1000;
// Local copy synced more recently than this: no new Jira call when opening. The server applies the same
// threshold to its copy on disk, which the background sync may have refreshed in the meantime.
const DETAIL_FRESH_MS = 30 * 1000;
// Visible page: the server is asked what its background sync found (without calling Jira), and the open
// detail is read again from the local copy. Asking also tells the server someone is watching: it then
// checks Jira every 30 s instead of every 5 minutes.
const CHANGES_POLL_MS = 15 * 1000;
// After a move, Jira may change the issue on its own: a post-function at once (already in the answer to the
// move), an automation rule a few seconds later (assigning whoever moved it, for instance). The issue is
// read again after these delays, one Jira request each, and its card updated without reloading the board.
const FOLLOW_UP_DELAYS_MS = [5 * 1000, 20 * 1000];
// A stopped server is not always refused: behind WSL's localhost forwarding, the connection just hangs.
// Every request therefore has a deadline. Local reads (the copy on disk, /changes, /stats) answer at
// once; a Jira read is bounded by the server's own Jira timeout (30 s); a move may chain several
// transitions.
const LOCAL_TIMEOUT_MS = 5 * 1000;
const JIRA_READ_TIMEOUT_MS = 45 * 1000;
const WRITE_TIMEOUT_MS = 2 * 60 * 1000;
// Notifications when someone else changes one of my issues. A hidden page keeps asking /changes, with
// watch=0: the server's sync does not speed up for a page nobody looks at, so a change then takes up to
// --sync-interval (5 min) to show.
const NOTIFY_KEY = "sprint-board.notify";
// Jira's "updated" date is the time of the last change: a history entry or comment further from it is
// not the change that was found (a work log, for instance), and its author cannot be told.
const NOTIFY_MATCH_MS = 60 * 1000;
const NOTIFY_TEXT_LENGTH = 160;
// "Since your last visit": a visit ends once the page has gone unseen for VISIT_GAP_MS. A reload, or a
// coffee break, keeps the same list; coming back the next morning starts a new one.
const LAST_SEEN_KEY = "sprint-board.lastSeen";
const VISIT_SINCE_KEY = "sprint-board.visitSince";
const VISIT_GAP_MS = 60 * 60 * 1000;
const ERROR_FLASH_MS = 8000;
const INFO_FLASH_MS = 2500;
const DETAIL_CACHE_SIZE = 80;
const HOVER_PREFETCH_MS = 120;
// Asking Jira for people is a request: only after a pause in typing, from a few letters, and only when
// nobody known to the page matches (otherwise on demand, through the "Search Jira" entry).
const PEOPLE_SEARCH_DELAY_MS = 300;
const PEOPLE_SEARCH_MIN_CHARS = 2;
const PEOPLE_SEARCH_SIZE = 20;
// Labels shown upfront as buttons; the others go in the drop-down list.
const TOP_LABELS = 5;
// Up to this many labels in the sprint, all of them are buttons: a list would hide too few to be worth a click.
const LABELS_ALL_AS_BUTTONS = 15;
// A label carried by more than this share of the sprint filters too little to earn a button by default.
const BROAD_LABEL_SHARE = 0.4;
// The user's label usage: each click adds 1 to a score that loses half its value every
// LABEL_USAGE_HALF_LIFE_MS — frequency and recency in a single number.
const LABEL_USAGE_KEY = "sprint-board.labelUsage";
const LABEL_USAGE_HALF_LIFE_MS = 7 * 24 * 3600 * 1000;
const LABEL_USAGE_SIZE = 60;
// Remembered order of the label buttons: scores decide who gets in and who gets out, never who moves
// ahead of whom — a button never moves under the cursor.
const LABEL_ORDER_KEY = "sprint-board.labelOrder";
const LABEL_ORDER_SIZE = 40;
const AGILE_PAGE_SIZE = 50;
const SNAPSHOT_KEY = `sprint-board.${CONFIG.boardId}`;
const SNAPSHOT_VERSION = 1;
const REFRESH_LOCK = `sprint-board.${CONFIG.boardId}.refresh`;
const ALL_DATA = `rest/greenhopper/1.0/xboard/work/allData.json?rapidViewId=${CONFIG.boardId}`;
// Jira Server's epic label palette (ghx-label-N classes).
const EPIC_COLORS = {
  "ghx-label-1": "#b39578", "ghx-label-2": "#ffc400", "ghx-label-3": "#ffe380", "ghx-label-4": "#79a6ff",
  "ghx-label-5": "#a3bfde", "ghx-label-6": "#abf5d1", "ghx-label-7": "#e5a3d1", "ghx-label-8": "#c0b6f2",
  "ghx-label-9": "#ff8f73", "ghx-label-10": "#b3d4ff", "ghx-label-11": "#79e2f2", "ghx-label-12": "#c1c7d0",
  "ghx-label-13": "#57d9a3", "ghx-label-14": "#ff7452",
};
const THEME_KEY = "sprint-board.theme";
const VIEW_KEY = "sprint-board.view";
// Colleagues' quick filters shown as buttons up to this many; past it, they go in one list.
const PEOPLE_AS_BUTTONS = 4;
// In the URL's quick filters, beside the board's ids: someone on the board none of its filters names.
const DETECTED_PREFIX = "@";
// Past this many issues, the bell's count reads "99+": the exact number is in its title and panel.
const ACTIVITY_BADGE_MAX = 99;
// Cards side by side in a column (the .board.lanes and .cards rules): a card's narrowest width, the gap
// between two cards, and the board's gap and column margin once they sit side by side.
const LANE_MIN_REM = 15;
const LANE_GAP_REM = 0.4;
const LANES_BOARD_GAP_REM = 1.25;
const LANES_PADDING_REM = 0.75;
// Room kept between a header panel and the window's edge.
const POPOVER_MARGIN_PX = 8;
// Room kept between the last filter shown and the "+N more" button.
const FILTERS_GAP_PX = 8;
const DOCK_KEY = "sprint-board.panelDock";
const PANEL_HEIGHT_KEY = "sprint-board.panelHeight";
// How a long value's change shows in its dialog: "unified" (one column, as git diff) or "split" (side by
// side). Without a choice yet, side by side when the window leaves each half room for a sentence.
const DIFF_LAYOUT_KEY = "sprint-board.diffLayout";
const DIFF_SPLIT_MIN_WIDTH = 1100;
// Bounds of the detail height at the bottom, as a fraction of the window.
const PANEL_MIN_HEIGHT = 0.2;
const PANEL_MAX_HEIGHT = 0.8;
// Board views, declared in the configuration (views): a board with many columns is split, for instance,
// into Dev and QA. Each view starts at its `from` column and stops at the next view; a whole-board view is
// added. Without configuration, no selector: a board with a few columns fits on the screen.
// The first view is the default one; keys 1, 2, 3… follow the order.
const VIEWS = CONFIG.views?.length
  ? [...CONFIG.views.map((v, index) => ({ id: String(index), label: v.label, from: v.from })), { id: "all", label: "All" }]
    .map((v, index) => ({ ...v, key: String(index + 1) }))
  : [];
const ASSIGNEE_IS_ME = /^\s*assignee\s*(?:=\s*currentUser\(\)|in\s*\(\s*currentUser\(\)\s*\))\s*$/i;
const ASSIGNEE_IS = /^\s*assignee\s*=\s*(?:"([^"]+)"|([\w.@-]+))\s*$/i;
const ASSIGNEE_NOT_IN = /^\s*assignee\s+not\s+in\s*\(([^)]*)\)\s*$/i;
const ASSIGNEE_EMPTY = /^\s*assignee\s+(?:is\s+(?:empty|null)|=\s*(?:empty|null))\s*$/i;
// "labels = x", "issuetype in (Bug, Task)": what the board already shows, so the page evaluates them instead
// of asking Jira for a whole board. Type ids ("issuetype = 1") are left to Jira.
const FIELD_IS = /^\s*(labels|issuetype|type)\s*(?:=\s*(?:"([^"]+)"|([\w.-]+))|in\s*\(([^)]*)\))\s*$/i;

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);

const state = {
  // Issues changed in Jira lately, {key: epoch milliseconds}, as GET /changes lists them.
  recent: {},
  // The last /changes answer compared, null until the first: what changed before the page opened is
  // not news.
  seenChanges: null,
  // Start of the current visit (epoch ms), and what changed since then: GET /activity, from the local copy.
  visitSince: null,
  activity: [],
  // Stand-up mode: {people: [login, …, null for unassigned], index of the person speaking or null, spoke: a
  // Set of indexes, since, activity, touched: keys of the issues the person speaking changed since then},
  // or null.
  standup: null,
  notify: readPreference(NOTIFY_KEY) === "true" && window.Notification?.permission === "granted",
  meta: null,
  boards: {},
  defaultSprint: null,
  sprintId: Number(params.get("sprint")) || null,
  quick: new Set((params.get("qf") || "").split(",").filter(Boolean).map(quickId)),
  // Quick filters whose issues are being asked to Jira.
  filtersLoading: new Set(),
  labelOrder: readLabelOrder(),
  labels: new Set((params.get("lb") || "").split(",").filter(Boolean).map(label => label.toLowerCase())),
  q: params.get("q") || "",
  refreshing: null,
  lastFailure: null,
  timer: null,
  detail: new Map(),
  detailLoading: new Map(),
  openKey: null,
  // Issues picked with Ctrl + click, besides the open one: Ctrl+C copies them all.
  picked: new Set(),
  // A bulk assignment or move running: the bar waits for it before taking another one.
  bulkBusy: false,
  // Where a Shift + click range starts: the last issue opened or picked with Ctrl + click.
  pickAnchor: null,
  detailSyncing: null,
  picker: null,
  assigning: new Set(),
  autoRefresh: readPreference(AUTO_REFRESH_KEY) !== "false",
  // The popover of the filters past the end of their line.
  filtersOpen: false,
  // The assignee list, while open: its entries and the one the keyboard is on.
  peopleMenu: null,
  peopleEntries: [],
  dock: readPreference(DOCK_KEY) === "bottom" ? "bottom" : "side",
  // Not remembered across reloads: a maximized detail hides the board the page opens on.
  maximized: false,
  // The size to go back to when the detail closes, after a middle click enlarged it for one issue only.
  sizeBeforeMiddle: null,
  view: VIEWS.some(v => v.id === readPreference(VIEW_KEY)) ? readPreference(VIEW_KEY) : VIEWS[0]?.id ?? "all",
};

function readPreference(key) {
  try {
    return localStorage.getItem(key);
  } catch (ignored) {
    return null;
  }
}

function savePreference(
  key,
  value
) {
  try {
    localStorage.setItem(key, value);
  } catch (ignored) { /* storage unavailable: the choice holds for this page only */ }
}

// ---------- Jira access ----------

// A request to the local server with a deadline. A network failure means the server is gone; a timeout
// may only be Jira being slow, so it is left to the /changes poll to decide.
async function request(
  path,
  { timeout, ...options }
) {
  try {
    return await fetch(
      path,
      { ...options, signal: AbortSignal.timeout(timeout) }
    );
  } catch (error) {
    if (error.name === "TimeoutError") throw new Error(`no answer from the local server after ${Math.round(timeout / 1000)} s`);
    setServerReachable(false);
    throw new Error("the local server cannot be reached");
  }
}

function setServerReachable(reachable) {
  const banner = $("offline");
  if (banner.hidden === reachable) return;
  banner.hidden = reachable;
  if (reachable) flashInfo("The local server answers again");
}

async function jira(path) {
  for (let attempt = 0; ; attempt++) {
    const response = await request(
      "/jira/" + path,
      { timeout: JIRA_READ_TIMEOUT_MS }
    );
    // Jira sometimes returns transient 500s: a second attempt is almost always enough.
    if (response.status >= 500 && attempt === 0) continue;
    if (!response.ok) {
      let message = response.statusText;
      try {
        const body = await response.json();
        message = body.message || body.errorMessages?.join(", ") || message;
      } catch (ignored) { /* non-JSON body */ }
      throw new Error(`${response.status} ${message}`);
    }
    return response.json();
  }
}

// Jira image URLs require authentication: they go through the relay.
function relayed(url) {
  if (!url) return url;
  if (url.startsWith(CONFIG.jiraWeb + "/")) return "/jira/" + url.slice(CONFIG.jiraWeb.length + 1);
  if (url.startsWith("/") && !url.startsWith("//")) return "/jira" + url;
  return url;
}

const browseUrl = key => `${CONFIG.jiraWeb}/browse/${encodeURIComponent(key)}`;

// ---------- Loading ----------

async function ensureMeta() {
  if (state.meta && Date.now() - state.meta.at < META_TTL_MS) return;
  const [model, me] = await Promise.all([
    jira(`rest/greenhopper/1.0/rapidviewconfig/editmodel.json?rapidViewId=${CONFIG.boardId}`),
    jira("rest/api/2/myself"),
  ]);
  state.meta = {
    at: Date.now(),
    boardName: model.name ?? model.rapidView?.name ?? `Board ${CONFIG.boardId}`,
    me: me.name,
    meName: me.displayName,
    meAvatar: me.avatarUrls?.["48x48"] ?? null,
    quickFilters: (model.quickFilterConfig?.quickFilters ?? []).map(f => ({ id: f.id, name: f.name, query: f.query, description: f.description })),
  };
}

// A quick filter on the assignee ("= X", "not in (…)", "is EMPTY"), the labels or the issue type is
// evaluated in the page, as a predicate (issue, board); any other JQL is evaluated by Jira, which returns
// the matching issues (null here): beyond these simple forms, the JQL is never approximated.
function clientPredicate(filter) {
  if (ASSIGNEE_IS_ME.test(filter.query)) {
    return issue => Boolean(issue.assignee) && issue.assignee.toLowerCase() === state.meta.me.toLowerCase();
  }
  const match = filter.query.match(ASSIGNEE_IS);
  if (match) {
    const who = (match[1] ?? match[2]).toLowerCase();
    return issue => Boolean(issue.assignee) && issue.assignee.toLowerCase() === who;
  }
  // Jira excludes unassigned issues from an "assignee not in (…)": such a board filter for unassigned work
  // returns nothing. Here, unassigned counts as "not one of them", which is what the filter means.
  const excluded = filter.query.match(ASSIGNEE_NOT_IN);
  if (excluded) {
    const team = new Set(excluded[1].split(",").map(name => name.trim().replace(/^"|"$/g, "").toLowerCase()));
    return issue => !issue.assignee || !team.has(issue.assignee.toLowerCase());
  }
  if (ASSIGNEE_EMPTY.test(filter.query)) return issue => !issue.assignee;
  const field = filter.query.match(FIELD_IS);
  if (field) {
    const values = (field[4]?.split(",") ?? [field[2] ?? field[3]]).map(value => value.trim().replace(/^"|"$/g, ""));
    if (field[1].toLowerCase() === "labels") {
      // Case kept: boards list "front" and "FRONT" in the same filter to get both, so Jira tells them apart
      // (unlike the page's label buttons, which merge them on purpose).
      return issue => (issue.labels ?? []).some(label => values.includes(label));
    }
    const types = values.map(value => value.toLowerCase());
    if (types.every(value => !/^\d+$/.test(value))) {
      return (issue, board) => types.includes((board.types[issue.typeId]?.name ?? "").toLowerCase());
    }
  }
  return null;
}

async function fetchBoard(sprintId) {
  const [raw, localLabels, filterKeys] = await Promise.all([
    jira(`${ALL_DATA}&activeSprints=${sprintId}`),
    readLocalLabels(),
    fetchFilterKeys(
      sprintId,
      state.meta.quickFilters.filter(f => state.quick.has(f.id) && !clientPredicate(f))
    ),
  ]);
  const board = toBoard(
    raw,
    sprintId
  );
  board.filterKeys = filterKeys;
  // An issue the local copy does not have yet (first start, issue just added to the sprint): Jira gives
  // the labels of the whole sprint, as before the local copy had them.
  const labels = board.issues.every(issue => localLabels.has(issue.key)) ? localLabels : await fetchLabels(sprintId);
  for (const issue of board.issues) issue.labels = labels.get(issue.key) ?? [];
  return board;
}

// Labels of the issues of the local copy, which the background sync keeps up to date: no Jira request.
async function readLocalLabels() {
  try {
    const response = await request(
      "/labels",
      { timeout: LOCAL_TIMEOUT_MS }
    );
    return response.ok ? new Map(Object.entries((await response.json()).labels)) : new Map();
  } catch (ignored) {
    return new Map();
  }
}

// The issues of the quick filters Jira evaluates, {filter id: keys}. Each costs a whole board: only the
// filters in use are asked for, at refresh time, and the others when they are switched on.
async function fetchFilterKeys(
  sprintId,
  filters
) {
  const answers = await Promise.all(filters.map(f => jira(`${ALL_DATA}&activeSprints=${sprintId}&activeQuickFilters=${f.id}`)));
  return Object.fromEntries(filters.map((f, i) => [f.id, answers[i].issuesData.issues.map(issue => issue.key)]));
}

// A quick filter switched on without its issues (just clicked, or read from the URL on a board refreshed
// without it): asks Jira for them. Meanwhile the filter lets every issue through.
function loadMissingFilterKeys() {
  const board = currentBoard();
  if (!board || !state.meta) return;
  const missing = state.meta.quickFilters.filter(f =>
    state.quick.has(f.id) && !clientPredicate(f) && !board.filterKeys[f.id] && !state.filtersLoading.has(f.id));
  if (!missing.length) return;
  for (const f of missing) state.filtersLoading.add(f.id);
  fetchFilterKeys(
    board.sprintId,
    missing
  ).then(keys => {
    Object.assign(board.filterKeys, keys);
    saveSnapshot();
  }).catch(error => {
    for (const f of missing) state.quick.delete(f.id);
    writeUrl();
    flashError(`Quick filter unavailable: ${error.message}`);
  }).finally(() => {
    for (const f of missing) state.filtersLoading.delete(f.id);
    renderFilters();
    renderBoard();
  });
}

// allData.json does not carry labels: the agile API gives them for the whole sprint, in pages of 50.
async function fetchLabels(sprintId) {
  const labels = new Map();
  for (let startAt = 0; ; startAt += AGILE_PAGE_SIZE) {
    const page = await jira(`rest/agile/1.0/board/${CONFIG.boardId}/sprint/${sprintId}/issue?fields=labels&maxResults=${AGILE_PAGE_SIZE}&startAt=${startAt}`);
    for (const issue of page.issues) labels.set(issue.key, issue.fields.labels ?? []);
    if (!page.issues.length || startAt + page.issues.length >= page.total) return labels;
  }
}

// Sprint labels, from most to least frequent. "front" and "FRONT" are the same label typed twice: they
// are merged under the most used spelling.
function sprintLabels(board) {
  const byLabel = new Map();
  for (const issue of board.issues) {
    for (const label of new Set(issue.labels ?? [])) {
      const id = label.toLowerCase();
      const entry = byLabel.get(id) ?? { id, count: 0, spellings: new Map() };
      entry.count++;
      entry.spellings.set(label, (entry.spellings.get(label) ?? 0) + 1);
      byLabel.set(id, entry);
    }
  }
  return [...byLabel.values()]
    .map(({ id, count, spellings }) => ({ id, count, name: [...spellings].sort((a, b) => b[1] - a[1])[0][0] }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

// Keeps only what is displayed: the saved copy stays small, and reading it back at startup is instant.
function toBoard(
  raw,
  sprintId
) {
  const entities = raw.entityData;
  return {
    at: Date.now(),
    sprintId,
    sprints: raw.sprintsData.sprints.map(s => ({ id: s.id, name: s.name, start: s.startDate, end: s.endDate, days: s.daysRemaining, goal: s.goal })),
    columns: raw.columnsData.columns.map(c => ({ name: c.name, statusIds: c.statusIds })),
    issues: raw.issuesData.issues.filter(i => !i.hidden).map(i => ({
      key: i.key,
      summary: i.summary,
      typeId: i.typeId,
      priorityId: i.priorityId,
      statusId: i.statusId,
      done: i.done,
      assignee: i.assignee ?? null,
      assigneeName: i.assigneeName ?? null,
      avatar: i.avatarUrl ?? null,
      epicId: i.epicId ?? null,
      points: i.estimateStatistic?.statFieldValue?.value ?? null,
    })),
    types: mapValues(entities.types, t => ({ name: t.typeName, url: t.typeUrl })),
    priorities: mapValues(entities.priorities, p => ({ name: p.priorityName, url: p.priorityUrl })),
    statuses: mapValues(entities.statuses, s => ({ name: s.statusName, category: s.status?.statusCategory?.key })),
    epics: mapValues(entities.epics ?? {}, e => ({ key: e.epicField.epicKey, text: e.epicField.text, color: e.epicField.epicColor })),
    filterKeys: {},
  };
}

function mapValues(
  object,
  mapper
) {
  return Object.fromEntries(Object.entries(object ?? {}).map(([k, v]) => [k, mapper(v)]));
}

async function discoverDefaultSprint() {
  const active = await jira(`rest/agile/1.0/board/${CONFIG.boardId}/sprint?state=active`);
  return latestSprint(active.values.map(s => ({ id: s.id, start: s.startDate && toJiraDate(s.startDate) })));
}

// One refresh at a time; concurrent requests wait for the same one.
function refresh() {
  state.refreshing ??= doRefresh().finally(() => {
    state.refreshing = null;
    $("refresh").disabled = false;
    renderStatus();
    scheduleAutoRefresh();
  });
  $("refresh").disabled = true;
  renderStatus();
  return state.refreshing;
}

async function doRefresh() {
  try {
    await ensureMeta();
    state.defaultSprint ??= await discoverDefaultSprint();
    const sprintId = currentSprintId();
    const board = await fetchBoard(sprintId);
    state.boards[sprintId] = board;
    // A new sprint has started: switch to it, unless the URL explicitly asks for another one.
    const latest = latestSprint(board.sprints);
    const activeIds = new Set(board.sprints.map(s => s.id));
    for (const id of Object.keys(state.boards)) if (!activeIds.has(Number(id))) delete state.boards[id];
    const followDefault = !state.sprintId || state.sprintId === state.defaultSprint;
    state.defaultSprint = latest;
    if (followDefault && latest !== sprintId) {
      state.sprintId = null;
      state.boards[latest] = await fetchBoard(latest);
    }
    state.lastFailure = null;
    saveSnapshot();
    render();
    prefetchOtherSprints();
  } catch (error) {
    state.lastFailure = { at: Date.now(), message: error.message };
    if (!currentBoard()) showError(`Loading failed: ${error.message}`);
  }
}

// The other active sprints are loaded in the background: switching between them is then instant.
function prefetchOtherSprints() {
  const board = currentBoard();
  const others = board.sprints.filter(s => s.id !== board.sprintId && !(Date.now() - (state.boards[s.id]?.at ?? 0) < AUTO_REFRESH_MS));
  if (!others.length) return;
  const run = async () => {
    for (const s of others) {
      try {
        state.boards[s.id] = await fetchBoard(s.id);
      } catch (ignored) { /* best effort: it will be loaded on demand */ }
    }
    saveSnapshot();
    renderHeader();
  };
  (window.requestIdleCallback ?? setTimeout)(run);
}

const currentSprintId = () => state.sprintId ?? state.defaultSprint;
const currentBoard = () => state.boards[currentSprintId()];

// ---------- Saved copy, shared between tabs ----------

function saveSnapshot() {
  try {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({
      version: SNAPSHOT_VERSION,
      meta: state.meta,
      defaultSprint: state.defaultSprint,
      boards: state.boards,
    }));
  } catch (ignored) {
    forgetSnapshot();
  }
}

function readSnapshot() {
  try {
    const saved = JSON.parse(localStorage.getItem(SNAPSHOT_KEY));
    return saved?.version === SNAPSHOT_VERSION ? saved : null;
  } catch (ignored) {
    forgetSnapshot();
    return null;
  }
}

function forgetSnapshot() {
  try {
    localStorage.removeItem(SNAPSHOT_KEY);
  } catch (ignored) { /* storage unavailable: nothing to remove */ }
}

// Takes another tab's data if it is newer than what is displayed.
function adoptNewerSnapshot() {
  const saved = readSnapshot();
  if (!saved) return false;
  const shown = currentBoard()?.at ?? 0;
  state.meta ??= saved.meta;
  if (saved.meta && saved.meta.at > (state.meta?.at ?? 0)) state.meta = saved.meta;
  state.defaultSprint ??= saved.defaultSprint;
  for (const [id, board] of Object.entries(saved.boards ?? {})) {
    if (!state.boards[id] || board.at > state.boards[id].at) state.boards[id] = board;
  }
  const adopted = (currentBoard()?.at ?? 0) > shown;
  if (adopted) {
    render();
    scheduleAutoRefresh();
  }
  return adopted;
}

const age = () => Date.now() - (currentBoard()?.at ?? 0);

// Under a lock: all tabs open on the board share a single refresh.
async function sharedRefresh({ olderThan = 0 } = {}) {
  const run = async () => {
    adoptNewerSnapshot();
    if (currentBoard() && age() < olderThan) {
      scheduleAutoRefresh();
      return;
    }
    await refresh();
  };
  if (navigator.locks) await navigator.locks.request(REFRESH_LOCK, run);
  else await run();
}

// Next auto-refresh = last update + AUTO_REFRESH_MS: a manual refresh restarts the cycle. Hidden page: no
// request; refreshing resumes when coming back to the tab.
function scheduleAutoRefresh() {
  clearTimeout(state.timer);
  const board = currentBoard();
  state.timer = state.autoRefresh && board && !document.hidden
    ? setTimeout(() => sharedRefresh({ olderThan: AUTO_REFRESH_MS - 1000 }), Math.max(0, board.at + AUTO_REFRESH_MS - Date.now()))
    : null;
  renderFreshness();
}

// ---------- Rendering ----------

function render() {
  loadMissingFilterKeys();
  renderActivity();
  renderHeader();
  renderFilters();
  renderBoard();
  renderStatus();
}

function renderHeader() {
  const board = currentBoard();
  $("crumb").textContent = state.meta?.boardName ?? "";
  document.title = state.meta?.boardName ? `${sprintOf(board)?.name ?? "Sprint"} · Camelopard` : "Camelopard";
  $("open-jira").href = `${CONFIG.jiraWeb}/secure/RapidBoard.jspa?rapidView=${CONFIG.boardId}` + (board ? `&sprint=${board.sprintId}` : "");
  if (!board) return;
  const sprint = sprintOf(board);
  $("sprint-name").textContent = sprint?.name ?? "Sprint";
  // On a narrow window the name is cut short by the header's data: the tooltip gives it back whole.
  $("sprint-name").title = [
    sprint?.name,
    sprint?.goal
  ].filter(Boolean).join("\n");
  const select = $("sprint");
  select.hidden = board.sprints.length < 2;
  select.innerHTML = `<option value="" disabled>Change sprint</option>` + board.sprints
    .map(s => `<option value="${s.id}"${s.id === board.sprintId ? " selected" : ""}>${escapeHtml(s.name)}${state.boards[s.id] ? "" : " …"}</option>`)
    .join("");
  const remaining = $("remaining");
  remaining.classList.toggle("over", sprint?.days === 0);
  remaining.textContent = sprint ? (sprint.days > 0 ? `⏱ ${sprint.days} day${sprint.days > 1 ? "s" : ""} left` : `⏱ past due (${sprint.end?.slice(0, 10)})`) : "";
}

const sprintOf = board => board?.sprints.find(s => s.id === board.sprintId);

// The board's quick filters by their Jira id; "@login" for someone on the board the board's filters do not
// name: a filter on the assignee the page makes up and evaluates itself, never sent to Jira.
function quickId(text) {
  return text.startsWith(DETECTED_PREFIX) ? text : Number(text);
}

function quickFilter(id) {
  if (typeof id === "string") {
    const login = id.slice(DETECTED_PREFIX.length);
    return { id, name: login, query: `assignee = "${login}"`, description: "" };
  }
  return state.meta?.quickFilters.find(f => f.id === id);
}

// Who holds issues on the board without a filter of the board's on them: someone who joined after the
// filters were made, or whom nobody thought of. Automation accounts are no one to filter on.
function detectedFilters(
  board,
  filters
) {
  const named = new Set(filters.map(f => f.query.match(ASSIGNEE_IS)).filter(Boolean).map(m => (m[1] ?? m[2]).toLowerCase()));
  if (filters.some(isMyFilter)) named.add(state.meta.me.toLowerCase());
  const people = new Map();
  for (const issue of board?.issues ?? []) {
    const login = issue.assignee;
    if (!login || isAutomation(login) || named.has(login.toLowerCase()) || people.has(login.toLowerCase())) continue;
    people.set(login.toLowerCase(), { ...quickFilter(DETECTED_PREFIX + login), name: issue.assigneeName ?? login });
  }
  return [...people.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

function isPersonFilter(id) {
  const filter = quickFilter(id);
  return Boolean(filter) && [ASSIGNEE_IS_ME, ASSIGNEE_IS, ASSIGNEE_NOT_IN, ASSIGNEE_EMPTY].some(pattern => pattern.test(filter.query));
}

// The user's own filter: highlighted, to find oneself at a glance among the filters.
// The last letter of the first name is isolated: it carries the giraffe horns.
function myName(name) {
  const letters = Array.from(name);
  const end = letters.findIndex((letter, index) => index > 0 && /\s/.test(letter));
  const last = (end < 0 ? letters.length : end) - 1;
  if (last < 0) return escapeHtml(name);
  return escapeHtml(letters.slice(0, last).join("")) +
    `<span class="horned">${escapeHtml(letters[last])}</span>` +
    escapeHtml(letters.slice(last + 1).join(""));
}

// "assignee = <my login>" and Jira's "Only My Issues" (assignee = currentUser()), recognised by their query
// whatever their name or language: the same issues, so the page shows one of them only.
function isMyFilter(filter) {
  if (ASSIGNEE_IS_ME.test(filter.query)) return true;
  const match = filter.query.match(ASSIGNEE_IS);
  return Boolean(match && state.meta?.me) && (match[1] ?? match[2]).toLowerCase() === state.meta.me.toLowerCase();
}

// The board's name for the filter when it names the user, their first name when it is Jira's generic one.
function myFilterLabel(filter) {
  const firstName = (state.meta?.meName ?? "").trim().split(/\s+/)[0];
  return myName(ASSIGNEE_IS_ME.test(filter.query) && firstName ? firstName : filter.name);
}

// Jira shows quick filters in the order the board administrator created them, which means nothing. Here:
// the user's own first, then people in alphabetical order, then unassigned, then the rest in Jira's order.
function displayOrder(filters) {
  const rank = f => isMyFilter(f) ? -1 : ASSIGNEE_IS.test(f.query) ? 0 : isPersonFilter(f.id) ? 1 : 2;
  return filters
    .map((filter, index) => ({ filter, index }))
    .sort((a, b) => rank(a.filter) - rank(b.filter)
      || (rank(a.filter) === 0 ? a.filter.name.localeCompare(b.filter.name, undefined, { sensitivity: "base" }) : 0)
      || a.index - b.index)
    .map(({ filter }) => filter);
}

function switchOnFilter(id) {
  // An issue has only one assignee: two "person" filters combined with AND would empty the board.
  if (isPersonFilter(id)) for (const other of [...state.quick]) if (isPersonFilter(other)) state.quick.delete(other);
  state.quick.add(id);
}

function quickFiltersChanged() {
  writeUrl();
  loadMissingFilterKeys();
  renderFilters();
  renderBoard();
}

function renderFilters() {
  const board = currentBoard();
  const ordered = displayOrder(state.meta?.quickFilters ?? []);
  // A board often has both "assignee = <me>" and "Only My Issues": one button stands for them, the first.
  // A twin switched on (a link shared before) stands for it too.
  const twins = ordered.filter(isMyFilter).slice(1);
  for (const twin of twins) if (state.quick.delete(twin.id)) state.quick.add(ordered.find(isMyFilter).id);
  const filters = ordered.filter(f => !twins.includes(f));
  // One filter per colleague makes a long row of names to read through: past a few, they go in one list,
  // like the labels' "+N more". The user's own filter stays a button beside it, and only there.
  const named = filters.filter(f => ASSIGNEE_IS.test(f.query) && !isMyFilter(f));
  const listed = new Set(named.length > PEOPLE_AS_BUTTONS ? named.map(f => f.id) : []);
  const shown = filters.filter(f => !listed.has(f.id));
  const detected = detectedFilters(
    board,
    filters
  );
  const people = listed.size || detected.length ? peopleHtml(
    named.filter(f => listed.has(f.id)),
    detected
  ) : "";
  const labels = labelsHtml(board);
  const items = shown.map(f => ({
    person: isPersonFilter(f.id),
    html: `<button type="button" class="qf${isMyFilter(f) ? " me" : ""}" data-qf="${f.id}" aria-pressed="${state.quick.has(f.id)}" aria-busy="${state.filtersLoading.has(f.id)}" ` +
      `title="${escapeHtml(f.description || f.query)}">${isMyFilter(f) ? myFilterLabel(f) : escapeHtml(f.name)}</button>`,
  }));
  if (people) items.splice(shown.some(isMyFilter) ? 1 : 0, 0, { person: true, html: people });
  // The popover holds the previous rendering's filters: rebuilt from scratch, like the line.
  $("filters-more").replaceChildren();
  $("filters").innerHTML =
    (filters.length ? `<span class="label">Quick filters</span>` : "") +
    items.map((item, index) => (index > 0 && items[index - 1].person && !item.person ? `<span class="qf-sep" aria-hidden="true"></span>` : "") + item.html).join("") +
    (filters.length && labels ? `<span class="qf-sep labels-sep" aria-hidden="true"></span>` : "") + labels +
    `<button type="button" class="more-filters" id="more-filters" aria-controls="filters" hidden></button>`;
  // Typing in the search does not go through here: the field is only rewritten when the search changes
  // elsewhere (clear, shared link), so the caret never jumps.
  if ($("q").value !== state.q) $("q").value = state.q;
  $("count").textContent = board ? countText(board) : "";
  fitFilters();
}

// The filters keep to one line: a board with forty quick filters must not push the board down by five rows.
// A group (people, the board's other quick filters, labels) that does not fit goes whole, with those after it,
// behind a "+N" button: a group is never split between the line and the popover. A filter switched on in
// there shows on that button, so it is never on without the user seeing it.
function fitFilters() {
  const rail = $("filters");
  const more = $("more-filters");
  const popover = $("filters-more");
  if (!more) return;
  // Those moved to the popover by the previous fit come back in their place, to be measured again.
  for (const el of [...popover.children]) rail.insertBefore(el, more);
  const items = [...rail.children].filter(el => el !== more);
  items.forEach(el => { el.hidden = false; });
  more.hidden = true;
  if (rail.scrollWidth <= rail.clientWidth) {
    showMoreFilters(false);
    return;
  }
  more.hidden = false;
  more.textContent = "+ 99 more";
  const limit = rail.getBoundingClientRect().left + rail.clientWidth - more.offsetWidth - FILTERS_GAP_PX;
  const over = items.findIndex(el => el.getBoundingClientRect().right > limit);
  // Back to the start of the group that overflows: a separator, or the start of the line.
  let cut = Math.max(0, over);
  while (cut > 0 && !items[cut].matches(".qf-sep")) cut--;
  const hidden = over < 0 ? [] : items.slice(cut);
  // The separator opening the group has nothing before it in the popover: it stays, hidden, on the line.
  if (hidden[0]?.matches(".qf-sep")) hidden.shift().hidden = true;
  const count = hidden.reduce((sum, el) => sum + (el.id === "people-filter" ? Number(el.dataset.count)
    : el.matches("button") ? 1 : el.matches("select") ? el.options.length - 1 : 0), 0);
  const on = hidden.filter(el => el.getAttribute("aria-pressed") === "true" || el.matches(".people.active")).length;
  // The rest waits in a popover over the cards: opening it moves nothing on the page.
  popover.append(...hidden);
  more.classList.toggle("active", on > 0);
  more.textContent = (cut > 0 ? `+ ${count} more` : `${count} filters`) + (on ? ` · ${on} on` : "");
  more.title = on ? `${on} of the other filters ${on > 1 ? "are" : "is"} on` : "Show the other filters";
  showMoreFilters(state.filtersOpen);
}

// Open under the filters line, from its start to the window's right edge; picking a filter closes it.
function showMoreFilters(open) {
  const popover = $("filters-more");
  state.filtersOpen = open && popover.childElementCount > 0;
  popover.hidden = !state.filtersOpen;
  $("more-filters")?.setAttribute("aria-expanded", String(state.filtersOpen));
  if (state.filtersOpen) popover.style.left = `${$("filters").offsetLeft}px`;
  // A refresh or a resize may have rebuilt or moved the assignee button: its list follows it.
  if (state.peopleMenu) placePeopleMenu();
}

// The line's room changes with the window, and with the count beside it.
new ResizeObserver(fitFilters).observe($("filters"));

// Cards side by side when two fit in every column once the board takes the wider spacing of .board.lanes:
// decided from the board's width alone, so the spacing cannot take the second lane away and flip it back.
function fitLanes() {
  const board = $("board");
  const count = board.querySelectorAll(".column").length;
  if (!count) return;
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
  const column = (board.clientWidth - (count - 1) * LANES_BOARD_GAP_REM * rem) / count;
  board.classList.toggle(
    "lanes",
    column - 2 * LANES_PADDING_REM * rem >= (2 * LANE_MIN_REM + LANE_GAP_REM) * rem
  );
}

// The board's width changes with the window and the zoom (the base size follows the screen width too).
new ResizeObserver(fitLanes).observe($("board"));

// The colleagues' filters as one list: a native list cannot show the avatars, which tell apart people the
// board's filters name by a nickname. The button shows the one switched on.
// The board's filters first, in their order, then those the page found on the board, set apart.
function peopleHtml(
  named,
  detected
) {
  const people = [
    ...named.map(personEntry),
    ...detected.map((filter, index) => ({ ...personEntry(filter), detected: true, apart: index === 0 && named.length > 0 })),
  ];
  const on = people.find(p => state.quick.has(p.id));
  state.peopleEntries = [{ id: null, name: "Everyone" }, ...people];
  if (state.peopleMenu) state.peopleMenu.options = state.peopleEntries;
  const chevron = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9 L12 16 L19 9"/></svg>`;
  return `<button type="button" id="people-filter" class="more-labels people${on ? " active" : ""}" data-count="${people.length}" ` +
    `aria-haspopup="listbox" aria-controls="people-menu" aria-expanded="${Boolean(state.peopleMenu)}" title="Filter by assignee">` +
    (on ? `${avatar(on.login, on.fullName, on.avatar)}${escapeHtml(on.name)}` : `People · ${people.length}`) + `${chevron}</button>`;
}

// A filter's person: its login is in its query, whatever name the board gives the filter; name and photo come
// from the people the page already knows (no request), or initials from the filter's name.
function personEntry(filter) {
  const match = filter.query.match(ASSIGNEE_IS);
  const login = match[1] ?? match[2];
  const known = knownPeople().find(p => p.login.toLowerCase() === login.toLowerCase());
  return { id: filter.id, name: filter.name, login, fullName: known?.name ?? filter.name, avatar: known?.avatar ?? null };
}

function openPeopleMenu(open) {
  const menu = $("people-menu");
  if (!open) {
    if (!state.peopleMenu) return;
    state.peopleMenu = null;
    menu.hidden = true;
    $("people-filter")?.setAttribute("aria-expanded", "false");
    return;
  }
  const options = state.peopleEntries;
  state.peopleMenu = { options, active: Math.max(0, options.findIndex(p => p.id !== null && state.quick.has(p.id))) };
  $("people-filter").setAttribute("aria-expanded", "true");
  renderPeopleMenu();
  menu.hidden = false;
  placePeopleMenu();
  menu.focus();
}

function renderPeopleMenu() {
  const { options, active } = state.peopleMenu;
  // "Everyone" means no filter on the assignee at all: the user's own button or "Unassigned" beside the list
  // are filters on the assignee too, and picking "Everyone" switches them off.
  const anyOn = [...state.quick].some(isPersonFilter);
  $("people-menu").innerHTML = options.map((p, index) => {
    const selected = p.id === null ? !anyOn : state.quick.has(p.id);
    const content = p.id === null
      ? `<span class="name">Everyone</span>`
      : `${avatar(p.login, p.fullName, p.avatar)}<span class="name">${escapeHtml(p.name)}</span>` +
        `<span class="login">${escapeHtml(p.login)}</span>`;
    const classes = [p.id === null ? "everyone" : "", p.apart ? "apart" : "", index === active ? "active" : ""].filter(Boolean).join(" ");
    return `<li role="option" id="people-option-${index}" data-index="${index}" class="${classes}" ` +
      `aria-selected="${selected}"${p.detected ? ` title="On the board's issues, with no quick filter of the board's"` : ""}>${content}</li>`;
  }).join("");
  $("people-menu").setAttribute("aria-activedescendant", `people-option-${active}`);
  $(`people-option-${active}`)?.scrollIntoView({ block: "nearest" });
}

// Only the highlight moves: rebuilt at each move of the mouse, the list would reload every photo, drawn
// again over its initials.
function movePeopleActive(index) {
  const menu = $("people-menu");
  menu.querySelector("li.active")?.classList.remove("active");
  state.peopleMenu.active = index;
  const option = $(`people-option-${index}`);
  option?.classList.add("active");
  menu.setAttribute("aria-activedescendant", `people-option-${index}`);
  option?.scrollIntoView({ block: "nearest" });
}

// Under its button, wherever the button is (line or popover); closed when the button is no longer shown.
function placePeopleMenu() {
  const button = $("people-filter");
  const box = button?.getBoundingClientRect();
  if (!box?.width) {
    openPeopleMenu(false);
    return;
  }
  const menu = $("people-menu");
  const top = box.bottom + 4;
  menu.style.top = `${top}px`;
  menu.style.maxHeight = `${Math.max(window.innerHeight - top - 16, 160)}px`;
  menu.style.left = `${Math.max(8, Math.min(box.left, window.innerWidth - menu.offsetWidth - 8))}px`;
}

function pickPerson(index) {
  const person = state.peopleMenu.options[index];
  openPeopleMenu(false);
  state.filtersOpen = false;
  for (const id of [...state.quick]) if (isPersonFilter(id)) state.quick.delete(id);
  if (person.id !== null) switchOnFilter(person.id);
  quickFiltersChanged();
  $("people-filter")?.focus();
}

$("people-menu").addEventListener("click", e => {
  const option = e.target.closest("li[data-index]");
  if (option) pickPerson(Number(option.dataset.index));
});
$("people-menu").addEventListener("mousemove", e => {
  const option = e.target.closest("li[data-index]");
  if (!option || Number(option.dataset.index) === state.peopleMenu.active) return;
  movePeopleActive(Number(option.dataset.index));
});
// Arrows, Home/End, a letter to jump to the next name starting with it: what a native list does. The keys
// stop here, so the board's own shortcuts (D, A, M…) do not fire while choosing.
$("people-menu").addEventListener("keydown", e => {
  const menu = state.peopleMenu;
  const last = menu.options.length - 1;
  let next = null;
  if (e.key === "ArrowDown") next = Math.min(menu.active + 1, last);
  else if (e.key === "ArrowUp") next = Math.max(menu.active - 1, 0);
  else if (e.key === "Home") next = 0;
  else if (e.key === "End") next = last;
  else if (e.key === "Enter" || e.key === " ") pickPerson(menu.active);
  else if (e.key === "Escape") {
    openPeopleMenu(false);
    $("people-filter")?.focus();
  } else if (e.key === "Tab") {
    openPeopleMenu(false);
    return;
  } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const letter = normalize(e.key);
    const order = menu.options.map((_, index) => (menu.active + 1 + index) % menu.options.length);
    next = order.find(index => normalize(menu.options[index].name).startsWith(letter)) ?? null;
  } else {
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  if (next !== null && state.peopleMenu) {
    movePeopleActive(next);
  }
});
window.addEventListener("resize", () => {
  if (state.peopleMenu) placePeopleMenu();
});

// Issues and story points displayed — view columns and filters — out of the sprint total:
// "21 / 49 · 37 / 94 pts". In a Dev view, for instance, the share left on the dev side.
function countText(board) {
  const columns = new Set(viewColumns(board, state.view).flatMap(index => board.columns[index].statusIds));
  const shown = visibleIssues(board).filter(issue => columns.has(issue.statusId));
  // Rounded to one decimal: 0.1 + 0.2 is not displayed as "0.30000000000000004".
  const points = issues => formatPoints(Math.round(issues.reduce((sum, issue) => sum + (issue.points ?? 0), 0) * 10) / 10);
  return `${shown.length} / ${board.issues.length} · ${points(shown)} / ${points(board.issues)} pts`;
}

// Label buttons, in a stable order: a slot only changes hands to let in an active label (picked from the
// list), and the least used inactive button then gives it up; the others do not move. Free slots are filled
// with the labels the user uses most, then with the sprint's most frequent ones, except those too
// widespread to filter usefully.
function labelsHtml(board) {
  const labels = board ? sprintLabels(board) : [];
  // Active label missing from the sprint (shared link, other sprint): shown at 0, so it can be removed.
  for (const id of state.labels) if (!labels.some(label => label.id === id)) labels.push({ id, count: 0, name: id });
  if (!labels.length) return "";
  const byId = new Map(labels.map(label => [label.id, label]));
  // All shown: in alphabetical order, which no count or click changes, so a button never moves.
  const top = labels.length <= LABELS_ALL_AS_BUTTONS
    ? labels.map(label => label.id).sort((a, b) => byId.get(a).name.localeCompare(byId.get(b).name, undefined, { sensitivity: "base" }))
    : buttonLabels(
      byId,
      board
    );
  const shown = top.map(id => byId.get(id));
  const others = labels.filter(label => !top.includes(label.id));
  return `<span class="label">Labels</span>` +
    shown.map(label => `<button type="button" class="qf" data-label="${escapeHtml(label.id)}" aria-pressed="${state.labels.has(label.id)}" ` +
      `title="${label.count} issue(s) in the sprint">${escapeHtml(label.name)}<span class="n">${label.count}</span></button>`).join("") +
    (others.length
      ? `<select id="more-labels" class="more-labels" aria-label="Other labels"><option value="">+ ${others.length} more</option>` +
        others.map(label => `<option value="${escapeHtml(label.id)}">${escapeHtml(label.name)} (${label.count})</option>`).join("") + `</select>`
      : "");
}

// Ids of the labels shown as buttons, in the remembered order; the order is completed and saved on the
// way. It spans all sprints: a label missing from this one keeps its slot for the next sprint using it.
function buttonLabels(
  byId,
  board
) {
  const usage = labelUsageScores();
  const order = state.labelOrder;
  const before = order.join();
  const top = order.filter(id => byId.has(id)).slice(0, TOP_LABELS);
  // Least used first; on a tie, the least present in the sprint.
  const coldness = id => [usage.get(id) ?? 0, byId.get(id).count];
  const colder = (a, b) => coldness(a)[0] - coldness(b)[0] || coldness(a)[1] - coldness(b)[1];
  const place = id => {
    if (order.includes(id)) order.splice(order.indexOf(id), 1);
    const inactive = top.filter(other => !state.labels.has(other));
    if (top.length >= TOP_LABELS && inactive.length) {
      const evicted = inactive.sort(colder)[0];
      order[order.indexOf(evicted)] = id;
      top[top.indexOf(evicted)] = id;
      return;
    }
    order.splice(top.length ? order.indexOf(top.at(-1)) + 1 : 0, 0, id);
    top.push(id);
  };
  for (const id of state.labels) if (!top.includes(id)) place(id);
  const broad = board ? board.issues.length * BROAD_LABEL_SHARE : Infinity;
  const candidates = [...byId.values()]
    .filter(label => usage.has(label.id) || label.count <= broad)
    .sort((a, b) => (usage.get(b.id) ?? 0) - (usage.get(a.id) ?? 0) || b.count - a.count);
  for (const label of candidates) {
    if (top.length >= TOP_LABELS) break;
    if (!top.includes(label.id)) place(label.id);
  }
  order.splice(LABEL_ORDER_SIZE);
  if (order.join() !== before) savePreference(LABEL_ORDER_KEY, JSON.stringify(order));
  return top;
}

function readLabelOrder() {
  try {
    const order = JSON.parse(readPreference(LABEL_ORDER_KEY));
    return Array.isArray(order) ? order.filter(id => typeof id === "string") : [];
  } catch (ignored) {
    return [];
  }
}

// Usage scores brought back to now: a label left unused for weeks makes room for the others.
function labelUsageScores() {
  const now = Date.now();
  return new Map(Object.entries(readLabelUsage())
    .map(([id, { score, at }]) => [id, score * 0.5 ** ((now - at) / LABEL_USAGE_HALF_LIFE_MS)]));
}

function recordLabelUse(id) {
  const now = Date.now();
  const scores = labelUsageScores();
  scores.set(id, (scores.get(id) ?? 0) + 1);
  // The least used drop beyond LABEL_USAGE_SIZE: the preference stays small.
  const kept = [...scores].sort((a, b) => b[1] - a[1]).slice(0, LABEL_USAGE_SIZE);
  savePreference(LABEL_USAGE_KEY, JSON.stringify(Object.fromEntries(kept.map(([key, score]) => [key, { score, at: now }]))));
}

function readLabelUsage() {
  try {
    const usage = JSON.parse(readPreference(LABEL_USAGE_KEY));
    return usage && typeof usage === "object" ? usage : {};
  } catch (ignored) {
    return {};
  }
}

function clearFilters() {
  state.quick.clear();
  state.labels.clear();
  state.q = "";
  writeUrl();
  renderFilters();
  renderBoard();
}

function renderClearFilters() {
  const active = [
    ...state.quick.size ? [`${state.quick.size} quick filter(s)`] : [],
    ...state.labels.size ? [`${state.labels.size} label(s)`] : [],
    ...state.q ? [`the search "${state.q}"`] : [],
  ];
  const button = $("clear-filters");
  button.disabled = !active.length;
  button.title = active.length ? `Clear filters: ${active.join(", ")}` : "No active filter";
  button.setAttribute("aria-label", button.title);
}

function toggleLabel(id) {
  if (!state.labels.delete(id)) {
    state.labels.add(id);
    recordLabelUse(id);
  }
  writeUrl();
  renderFilters();
  renderBoard();
}

// Column indices of a view: from its start column to the next start, whatever the declaration order. A
// view whose column does not exist (renamed in Jira) shows the whole board.
function viewColumns(
  board,
  view
) {
  const all = board.columns.map((column, index) => index);
  const selected = VIEWS.find(v => v.id === view);
  if (!selected?.from) return all;
  const start = columnIndex(
    board,
    selected
  );
  if (start < 0) return all;
  const starts = VIEWS.filter(v => v.from).map(v => columnIndex(board, v));
  const end = Math.min(...starts.filter(s => s > start), all.length);
  return all.slice(start, end);
}

// Missing columns already reported: the board is redrawn often, the warning is only shown once.
const warnedColumns = new Set();

function columnIndex(
  board,
  view
) {
  const index = board.columns.findIndex(c => c.name.toLocaleLowerCase() === view.from.toLocaleLowerCase());
  if (index < 0 && !warnedColumns.has(view.from)) {
    warnedColumns.add(view.from);
    showError(
      `View "${view.label}": no column "${view.from}" on the board ` +
      `(columns: ${board.columns.map(c => c.name).join(", ")}). Fix "views" in the configuration.`
    );
  }
  return index;
}

function renderViews(
  board,
  columnIssues
) {
  $("views").hidden = !VIEWS.length;
  $("views").innerHTML = VIEWS.map(v => {
    const count = viewColumns(board, v.id).reduce((sum, index) => sum + columnIssues[index].length, 0);
    return `<button type="button" data-view="${v.id}" aria-pressed="${state.view === v.id}" title="${v.label} view (key ${v.key})">` +
      `${v.label}<span class="n">${count}</span></button>`;
  }).join("");
}

function setView(view) {
  if (view === state.view) return;
  state.view = view;
  savePreference(
    VIEW_KEY,
    view
  );
  renderBoard();
}

// Quick filters add up (AND), as in Jira.
function visibleIssues(board) {
  // Nobody speaking yet (or any more): the stand-up shows the whole board.
  const speaking = state.standup?.index ?? null;
  const speaker = speaking === null ? undefined : state.standup.people[speaking];
  const active = [...state.quick].map(quickFilter).filter(f => f && !(speaker !== undefined && isPersonFilter(f.id))).map(f => filterPredicate(
    f,
    board
  ));
  const terms = parseSearch(
    state.q,
    SEARCH_FIELDS
  );
  const labels = [...state.labels];
  return board.issues.filter(issue =>
    (speaker === undefined || (issue.assignee ?? null) === speaker || state.standup.touched.has(issue.key)) && active.every(p => p(issue)) && labels.every(id => (issue.labels ?? []).some(l => l.toLowerCase() === id)) && terms.every(term => matchesTerm(
      issue,
      board,
      term
    ))
  );
}

// Search keywords, each matched on one field only (accents and case ignored, part of a word is enough).
const SEARCH_FIELDS = {
  type: (issue, board) => [board.types[issue.typeId]?.name],
  status: (issue, board) => [board.statuses[issue.statusId]?.name],
  priority: (issue, board) => [board.priorities[issue.priorityId]?.name],
  label: issue => issue.labels ?? [],
  epic: (issue, board) => [board.epics[issue.epicId]?.text, board.epics[issue.epicId]?.key],
  assignee: issue => [issue.assignee, issue.assigneeName, issue.assignee && firstName(issue.assignee, issue.assigneeName)],
};

function matchesTerm(
  issue,
  board,
  term
) {
  return matchesValue(
    issue,
    board,
    term
  ) !== term.negate;
}

function matchesValue(
  issue,
  board,
  { field, value }
) {
  if (!field) return haystack(issue, board).includes(value);
  if (field === "assignee" && value === "me") return !!issue.assignee && issue.assignee.toLowerCase() === state.meta?.me?.toLowerCase();
  if (field === "assignee" && value === "none") return !issue.assignee;
  return SEARCH_FIELDS[field](issue, board).some(text => text && normalize(text).includes(value));
}

function filterPredicate(
  filter,
  board
) {
  const client = clientPredicate(filter);
  if (client) return issue => client(
    issue,
    board
  );
  const keys = board.filterKeys?.[filter.id];
  if (!keys) return () => true;
  const set = new Set(keys);
  return issue => set.has(issue.key);
}

function haystack(
  issue,
  board
) {
  const epic = board.epics[issue.epicId];
  // Type, status and priority names as Jira shows them: "bug" only finds bugs if the type is named so.
  return normalize(`${issue.key} ${issue.summary} ${issue.assigneeName ?? ""} ${epic?.text ?? ""} ${epic?.key ?? ""} ${(issue.labels ?? []).join(" ")} ${board.types[issue.typeId]?.name ?? ""} ${board.statuses[issue.statusId]?.name ?? ""} ${board.priorities[issue.priorityId]?.name ?? ""}`);
}


function renderBoard() {
  // During a drag, rebuilding the cards would remove the one being held: rendering is deferred to the drop.
  if (drag?.started) {
    state.renderLater = true;
    return;
  }
  state.renderLater = false;
  const board = currentBoard();
  if (!board) {
    $("board").innerHTML = `<div class="skeleton">Loading the board…</div>`;
    return;
  }
  assignHues(board);
  const columnOf = new Map();
  board.columns.forEach((c, index) => c.statusIds.forEach(id => columnOf.set(id, index)));
  const columns = board.columns.map(() => []);
  for (const issue of visibleIssues(board)) columns[columnOf.get(issue.statusId)]?.push(issue);
  renderViews(
    board,
    columns
  );
  renderClearFilters();
  renderStandup();
  renderBulk();
  // The count follows the view and the search, which only redraw the board, not the filter bar.
  $("count").textContent = countText(board);
  // Columns outside the view: neither rendered nor laid out, not just hidden with CSS.
  const shown = viewColumns(board, state.view).map(index => ({ column: board.columns[index], index }));
  $("board").style.setProperty("--cols", shown.length);
  // Rebuilding the board drops the focus: a card that had it gets it back, so a refresh does not take the
  // keyboard away from someone moving through the cards.
  const focused = document.activeElement?.closest?.("#board .card[data-key]")?.dataset.key;
  $("board").innerHTML = shown.map(({ column, index }) => {
    const issues = columns[index];
    const points = issues.reduce((sum, i) => sum + (i.points ?? 0), 0);
    return `<section class="column" data-col="${index}"><h2><span>${escapeHtml(column.name)}</span>` +
      `<span class="n" title="${issues.length} issue(s), ${formatPoints(points)} point(s)">${issues.length}${points ? ` · ${formatPoints(points)} pts` : ""}</span></h2>` +
      `<div class="cards">${issues.length ? issues.map(i => card(i, board)).join("") : `<div class="empty-col">—</div>`}</div></section>`;
  }).join("");
  if (focused) document.querySelector(`#board .card[data-key="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
  // The number of columns changes with the view, without the board changing size.
  fitLanes();
}

// Readable first name next to the avatar: the one of the person's quick filter ("Alice") when it exists,
// since it is the name the team uses; otherwise the first word of the Jira name, case normalised
// ("ALICE" → "Alice").
function firstName(
  login,
  name
) {
  if (!login) return "Unassigned";
  const filter = state.meta?.quickFilters.find(f => f.query.match(ASSIGNEE_IS)?.slice(1).some(who => who?.toLowerCase() === login.toLowerCase()));
  if (filter) return filter.name;
  const first = (name ?? login).split(/\s+/)[0];
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

const GRIP = `<span class="grip" title="Drag to move" aria-hidden="true"><svg viewBox="0 0 6 10" fill="currentColor">` +
  [1, 5].flatMap(x => [1, 5, 9].map(y => `<circle cx="${x}" cy="${y}" r="1"/>`)).join("") + `</svg></span>`;

function card(
  issue,
  board
) {
  const epic = board.epics[issue.epicId];
  const elsewhere = touchedElsewhere(issue);
  const handed = elsewhere && handedOver(issue);
  const classes = ["card", issue.done ? "done" : "", issue.key === state.openKey ? "selected" : "", issue.key in state.recent ? "recent" : "", state.picked.has(issue.key) ? "picked" : "", elsewhere ? "handed-over" : ""].filter(Boolean).join(" ");
  // draggable="false": otherwise pressing a link and moving drags its URL instead of selecting text.
  return `<a class="${classes}" href="${browseUrl(issue.key)}" data-key="${escapeHtml(issue.key)}" draggable="false">` +
    `<div class="top"><span class="id">${GRIP}<span class="key">${escapeHtml(issue.key)}</span></span>` +
    `<span class="who"><span class="first-name">${escapeHtml(firstName(issue.assignee, issue.assigneeName))}</span>${avatar(issue.assignee, issue.assigneeName, issue.avatar)}</span></div>` +
    `<div class="summary">${escapeHtml(issue.summary)}</div>` +
    (epic ? `<span class="epic" style="--epic:${EPIC_COLORS[epic.color] ?? "#c1c7d0"}" title="${escapeHtml(epic.key)}">${escapeHtml(epic.text)}</span>` : "") +
    `<div class="foot">${icon(board.types[issue.typeId])}${icon(board.priorities[issue.priorityId])}` +
    (issue.points != null ? `<span class="sp" title="Story points">${formatPoints(issue.points)}</span>` : "") +
    (handed ? `<span class="handed" title="Assigned to the person speaking, handed to someone else since ${escapeHtml(formatSince(state.standup.since))}">handed over</span>` : "") +
    (elsewhere && !handed ? `<span class="handed" title="Changed by the person speaking since ${escapeHtml(formatSince(state.standup.since))}, assigned to someone else">worked on</span>` : "") +
    `${GRIP}</div></a>`;
}

function icon(entity) {
  return entity?.url
    ? `<img class="icon" src="${escapeHtml(relayed(entity.url))}" alt="${escapeHtml(entity.name)}" title="${escapeHtml(entity.name)}" width="16" height="16" decoding="async">`
    : "";
}

// Initials are always drawn, covered by the photo when it loads.
// Hand-picked palette rather than a colour wheel: bold, nameable colours, without purple or pink, all
// readable under white initials (at least 4.5:1: the initials are small text). Ordered so that the first ones are the furthest apart.
const AVATAR_COLORS = [
  "#2c77c5", // blue
  "#27844c", // green
  "#c05422", // orange
  "#c43d3d", // red
  "#158089", // turquoise
  "#8a5a3c", // brown
  "#6b7a28", // olive
  "#5b6b7c", // slate
];

// Colours handed out only to the board's assignees shown as initials (those with a Jira photo do not need
// one): up to 8, two people never share one. Outside the board (reporter, commenters), a hash of the login.
const avatarColors = new Map();

function assignHues(board) {
  // Gravatar counts as initials: whether it has a real photo is only known once loaded.
  const initialsOnly = board.issues.filter(i => i.assignee && !/[?&]ownerId=/.test(i.avatar ?? "")).map(i => i.assignee);
  avatarColors.clear();
  [...new Set(initialsOnly)].sort().forEach((login, index) => avatarColors.set(login, AVATAR_COLORS[index % AVATAR_COLORS.length]));
}

// Default avatar from Jira (no ownerId) or Gravatar ("mm" silhouette): an anonymous silhouette that would
// hide the initials. Gravatar answers 404 without a real avatar, and the image is then removed.
function personalAvatar(url) {
  if (!url) return null;
  if (/gravatar\.com/.test(url)) return url.replace(/([?&])d=[^&]*/, "$1d=404");
  return /[?&]ownerId=/.test(url) ? url : null;
}

function avatar(
  login,
  name,
  url
) {
  if (!login) {
    return `<span class="avatar none" title="Unassigned" aria-label="Unassigned">` +
      `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4" fill="currentColor"/>` +
      `<path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7z" fill="currentColor"/></svg><span class="q">?</span></span>`;
  }
  const label = name ?? login;
  const initials = label.split(/\s+/).filter(Boolean).map(part => part[0]).join("").slice(0, 2).toUpperCase();
  const color = avatarColors.get(login) ?? AVATAR_COLORS[[...login].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % AVATAR_COLORS.length, 7)];
  const image = personalAvatar(url);
  const img = image ? `<img src="${escapeHtml(relayed(image))}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.remove()">` : "";
  return `<span class="avatar" style="--avatar-bg:${color}" title="${escapeHtml(label)}">${escapeHtml(initials)}${img}</span>`;
}

const formatPoints = n => String(n);

// Absolute time and day: a screenshot still tells how old the data is.
function renderStatus() {
  const board = currentBoard();
  const time = at => new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const updated = board ? `Updated ${time(board.at)} · ${new Date(board.at).toLocaleDateString("en-GB")}` : "";
  // The second line says what is going on: a failure first, then a refresh running, else the age.
  const second = state.lastFailure
    ? `<span class="failed" title="${escapeHtml(`Failed at ${time(state.lastFailure.at)}, showing the previous data: ${state.lastFailure.message}`)}">Failed at ${time(state.lastFailure.at)}</span>`
    : state.refreshing
      ? `<span class="progress">Refreshing…</span>`
      : board ? `<span>${escapeHtml(compactDuration(Date.now() - board.at))} ago</span>` : "";
  $("status").innerHTML = `<span>${updated || "&nbsp;"}</span>${second || "<span>&nbsp;</span>"}`;
}

// ---------------------------------------------------------------------------------------------------
// Load put on Jira: requests made by the local server (all tabs and background sync together) over 1, 5
// and 15 minutes. /stats is served locally, without calling Jira.

// The header only shows the totals: a summary every 10 s is enough. The breakdown by origin is asked every
// second, and only while its panel is open.
const LOAD_REFRESH_MS = 10 * 1000;
const LOAD_PANEL_REFRESH_MS = 1000;
const LOAD_WINDOWS = ["1m", "5m", "15m"];
const LOAD_ORIGINS = [
  ["page", "Board", "refresh of the open tabs"],
  ["detail", "Issue detail", "when opened, if the copy is older than 30 s"],
  ["images", "Images", "icons, avatars, attachment previews; kept for a week by the browser"],
  ["sync", "Background sync", "every 5 min, copies the issues changed in Jira locally"],
  ["write", "Writes", "reordering, assignments, status changes"],
];

// Ticks every second: a hanging server must not pile up requests.
let loadPending = false;
let loadAt = 0;

function refreshLoad() {
  const detailed = !$("load-panel").hidden;
  if (document.hidden || loadPending || (!detailed && Date.now() - loadAt < LOAD_REFRESH_MS)) return;
  loadPending = true;
  request(
    detailed ? "/stats" : "/stats?summary=1",
    { timeout: LOCAL_TIMEOUT_MS }
  )
    .then(response => response.ok ? response.json() : null)
    .then(stats => {
      if (!stats) return;
      loadAt = Date.now();
      renderLoad(
        stats,
        detailed
      );
    })
    .catch(() => {})
    .finally(() => { loadPending = false; });
}

function renderLoad(
  stats,
  detailed
) {
  const total = window => stats.windows[window]?.total ?? 0;
  $("load").title = `Requests sent to Jira by the local server: ${total("1m")} over the last minute, ${total("5m")} over 5 minutes, ${total("15m")} over 15 minutes`;
  $("load").setAttribute("aria-label", $("load").title);
  $("load").innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 20 V4 M4 8 L8 4 L12 8"/><path d="M16 4 V20 M12 16 L16 20 L20 16"/></svg>` +
    `<b>${total("1m")}</b><span>/min</span>`;
  if (!detailed) return;
  const count = (window, origin) => stats.windows[window]?.byOrigin?.[origin] ?? 0;
  const rows = LOAD_ORIGINS.map(([origin, label, hint]) =>
    `<tr><td>${label}<span class="hint">${hint}</span></td>${LOAD_WINDOWS.map(window => `<td>${count(window, origin)}</td>`).join("")}</tr>`
  ).join("");
  const since = compactDuration(Date.now() - stats.startedAt);
  $("load-panel").innerHTML = `<h4>Requests sent to Jira</h4>` +
    `<table><thead><tr><th></th><th>1 min</th><th>5 min</th><th>15 min</th></tr></thead>` +
    `<tbody>${rows}</tbody>` +
    `<tfoot><tr><td>Total</td>${LOAD_WINDOWS.map(window => `<td>${total(window)}</td>`).join("")}</tr></tfoot></table>` +
    `<p>${stats.sinceStart} request${stats.sinceStart > 1 ? "s" : ""} since the server started (${escapeHtml(since)} ago), ` +
    `i.e. ${formatPoints(Math.round(stats.sinceStart / Math.max(1, (Date.now() - stats.startedAt) / 60000) * 10) / 10)} per minute on average.</p>`;
}

function toggleLoadPanel(open) {
  $("load-panel").hidden = !open;
  $("load").setAttribute("aria-expanded", String(open));
  if (open) {
    alignPopover(
      $("load-panel"),
      $("load")
    );
    refreshLoad();
  }
}

// Where the header puts a button depends on the window's width: its panel opens towards the side with room.
function alignPopover(
  panel,
  button
) {
  const box = button.getBoundingClientRect();
  const width = document.documentElement.clientWidth;
  panel.classList.toggle("from-left", box.left + box.width / 2 < width / 2);
  // On a narrow window, a panel wider than the room on either side of its button is slid back inside.
  panel.style.translate = "";
  const rect = panel.getBoundingClientRect();
  const shift = rect.right > width - POPOVER_MARGIN_PX ? width - POPOVER_MARGIN_PX - rect.right : rect.left < POPOVER_MARGIN_PX ? POPOVER_MARGIN_PX - rect.left : 0;
  if (shift) panel.style.translate = `${shift}px 0`;
}

$("load").addEventListener("click", () => toggleLoadPanel($("load-panel").hidden));
document.addEventListener("click", e => {
  if (!$("load-panel").hidden && !e.target.closest(".jira-load")) toggleLoadPanel(false);
  if (!$("about-panel").hidden && !e.target.closest(".about")) toggleAboutPanel(false);
  if (!$("activity-panel").hidden && !e.target.closest(".activity")) toggleActivityPanel(false);
});

function toggleAboutPanel(open) {
  $("about-panel").hidden = !open;
  $("about").setAttribute("aria-expanded", String(open));
}

$("about").addEventListener("click", () => toggleAboutPanel($("about-panel").hidden));

// Two lists, each the keys of where it opens: the board's in the header, the detail's in the detail.
const SHORTCUT_LISTS = [["board-shortcuts-panel", "board-shortcuts-btn"], ["shortcuts-panel", "shortcuts-btn"]];

function toggleShortcuts(
  panelId,
  open
) {
  const button = $(SHORTCUT_LISTS.find(([id]) => id === panelId)[1]);
  $(panelId).hidden = !open;
  button.setAttribute("aria-expanded", String(open));
  if (open && panelId === "board-shortcuts-panel") {
    alignPopover(
      $(panelId),
      button
    );
  }
}

const openShortcuts = () => SHORTCUT_LISTS.map(([id]) => id).find(id => !$(id).hidden);

for (const [panelId, buttonId] of SHORTCUT_LISTS) $(buttonId).addEventListener("click", () => toggleShortcuts(
  panelId,
  $(panelId).hidden
));
document.addEventListener("click", e => {
  for (const [panelId] of SHORTCUT_LISTS) {
    if (!$(panelId).hidden && !e.target.closest(".shortcuts")?.contains($(panelId))) toggleShortcuts(
      panelId,
      false
    );
  }
});
// Without board views, no keys for them.
$("views-shortcut").hidden = !VIEWS.length;

// Recreating the segments restarts their animations; the negative delay puts them at the time already
// elapsed. The rightmost segment fades after one minute, the leftmost at the refresh.
function renderFreshness() {
  const bar = $("freshness");
  bar.hidden = !state.autoRefresh || !currentBoard() || document.hidden;
  if (bar.hidden) return;
  bar.style.setProperty("--cycle", `${AUTO_REFRESH_MS}ms`);
  bar.style.setProperty("--delay", `${-Math.min(age(), AUTO_REFRESH_MS)}ms`);
  bar.innerHTML = Array.from(
    { length: FRESHNESS_SEGMENTS },
    (_, i) => `<i style="--off:${AUTO_REFRESH_MS * (FRESHNESS_SEGMENTS - i) / FRESHNESS_SEGMENTS}ms"></i>`
  ).join("");
}

// The detail's freshness on the board's scale ("< 5 s", "10 s"… then minutes), redrawn with it: "just now"
// for anything under 45 s told nothing of a copy checked a second or forty seconds ago.
const syncAge = at => `${compactDuration(Date.now() - at)} ago`;

function renderSyncAge() {
  const age = $("panel-sync").querySelector(".sync-age");
  if (age) age.textContent = syncAge(Number(age.dataset.at));
}

function relative(at) {
  const seconds = Math.round((Date.now() - at) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
}

function showError(message) {
  $("errors").insertAdjacentHTML("beforeend", `<div class="error-banner" role="alert">${escapeHtml(message)}</div>`);
}

// ---------- Issue detail ----------

// Two sources: the local copy kept by the server (a file read, instant) and the on-demand sync, which
// queries Jira. Hovering a card only reads the local copy: it costs nothing.
// mode: "local" (local copy only), "sync" (Jira if the copy is stale) or "force" (Jira no matter what).
const ISSUE_QUERY = { local: "", sync: "?sync=1", force: "?sync=1&force=1" };

async function fetchIssue(
  key,
  mode
) {
  const response = await request(
    `/issue/${encodeURIComponent(key)}${ISSUE_QUERY[mode]}`,
    { timeout: mode === "local" ? LOCAL_TIMEOUT_MS : JIRA_READ_TIMEOUT_MS }
  );
  if (response.status === 404) return null;
  const body = await response.json();
  if (!response.ok) throw new Error(body.message || `${response.status}`);
  return body;
}

// When Jira last confirmed the copy (epoch milliseconds): its own sync, or a later pass of the background
// sync that found it unchanged.
const checkedAt = entry => Math.max(
  Date.parse(entry.syncedAt),
  entry.checkedAt ? Date.parse(entry.checkedAt) : 0
);

function remember(entry) {
  if (!entry) return;
  state.detail.delete(entry.key);
  state.detail.set(entry.key, entry);
  if (state.detail.size > DETAIL_CACHE_SIZE) state.detail.delete(state.detail.keys().next().value);
}

// The card from the issue's local copy: what Jira changed by itself shows without reloading the board.
// Its column is left alone: a read made just after a transition can still give the status the issue left,
// which sent the card back where it came from. Returns whether a card changed.
function patchCard(entry) {
  const fields = entry?.data?.fields;
  if (!fields) return false;
  let changed = false;
  for (const board of Object.values(state.boards)) {
    const issue = board.issues.find(i => i.key === entry.key);
    if (!issue) continue;
    const next = {};
    if (fields.summary) next.summary = fields.summary;
    if (fields.priority) next.priorityId = String(fields.priority.id);
    // An assignment being saved keeps the value it shows: the copy read meanwhile may predate it.
    if ("assignee" in fields && !state.assigning.has(entry.key) && (fields.assignee?.name ?? null) !== issue.assignee) {
      next.assignee = fields.assignee?.name ?? null;
      next.assigneeName = fields.assignee?.displayName ?? null;
      next.avatar = fields.assignee?.avatarUrls?.["48x48"] ?? null;
    }
    for (const [name, value] of Object.entries(next)) {
      if (issue[name] === value) continue;
      issue[name] = value;
      changed = true;
    }
  }
  return changed;
}

function elsewhere(entry) {
  const statusId = entry.data?.fields?.status?.id;
  const board = currentBoard();
  const issue = board?.issues.find(i => i.key === entry.key);
  if (statusId === undefined || !issue) return false;
  const column = id => board.columns.findIndex(c => c.statusIds.map(String).includes(String(id)));
  return column(statusId) !== column(issue.statusId);
}

// Pending follow-up reads, per issue: moving it again starts them over.
const followUps = new Map();

function followUp(key) {
  for (const timer of followUps.get(key) ?? []) clearTimeout(timer);
  followUps.set(key, FOLLOW_UP_DELAYS_MS.map((delay, index) => setTimeout(
    async () => {
      const last = index === FOLLOW_UP_DELAYS_MS.length - 1;
      if (last) followUps.delete(key);
      const entry = await fetchIssue(
        key,
        "force"
      ).catch(() => null);
      // Jira did not answer: the copy the server returns instead says nothing new.
      if (!entry || entry.syncError) return;
      remember(entry);
      if (patchCard(entry)) {
        renderBoard();
        saveSnapshot();
      }
      if (state.openKey === key && state.detailSyncing !== key) rerenderDetail();
      // The move has had time to settle in Jira: an issue still read in another column (an automation
      // moved it on, or the move did not hold) is settled by the board's own data.
      if (last && !followUps.has(key) && elsewhere(entry)) refresh();
    },
    delay
  )));
}

function prefetchLocal(key) {
  if (state.detail.has(key) || state.detailLoading.has(key)) return;
  state.detailLoading.set(key, fetchIssue(
    key,
    "local"
  ).then(remember).catch(() => {}).finally(() => state.detailLoading.delete(key)));
}

async function openDetail(key) {
  state.openKey = key;
  state.pickAnchor = key;
  if (state.picker?.key !== key) state.picker = null;
  for (const el of document.querySelectorAll(".card.selected")) el.classList.remove("selected");
  const cardEl = document.querySelector(`.card[data-key="${CSS.escape(key)}"]`);
  cardEl?.classList.add("selected");
  cardEl?.scrollIntoView({ block: "nearest", inline: "nearest" });
  // Focus follows the selection: otherwise it stays on the last clicked card and the keyboard acts on it.
  if (cardEl && document.activeElement !== $("q")) cardEl.focus({ preventScroll: true });
  if (cardEl && state.dock === "side") {
    const box = cardEl.getBoundingClientRect();
    $("panel").classList.toggle("left", box.left + box.width / 2 > document.documentElement.clientWidth / 2);
  }
  $("panel").hidden = false;
  // At the bottom, the panel shrinks the board: the card is only scrolled into view once the panel is shown.
  if (state.dock === "bottom") cardEl?.scrollIntoView({ block: "nearest", inline: "nearest" });
  const token = Symbol(key);
  state.openToken = token;
  if (!state.detail.has(key)) {
    renderDetail(key, { syncing: true });
    remember(await fetchIssue(
      key,
      "local"
    ).catch(() => null));
    if (state.openToken !== token) return;
  }
  const cached = state.detail.get(key);
  if (cached && Date.now() - checkedAt(cached) < DETAIL_FRESH_MS) {
    renderDetail(key, {});
    return;
  }
  await syncDetail(
    key,
    "sync"
  );
}

async function syncDetail(
  key,
  mode
) {
  const token = state.openToken;
  const current = () => state.openToken === token;
  state.detailSyncing = key;
  renderDetail(key, { syncing: true });
  try {
    const fresh = await fetchIssue(
      key,
      mode
    );
    remember(fresh);
    if (current()) renderDetail(key, { syncError: fresh?.syncError });
  } catch (error) {
    if (current()) renderDetail(key, { syncError: error.message });
  } finally {
    if (state.detailSyncing === key) state.detailSyncing = null;
  }
}

// An issue of the sprint changed in Jira after the board was loaded (by someone else, or in another
// browser): the board is reloaded, once for all tabs thanks to the shared refresh.
async function watchChanges() {
  if (document.hidden) {
    if (state.notify) await pollChanges(false);
    return;
  }
  const { changedAt } = await pollChanges(true) ?? {};
  reloadOpenDetail();
  const board = currentBoard();
  if (!changedAt || !board || board.at >= changedAt || !state.autoRefresh || drag?.started || state.refreshing) return;
  sharedRefresh({ olderThan: Date.now() - changedAt });
}

// The poll that tells whether the server is still there: /changes never waits for Jira, so no answer
// within LOCAL_TIMEOUT_MS means it is down.
async function pollChanges(watching) {
  const changes = await request(
    watching ? "/changes" : "/changes?watch=0",
    { timeout: LOCAL_TIMEOUT_MS }
  ).then(response => response.json()).catch(() => null);
  setServerReachable(changes !== null);
  if (changes?.recent) {
    state.recent = changes.recent;
    markRecent();
    notifyChanges(changes.recent);
  }
  return changes;
}

// ---------- Bulk actions ----------

// The picked issues of the sprint shown, in board order; a pick left in another sprint does not count.
function pickedIssues() {
  return (currentBoard()?.issues ?? []).filter(issue => state.picked.has(issue.key));
}

function renderBulk() {
  const bar = $("bulk");
  const issues = pickedIssues();
  bar.hidden = !issues.length;
  if (!issues.length) return;
  const board = currentBoard();
  // People offered: those the page already knows (no Jira search for several issues at once). Kept with the
  // bar, so that the option chosen is the person it showed.
  const people = knownPeople(state.openKey);
  const disabled = state.bulkBusy ? " disabled" : "";
  const html = `<span class="count">${issues.length === 1 ? "1 issue" : `${issues.length} issues`} picked</span>` +
    `<select id="bulk-assign" aria-label="Assign the picked issues"${disabled}><option value="">Assign to…</option>` +
    `<option value="-1">Unassigned</option>` +
    people.map((p, index) => `<option value="${index}">${escapeHtml(p.name)}</option>`).join("") + `</select>` +
    `<select id="bulk-move" aria-label="Move the picked issues"${disabled}><option value="">Move to…</option>` +
    board.columns.map((c, index) => `<option value="${index}">${escapeHtml(c.name)}</option>`).join("") + `</select>` +
    (state.bulkBusy ? `<span class="busy">${escapeHtml(state.bulkBusy)}</span>` : "") +
    `<button type="button" id="bulk-clear" title="Unpick every card (Escape)"${disabled}>Clear</button>`;
  // The board renders again at every sync: rebuilding the bar each time would close a list being opened.
  if (html === bar.dataset.html) return;
  bar.dataset.html = html;
  bar.innerHTML = html;
  bar.people = people;
}

// The move dialog, listing the issues instead of the statuses of one.
function confirmBulk(
  title,
  rows,
  confirmLabel
) {
  const dialog = $("move-dialog");
  $("move-title").textContent = title;
  $("move-summary").textContent = "";
  $("move-note").textContent = "Each issue is changed in turn, as it would be in Jira: it shows in its history, and may notify people.";
  $("move-confirm").textContent = confirmLabel;
  $("move-steps").className = "issues";
  $("move-steps").innerHTML = rows.join("");
  dialog.returnValue = "cancel";
  dialog.showModal();
  $("move-confirm").focus();
  return new Promise(resolve => dialog.addEventListener(
    "close",
    () => resolve(dialog.returnValue === "move"),
    { once: true }
  ));
}

function bulkRow(
  issue,
  detail
) {
  return `<li><span class="key">${escapeHtml(issue.key)}</span><span>${escapeHtml(issue.summary ?? "")}</span>${detail}</li>`;
}

function setBulkBusy(message) {
  state.bulkBusy = message;
  renderBulk();
}

async function bulkAssign(user) {
  const login = (user?.login ?? "").toLowerCase();
  const issues = pickedIssues().filter(issue => (issue.assignee ?? "").toLowerCase() !== login);
  const name = user?.name ?? "nobody";
  if (!issues.length) {
    flashInfo(`Already assigned to ${name}`);
    return;
  }
  const plural = issues.length === 1 ? "1 issue" : `${issues.length} issues`;
  if (!await confirmBulk(
    `Assign ${plural} to ${name}`,
    issues.map(issue => bulkRow(
      issue,
      ""
    )),
    "Assign"
  )) return;
  setBulkBusy("Assigning…");
  let done = 0;
  // One after the other: a burst of writes would gain little, and a refusal stays easy to read.
  for (const issue of issues) {
    if (await assignIssue(
      issue.key,
      user
    )) done++;
  }
  setBulkBusy(false);
  if (done) flashInfo(`${done === 1 ? "1 issue" : `${done} issues`} assigned to ${name}`);
}

async function bulkMove(column) {
  const board = currentBoard();
  const target = board.columns[column];
  const issues = pickedIssues().filter(issue => !target.statusIds.some(id => String(id) === String(issue.statusId)));
  if (!issues.length) {
    flashInfo(`Already in ${target.name}`);
    return;
  }
  // The same read as a drag, once per issue: the path depends on each one's status and workflow.
  setBulkBusy("Checking the transitions…");
  const plans = await Promise.all(issues.map(async issue => {
    const transitions = await loadTransitions(issue.key).promise;
    const route = transitions.error ? null : routeTo(
      transitions,
      column
    );
    return { issue, transitions, route };
  }));
  setBulkBusy(false);
  if (currentBoard() !== board) return;
  const movable = plans.filter(plan => plan.route);
  const pill = id => `<span class="status-pill ${escapeHtml(board.statuses[id]?.category ?? "")}">${escapeHtml(board.statuses[id]?.name ?? "")}</span>`;
  const rows = plans.map(({ issue, transitions, route }) => bulkRow(
    issue,
    route
      ? `${pill(issue.statusId)} → ${pill(route.statusId)}${route.steps.length > 1 ? `<span class="skipped">${route.steps.length} transitions</span>` : ""}`
      : `<span class="skipped">left as is: ${escapeHtml(transitions.error ?? "no known path leads there")}</span>`
  ));
  if (!movable.length) {
    flashError(`None of the picked issues can be moved to ${target.name}`);
    return;
  }
  const plural = movable.length === 1 ? "1 issue" : `${movable.length} issues`;
  if (!await confirmBulk(
    `Move ${plural} to ${target.name}`,
    rows,
    "Move"
  )) return;
  setBulkBusy("Moving…");
  let done = 0;
  for (const { issue, transitions } of movable) {
    if (await moveIssue(
      issue.key,
      column,
      null,
      transitions,
      true
    )) done++;
  }
  setBulkBusy(false);
  if (done) flashInfo(`${done === 1 ? "1 issue" : `${done} issues`} moved to ${target.name}`);
}

$("bulk").addEventListener("change", e => {
  const value = e.target.value;
  if (value === "") return;
  if (e.target.id === "bulk-assign") {
    bulkAssign(value === "-1" ? null : $("bulk").people[Number(value)]);
  } else if (e.target.id === "bulk-move") {
    bulkMove(Number(value));
  }
  e.target.value = "";
});
$("bulk").addEventListener("click", e => {
  if (e.target.id === "bulk-clear") clearPicked();
});

// ---------- Stand-up ----------

// Everyone with an issue in the sprint, and everyone who acted on one since then without any assigned (who
// writes the issues, sends them back, reassigns them: their day shows in what they did), by first name;
// then, set apart, the unassigned issues and the automation accounts.
function standupPeople(
  board,
  activity
) {
  const names = new Map();
  const add = (login, name) => {
    if (![...names.keys()].some(known => known.toLowerCase() === login.toLowerCase())) names.set(login, firstName(login, name));
  };
  for (const issue of board.issues) if (issue.assignee) add(issue.assignee, issue.assigneeName);
  const keys = new Set(board.issues.map(issue => issue.key));
  for (const issue of activity) {
    if (!keys.has(issue.key)) continue;
    for (const change of issue.changes) if (change.author?.name) add(change.author.name, change.author.displayName);
  }
  const people = [...names.keys()].sort((a, b) => names.get(a).localeCompare(names.get(b), undefined, { sensitivity: "base" }));
  return [
    ...people.filter(login => !isAutomation(login)),
    ...board.issues.some(issue => !issue.assignee) ? [null] : [],
    ...people.filter(isAutomation),
  ];
}

// Name and avatar of a person of the round, from one of their issues.
function standupPerson(
  board,
  login
) {
  const issue = board.issues.find(i => (i.assignee ?? null) === login);
  // Someone with no issue: their name comes from what they did.
  const author = issue ? null : (state.standup?.activity ?? []).flatMap(i => i.changes).find(change => authoredBy(
    change,
    login
  ))?.author;
  const name = issue?.assigneeName ?? author?.displayName;
  return {
    login,
    name: name ?? login,
    first: login ? firstName(login, name) : "Unassigned issues",
    avatar: issue?.avatar,
  };
}

function toggleStandup() {
  if (state.standup) {
    endStandup();
    return;
  }
  const board = currentBoard();
  if (!board) return;
  const since = standupSince();
  state.standup = { people: standupPeople(
    board,
    []
  ), index: null, spoke: new Set(), since, activity: [], touched: new Set() };
  closeDetail();
  clearPicked();
  // Built once: the board renders again at every sync, and the field must keep what is being typed.
  $("standup").innerHTML = `<div class="who"><span class="name" id="standup-current"></span><span class="meta" id="standup-meta"></span>` +
    `<span class="spacer"></span>` +
    `<input type="text" id="standup-query" autocomplete="off" spellcheck="false" placeholder="Next: type a name, Enter" ` +
    `aria-label="Who speaks next" title="Enter alone: someone who has not spoken yet">` +
    `<button type="button" id="standup-end" title="Back to the whole board (Shift + S, or Escape twice)">End stand-up</button></div>` +
    `<div class="people" id="standup-people" role="toolbar" aria-label="Participants"></div>` +
    `<div class="changes" id="standup-changes" hidden></div>`;
  renderBoard();
  $("standup-query").focus();
  request(
    `/activity?since=${since}`,
    { timeout: LOCAL_TIMEOUT_MS }
  ).then(response => response.ok ? response.json() : null).catch(() => null).then(body => {
    if (!body || state.standup?.since !== since) return;
    const standup = state.standup;
    standup.activity = body.issues;
    // Those who only acted join the round: whoever has the floor or has spoken keeps it, by login.
    const before = standup.people;
    standup.people = standupPeople(
      currentBoard(),
      body.issues
    );
    if (standup.index !== null) standup.index = standup.people.indexOf(before[standup.index]);
    standup.spoke = new Set([...standup.spoke].map(i => standup.people.indexOf(before[i])));
    // The issues the person speaking acted on join the board: render it all, not only the strip.
    updateTouched();
    renderBoard();
  });
}

function endStandup() {
  state.standup = null;
  renderBoard();
}

// The floor goes to that person (null: nobody, the whole board); whoever had it has spoken.
function giveFloor(index) {
  const standup = state.standup;
  if (standup.index !== null) standup.spoke.add(standup.index);
  standup.index = index;
  if (index !== null) standup.spoke.delete(index);
  updateTouched();
  const query = $("standup-query");
  query.value = "";
  closeDetail();
  clearPicked();
  renderBoard();
  query.focus({ preventScroll: true });
}

// The login whose changes count as theirs: undefined while nobody speaks, null for the unassigned issues,
// which nobody authors.
function speakerLogin() {
  const standup = state.standup;
  return standup?.index == null ? undefined : standup.people[standup.index];
}

const authoredBy = (
  change,
  login
) => !!login && change.author?.name?.toLowerCase() === login.toLowerCase();

// What the person speaking did since then, on any issue of the sprint: what they handed over counts too.
function speakerActivity() {
  const login = speakerLogin();
  return state.standup.activity
    .map(issue => ({ ...issue, changes: issue.changes.filter(change => authoredBy(
      change,
      login
    )) }))
    .filter(issue => issue.changes.length);
}

function updateTouched() {
  state.standup.touched = new Set(speakerActivity().map(issue => issue.key));
}

// An issue on the board for what the person speaking did on it, not for being theirs.
function touchedElsewhere(issue) {
  const login = speakerLogin();
  return login !== undefined && state.standup.touched.has(issue.key) && (issue.assignee ?? null) !== login;
}

// Of those, one that was theirs since then; the others they only worked on (a comment, a move): someone who
// writes or checks the issues without being assigned any hands nothing over.
function handedOver(issue) {
  const login = speakerLogin()?.toLowerCase();
  return state.standup.activity.some(entry => entry.key === issue.key
    && entry.changes.some(change => change.kind === "assignee" && change.from?.toLowerCase() === login));
}

// Nobody named: the next one in the row who has not spoken yet, and nobody once everyone has.
function nextSpeaker() {
  const { people, index, spoke } = state.standup;
  const count = people.length;
  const from = index ?? -1;
  for (let step = 1; step <= count; step++) {
    const candidate = (from + step) % count;
    // What an automation did is looked at when asked, never as a turn of the round.
    if (candidate !== index && !spoke.has(candidate) && !isAutomation(people[candidate])) {
      giveFloor(candidate);
      return;
    }
  }
  giveFloor(null);
}

// The people whose first name starts with what is typed, else whose name or login contains it.
function standupMatches(query) {
  const typed = normalize(query.trim());
  if (!typed) return [];
  const board = currentBoard();
  const people = state.standup.people.map((login, index) => ({ index, ...standupPerson(
    board,
    login
  ) }));
  const starts = people.filter(p => normalize(p.first).startsWith(typed));
  return starts.length ? starts.map(p => p.index) : people.filter(p => normalize(`${p.first} ${p.name} ${p.login ?? ""}`).includes(typed)).map(p => p.index);
}

const notPerson = login => login === null || isAutomation(login);

function renderStandup() {
  const standup = state.standup;
  $("standup-toggle").setAttribute("aria-pressed", String(!!standup));
  $("standup").hidden = !standup;
  const board = currentBoard();
  if (!standup || !board) return;
  const { people, index, spoke } = standup;
  const left = people.filter((login, i) => i !== index && !spoke.has(i) && !isAutomation(login)).length;
  const matches = new Set(standupMatches($("standup-query").value));
  let current = "";
  let meta = "";
  if (index !== null) {
    const person = standupPerson(
      board,
      people[index]
    );
    const shown = visibleIssues(board);
    const issues = shown.filter(issue => !touchedElsewhere(issue));
    const handed = shown.filter(issue => touchedElsewhere(issue) && handedOver(issue)).length;
    const worked = shown.length - issues.length - handed;
    const points = issues.reduce((sum, issue) => sum + (issue.points ?? 0), 0);
    current = `${avatar(person.login, person.name, person.avatar)}${escapeHtml(person.first)}`;
    meta = `${issues.length} issue${issues.length === 1 ? "" : "s"}${points ? ` · ${formatPoints(points)} pts` : ""}` +
      `${handed ? ` · ${handed} handed over` : ""}${worked ? ` · ${worked} worked on` : ""} · `;
  } else {
    current = escapeHtml(spoke.size ? "Everyone spoke" : "Who starts?");
  }
  meta += left ? `${left} left` : index === null ? "" : "last one";
  $("standup-current").innerHTML = current;
  $("standup-meta").textContent = meta;
  $("standup-end").classList.toggle("done", index === null && spoke.size > 0);
  const row = people.map((login, i) => {
    const person = standupPerson(
      board,
      login
    );
    const classes = [i === index ? "current" : "", spoke.has(i) ? "spoke" : "", matches.has(i) ? "match" : ""].filter(Boolean).join(" ");
    // Not people: the issues nobody holds and the automation accounts, set apart at the end.
    const apart = i > 0 && notPerson(login) && !notPerson(people[i - 1]) ? `<span class="sep" aria-hidden="true"></span>` : "";
    return `${apart}<button type="button" data-speaker="${i}" class="${classes}" aria-pressed="${i === index}"` +
      ` title="${escapeHtml(person.login ? person.name : "Unassigned issues")}${spoke.has(i) ? " (spoke)" : ""}">` +
      `${avatar(person.login, person.name, person.avatar)}<span class="label">${escapeHtml(person.first)}</span></button>`;
  }).join("");
  // Rebuilt only when it changes: a sync must not swallow a click on a person.
  const peopleEl = $("standup-people");
  if (peopleEl.dataset.html !== row) {
    peopleEl.dataset.html = row;
    peopleEl.innerHTML = row;
  }
  const changesEl = $("standup-changes");
  changesEl.hidden = index === null;
  if (index === null) return;
  const login = speakerLogin();
  const since = escapeHtml(formatSince(standup.since));
  const did = speakerActivity();
  // What others did on the cards now theirs: a ticket sent back, a comment waiting for an answer.
  const own = new Set(board.issues.filter(issue => (issue.assignee ?? null) === login).map(issue => issue.key));
  const others = standup.activity
    .filter(issue => own.has(issue.key))
    .map(issue => ({ ...issue, changes: issue.changes.filter(change => !authoredBy(
      change,
      login
    )) }))
    .filter(issue => issue.changes.length);
  // The unassigned issues have nobody to report on them: only what happened to them.
  changesEl.innerHTML = (login === null ? "" : `<h3>Did since ${since}</h3>` +
    (did.length ? activityHtml(did) : `<p>No column move, assignment or comment since ${since}.</p>`)) +
    `<h3>${login === null ? "Changes on unassigned issues" : "Changed by others on their issues"} since ${since}</h3>` +
    (others.length ? activityHtml(others) : `<p>Nothing.</p>`);
}

$("standup-toggle").addEventListener("click", toggleStandup);
$("standup").addEventListener("click", e => {
  if (e.target.closest("#standup-end")) {
    endStandup();
    return;
  }
  const speaker = e.target.closest("[data-speaker]");
  if (speaker) {
    giveFloor(Number(speaker.dataset.speaker));
    return;
  }
  const issue = e.target.closest("[data-open]");
  if (issue) openDetail(issue.dataset.open);
});
$("standup").addEventListener("input", e => {
  if (e.target.id === "standup-query") renderStandup();
});
$("standup").addEventListener("keydown", e => {
  if (e.target.id !== "standup-query" || e.key !== "Enter") return;
  e.preventDefault();
  if (!e.target.value.trim()) {
    nextSpeaker();
    return;
  }
  const [first] = standupMatches(e.target.value);
  if (first !== undefined) giveFloor(first);
});

// ---------- Since the last visit ----------

function startVisit() {
  const now = Date.now();
  const lastSeen = Number(readPreference(LAST_SEEN_KEY)) || 0;
  const saved = Number(readPreference(VISIT_SINCE_KEY)) || 0;
  // First visit ever: nothing to compare with yet.
  state.visitSince = !lastSeen ? now : now - lastSeen > VISIT_GAP_MS ? lastSeen : saved || lastSeen;
  savePreference(
    VISIT_SINCE_KEY,
    String(state.visitSince)
  );
  savePreference(
    LAST_SEEN_KEY,
    String(now)
  );
  loadActivity();
}

async function loadActivity() {
  if (!state.visitSince) return;
  const body = await request(
    `/activity?since=${state.visitSince}`,
    { timeout: LOCAL_TIMEOUT_MS }
  ).then(response => response.ok ? response.json() : null).catch(() => null);
  if (!body) return;
  state.activity = body.issues;
  renderActivity();
}

const isMe = user => !!user?.name && user.name.toLowerCase() === state.meta?.me?.toLowerCase();

// Other people's changes only: mine, I know about.
function othersActivity(issues) {
  return issues
    .map(issue => ({ ...issue, changes: issue.changes.filter(change => !isMe(change.author)) }))
    .filter(issue => issue.changes.length);
}

function renderActivity() {
  const issues = othersActivity(state.activity);
  const open = !$("activity-panel").hidden;
  const count = issues.reduce((sum, issue) => sum + issue.changes.length, 0);
  // The bell counts issues, not changes: an issue moved three times and commented on twice is one thing to
  // look at. A new change on an issue already listed does not raise it.
  $("activity-count").hidden = !issues.length;
  $("activity-count").textContent = issues.length > ACTIVITY_BADGE_MAX ? `${ACTIVITY_BADGE_MAX}+` : issues.length;
  $("activity-btn").title = (count
    ? `${count} change${count === 1 ? "" : "s"} by others on ${issues.length} issue${issues.length === 1 ? "" : "s"} since ${formatSince(state.visitSince)}`
    : `Nothing changed by others since ${formatSince(state.visitSince)}`) +
    (state.notify ? "" : " · desktop notifications off");
  $("activity-btn").setAttribute("aria-label", $("activity-btn").title);
  if (!open) return;
  $("activity-panel").innerHTML = `<div class="bar"><h4>Changed by others since ${escapeHtml(formatSince(state.visitSince))}</h4>` +
    (issues.length ? `<button type="button" id="activity-read" title="Start a new list from now">Mark all as read</button>` : "") + `</div>` +
    `<label class="notify-toggle" title="When someone else changes one of your issues (status, comment, assignment)"><input type="checkbox" id="notify"${state.notify ? " checked" : ""}> Notify me on the desktop when one of my issues changes</label>` +
    (issues.length ? activityHtml(issues) : `<p class="muted">Nothing new.</p>`);
}

// One entry per issue, its changes oldest first; shared with the stand-up.
function activityHtml(issues) {
  return `<ul class="activity-list">` + issues.map(issue =>
    `<li><button type="button" class="issue" data-open="${escapeHtml(issue.key)}" title="Show ${escapeHtml(issue.key)}">` +
    `<span class="key">${escapeHtml(issue.key)}</span><span class="summary">${escapeHtml(issue.summary ?? "")}</span></button>` +
    `<ul>${issue.changes.map(changeHtml).join("")}</ul></li>`
  ).join("") + `</ul>`;
}

function changeHtml(change) {
  const who = `<span class="who">${escapeHtml(change.author?.displayName ?? change.author?.name ?? "Someone")}</span>`;
  const when = `<span class="when" title="${escapeHtml(formatDate(change.at))}">${escapeHtml(relative(change.at))}</span>`;
  if (change.kind === "comment") return `<li>${who} commented: <span class="text">${escapeHtml(change.text)}</span>${when}</li>`;
  if (change.kind === "status") return `<li>${who} moved it ${statusPill(change.from)} → ${statusPill(change.to)}${when}</li>`;
  return `<li>${who} ${change.to ? `assigned it to <span class="text">${escapeHtml(change.to)}</span>` : "unassigned it"}${when}</li>`;
}

// The history gives status names only: the colour comes from the board's status of that name.
function statusPill(name) {
  const category = Object.values(currentBoard()?.statuses ?? {}).find(status => status.name === name)?.category ?? "";
  return `<span class="status-pill ${escapeHtml(category)}">${escapeHtml(name ?? "—")}</span>`;
}

function formatSince(at) {
  const date = new Date(at);
  const time = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(at).setHours(0, 0, 0, 0)) / 86400000);
  if (days === 0) return time;
  if (days === 1) return `yesterday ${time}`;
  return `${date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} ${time}`;
}

function toggleActivityPanel(open) {
  $("activity-panel").hidden = !open;
  $("activity-btn").setAttribute("aria-expanded", String(open));
  if (open) {
    alignPopover(
      $("activity-panel"),
      $("activity-btn")
    );
  }
  renderActivity();
}

$("activity-btn").addEventListener("click", () => toggleActivityPanel($("activity-panel").hidden));
$("activity-panel").addEventListener("change", e => {
  // Refused by the browser, the box goes back to what is in force.
  if (e.target.id === "notify") toggleNotify().finally(renderActivity);
});
$("activity-panel").addEventListener("click", e => {
  if (e.target.closest("#activity-read")) {
    state.visitSince = Date.now();
    savePreference(
      VISIT_SINCE_KEY,
      String(state.visitSince)
    );
    state.activity = [];
    toggleActivityPanel(false);
    return;
  }
  const issue = e.target.closest("[data-open]");
  if (issue) {
    toggleActivityPanel(false);
    openDetail(issue.dataset.open);
  }
});

// ---------- Notifications ----------

function notifyChanges(recent) {
  const previous = state.seenChanges;
  state.seenChanges = recent;
  if (!document.hidden) savePreference(
    LAST_SEEN_KEY,
    String(Date.now())
  );
  if (previous && Object.entries(recent).some(([key, at]) => at > (previous[key] ?? 0))) loadActivity();
  if (!previous || !state.notify) return;
  for (const [key, at] of Object.entries(recent)) {
    if (at > (previous[key] ?? 0)) notifyIfMine(
      key,
      at
    );
  }
}

// Read from the local copy, which the sync has just written: no Jira request. My own changes (from this
// page or from Jira) are not news.
async function notifyIfMine(
  key,
  at
) {
  const entry = await fetchIssue(
    key,
    "local"
  ).catch(() => null);
  const fields = entry?.data?.fields;
  const me = state.meta?.me?.toLowerCase();
  if (!fields || !me || fields.assignee?.name?.toLowerCase() !== me) return;
  const change = lastChange(
    entry.data,
    at
  );
  if (!change || change.author?.name?.toLowerCase() === me) return;
  const notification = new Notification(
    `${key} ${fields.summary ?? ""}`,
    // The tag: several open tabs show a change once.
    { body: change.text, tag: `${key}@${at}` }
  );
  notification.onclick = () => {
    window.focus();
    openDetail(key);
    notification.close();
  };
}

// The history entry or comment that made the issue's "updated" date, described in one line.
function lastChange(
  data,
  at
) {
  const history = data.changelog?.histories?.at(-1);
  const comment = data.fields.comment?.comments?.at(-1);
  const near = item => item && Math.abs(Date.parse(item.created) - at) <= NOTIFY_MATCH_MS;
  const shorten = text => text.length > NOTIFY_TEXT_LENGTH ? `${text.slice(0, NOTIFY_TEXT_LENGTH - 1)}…` : text;
  const who = user => user?.displayName ?? user?.name ?? "Someone";
  if (near(comment) && (!near(history) || Date.parse(comment.created) >= Date.parse(history.created))) {
    return { author: comment.author, text: shorten(`${who(comment.author)} commented: ${comment.body.replace(/\s+/g, " ")}`) };
  }
  if (!near(history)) return null;
  const items = history.items.map(item => {
    const field = HISTORY_FIELDS[item.field] ?? item.field;
    const from = item.from ?? "";
    const to = item.to ?? "";
    if (from.length > HISTORY_LONG_VALUE || to.length > HISTORY_LONG_VALUE) return `${field} changed`;
    return !from ? `${field}: ${to}` : !to ? `${field}: ${from} removed` : `${field}: ${from} → ${to}`;
  });
  return { author: history.author, text: shorten(`${who(history.author)} — ${items.join(", ")}`) };
}

async function toggleNotify() {
  if (!window.Notification) {
    flashError("This browser cannot show notifications");
    return;
  }
  if (!state.notify && Notification.permission !== "granted" && await Notification.requestPermission() !== "granted") {
    flashError("Notifications are blocked for this page: allow them in the browser's site settings");
    return;
  }
  state.notify = !state.notify;
  savePreference(
    NOTIFY_KEY,
    String(state.notify)
  );
  renderNotifyButton();
}

function renderNotifyButton() {
  $("activity-btn").classList.toggle("on", state.notify);
  renderActivity();
}

// At each poll rather than at each render: a card stops shining once its change gets old, without redrawing
// the board.
function markRecent() {
  document.querySelectorAll(".column .card[data-key]").forEach(card => card.classList.toggle(
    "recent",
    card.dataset.key in state.recent
  ));
}

// What the background sync has written since opening is shown without asking Jira anything.
async function reloadOpenDetail() {
  const key = state.openKey;
  if (!key || document.hidden || state.detailSyncing === key || drag?.started || state.picker) return;
  const entry = await fetchIssue(
    key,
    "local"
  ).catch(() => null);
  const shown = state.detail.get(key);
  if (!entry || state.openKey !== key || state.detailSyncing === key) return;
  if (shown && Date.parse(entry.syncedAt) <= Date.parse(shown.syncedAt)) return;
  remember(entry);
  renderDetail(key, {});
}

function closeDetail() {
  hidePreview();
  state.picker = null;
  state.openKey = null;
  state.openToken = null;
  $("panel").hidden = true;
  if (state.sizeBeforeMiddle !== null) {
    state.maximized = state.sizeBeforeMiddle;
    state.sizeBeforeMiddle = null;
    applyMaximized();
  }
  for (const el of document.querySelectorAll(".card.selected")) el.classList.remove("selected");
}

// Closed by the user, the panel hands the keyboard back to the card it showed: without it, focus falls back
// to the page's start and the next Tab begins from the header again.
function closeDetailToCard() {
  const key = state.openKey;
  closeDetail();
  focusCard(key);
}

// Into the detail (Tab from its card): the arrows then scroll what is read, the description in bottom mode.
function focusDetail() {
  const content = $("panel-content");
  const body = content.querySelector(":scope > .body");
  (body && body.scrollHeight > body.clientHeight ? body : content).focus({ preventScroll: true });
}

function focusCard(key) {
  const card = key && document.querySelector(`.card[data-key="${CSS.escape(key)}"]`);
  if (!card) return;
  // Ringed even when the panel was opened with the mouse, where the browser would not show the focus: the
  // next keys start from that card, so it must be seen.
  card.classList.add("focus-return");
  card.addEventListener(
    "blur",
    () => card.classList.remove("focus-return"),
    { once: true }
  );
  card.focus({ preventScroll: true });
}

function renderDetail(
  key,
  { syncing = false, syncError = null }
) {
  const board = currentBoard();
  const issue = board?.issues.find(i => i.key === key);
  const entry = state.detail.get(key);
  const data = entry?.data;
  $("panel-sync").innerHTML = syncing
    ? `<span class="muted">Syncing with Jira…</span>` + (entry ? ` <span class="muted">(copy from ${escapeHtml(formatDate(entry.syncedAt))})</span>` : "")
    : entry
      ? `<button type="button" class="resync ${syncError ? "sync-failed" : "muted"}" title="${escapeHtml(syncError ? `${syncError} — click to retry` : "Click to resync from Jira")}">${syncError ? "Sync failed · local copy synced" : "Synced"} <span class="sync-age" data-at="${checkedAt(entry)}">${syncAge(checkedAt(entry))}</span></button>`
      : syncError
        ? `<button type="button" class="resync sync-failed" title="${escapeHtml(`${syncError} — click to retry`)}">Sync failed · click to retry</button>`
        : "";
  $("panel-key").textContent = key;
  $("panel-key").href = browseUrl(key);
  const f = data?.fields;
  const status = f ? { name: f.status.name, category: f.status.statusCategory?.key } : board?.statuses[issue?.statusId];
  const epic = issue && board.epics[issue.epicId];
  const points = f ? custom(f, "storyPoints") : issue?.points;
  const facts = [
    ["Status", status ? `<span class="status-pill ${escapeHtml(status.category ?? "")}">${escapeHtml(status.name)}</span>` : ""],
    ["Resolution", f?.resolution ? escapeHtml(f.resolution.name) + (f.resolutiondate ? ` <span class="muted">on ${formatDate(f.resolutiondate)}</span>` : "") : null],
    ["Type", f ? `${icon({ url: f.issuetype.iconUrl, name: f.issuetype.name })}${escapeHtml(f.issuetype.name)}` : issue ? `${icon(board.types[issue.typeId])}${escapeHtml(board.types[issue.typeId]?.name)}` : ""],
    ["Priority", f?.priority ? `${icon({ url: f.priority.iconUrl, name: f.priority.name })}${escapeHtml(f.priority.name)}` : issue ? `${icon(board.priorities[issue.priorityId])}${escapeHtml(board.priorities[issue.priorityId]?.name)}` : ""],
    ["Criticality", custom(f, "criticality") ? escapeHtml(custom(f, "criticality").value) : null],
    ["Story points", points != null ? `<span class="sp">${formatPoints(points)}</span>` : "—"],
    GROUP,
    ["Assignee", assigneeHtml(
      key,
      f ? f.assignee : issue && { name: issue.assignee, displayName: issue.assigneeName, avatarUrls: { "48x48": issue.avatar } }
    )],
    ["Developer", custom(f, "developer") ? person(custom(f, "developer")) : null],
    ["Tester", custom(f, "tester") ? person(custom(f, "tester")) : null],
    ["Reporter", f ? person(f.reporter) : null],
    GROUP,
    ["Epic", epic ? `<span class="epic" style="--epic:${EPIC_COLORS[epic.color] ?? "#c1c7d0"}">${escapeHtml(epic.text)}</span> <a href="${browseUrl(epic.key)}" target="_blank" rel="noopener">${escapeHtml(epic.key)}</a>` : null],
    ["Sprints", sprintsHtml(custom(f, "sprints"))],
    ["Version", f?.fixVersions?.length ? f.fixVersions.map(v => `<span class="tag">${escapeHtml(v.name)}</span>`).join("") : null],
    ["Components", f?.components?.length ? f.components.map(c => `<span class="tag">${escapeHtml(c.name)}</span>`).join("") : null],
    ["Labels", f?.labels?.length ? f.labels.map(l => `<span class="tag">${escapeHtml(l)}</span>`).join("") : null],
    ["Environments", custom(f, "environments")?.length ? custom(f, "environments").map(e => `<span class="tag">${escapeHtml(e.value)}</span>`).join("") : null],
    ["Due date", f?.duedate ? escapeHtml(f.duedate.split("-").reverse().join("/")) : null],
    GROUP,
    ["Created", f ? dated(f.created) : null],
    ["Updated", f ? dated(f.updated) : null],
    ["Delivered", custom(f, "deliveredAt") ? dated(custom(f, "deliveredAt")) : null],
    ["Installed", custom(f, "installedAt") ? dated(custom(f, "installedAt")) : null],
    ["Accepted", custom(f, "acceptedAt") ? dated(custom(f, "acceptedAt")) : null],
  ].filter(fact => fact === GROUP || fact[1] != null);
  const description = data
    ? `<div class="rich">${data.renderedFields?.description ? sanitize(data.renderedFields.description) : `<span class="muted">No description.</span>`}</div>`
    : `<p class="muted">${syncing ? "Loading…" : "Detail unavailable."}</p>`;
  // Another issue: the detail starts from the top; a resync of the same issue keeps the reading position.
  const sameTicket = state.renderedKey === key;
  state.renderedKey = key;
  const positions = sameTicket ? panelScrollers().map(el => el.scrollTop) : [];
  $("panel-content").innerHTML =
    // Focusable, like the content around them: a click or Tab in one lets the arrows scroll it (bottom mode).
    `<div class="head" tabindex="-1"><h3>${escapeHtml(f?.summary ?? issue?.summary ?? key)}</h3>${factsHtml(facts)}</div>` +
    `<div class="body" tabindex="-1"><h4 data-jump="description">Description</h4>${description}${f ? linksHtml(f) + attachmentsHtml(f) : ""}</div>` +
    `<div class="comments" tabindex="-1">${data ? commentsHtml(data) + historyHtml(data) : ""}</div>`;
  panelScrollers().forEach((el, index) => { el.scrollTop = positions[index] ?? 0; });
  if (!sameTicket) $("panel-top").classList.remove("shown");
  renderJump();
  if (state.picker?.key === key) {
    renderPickerOptions();
    const input = $("assignee-query");
    input.focus({ preventScroll: true });
    input.setSelectionRange(input.value.length, input.value.length);
  }
}

// Separator between two groups of fields: state, people, planning, dates.
const GROUP = Symbol("group");

function factsHtml(facts) {
  const groups = [[]];
  for (const fact of facts) {
    if (fact === GROUP) groups.push([]);
    else groups.at(-1).push(fact);
  }
  return groups.filter(group => group.length)
    .map(group => `<dl class="facts">${group.map(([label, value]) => `<dt>${label}</dt><dd>${value}</dd>`).join("")}</dl>`)
    .join("");
}

const dated = iso => `${formatDate(iso)} <span class="muted">(${relative(Date.parse(iso))})</span>`;

// Sprints the issue went through, in order: a carried-over issue shows at a glance.
// Jira Server returns them serialised ("…Sprint@1a2b[id=…,name=[ABC] Sprint 7,…]").
function sprintsHtml(sprints) {
  if (!sprints?.length) return null;
  const names = sprints.map(s => typeof s === "string" ? /,name=(.*?),[a-zA-Z]+=/.exec(s)?.[1] : s.name).filter(Boolean);
  if (!names.length) return null;
  return names.map(name => `<span class="tag">${escapeHtml(name.replace(/^\[[^\]]*\]\s*/, ""))}</span>`).join(" → ") +
    (names.length > 1 ? ` <span class="muted">(carried over ${names.length - 1} time${names.length > 2 ? "s" : ""})</span>` : "");
}

function linksHtml(f) {
  const rows = [
    ...(f.issuelinks ?? []).map(link => link.outwardIssue
      ? { relation: link.type.outward, issue: link.outwardIssue }
      : { relation: link.type.inward, issue: link.inwardIssue }),
    ...(f.subtasks ?? []).map(issue => ({ relation: "subtask", issue })),
  ].filter(row => row.issue);
  if (!rows.length) return `<h4 data-jump="links" data-count="0">Links</h4><p class="muted">No links.</p>`;
  return `<h4 data-jump="links" data-count="${rows.length}">Links (${rows.length})</h4><ul class="links">` + rows.map(({ relation, issue }) => {
    const status = issue.fields?.status;
    return `<li><span class="relation">${escapeHtml(relation)}</span>` +
      (issue.fields?.issuetype ? icon({ url: issue.fields.issuetype.iconUrl, name: issue.fields.issuetype.name }) : "") +
      `<a href="${browseUrl(issue.key)}" target="_blank" rel="noopener">${escapeHtml(issue.key)}</a>` +
      `<span class="summary" title="${escapeHtml(issue.fields?.summary ?? "")}">${escapeHtml(issue.fields?.summary ?? "")}</span>` +
      (status ? `<span class="status-pill ${escapeHtml(status.statusCategory?.key ?? "")}">${escapeHtml(status.name)}</span>` : "") +
      `</li>`;
  }).join("") + `</ul>`;
}

function attachmentsHtml(f) {
  const files = f.attachment ?? [];
  if (!files.length) return `<h4 data-jump="attachments" data-count="0">Attachments</h4><p class="muted">No attachments.</p>`;
  return `<h4 data-jump="attachments" data-count="${files.length}">Attachments (${files.length})</h4><ul class="links">` + files.map(file =>
    `<li><a href="${escapeHtml(relayed(file.content))}" target="_blank" rel="noopener"` +
    (file.mimeType?.startsWith("image/") ? ` class="previewable" data-preview="${escapeHtml(relayed(file.content))}"` : "") +
    `>${escapeHtml(file.filename)}</a>` +
    `<span class="muted">${formatSize(file.size)} · ${escapeHtml(file.author?.displayName ?? "")} · ${formatDate(file.created)}</span></li>`
  ).join("") + `</ul>`;
}

function commentsHtml(data) {
  const raw = data.fields.comment?.comments ?? [];
  const rendered = data.renderedFields?.comment?.comments ?? [];
  if (!raw.length) return `<h4 data-jump="comments" data-count="0">Comments</h4><p class="muted">No comments.</p>`;
  // Newest first: it is the one people come to read.
  const items = raw.map((c, i) => ({ author: c.author, created: c.created, body: rendered[i]?.body ?? escapeHtml(c.body) })).reverse();
  return `<h4 data-jump="comments" data-count="${raw.length}">Comments (${raw.length})</h4>` + items.map(c =>
    `<div class="comment"><div class="who">${person(c.author)}<span class="when">${formatDate(c.created)} · ${relative(Date.parse(c.created))}</span></div>` +
    `<div class="rich">${sanitize(c.body)}</div></div>`
  ).join("");
}

// History field names as Jira returns them (system id or custom field label).
const HISTORY_FIELDS = {
  status: "Status", assignee: "Assignee", reporter: "Reporter", resolution: "Resolution",
  summary: "Summary", description: "Description", labels: "Labels", priority: "Priority",
  issuetype: "Type", duedate: "Due date", "Fix Version": "Version", Component: "Component",
  "Story Points": "Story points", "Epic Link": "Epic", Link: "Link", Attachment: "Attachment",
  Rank: "Rank", Sprint: "Sprint", Comment: "Comment",
};
// Beyond this length, the old and new values (typically a description) are collapsed.
const HISTORY_LONG_VALUE = 120;
const HISTORY_BOT = /automat/i;

function historyHtml(data) {
  historyDiffs.length = 0;
  const histories = data.changelog?.histories;
  if (!histories) return "";
  if (!histories.length) return `<h4 data-jump="history" data-count="0">History</h4><p class="muted">No changes.</p>`;
  // Newest first, like the comments.
  return `<h4 data-jump="history" data-count="${histories.length}">History (${histories.length})</h4><ol class="history">` + [...histories].reverse().map(h =>
    `<li class="${HISTORY_BOT.test(h.author?.displayName ?? "") ? "bot" : ""}">` +
    `<div class="who">${person(h.author)}<span class="when" title="${escapeHtml(formatDate(h.created))}">${relative(Date.parse(h.created))}</span></div>` +
    `<ul>${h.items.map(item => historyItemHtml(
      item,
      h
    )).join("")}</ul></li>`
  ).join("") + `</ol>`;
}

// The long changes of the detail shown, by the index its button carries: the dialog reads them from here.
const historyDiffs = [];

function historyItemHtml(
  item,
  history
) {
  const label = HISTORY_FIELDS[item.field] ?? item.field;
  const field = `<span class="field">${escapeHtml(label)}</span>`;
  const from = item.from ?? "";
  const to = item.to ?? "";
  // Jira strikes the whole old text through before the whole new one: past a line, the change opens in a
  // dialog that shows only the lines that changed.
  if (from.length > HISTORY_LONG_VALUE || to.length > HISTORY_LONG_VALUE || /\n/.test(from + to)) {
    const lines = diffLines(
      from,
      to
    );
    const { added, removed } = diffStats(lines);
    const count = n => `${n} line${n === 1 ? "" : "s"}`;
    const summary = !from ? `added, ${count(added)}`
      : !to ? `removed, ${count(removed)}`
        : !added && !removed ? "line breaks or spaces only"
          : lines.length <= 2 && added === 1 && removed === 1 ? "edited"
            : `+${added} −${removed} lines`;
    historyDiffs.push({ label, history, from, to, lines });
    return `<li>${field} <button type="button" class="diff-open" data-diff="${historyDiffs.length - 1}"` +
      ` title="Show what changed">${escapeHtml(summary)}</button></li>`;
  }
  const change = !from ? `<span class="new">${escapeHtml(to)}</span>`
    : !to ? `<del>${escapeHtml(from)}</del> <span class="muted">(removed)</span>`
      : `<del>${escapeHtml(from)}</del> → <span class="new">${escapeHtml(to)}</span>`;
  return `<li>${field} ${change}</li>`;
}

// ---------- A long value's change, in a dialog ----------

// The change shown, whether its unchanged lines are all shown, and the folds opened one by one (by the line
// number they start at).
const diffView = { entry: null, whole: false, unfolded: new Set() };

function diffLayout() {
  const saved = readPreference(DIFF_LAYOUT_KEY);
  if (saved === "unified" || saved === "split") return saved;
  return window.innerWidth >= DIFF_SPLIT_MIN_WIDTH ? "split" : "unified";
}

function openDiff(index) {
  const entry = historyDiffs[index];
  if (!entry) return;
  Object.assign(diffView, { entry, whole: false, unfolded: new Set() });
  const { added, removed } = diffStats(entry.lines);
  $("diff-title").textContent = `${entry.label} of ${state.openKey}`;
  $("diff-meta").innerHTML = `${escapeHtml(entry.history.author?.displayName ?? "")} · ` +
    `${escapeHtml(formatDate(entry.history.created))} · ` +
    `<span class="added">+${added}</span> <span class="removed">−${removed}</span>`;
  renderDiff();
  $("diff-dialog").showModal();
  // Scrolled with the keyboard at once: the body holds the focus rather than the first button.
  $("diff-body").scrollTop = 0;
  $("diff-body").focus();
}

function renderDiff() {
  const { entry, whole, unfolded } = diffView;
  const layout = diffLayout();
  for (const button of $("diff-dialog").querySelectorAll("[data-layout]")) {
    button.setAttribute("aria-pressed", String(button.dataset.layout === layout));
  }
  $("diff-whole").setAttribute("aria-pressed", String(whole));
  const blocks = diffBlocks(
    entry.lines,
    whole ? Infinity : DIFF_CONTEXT
  ).map(block => block.type === "skip" && unfolded.has(block.lines[0].before) ? { ...block, type: "same" } : block);
  if (!blocks.some(block => block.type === "change")) {
    $("diff-body").innerHTML = `<p class="muted">Only line breaks or trailing spaces changed: the text reads the same.</p>`;
    return;
  }
  const rows = blocks.map(block => layout === "split" ? splitRows(block) : unifiedRows(block)).join("");
  // Fixed layout: the widths come from the columns, not from a first row that may be a fold.
  const columns = layout === "split"
    ? `<col class="no"><col><col class="no"><col>`
    : `<col class="no"><col class="no"><col class="sign"><col>`;
  $("diff-body").innerHTML = `<table class="diff ${layout}"><colgroup>${columns}</colgroup>${rows}</table>`;
}

// The words of one side of an edited line, those that changed marked.
function markedWords(
  parts,
  side
) {
  return parts
    .filter(part => part.type === "same" || part.type === side)
    .map(part => part.type === "same" ? escapeHtml(part.text) : `<span class="word">${escapeHtml(part.text)}</span>`)
    .join("");
}

function foldRow(
  block,
  columns
) {
  const count = block.lines.length;
  return `<tr class="fold"><td colspan="${columns}"><button type="button" class="diff-unfold" data-from="${block.lines[0].before}">` +
    `⋯ ${count} unchanged line${count === 1 ? "" : "s"}</button></td></tr>`;
}

const lineNumber = number => `<td class="no">${number ?? ""}</td>`;

// One column, as git diff: the removed lines of a change, then the added ones.
function unifiedRows(block) {
  if (block.type === "skip") return foldRow(
    block,
    4
  );
  const row = (type, line, html, edited = false) => `<tr class="${type}${edited ? " edited" : ""}">` +
    `${lineNumber(line.before)}${lineNumber(line.after)}` +
    `<td class="sign">${{ same: "", del: "−", add: "+" }[type]}</td><td class="text">${html}</td></tr>`;
  if (block.type === "same") return block.lines.map(line => row("same", line, escapeHtml(line.text))).join("");
  // Between the unchanged lines a change may hold, its removed lines, then its added ones.
  const runs = [[]];
  for (const pair of pairLines(block)) {
    if (pair.same) runs.push(pair, []);
    else runs.at(-1).push(pair);
  }
  const lines = (pairs, side) => pairs.filter(pair => pair[side]).map(pair => row(
    side,
    pair[side],
    pair.parts ? markedWords(pair.parts, side) : escapeHtml(pair[side].text),
    Boolean(pair.parts)
  )).join("");
  return runs.map(run => Array.isArray(run)
    ? lines(run, "del") + lines(run, "add")
    : row("same", run.same, escapeHtml(run.same.text))).join("");
}

// Side by side: the former text on the left, the new one on the right, an edited line facing its old form.
function splitRows(block) {
  if (block.type === "skip") return foldRow(
    block,
    4
  );
  const side = (type, line, number, html) => line
    ? `<td class="no ${type}">${number}</td><td class="text ${type}">${html}</td>`
    : `<td class="no empty"></td><td class="text empty"></td>`;
  const same = line => `<tr>${side("same", line, line.before, escapeHtml(line.text))}` +
    `${side("same", line, line.after, escapeHtml(line.text))}</tr>`;
  if (block.type === "same") return block.lines.map(same).join("");
  return pairLines(block).map(pair => pair.same ? same(pair.same) : `<tr${pair.parts ? ` class="edited"` : ""}>` +
    side("del", pair.del, pair.del?.before, pair.parts ? markedWords(pair.parts, "del") : escapeHtml(pair.del?.text)) +
    side("add", pair.add, pair.add?.after, pair.parts ? markedWords(pair.parts, "add") : escapeHtml(pair.add?.text)) +
    `</tr>`).join("");
}

$("diff-dialog").addEventListener("click", event => {
  const dialog = $("diff-dialog");
  // The backdrop belongs to the dialog itself, its content to the form inside it.
  if (event.target === dialog) {
    dialog.close();
    return;
  }
  const layout = event.target.closest("[data-layout]");
  if (layout) {
    savePreference(
      DIFF_LAYOUT_KEY,
      layout.dataset.layout
    );
    renderDiff();
  }
  if (event.target.closest("#diff-whole")) {
    diffView.whole = !diffView.whole;
    renderDiff();
  }
  const unfold = event.target.closest(".diff-unfold");
  if (unfold) {
    diffView.unfolded.add(Number(unfold.dataset.from));
    renderDiff();
  }
});

function person(user) {
  if (!user?.name) return `<span class="muted">Unassigned</span>`;
  return `${avatar(user.name, user.displayName, user.avatarUrls?.["48x48"])}${escapeHtml(user.displayName ?? user.name)}`;
}

function formatDate(iso) {
  return new Date(iso).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" });
}

// The HTML rendered by Jira is sanitised before insertion: no script, no event handler, no exotic URL
// scheme; its images go through the authenticated relay.
const DROPPED_ELEMENTS = "script,style,iframe,frame,object,embed,form,input,button,textarea,select,link,meta,base,svg,math";

function sanitize(html) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  doc.querySelectorAll(DROPPED_ELEMENTS).forEach(el => el.remove());
  for (const el of doc.body.querySelectorAll("*")) {
    for (const attribute of [...el.attributes]) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on") || name === "srcset" || name === "formaction") {
        el.removeAttribute(attribute.name);
      } else if (name === "href" || name === "src") {
        const url = safeUrl(attribute.value);
        if (!url) el.removeAttribute(attribute.name);
        else el.setAttribute(attribute.name, name === "src" ? relayed(url) : url);
      }
    }
    if (el.tagName === "A") {
      el.setAttribute("target", "_blank");
      el.setAttribute("rel", "noopener noreferrer");
    }
    if (el.tagName === "IMG") el.setAttribute("loading", "lazy");
  }
  return doc.body.innerHTML;
}

function safeUrl(value) {
  try {
    const url = new URL(value, CONFIG.jiraWeb + "/");
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? url.href : null;
  } catch (ignored) {
    return null;
  }
}

// Keyboard navigation in the panel: ↑ ↓ within the column, ← → to the neighbouring column.
function moveSelection(key) {
  const target = neighbourCard(
    document.querySelector(`.card[data-key="${CSS.escape(state.openKey)}"]`),
    key
  );
  if (target) openDetail(target.dataset.key);
}

// The same moves with the panel closed (after Escape, say): the focus goes from card to card, Enter opens one.
function moveFocus(
  current,
  key
) {
  neighbourCard(
    current,
    key
  )?.focus();
}

function neighbourCard(
  current,
  key
) {
  if (!current) return null;
  let target = null;
  if (key === "ArrowUp" || key === "ArrowDown") {
    target = key === "ArrowUp" ? current.previousElementSibling : current.nextElementSibling;
  } else {
    const column = current.closest(".column");
    const index = [...column.querySelectorAll(".card")].indexOf(current);
    let next = key === "ArrowLeft" ? column.previousElementSibling : column.nextElementSibling;
    while (next && !next.querySelector(".card")) next = key === "ArrowLeft" ? next.previousElementSibling : next.nextElementSibling;
    const cards = next ? [...next.querySelectorAll(".card")] : [];
    target = cards[Math.min(index, cards.length - 1)];
  }
  return target?.classList.contains("card") ? target : null;
}

// ---------- URL ----------

function writeUrl() {
  const p = new URLSearchParams();
  if (state.sprintId && state.sprintId !== state.defaultSprint) p.set("sprint", state.sprintId);
  if (state.quick.size) p.set("qf", [...state.quick].join(","));
  if (state.labels.size) p.set("lb", [...state.labels].join(","));
  if (state.q) p.set("q", state.q);
  const query = p.toString();
  history.replaceState(null, "", query ? "?" + query : location.pathname);
}

// ---------- Events ----------

document.addEventListener("click", e => {
  if (e.target.closest("#people-filter")) {
    openPeopleMenu(!state.peopleMenu);
    return;
  }
  if (state.peopleMenu && !e.target.closest("#people-menu")) openPeopleMenu(false);
  if (e.target.closest("#more-filters")) {
    showMoreFilters(!state.filtersOpen);
    return;
  }
  if (state.filtersOpen && !e.target.closest("#filters-more, #people-menu")) showMoreFilters(false);
  if (e.target.closest("#clear-filters")) {
    clearFilters();
    return;
  }
  const viewButton = e.target.closest("[data-view]");
  if (viewButton) {
    setView(viewButton.dataset.view);
    return;
  }
  const labelButton = e.target.closest("[data-label]");
  if (labelButton) {
    state.filtersOpen = false;
    toggleLabel(labelButton.dataset.label);
    return;
  }
  const quick = e.target.closest("[data-qf]");
  if (quick) {
    state.filtersOpen = false;
    const id = quickId(quick.dataset.qf);
    if (state.quick.has(id)) state.quick.delete(id);
    else switchOnFilter(id);
    quickFiltersChanged();
    return;
  }
  const cardEl = e.target.closest(".card");
  // As in a file list: Ctrl + click (Cmd on a Mac, where Ctrl + click is the context menu) picks a card,
  // Shift + click the cards between the last one clicked and this one (added to the others with Ctrl too).
  // Neither opens Jira, as they would on a link: leaving the board for Jira must be deliberate (J, the key
  // in the detail, or Alt + middle click).
  if (cardEl && e.button === 0 && e.shiftKey) {
    e.preventDefault();
    pickRange(
      cardEl.dataset.key,
      e.ctrlKey || e.metaKey
    );
    return;
  }
  if (cardEl && e.button === 0 && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    togglePicked(cardEl.dataset.key);
    return;
  }
  if (cardEl && e.button === 0) {
    e.preventDefault();
    clearPicked();
    // Selecting text ends with a click: a drag-selection, or a double or triple click on a word, must
    // neither open nor close the detail.
    const selection = getSelection();
    if (e.detail > 1 || (!selection.isCollapsed && cardEl.contains(selection.anchorNode))) return;
    if (state.openKey === cardEl.dataset.key) closeDetail();
    else openDetail(cardEl.dataset.key);
  }
});

// A middle click on a link opens it in a new tab: on a card, it rather shows the issue on the whole page,
// and only Alt + middle click, a gesture nobody makes by accident, opens it in Jira.
document.addEventListener("auxclick", e => {
  const cardEl = e.button === 1 && e.target.closest(".card[data-key]");
  if (!cardEl) return;
  e.preventDefault();
  if (e.altKey) {
    window.open(
      browseUrl(cardEl.dataset.key),
      "_blank",
      "noopener"
    );
    return;
  }
  clearPicked();
  if (state.openKey !== cardEl.dataset.key) openDetail(cardEl.dataset.key);
  state.sizeBeforeMiddle ??= state.maximized;
  state.maximized = true;
  applyMaximized();
});

// Pressing the middle button starts the autoscroll on Windows, or pastes the selection on Linux.
document.addEventListener("mousedown", e => {
  if (e.button === 1 && e.target.closest(".card[data-key]")) e.preventDefault();
});

// ---------- Copying issues ----------

// Shift + mousedown would extend the text selection up to the card: it picks cards instead.
document.addEventListener("mousedown", e => {
  if (e.shiftKey && e.button === 0 && e.target.closest(".card")) e.preventDefault();
});

// The cards in between, in the order they are shown (column after column, filters applied).
function pickRange(
  key,
  adding
) {
  const anchor = state.pickAnchor ?? state.openKey;
  const keys = [...document.querySelectorAll(".card[data-key]:not(.drag-ghost)")].map(el => el.dataset.key);
  const from = keys.indexOf(anchor);
  const to = keys.indexOf(key);
  if (!adding) state.picked.clear();
  if (from < 0) {
    state.picked.add(key);
    state.pickAnchor = key;
  } else {
    for (const between of keys.slice(Math.min(from, to), Math.max(from, to) + 1)) state.picked.add(between);
  }
  renderPicked();
}

// The open issue is part of the selection: picking a second one starts from it.
function togglePicked(key) {
  state.pickAnchor = key;
  if (!state.picked.size && state.openKey && state.openKey !== key) state.picked.add(state.openKey);
  if (!state.picked.delete(key)) state.picked.add(key);
  renderPicked();
}

function clearPicked() {
  if (!state.picked.size) return false;
  state.picked.clear();
  renderPicked();
  return true;
}

function renderPicked() {
  // Several issues picked: the detail of one of them would be misleading (A would only assign that one), and
  // it hides the cards being picked. The open issue stays picked, and remains the anchor of Shift + click.
  if (state.picked.size > 1 && state.openKey) closeDetail();
  for (const el of document.querySelectorAll(".card[data-key]")) el.classList.toggle("picked", state.picked.has(el.dataset.key));
  renderBulk();
}

// The picked issues (or else the open one), in board order: one line per issue, "KEY Summary". The HTML
// version links each key to Jira, for mail and chat.
function copiedIssues() {
  const keys = new Set(state.picked.size ? state.picked : state.openKey ? [state.openKey] : []);
  const issues = (currentBoard()?.issues ?? []).filter(issue => keys.has(issue.key));
  if (!issues.length) return null;
  return {
    count: issues.length,
    text: issues.map(issue => `${issue.key} ${issue.summary}`).join("\n"),
    html: issues.map(issue => `<a href="${escapeHtml(browseUrl(issue.key))}">${escapeHtml(issue.key)}</a> ${escapeHtml(issue.summary)}`).join("<br>"),
  };
}

// Ctrl+C copies the issues only when no text is selected and no field has the focus: copying a piece of a
// card or of the detail keeps working as usual.
function copiesIssues() {
  return !document.activeElement?.matches?.("input, select, textarea") && getSelection().isCollapsed && copiedIssues();
}

// Written from the key press rather than from the copy event: browsers do not all send that event when
// nothing is selected, nor at the same moment, and handling both copied twice.
function copyIssues(event) {
  const copied = copiesIssues();
  if (!copied) return;
  event.preventDefault();
  const message = `${copied.count === 1 ? "1 issue" : `${copied.count} issues`} copied`;
  // The HTML version needs ClipboardItem; without it, the text alone.
  const written = window.ClipboardItem
    ? navigator.clipboard.write([new ClipboardItem({
      "text/plain": new Blob([copied.text], { type: "text/plain" }),
      "text/html": new Blob([copied.html], { type: "text/html" }),
    })])
    : navigator.clipboard.writeText(copied.text);
  written.then(
    () => flashInfo(message),
    error => flashError(`Copy failed: ${error.message}`)
  );
}

// ---------- Tooltips ----------

// Every title is shown by the page instead of the browser. On first hover it moves to data-title, which
// silences the native tooltip; a title set again later by the code is picked up at the next hover.
const TOOLTIP_DELAY_MS = 500;
const TOOLTIP_GAP_PX = 8;
// Native tooltips are about 12px: 20% larger, but never larger than the text of the element they describe.
const TOOLTIP_MAX_FONT_PX = 14.4;
// Elements without text of their own (their initials are only a stand-in): the size of the surrounding text.
const TOOLTIP_TEXTLESS = "img, svg, .avatar, .icon, .grip";
let tooltipTimer = 0;
let tooltipTarget = null;

document.addEventListener("mouseover", e => {
  const target = e.target.closest?.("[title], [data-title]");
  if (target === tooltipTarget) return;
  hideTooltip();
  if (!target || drag?.started) return;
  if (target.hasAttribute("title")) {
    target.dataset.title = target.getAttribute("title");
    target.removeAttribute("title");
    // The title was the accessible name of icon-only buttons: it stays one.
    if (!target.hasAttribute("aria-label") && !target.textContent.trim() && target.tagName !== "IMG") {
      target.setAttribute("aria-label", target.dataset.title);
    }
  }
  if (!target.dataset.title) return;
  tooltipTarget = target;
  tooltipTimer = setTimeout(showTooltip, TOOLTIP_DELAY_MS);
});
document.addEventListener("mouseout", e => {
  if (!e.relatedTarget) hideTooltip();
});
for (const type of ["mousedown", "keydown", "wheel"]) document.addEventListener(type, hideTooltip, { passive: true });
document.addEventListener("scroll", hideTooltip, { passive: true, capture: true });

function showTooltip() {
  const target = tooltipTarget;
  if (!target?.isConnected || drag?.started) return;
  const tip = $("tooltip");
  const reference = target.matches(TOOLTIP_TEXTLESS) ? target.parentElement : target;
  tip.style.fontSize = `${Math.min(TOOLTIP_MAX_FONT_PX, parseFloat(getComputedStyle(reference).fontSize))}px`;
  tip.textContent = target.dataset.title;
  tip.hidden = false;
  const box = target.getBoundingClientRect();
  const viewport = document.documentElement;
  const left = Math.min(
    Math.max(TOOLTIP_GAP_PX, box.left + box.width / 2 - tip.offsetWidth / 2),
    viewport.clientWidth - tip.offsetWidth - TOOLTIP_GAP_PX
  );
  const below = box.bottom + TOOLTIP_GAP_PX;
  const top = below + tip.offsetHeight <= viewport.clientHeight ? below : box.top - TOOLTIP_GAP_PX - tip.offsetHeight;
  tip.style.left = `${left}px`;
  tip.style.top = `${Math.max(TOOLTIP_GAP_PX, top)}px`;
}

function hideTooltip() {
  clearTimeout(tooltipTimer);
  tooltipTarget = null;
  $("tooltip").hidden = true;
}

// ---------- Reordering cards ----------

// Dragging a card within its column ranks it in Jira, before or after its neighbour. Dragging it to another
// column applies the Jira transition leading to one of that column's statuses, then ranks it where it was
// dropped. Dragging is handled by hand (pointer events) rather than with native drag and drop: a dragged
// link only shows its URL there, with no reserved slot and no cards moving aside.
// The transitions available from the card's status are only asked of Jira once the card leaves its column:
// a column with none leading to it gets a red outline, and a card dropped there goes back to its place.
const DRAG_THRESHOLD_PX = 5;
const DRAG_ANIMATION_MS = 160;
// Asked by the system: the card lands and the panel scrolls at once, without the motion.
const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)");
const motionMs = ms => REDUCED_MOTION.matches ? 0 : ms;
const scrollBehavior = () => REDUCED_MOTION.matches ? "auto" : "smooth";
// Near the top or bottom edge of the board, it scrolls by itself, faster as the pointer gets closer.
const AUTO_SCROLL_EDGE_PX = 60;
const AUTO_SCROLL_MAX_PX = 18;
let drag = null;
let suppressClick = false;

// Neither the link nor selected text is dragged natively: the card is what moves, by one of its grips.
document.addEventListener("dragstart", e => {
  if (e.target.closest?.(".card")) e.preventDefault();
});

// Pressing the grip must not start a text selection before the drag threshold is reached.
document.addEventListener("mousedown", e => {
  if (e.target.closest(".card .grip")) e.preventDefault();
});

document.addEventListener("pointerdown", e => {
  const card = e.target.closest(".card .grip")?.closest(".card");
  if (!card || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.pointerType !== "mouse") return;
  drag = { card, key: card.dataset.key, x: e.clientX, y: e.clientY, byFoot: !!e.target.closest(".foot"), started: false };
});

document.addEventListener("pointermove", e => {
  if (!drag) return;
  drag.pointer = { x: e.clientX, y: e.clientY };
  if (!drag.started) {
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < DRAG_THRESHOLD_PX) return;
    startDrag();
  }
  moveGhost();
  followPointer();
});

document.addEventListener("pointerup", () => {
  if (!drag) return;
  if (drag.started) dropCard(false);
  else drag = null;
});

document.addEventListener("pointercancel", () => drag?.started ? dropCard(true) : (drag = null));

// A drag ends with a click on the card: it must not open the detail.
document.addEventListener("click", e => {
  if (!suppressClick) return;
  suppressClick = false;
  e.preventDefault();
  e.stopImmediatePropagation();
}, true);

function startDrag() {
  const { card } = drag;
  const rect = card.getBoundingClientRect();
  drag.started = true;
  drag.cards = card.parentElement;
  drag.origin = card.closest(".column");
  drag.home = card.nextElementSibling;
  drag.offset = { x: drag.x - rect.left, y: drag.y - rect.top };
  drag.ghost = card.cloneNode(true);
  drag.ghost.classList.add("drag-ghost");
  drag.ghost.classList.remove("selected");
  drag.ghost.style.width = `${rect.width}px`;
  drag.ghost.style.height = `${rect.height}px`;
  document.body.append(drag.ghost);
  // Lift: the card grows a little and tilts, for a beat.
  drag.ghost.animate(
    [{ transform: "rotate(0) scale(1)" }, { transform: "rotate(2deg) scale(1.03)" }],
    { duration: motionMs(DRAG_ANIMATION_MS), easing: "ease-out" }
  );
  card.classList.add("placeholder");
  card.closest(".column").classList.add("drag-origin");
  document.body.classList.add("card-dragging");
  // The pressed button may have started selecting the card's text.
  getSelection().removeAllRanges();
  drag.scroller = document.querySelector("main");
  drag.scrollFrame = requestAnimationFrame(autoScroll);
}

function moveGhost() {
  const { ghost, pointer, offset } = drag;
  ghost.style.left = `${pointer.x - offset.x}px`;
  ghost.style.top = `${pointer.y - offset.y}px`;
  ghost.style.transform = "rotate(2deg) scale(1.03)";
}

// The slot follows the pointer, in the original column or in one a transition leads to (or might, while
// Jira has not answered yet); over a refused column, it stays where it was.
function followPointer() {
  const under = document.elementFromPoint(drag.pointer.x, drag.pointer.y);
  const column = under?.closest(".column");
  document.querySelectorAll(".column.drag-refused, .column.drag-target").forEach(el => el.classList.remove("drag-refused", "drag-target"));
  delete drag.ghost.dataset.hint;
  delete drag.ghost.dataset.hintKind;
  if (!column) return;
  if (column !== drag.origin) {
    const verdict = columnVerdict(column);
    column.classList.add(verdict.refused ? "drag-refused" : "drag-target");
    drag.ghost.dataset.hint = verdict.hint;
    if (!verdict.refused) drag.ghost.dataset.hintKind = "info";
    showSlotStatus(verdict.route);
    if (verdict.refused) return;
  } else {
    showSlotStatus(null);
  }
  const cards = column.querySelector(".cards");
  movePlaceholder(
    slotAt(drag.pointer, cards) ?? null,
    cards
  );
}

function showSlotStatus(route) {
  drag.card.querySelector(".slot-status")?.remove();
  if (!route) return;
  const status = currentBoard().statuses[route.statusId];
  const label = document.createElement("span");
  label.className = drag.byFoot ? "slot-status bottom" : "slot-status";
  label.innerHTML = `<span>New status</span><span class="status-pill ${escapeHtml(status?.category ?? "")}">` +
    `${escapeHtml(status?.name ?? route.steps.at(-1).name)}</span>`;
  drag.card.append(label);
}

// Where a drop in the column leads: its first status a known path reaches, and the statuses on the way when
// the workflow does not lead there directly.
function routeTo(
  transitions,
  column
) {
  // The board lists a column's statuses in the order its owner chose, the usual one first: the fewest
  // transitions would rather pick a side exit (a column holding both Closed and Abandoned, one step away).
  for (const id of currentBoard().columns[column].statusIds) {
    const steps = transitions.paths?.[String(id)];
    if (steps) return { statusId: String(id), steps };
  }
  return null;
}

// The page's own dialog rather than confirm(): it follows the theme and the zoom, and shows the path as a list.
function confirmMove(
  issue,
  fromStatusId,
  route,
  columnName
) {
  const board = currentBoard();
  const dialog = $("move-dialog");
  const pill = (id, name) => {
    const category = board.statuses[id]?.category ?? "";
    return `<span class="status-pill ${escapeHtml(category)}">${escapeHtml(board.statuses[id]?.name ?? name)}</span>`;
  };
  $("move-title").textContent = `Move ${issue.key} to ${columnName}`;
  $("move-summary").textContent = issue.summary ?? "";
  $("move-note").textContent = "Each transition shows in the issue's history, and may notify people, as it would in Jira.";
  $("move-confirm").textContent = "Move";
  $("move-steps").className = "";
  $("move-steps").innerHTML =
    `<li>${pill(fromStatusId, "")}<span class="transition">now</span></li>` +
    route.steps.map((step, index) =>
      `<li class="${index === route.steps.length - 1 ? "target" : ""}">${pill(step.id, step.name)}` +
      `<span class="transition">transition ${index + 1} of ${route.steps.length}</span></li>`
    ).join("");
  dialog.returnValue = "cancel";
  dialog.showModal();
  $("move-confirm").focus();
  return new Promise(resolve => dialog.addEventListener(
    "close",
    () => resolve(dialog.returnValue === "move"),
    { once: true }
  ));
}

function routeHint(
  transitions,
  route
) {
  if (route.steps.length === 1) return transitions.list.find(t => String(t.to?.id) === route.statusId)?.name ?? route.steps[0].name;
  return `Through ${route.steps.slice(0, -1).map(step => step.name).join(", then ")} (${route.steps.length} transitions)`;
}

function columnVerdict(column) {
  const current = drag;
  if (!current.transitions) {
    current.transitions = loadTransitions(current.key);
    current.transitions.promise.then(() => {
      if (drag === current) followPointer();
    });
  }
  const { list, error } = current.transitions;
  if (error) return { refused: true, hint: `Transitions unavailable: ${error}` };
  if (!list) return { refused: false, hint: "Checking the transitions…" };
  const board = currentBoard();
  const index = Number(column.dataset.col);
  const route = routeTo(
    current.transitions,
    index
  );
  if (route) {
    return {
      refused: false,
      route,
      hint: routeHint(
        current.transitions,
        route
      ),
    };
  }
  const status = board.statuses[board.issues.find(i => i.key === current.key)?.statusId]?.name ?? "its status";
  return { refused: true, hint: `No known path from ${status} to ${board.columns[index].name}` };
}

// A read, made once per drag and only when the card leaves its column.
function loadTransitions(key) {
  const result = { list: null, error: null };
  result.promise = request(
    `/transitions/${encodeURIComponent(key)}`,
    { timeout: JIRA_READ_TIMEOUT_MS }
  )
    .then(async response => {
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || body.errorMessages?.join(", ") || response.statusText);
      result.list = body.transitions ?? [];
      result.paths = body.paths ?? {};
    })
    .catch(error => { result.error = error.message; })
    .then(() => result);
  return result;
}

// Card before which to put the slot (null: at the end of the column), based on the card nearest the
// pointer: left / right when cards are side by side at its height, top / bottom otherwise.
function slotAt(
  pointer,
  cards
) {
  let nearest = null;
  for (const card of cards.querySelectorAll(".card:not(.placeholder)")) {
    const r = card.getBoundingClientRect();
    const dx = Math.max(r.left - pointer.x, 0, pointer.x - r.right);
    const dy = Math.max(r.top - pointer.y, 0, pointer.y - r.bottom);
    if (!nearest || dx * dx + dy * dy < nearest.distance) nearest = { card, r, distance: dx * dx + dy * dy };
  }
  if (!nearest) return undefined;
  const { card, r } = nearest;
  const sideBySide = getComputedStyle(cards).gridTemplateColumns.split(" ").length > 1 && pointer.y >= r.top && pointer.y <= r.bottom;
  const before = sideBySide ? pointer.x < r.left + r.width / 2 : pointer.y < r.top + r.height / 2;
  return before ? card : card.nextElementSibling;
}

// Moves the slot, and slides the cards it pushes aside from their former position (FLIP), in the column it
// leaves as in the one it enters.
function movePlaceholder(
  before,
  cards
) {
  const placeholder = drag.card;
  if (placeholder.parentElement === cards && (before === placeholder || placeholder.nextElementSibling === before)) return;
  const others = [...new Set([placeholder.parentElement, cards])].flatMap(el => [...el.children]).filter(el => el !== placeholder);
  const first = new Map(others.map(el => [el, el.getBoundingClientRect()]));
  cards.insertBefore(placeholder, before);
  for (const el of others) {
    const from = first.get(el);
    const to = el.getBoundingClientRect();
    const dx = from.left - to.left;
    const dy = from.top - to.top;
    if (dx || dy) {
      el.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
        { duration: motionMs(DRAG_ANIMATION_MS), easing: "ease-out" }
      );
    }
  }
}

function autoScroll() {
  if (!drag?.started) return;
  const r = drag.scroller.getBoundingClientRect();
  const { y } = drag.pointer ?? drag;
  const speed = edge => Math.ceil(AUTO_SCROLL_MAX_PX * (1 - edge / AUTO_SCROLL_EDGE_PX));
  const step = y < r.top + AUTO_SCROLL_EDGE_PX ? -speed(Math.max(0, y - r.top))
    : y > r.bottom - AUTO_SCROLL_EDGE_PX ? speed(Math.max(0, r.bottom - y)) : 0;
  if (step) {
    drag.scroller.scrollTop += step;
    followPointer();
  }
  drag.scrollFrame = requestAnimationFrame(autoScroll);
}

// Drop: the card slides into its place, then the rank (and the transition, in another column) is sent to
// Jira if the place changed. Escape or a drop on a refused column: it goes back where it came from.
function dropCard(cancelled) {
  const current = drag;
  drag = null;
  suppressClick = true;
  setTimeout(() => { suppressClick = false; });
  cancelAnimationFrame(current.scrollFrame);
  const { card, ghost, cards } = current;
  const refused = document.querySelector(".column.drag-refused");
  const landed = card.closest(".column");
  // Jira may answer after the pointer left the slot's column: it counts as a drop on it.
  const unreachable = landed !== current.origin && (current.transitions?.error || current.transitions?.list && !routeTo(
    current.transitions,
    Number(landed.dataset.col)
  ));
  if (cancelled || refused || unreachable) cards.insertBefore(card, current.home);
  const column = card.parentElement === cards ? null : Number(card.closest(".column").dataset.col);
  const moved = column !== null || card.nextElementSibling !== current.home;
  const target = card.getBoundingClientRect();
  const from = ghost.getBoundingClientRect();
  const landing = ghost.animate(
    [
      { transform: "rotate(2deg) scale(1.03)" },
      { transform: `translate(${target.left - from.left - (from.width - target.width) / 2}px, ${target.top - from.top - (from.height - target.height) / 2}px)` },
    ],
    { duration: motionMs(DRAG_ANIMATION_MS), easing: "ease-in-out", fill: "forwards" }
  );
  landing.finished.catch(() => null).then(() => {
    ghost.remove();
    card.classList.remove("placeholder");
    card.querySelector(".slot-status")?.remove();
    document.querySelectorAll(".drag-origin, .drag-refused, .drag-target").forEach(el => el.classList.remove("drag-origin", "drag-refused", "drag-target"));
    document.body.classList.remove("card-dragging");
    const previous = card.previousElementSibling?.dataset.key;
    const next = card.nextElementSibling?.dataset.key;
    const neighbour = next ? { before: next } : previous ? { after: previous } : null;
    if (column !== null) {
      moveIssue(
        current.key,
        column,
        neighbour,
        current.transitions ?? loadTransitions(current.key)
      );
    } else if (moved) {
      rankIssue(
        current.key,
        neighbour
      );
    } else if (state.renderLater) {
      renderBoard();
    }
  });
}

// The card moves right away; if Jira refuses, it moves back and a message says why.
async function rankIssue(
  key,
  neighbour
) {
  const board = currentBoard();
  const previous = board.issues.slice();
  placeIssue(
    board,
    board.issues.find(i => i.key === key),
    neighbour
  );
  renderBoard();
  try {
    await write(
      "/rank",
      { issue: key, ...neighbour }
    );
    saveSnapshot();
  } catch (error) {
    board.issues = previous;
    if (currentBoard() === board) renderBoard();
    flashError(`${key} could not be moved: ${error.message}`);
  }
}

// Same in another column: the card shows there right away, in the status the move leads to; if Jira has no
// path there or refuses a step (a field its screen requires, for instance), it goes back. A path of several
// transitions is confirmed first: each one leaves a trace in the issue's history, and may notify people.
async function moveIssue(
  key,
  column,
  neighbour,
  transitions,
  confirmed = false
) {
  const board = currentBoard();
  const issue = board.issues.find(i => i.key === key);
  const before = { issues: board.issues.slice(), statusId: issue.statusId, done: issue.done };
  const show = statusId => {
    issue.statusId = statusId;
    issue.done = board.statuses[statusId]?.category === "done";
  };
  const undo = () => {
    board.issues = before.issues;
    show(before.statusId);
    issue.done = before.done;
    if (currentBoard() === board) renderBoard();
  };
  let route = transitions.list && routeTo(
    transitions,
    column
  );
  // Jira has not answered yet: the column's first status, until the path is known.
  show(route?.statusId ?? board.columns[column].statusIds[0]);
  if (neighbour) {
    placeIssue(
      board,
      issue,
      neighbour
    );
  }
  renderBoard();
  try {
    if (!route) {
      const { list, error } = await transitions.promise;
      if (error) throw new Error(error);
      route = routeTo(
        transitions,
        column
      );
      if (!route) throw new Error("no known path leads there from its status");
      show(route.statusId);
      if (currentBoard() === board) renderBoard();
    }
    if (route.steps.length > 1 && !confirmed && !await confirmMove(
      issue,
      before.statusId,
      route,
      board.columns[column].name
    )) {
      undo();
      return false;
    }
    const body = await write(
      "/transition",
      { issue: key, status: route.statusId }
    );
    remember(body.issue);
    // The answer to the move already holds what post-functions changed; the column stays where it was dropped.
    if (patchCard(body.issue) && currentBoard() === board) renderBoard();
    if (state.openKey === key) rerenderDetail();
    followUp(key);
  } catch (error) {
    undo();
    // Stopped halfway without being able to go back: the card shows where the issue really is.
    const reached = error.body?.issue?.data?.fields?.status?.id;
    if (error.body?.issue) remember(error.body.issue);
    if (reached && String(reached) !== String(before.statusId)) {
      show(String(reached));
      if (currentBoard() === board) renderBoard();
    }
    if (state.openKey === key) rerenderDetail();
    flashError(`${key} could not be moved to ${board.columns[column].name}: ${error.message}`);
    return false;
  }
  saveSnapshot();
  if (!neighbour) return true;
  try {
    await write(
      "/rank",
      { issue: key, ...neighbour }
    );
  } catch (error) {
    flashError(`${key} was moved, but not to that place in the column: ${error.message}`);
  }
  return true;
}

function placeIssue(
  board,
  issue,
  neighbour
) {
  board.issues.splice(board.issues.indexOf(issue), 1);
  const at = board.issues.findIndex(i => i.key === (neighbour.before ?? neighbour.after));
  board.issues.splice(neighbour.before ? at : at + 1, 0, issue);
}

// The page's writes: always through this server, which builds the Jira request itself.
async function write(
  path,
  payload
) {
  const response = await request(
    path,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      timeout: WRITE_TIMEOUT_MS,
    }
  );
  const body = await response.json().catch(() => ({}));
  // The body stays with the error: a refused move says there where the issue ended up.
  if (!response.ok) throw Object.assign(new Error(body.message || response.statusText), { body });
  return body;
}

function flashError(message) {
  const banner = document.createElement("div");
  banner.className = "error-banner";
  banner.setAttribute("role", "alert");
  banner.textContent = message;
  $("errors").append(banner);
  setTimeout(() => banner.remove(), ERROR_FLASH_MS);
}

function flashInfo(message) {
  const banner = document.createElement("div");
  banner.className = "error-banner info";
  banner.setAttribute("role", "status");
  banner.textContent = message;
  $("errors").append(banner);
  setTimeout(() => banner.remove(), INFO_FLASH_MS);
}

// ---------- Assignee ----------

function assigneeHtml(
  key,
  user
) {
  if (state.picker?.key === key) {
    return `<div class="picker"><input id="assignee-query" type="text" autocomplete="off" spellcheck="false" ` +
      `placeholder="Search people…" aria-label="New assignee" aria-controls="assignee-options" value="${escapeHtml(state.picker.query)}">` +
      `<ul id="assignee-options" role="listbox"></ul></div>`;
  }
  const pending = state.assigning.has(key);
  return `<button type="button" class="assign${pending ? " pending" : ""}" title="${pending ? "Saving in Jira…" : "Change the assignee (Shift+A)"}"` +
    `${pending ? " disabled" : ""}>${person(user)}</button>`;
}

function currentAssignee(key) {
  const fields = state.detail.get(key)?.data?.fields;
  return fields ? fields.assignee?.name ?? null : currentBoard()?.issues.find(i => i.key === key)?.assignee ?? null;
}

// People the page already knows, at no cost: me, the people of the open issue, the assignees of the loaded
// sprints. Me first, then by name.
function knownPeople(key) {
  const people = new Map();
  const add = (login, name, url) => {
    if (login && !people.has(login.toLowerCase())) people.set(login.toLowerCase(), { login, name: name || login, avatar: url ?? null });
  };
  if (state.meta?.me) add(state.meta.me, state.meta.meName, state.meta.meAvatar);
  const f = state.detail.get(key)?.data?.fields;
  for (const user of [f?.assignee, f?.reporter, custom(f, "developer"), custom(f, "tester")]) add(user?.name, user?.displayName, user?.avatarUrls?.["48x48"]);
  for (const board of Object.values(state.boards)) for (const i of board.issues) add(i.assignee, i.assigneeName, i.avatar);
  const isMe = p => p.login.toLowerCase() === state.meta?.me?.toLowerCase();
  return [...people.values()].sort((a, b) => isMe(b) - isMe(a) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

function pickerOptions() {
  const picker = state.picker;
  const typed = picker.query.trim();
  const query = normalize(typed);
  const matches = p => normalize(`${p.name} ${p.login}`).includes(query);
  const people = new Map();
  for (const p of knownPeople(picker.key)) if (matches(p)) people.set(p.login.toLowerCase(), p);
  // Jira also matches e-mail addresses: its answer to the current query is kept as is.
  for (const p of picker.remote) {
    if (!people.has(p.login.toLowerCase()) && (picker.remoteQuery === typed || matches(p))) people.set(p.login.toLowerCase(), p);
  }
  const options = [...people.values()].map(p => ({ person: p }));
  if (!query || normalize("Unassigned").includes(query)) {
    const afterMe = options[0]?.person.login.toLowerCase() === state.meta?.me?.toLowerCase() ? 1 : 0;
    options.splice(afterMe, 0, { person: null });
  }
  if (typed.length >= PEOPLE_SEARCH_MIN_CHARS && picker.remoteQuery !== typed) options.push({ search: typed });
  return options;
}

function renderPickerOptions() {
  const list = $("assignee-options");
  const picker = state.picker;
  if (!list || !picker) return;
  picker.options = pickerOptions();
  picker.active = Math.min(picker.active, Math.max(picker.options.length - 1, 0));
  const current = currentAssignee(picker.key)?.toLowerCase() ?? null;
  const items = picker.options.map((option, index) => {
    const classes = [index === picker.active ? "active" : ""];
    let content;
    if ("search" in option) {
      classes.push("search");
      content = `<span class="name">Search Jira for “${escapeHtml(option.search)}”</span>`;
    } else if (option.person) {
      if (option.person.login.toLowerCase() === current) classes.push("current");
      content = `${avatar(option.person.login, option.person.name, option.person.avatar)}` +
        `<span class="name">${escapeHtml(option.person.name)}</span><span class="login">${escapeHtml(option.person.login)}</span>`;
    } else {
      if (current === null) classes.push("current");
      content = `${avatar(null)}<span class="name">Unassigned</span>`;
    }
    return `<li role="option" data-index="${index}" class="${classes.filter(Boolean).join(" ")}" aria-selected="${index === picker.active}">${content}</li>`;
  });
  if (picker.searching) items.push(`<li class="hint">Searching Jira…</li>`);
  else if (picker.searchError) items.push(`<li class="hint">Search failed: ${escapeHtml(picker.searchError)}</li>`);
  else if (!picker.options.length) items.push(`<li class="hint">Nobody found</li>`);
  list.innerHTML = items.join("");
  list.querySelector(".active")?.scrollIntoView({ block: "nearest" });
}

function rerenderDetail() {
  if (state.openKey) renderDetail(state.openKey, { syncing: state.detailSyncing === state.openKey });
}

function openPicker() {
  const key = state.openKey;
  if (!key || state.assigning.has(key)) return;
  state.picker = { key, query: "", active: 0, options: [], remote: [], remoteQuery: null, searching: false, searchError: null, timer: 0 };
  rerenderDetail();
}

function closePicker() {
  if (!state.picker) return;
  clearTimeout(state.picker.timer);
  state.picker = null;
  rerenderDetail();
}

function onPickerInput(value) {
  const picker = state.picker;
  picker.query = value;
  picker.active = 0;
  picker.searchError = null;
  clearTimeout(picker.timer);
  renderPickerOptions();
  const typed = value.trim();
  const nobodyKnown = picker.options.every(option => !option.person);
  if (typed.length >= PEOPLE_SEARCH_MIN_CHARS && nobodyKnown) {
    picker.timer = setTimeout(() => searchPeople(typed), PEOPLE_SEARCH_DELAY_MS);
  }
}

async function searchPeople(query) {
  const picker = state.picker;
  if (!picker || picker.searching) return;
  picker.searching = true;
  renderPickerOptions();
  try {
    // Dots encoded: the relay refuses any path containing "..", a query included.
    const users = await jira(`rest/api/2/user/assignable/search?issueKey=${encodeURIComponent(picker.key)}` +
      `&username=${encodeURIComponent(query).replace(/\./g, "%2E")}&maxResults=${PEOPLE_SEARCH_SIZE}`);
    picker.remote = users.filter(u => u.active !== false).map(u => ({ login: u.name, name: u.displayName || u.name, avatar: u.avatarUrls?.["48x48"] ?? null }));
    picker.remoteQuery = query;
  } catch (error) {
    picker.searchError = error.message;
  } finally {
    picker.searching = false;
    if (state.picker === picker) renderPickerOptions();
  }
}

function choosePickerOption(option) {
  if (!option) return;
  if ("search" in option) {
    searchPeople(option.search);
    return;
  }
  const key = state.picker.key;
  closePicker();
  if ((option.person?.login ?? "").toLowerCase() !== (currentAssignee(key) ?? "").toLowerCase()) {
    assignIssue(
      key,
      option.person
    );
  }
}

// Same as reordering: the new assignee shows right away, and goes back if Jira refuses.
async function assignIssue(
  key,
  user
) {
  const board = currentBoard();
  const issue = board?.issues.find(i => i.key === key);
  const previousIssue = issue && { assignee: issue.assignee, assigneeName: issue.assigneeName, avatar: issue.avatar };
  const previousEntry = state.detail.get(key);
  if (issue) Object.assign(issue, { assignee: user?.login ?? null, assigneeName: user?.name ?? null, avatar: user?.avatar ?? null });
  if (previousEntry?.data?.fields) {
    const assignee = user && { name: user.login, displayName: user.name, avatarUrls: { "48x48": user.avatar } };
    remember({ ...previousEntry, data: { ...previousEntry.data, fields: { ...previousEntry.data.fields, assignee } } });
  }
  state.assigning.add(key);
  renderBoard();
  if (state.openKey === key) rerenderDetail();
  try {
    const body = await write(
      "/assignee",
      { issue: key, assignee: user?.login ?? null }
    );
    // The server resynced its copy after the write: the detail shows what Jira now holds.
    remember(body.issue);
    saveSnapshot();
    return true;
  } catch (error) {
    if (issue) Object.assign(issue, previousIssue);
    if (previousEntry) remember(previousEntry);
    if (currentBoard() === board) renderBoard();
    flashError(`${key} could not be assigned: ${error.message}`);
    return false;
  } finally {
    state.assigning.delete(key);
    if (state.openKey === key) rerenderDetail();
  }
}

let hoverTimer = null;
document.addEventListener("mouseover", e => {
  const cardEl = e.target.closest(".card");
  clearTimeout(hoverTimer);
  if (cardEl) hoverTimer = setTimeout(() => prefetchLocal(cardEl.dataset.key), HOVER_PREFETCH_MS);
});

document.addEventListener("input", e => {
  if (e.target.id !== "q") return;
  state.q = e.target.value;
  writeUrl();
  renderBoard();
});

document.addEventListener("keydown", e => {
  // A dialog open: its own keys (Escape cancels, Enter confirms), none of the board's.
  if (document.querySelector("dialog[open]")) return;
  if (e.key === "Escape" && drag?.started) {
    dropCard(true);
    return;
  }
  if (e.key === "Escape" && state.picker) {
    e.preventDefault();
    closePicker();
    $("panel-content").querySelector(".assign")?.focus({ preventScroll: true });
    return;
  }
  if (e.key === "Escape" && !$("load-panel").hidden) {
    toggleLoadPanel(false);
    $("load").focus();
    return;
  }
  // Closed where the focus stays: opened with "?" from a card, the arrows go on from that card.
  if (e.key === "Escape" && openShortcuts()) {
    toggleShortcuts(
      openShortcuts(),
      false
    );
    return;
  }
  if (e.key === "Escape" && !$("about-panel").hidden) {
    toggleAboutPanel(false);
    $("about").focus();
    return;
  }
  if (e.key === "Escape" && state.filtersOpen) {
    showMoreFilters(false);
    $("more-filters").focus();
    return;
  }
  if (e.key === "Escape" && !$("activity-panel").hidden) {
    toggleActivityPanel(false);
    $("activity-btn").focus();
    return;
  }
  const typing = e.target.matches?.("input, select, textarea");
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "c") {
    copyIssues(e);
    return;
  }
  if (e.key === "Escape" && !typing && clearPicked()) return;
  // Escape steps back one level: from the detail to its card (the arrows go to the issues again), then closes.
  if (e.key === "Escape" && !typing && state.openKey && e.target.closest?.("#panel")) {
    focusCard(state.openKey);
    return;
  }
  if (e.key === "Tab" && !e.shiftKey && state.openKey && e.target.matches?.("#board .card.selected")) {
    e.preventDefault();
    focusDetail();
    return;
  }
  if (e.key === "Escape") {
    // Out of the search, its results kept: the board's keys (Shift + S, the arrows…) work again, where in the
    // field every letter is text. A second Escape, on the board, clears the search.
    if (typing && e.target.id === "q") {
      e.preventDefault();
      e.target.blur();
      return;
    }
    if (!$("panel").hidden) closeDetailToCard();
    else if (typing) e.target.blur();
    else if (state.standup) endStandup();
    else if (state.q) {
      $("q").value = "";
      $("q").dispatchEvent(new Event(
        "input",
        { bubbles: true }
      ));
    }
    return;
  }
  if (typing) return;
  if (e.key === "?") {
    // The list of where the keys act: the detail's while it is open, the board's otherwise.
    const list = state.openKey ? "shortcuts-panel" : "board-shortcuts-panel";
    const wasOpen = !$(list).hidden;
    for (const [panelId] of SHORTCUT_LISTS) toggleShortcuts(
      panelId,
      false
    );
    toggleShortcuts(
      list,
      !wasOpen
    );
  } else if (e.key === "/") {
    e.preventDefault();
    $("q")?.focus();
  } else if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key === "S") {
    // Shift + S: a plain s starts a search like any other letter (below), so typing "sync" no longer
    // starts the stand-up. The S itself must not land in the field the stand-up focuses.
    e.preventDefault();
    toggleStandup();
  } else if (state.standup && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === "n") {
    nextSpeaker();
  } else if (state.openKey && !e.ctrlKey && !e.metaKey && !e.altKey && e.shiftKey && e.key.toLowerCase() === "l") {
    // Shift for what acts, a plain letter only goes to a section: L is the links. Not Ctrl nor Alt, taken
    // by the browser (Ctrl+L, Alt+D: the address bar) or typing a character on a Mac (Option).
    toggleDock();
  } else if (state.openKey && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() in SECTION_KEYS) {
    readSection(SECTION_KEYS[e.key.toLowerCase()]);
  } else if (state.openKey && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === "m") {
    toggleMaximized();
  } else if (state.openKey && !e.ctrlKey && !e.metaKey && !e.altKey && e.shiftKey && e.key.toLowerCase() === "a") {
    // Shift: the one key that writes to Jira is not typed by accident, and a plain A is the attachments.
    e.preventDefault();
    openPicker();
  } else if (!e.ctrlKey && !e.metaKey && !e.altKey && VIEWS.some(v => v.key === e.key)) {
    setView(VIEWS.find(v => v.key === e.key).id);
  } else if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === "j" && (state.openKey || e.target.matches?.("#board .card"))) {
    // J for Jira: the issue in the detail, or the card with the focus, in full in Jira (new tab). Not Enter,
    // pressed without a thought: leaving for Jira must be deliberate.
    window.open(browseUrl(state.openKey ?? e.target.dataset.key), "_blank", "noopener");
  } else if (e.key === "Enter" && e.target.matches?.("#board .card.selected")) {
    // Enter opens a card's detail (the card's own click); on the card already shown, that click would close
    // it: nothing happens instead.
    e.preventDefault();
  } else if (state.openKey && !e.target.closest?.("#panel") && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
    // From the board, the arrows go to the next issue; in the detail (a click or Tab there) they scroll it
    // instead, so reading never changes the issue by accident. Escape or a click on a card gives them back.
    e.preventDefault();
    moveSelection(e.key);
  } else if (e.target.matches?.("#board .card") && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
    e.preventDefault();
    moveFocus(
      e.target,
      e.key
    );
  } else if (!state.openKey && !e.ctrlKey && !e.metaKey && !e.altKey && /^\p{L}$/u.test(e.key)) {
    // On the board, a letter no shortcut takes starts a search: the field gets the focus before the key
    // lands, so the letter is typed in it. During the stand-up, it is the name of who speaks next.
    (state.standup ? $("standup-query") : $("q")).focus();
  }
});

document.addEventListener("change", e => {
  if (e.target.id === "more-labels") state.filtersOpen = false;
  if (e.target.id === "more-labels" && e.target.value) toggleLabel(e.target.value);
});

$("sprint").addEventListener("change", e => {
  state.sprintId = Number(e.target.value);
  state.picked.clear();
  // The round of people belongs to the sprint left behind.
  state.standup = null;
  writeUrl();
  closeDetail();
  render();
  if (!currentBoard() || age() >= STALE_ON_FOCUS_MS) sharedRefresh({ olderThan: STALE_ON_FOCUS_MS });
  else scheduleAutoRefresh();
});
$("refresh").addEventListener("click", () => refresh());
$("autoRefresh").addEventListener("change", e => {
  state.autoRefresh = e.target.checked;
  savePreference(
    AUTO_REFRESH_KEY,
    String(state.autoRefresh)
  );
  scheduleAutoRefresh();
});
$("theme").addEventListener("click", () => {
  const light = document.documentElement.dataset.theme !== "light";
  if (light) document.documentElement.dataset.theme = "light";
  else delete document.documentElement.dataset.theme;
  savePreference(
    THEME_KEY,
    light ? "light" : "dark"
  );
  renderThemeButton();
});

function renderThemeButton() {
  const light = document.documentElement.dataset.theme === "light";
  $("theme").innerHTML = light
    ? `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5 A8 8 0 1 1 9.5 4 A6.5 6.5 0 0 0 20 14.5 Z"/></svg>`
    : `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.5 V5 M12 19 V21.5 M2.5 12 H5 M19 12 H21.5 M5.3 5.3 L7 7 M17 17 L18.7 18.7 M5.3 18.7 L7 17 M17 7 L18.7 5.3"/></svg>`;
  $("theme").title = light ? "Switch to the dark theme" : "Switch to the light theme";
  $("theme").setAttribute("aria-label", $("theme").title);
}
$("panel-close").addEventListener("click", closeDetailToCard);
// At the bottom, each detail column scrolls on its own: scrolling is captured on all of them.
const panelScrollers = () => [$("panel-content"), ...$("panel-content").children];
$("panel-content").addEventListener("scroll", () => {
  $("panel-top").classList.toggle("shown", panelScrollers().some(el => el.scrollTop > el.clientHeight * 0.6));
}, { passive: true, capture: true });
$("panel-top").addEventListener("click", () => {
  for (const el of panelScrollers()) el.scrollTo({ top: 0, behavior: scrollBehavior() });
});

// Detail table of contents: the sections of the displayed issue, with their number of entries. An empty one
// stays listed, at 0: each button keeps its place from one issue to the next, its key always leads
// somewhere, and "no attachment" reads at a glance. Its key is its first letter, underlined.
const JUMP_SECTIONS = [
  ["description", "Description"],
  ["links", "Links"],
  ["attachments", "Attachments"],
  ["comments", "Comments"],
  ["history", "History"],
];

function renderJump() {
  const content = $("panel-content");
  $("panel-sections").innerHTML = JUMP_SECTIONS
    .map(([id, label]) => [id, label, content.querySelector(`[data-jump="${id}"]`)])
    .filter(([, , heading]) => heading)
    .map(([id, label, heading]) => `<button type="button" data-target="${id}"` +
      `${heading.dataset.count === "0" ? ` class="empty"` : ""} title="${label} (${label[0]})">` +
      `<span><span class="key">${label[0]}</span>${label.slice(1)}</span>` +
      (heading.dataset.count ? ` <span class="count">${heading.dataset.count}</span>` : "") + `</button>`)
    .join("");
}

// Scrolls the column holding the section (at the bottom, each one scrolls alone; on the side, the whole detail).
// Returns that column.
function jumpTo(id) {
  const content = $("panel-content");
  const heading = content.querySelector(`[data-jump="${id}"]`);
  if (!heading) return null;
  const scroller = [...content.children].find(el => el.contains(heading) && getComputedStyle(el).overflowY === "auto") ?? content;
  const top = heading.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 12;
  scroller.scrollTo({ top, behavior: scrollBehavior() });
  return scroller;
}

// D, L, A, C, H: straight to a section with the keyboard, the focus with it, so the arrows then scroll that
// section and no longer change the issue (Escape gives them back to the cards).
const SECTION_KEYS = Object.fromEntries(JUMP_SECTIONS.map(([id, label]) => [label[0].toLowerCase(), id]));

function readSection(id) {
  jumpTo(id)?.focus({ preventScroll: true });
}

// Preview of attached images: shown after a short hover delay (a quick pass loads nothing), placed on the
// side of the screen with the most room, and following the mouse.
const PREVIEW_DELAY_MS = 150;
const PREVIEW_GAP_PX = 18;
// Displayed size: twice the natural size, within the screen (aspect ratio kept).
const PREVIEW_SCALE = 2;
const PREVIEW_MAX_WIDTH = 0.9;
const PREVIEW_MAX_HEIGHT = 0.88;
let previewTimer = 0;
let previewPointer = { x: 0, y: 0 };

function placePreview() {
  const box = $("preview");
  const { width, height } = box.getBoundingClientRect();
  const { x, y } = previewPointer;
  const left = x > innerWidth / 2 ? x - PREVIEW_GAP_PX - width : x + PREVIEW_GAP_PX;
  const top = Math.min(Math.max(8, y - height / 2), innerHeight - height - 8);
  box.style.left = `${Math.max(8, Math.min(left, innerWidth - width - 8))}px`;
  box.style.top = `${Math.max(8, top)}px`;
}

function showPreview(url) {
  const box = $("preview");
  const img = box.querySelector("img");
  box.classList.add("loading");
  img.onload = () => {
    sizePreview(img);
    box.classList.remove("loading");
    placePreview();
  };
  img.onerror = () => { box.hidden = true; };
  img.src = url;
  box.hidden = false;
  if (img.complete && img.naturalWidth) {
    sizePreview(img);
    box.classList.remove("loading");
  }
  placePreview();
}

function sizePreview(img) {
  const ratio = Math.min(
    PREVIEW_SCALE,
    innerWidth * PREVIEW_MAX_WIDTH / img.naturalWidth,
    innerHeight * PREVIEW_MAX_HEIGHT / img.naturalHeight
  );
  img.style.width = `${Math.round(img.naturalWidth * ratio)}px`;
  img.style.height = `${Math.round(img.naturalHeight * ratio)}px`;
}

function hidePreview() {
  clearTimeout(previewTimer);
  $("preview").hidden = true;
}

$("panel-content").addEventListener("mouseover", event => {
  const link = event.target.closest("a[data-preview]");
  if (!link || link.contains(event.relatedTarget)) return;
  previewPointer = { x: event.clientX, y: event.clientY };
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => showPreview(link.dataset.preview), PREVIEW_DELAY_MS);
});
$("panel-content").addEventListener("mousemove", event => {
  if (!event.target.closest("a[data-preview]")) return;
  previewPointer = { x: event.clientX, y: event.clientY };
  if (!$("preview").hidden) placePreview();
}, { passive: true });
$("panel-content").addEventListener("mouseout", event => {
  const link = event.target.closest("a[data-preview]");
  if (link && !link.contains(event.relatedTarget)) hidePreview();
});
$("panel-content").addEventListener("scroll", hidePreview, { passive: true, capture: true });

$("panel-content").addEventListener("click", event => {
  if (event.target.closest(".assign")) openPicker();
  const diff = event.target.closest(".diff-open");
  if (diff) openDiff(Number(diff.dataset.diff));
  const option = event.target.closest("#assignee-options li[data-index]");
  if (option && state.picker) choosePickerOption(state.picker.options[Number(option.dataset.index)]);
});
$("panel-content").addEventListener("input", event => {
  if (event.target.id === "assignee-query" && state.picker) onPickerInput(event.target.value);
});
$("panel-content").addEventListener("keydown", event => {
  const picker = state.picker;
  if (event.target.id !== "assignee-query" || !picker) return;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const count = picker.options.length;
    if (count) picker.active = (picker.active + (event.key === "ArrowDown" ? 1 : count - 1)) % count;
    renderPickerOptions();
  } else if (event.key === "Enter") {
    event.preventDefault();
    choosePickerOption(picker.options[picker.active]);
  } else if (event.key === "Tab") {
    closePicker();
  }
});
// A click in the list keeps the focus in the field; a click anywhere else closes the picker.
document.addEventListener("mousedown", event => {
  if (!state.picker) return;
  if (event.target.closest("#assignee-options")) event.preventDefault();
  else if (!event.target.closest(".picker")) closePicker();
});

$("panel-sections").addEventListener("click", event => {
  const target = event.target.closest("button[data-target]")?.dataset.target;
  if (target) jumpTo(target);
});

function applyDock() {
  const bottom = state.dock === "bottom";
  const panel = $("panel");
  panel.classList.toggle("bottom", bottom);
  if (bottom) panel.classList.remove("left");
  const height = Number(readPreference(PANEL_HEIGHT_KEY));
  if (height) panel.style.setProperty("--panel-height", `${height * 100}vh`);
  $("panel-dock").textContent = bottom ? "◨" : "⬓";
  $("panel-dock").title = bottom ? "Show the detail on the side (Shift+L)" : "Show the detail at the bottom, full width (Shift+L)";
}

function toggleDock() {
  state.dock = state.dock === "bottom" ? "side" : "bottom";
  savePreference(
    DOCK_KEY,
    state.dock
  );
  applyDock();
  if (state.openKey) openDetail(state.openKey);
}

$("panel-dock").addEventListener("click", toggleDock);

const MAXIMIZE_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>`;
const RESTORE_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>`;

function applyMaximized() {
  const { maximized } = state;
  $("panel").classList.toggle("maximized", maximized);
  $("panel-max").innerHTML = maximized ? RESTORE_ICON : MAXIMIZE_ICON;
  const label = maximized ? "Back to the previous size (M key)" : "Show the detail on the whole page (M key)";
  // Icon only: the label is also its accessible name, which the tooltip would otherwise leave stale.
  $("panel-max").title = label;
  $("panel-max").setAttribute("aria-label", label);
}

// A size chosen with M or the icon is kept once the detail closes.
function toggleMaximized() {
  state.sizeBeforeMiddle = null;
  state.maximized = !state.maximized;
  applyMaximized();
}

$("panel-max").addEventListener("click", toggleMaximized);
applyMaximized();
$("panel-grip").addEventListener("pointerdown", e => {
  e.preventDefault();
  const grip = e.currentTarget;
  grip.setPointerCapture(e.pointerId);
  document.body.classList.add("resizing");
  let ratio = null;
  const move = event => {
    ratio = Math.min(PANEL_MAX_HEIGHT, Math.max(PANEL_MIN_HEIGHT, (window.innerHeight - event.clientY) / window.innerHeight));
    $("panel").style.setProperty("--panel-height", `${ratio * 100}vh`);
  };
  const stop = () => {
    grip.removeEventListener("pointermove", move);
    document.body.classList.remove("resizing");
    if (ratio) savePreference(
      PANEL_HEIGHT_KEY,
      ratio.toFixed(3)
    );
  };
  grip.addEventListener("pointermove", move);
  grip.addEventListener("pointerup", stop, { once: true });
  grip.addEventListener("pointercancel", stop, { once: true });
});
applyDock();

document.addEventListener("visibilitychange", () => {
  if (document.hidden) savePreference(
    LAST_SEEN_KEY,
    String(Date.now())
  );
  else startVisit();
  if (document.hidden || !state.autoRefresh) scheduleAutoRefresh();
  else sharedRefresh({ olderThan: STALE_ON_FOCUS_MS });
});
// Only fired in the other tabs: the one that saved already shows this data.
window.addEventListener("storage", e => {
  if (e.key === SNAPSHOT_KEY) adoptNewerSnapshot();
});
setInterval(
  () => {
    renderStatus();
    renderSyncAge();
  },
  STATUS_TICK_MS
);
setInterval(refreshLoad, LOAD_PANEL_REFRESH_MS);
setInterval(watchChanges, CHANGES_POLL_MS);
// Without waiting for the first poll: the cards to look at are marked from the first render.
pollChanges(!document.hidden);
if (!document.hidden) startVisit();
$("panel-sync").addEventListener("click", e => {
  if (e.target.closest(".resync") && state.openKey) syncDetail(
    state.openKey,
    "force"
  );
});

// Saved data: shown right away, then refreshed behind the scenes if it has aged.
renderThemeButton();
renderNotifyButton();
$("autoRefresh").checked = state.autoRefresh;
$("auto-refresh-label").title = `Reloads the data every ${AUTO_REFRESH_MS / 60000} minutes`;
adoptNewerSnapshot();
render();
sharedRefresh({ olderThan: STALE_ON_FOCUS_MS });
refreshLoad();
