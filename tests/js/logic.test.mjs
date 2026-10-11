// The page's pure logic (src/camelopard/static/logic.mjs), with Node's built-in runner: cd tests/js && node --test
// (run from here, it finds the *.test.mjs files itself: a folder given as argument fails on Node 22).
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  compactDuration,
  escapeHtml,
  formatSize,
  latestSprint,
  normalize,
  parseSearch,
  standupSince,
  toJiraDate,
} from "../../src/camelopard/static/logic.mjs";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
// The keywords the page understands; only the keys count for parsing.
const FIELDS = { type: 1, status: 1, priority: 1, label: 1, epic: 1, assignee: 1 };

describe("compactDuration", () => {
  it("counts seconds in steps of 5 for two minutes, so a fresh refresh is told from an old one", () => {
    assert.equal(compactDuration(0), "< 5 s");
    assert.equal(compactDuration(4 * SECOND), "< 5 s");
    assert.equal(compactDuration(12 * SECOND), "10 s");
    assert.equal(compactDuration(119 * SECOND), "115 s");
  });

  it("then minutes, hours and days", () => {
    assert.equal(compactDuration(2 * MINUTE), "2 min");
    assert.equal(compactDuration(HOUR), "1h");
    assert.equal(compactDuration(HOUR + 5 * MINUTE), "1h05");
    assert.equal(compactDuration(DAY), "1 d");
    assert.equal(compactDuration(DAY + 3 * HOUR), "1 d 3h");
  });

  it("treats a clock running ahead as no time at all", () => {
    assert.equal(compactDuration(-5 * SECOND), "< 5 s");
  });
});

describe("escapeHtml", () => {
  it("escapes what would end a tag or an attribute", () => {
    assert.equal(escapeHtml(`<img src="x" onerror='y'>&`), "&lt;img src=&quot;x&quot; onerror=&#39;y&#39;&gt;&amp;");
  });

  it("writes nothing for a missing value", () => {
    assert.equal(escapeHtml(null), "");
    assert.equal(escapeHtml(undefined), "");
    assert.equal(escapeHtml(0), "0");
  });
});

describe("formatSize", () => {
  it("uses the unit that keeps the number short", () => {
    assert.equal(formatSize(512), "512 B");
    assert.equal(formatSize(2048), "2 KB");
    assert.equal(formatSize(3.5 * 1024 * 1024), "3.5 MB");
  });
});

describe("Jira dates", () => {
  it("writes an ISO date as Jira's board does, in UTC", () => {
    assert.equal(toJiraDate("2026-10-05T07:30:00Z"), "05/10/2026 07:30");
  });

  it("picks the most recently started sprint, the highest id when they started together", () => {
    const sprints = [
      { id: 1, start: "01/09/2026 09:00" },
      { id: 3, start: "28/09/2026 09:00" },
      { id: 2, start: "28/09/2026 09:00" },
      { id: 4 },
    ];
    assert.equal(latestSprint(sprints), 3);
    assert.equal(latestSprint([]), null);
  });
});

describe("standupSince", () => {
  const at = (day, hour) => new Date(2026, 9, day, hour, 30);

  it("starts at midnight of the previous working day", () => {
    assert.equal(standupSince(at(7, 9)), new Date(2026, 9, 6).getTime());
  });

  it("goes back to Friday on a Monday, and on a weekend", () => {
    const friday = new Date(2026, 9, 9).getTime();
    assert.equal(standupSince(at(12, 9)), friday);
    assert.equal(standupSince(at(11, 9)), friday);
  });
});

describe("parseSearch", () => {
  const parse = query => parseSearch(query, FIELDS);

  it("splits words, ignoring accents and case", () => {
    assert.deepEqual(parse("Réglé  Panier"), [
      { negate: false, field: undefined, value: "regle" },
      { negate: false, field: undefined, value: "panier" },
    ]);
  });

  it("reads keywords, their aliases, quotes and exclusions", () => {
    assert.deepEqual(parse(`status:"in progress" prio:high -label:back`), [
      { negate: false, field: "status", value: "in progress" },
      { negate: false, field: "priority", value: "high" },
      { negate: true, field: "label", value: "back" },
    ]);
  });

  it("takes @name for the assignee", () => {
    assert.deepEqual(parse("@alice"), [{ negate: false, field: "assignee", value: "alice" }]);
  });

  it("keeps an unknown prefix as a plain word, so a URL or a key stays searchable", () => {
    assert.deepEqual(parse("http://x ABC:1"), [
      { negate: false, field: null, value: "http://x" },
      { negate: false, field: null, value: "abc:1" },
    ]);
  });

  it("ignores a keyword still being typed, and a lone dash", () => {
    assert.deepEqual(parse("type:"), []);
    assert.deepEqual(parse("-"), []);
  });

  it("runs an unclosed quote to the end, as it is still being typed", () => {
    assert.deepEqual(parse(`epic:"login pa`), [{ negate: false, field: "epic", value: "login pa" }]);
  });
});

describe("normalize", () => {
  it("drops accents and case", () => {
    assert.equal(normalize("Éléonore ÇA"), "eleonore ca");
  });
});
