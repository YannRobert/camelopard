// The page's pure logic (src/camelopard/static/logic.mjs), with Node's built-in runner: cd tests/js && node --test
// (run from here, it finds the *.test.mjs files itself: a folder given as argument fails on Node 22).
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  compactDuration,
  diffBlocks,
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

describe("diffLines", () => {
  it("keeps the unchanged lines and marks only those removed or added", () => {
    const lines = diffLines(
      "title\nfirst\nsecond\nend",
      "title\nfirst\nchanged\nend\nmore"
    );
    assert.deepEqual(
      lines.map(line => `${line.type} ${line.text}`),
      ["same title", "same first", "del second", "add changed", "same end", "add more"]
    );
    assert.deepEqual(diffStats(lines), { added: 2, removed: 1 });
  });

  it("numbers each line on the side it belongs to", () => {
    const [same, del, add] = diffLines(
      "a\nb",
      "a\nc"
    );
    assert.deepEqual([same.before, same.after], [1, 1]);
    assert.deepEqual([del.before, del.after], [2, null]);
    assert.deepEqual([add.before, add.after], [null, 2]);
  });

  it("ignores line endings and trailing spaces, which Jira changes from one save to the next", () => {
    const lines = diffLines(
      "h2. Context\r\n\r\nSome text  \r\nmore",
      "h2. Context\n\nSome text\nmore"
    );
    assert.deepEqual(diffStats(lines), { added: 0, removed: 0 });
  });

  it("treats a value set or cleared as all added or all removed", () => {
    assert.deepEqual(diffStats(diffLines("", "a\nb")), { added: 2, removed: 0 });
    assert.deepEqual(diffStats(diffLines("a\nb", null)), { added: 0, removed: 2 });
  });

  it("still answers on texts too long to match, showing the middle as removed then added", () => {
    const before = Array.from({ length: 2100 }, (_, i) => `old ${i}`).join("\n");
    const after = Array.from({ length: 2100 }, (_, i) => `new ${i}`).join("\n");
    assert.deepEqual(diffStats(diffLines(before, after)), { added: 2100, removed: 2100 });
  });
});

describe("diffWords", () => {
  it("marks the words that changed within a line", () => {
    assert.deepEqual(
      diffWords(
        "the cat sleeps here",
        "the dog sleeps there"
      ),
      [
        { type: "same", text: "the " },
        { type: "del", text: "cat" },
        { type: "add", text: "dog" },
        { type: "same", text: " sleeps " },
        { type: "del", text: "here" },
        { type: "add", text: "there" },
      ]
    );
  });
});

describe("diffBlocks", () => {
  const numbers = count => Array.from({ length: count }, (_, i) => `line ${i + 1}`);

  it("folds the unchanged lines away from a change, keeping the context around it", () => {
    const after = numbers(20);
    after[9] = "changed";
    const blocks = diffBlocks(
      diffLines(numbers(20).join("\n"), after.join("\n")),
      3
    );
    assert.deepEqual(
      blocks.map(block => block.type === "change" ? "change" : `${block.type} ${block.lines.length}`),
      ["skip 6", "same 3", "change", "same 3", "skip 7"]
    );
  });

  it("does not fold fewer lines than the fold itself would take", () => {
    const after = numbers(8);
    after[3] = "changed";
    const blocks = diffBlocks(
      diffLines(numbers(8).join("\n"), after.join("\n")),
      3
    );
    assert.ok(!blocks.some(block => block.type === "skip"));
  });
});

describe("pairLines", () => {
  const change = (before, after) => diffBlocks(diffLines(before, after)).find(block => block.type === "change");

  it("sets an edited line next to its former version, with its word diff", () => {
    const rows = pairLines(change(
      "x\nThe report is sent before 8:00.",
      "x\nA new line.\nThe report is sent before 8:30."
    ));
    assert.equal(rows.length, 2);
    assert.deepEqual([rows[0].del, rows[0].add.text], [null, "A new line."]);
    assert.equal(rows[1].del.text, "The report is sent before 8:00.");
    assert.equal(rows[1].add.text, "The report is sent before 8:30.");
    assert.ok(rows[1].parts.some(part => part.type === "add" && part.text === "30"));
  });

  it("does not mark words between lines that have little in common, but still faces them", () => {
    const rows = pairLines(change(
      "x\nCompletely different words here",
      "x\nNothing alike at all"
    ));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].parts, null);
    assert.ok(rows[0].del && rows[0].add);
  });
});
