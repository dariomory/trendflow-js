/**
 * The contract every parser owes its caller: junk in, empty out, never a throw.
 *
 * Google owns these response shapes and changes them without notice — it has retired whole
 * endpoints in this product before. A parser that throws on an unexpected shape turns a partial
 * degradation into a hard failure, and in the hosted service into a tool error for a paying
 * customer. Returning nothing is honest; throwing is not.
 *
 * Deliberately blunt: every parser against every shape of nonsense. A new parser with no entry
 * here is the gap worth catching.
 */
import { describe, expect, it } from "vitest";

import { Resolution } from "../src/enums.js";
import * as parsers from "../src/parsers.js";

/**
 * Values Google could plausibly send where a list or object is expected. `null` and `undefined`
 * are included because a JSON `null` is the single most likely drift.
 */
const JUNK: unknown[] = [
  null,
  undefined,
  0,
  "",
  "a string",
  [],
  {},
  [null],
  [[]],
  [{}],
  [0],
  { unexpected: null },
  { timelineData: null },
  { geoMapData: "not a list" },
  [{ no: "expected keys" }],
];

describe("row parsers", () => {
  // The contract is "returns an array, never throws" rather than "always empty": some entries
  // above are valid minimal rows, and discarding those would be a different bug.
  it.each(JUNK)("trendingRowsToItems survives %j", (junk) => {
    expect(() => parsers.trendingRowsToItems(junk as never)).not.toThrow();
    expect(Array.isArray(parsers.trendingRowsToItems(junk as never))).toBe(true);
  });

  it.each(JUNK)("suggestionRowsToTopics survives %j", (junk) => {
    expect(() => parsers.suggestionRowsToTopics(junk as never)).not.toThrow();
    expect(Array.isArray(parsers.suggestionRowsToTopics(junk as never))).toBe(true);
  });

  it.each(JUNK)("parseTopRelated survives %j", (junk) => {
    expect(() => parsers.parseTopRelated(junk as never)).not.toThrow();
    expect(Array.isArray(parsers.parseTopRelated(junk as never))).toBe(true);
  });

  it.each(JUNK)("parseRisingRelated survives %j", (junk) => {
    expect(() => parsers.parseRisingRelated(junk as never)).not.toThrow();
    expect(Array.isArray(parsers.parseRisingRelated(junk as never))).toBe(true);
  });
});

describe("result parsers", () => {
  it.each(JUNK)("interestOverTimeToResult survives %j", (junk) => {
    const result = parsers.interestOverTimeToResult(junk as never, ["kw"], "US");
    expect(result.points).toEqual([]);
    expect(result.granularity).toBe("unknown");
  });

  it.each(JUNK)("interestByRegionRows survives %j", (junk) => {
    expect(parsers.interestByRegionRows(junk as never, "kw", ["kw"])).toEqual([]);
  });

  it.each(JUNK)("interestByRegionToResult survives %j", (junk) => {
    const result = parsers.interestByRegionToResult(
      junk as never,
      "kw",
      ["kw"],
      Resolution.COUNTRY,
    );
    expect(result.rows).toEqual([]);
  });

  it.each(JUNK)("relatedQueriesToResult survives %j", (junk) => {
    expect(() => parsers.relatedQueriesToResult(junk as never, "kw")).not.toThrow();
  });
});

describe("half-valid payloads", () => {
  // The realistic drift, rather than wholesale nonsense.
  it("skips a timeline entry with no usable timestamp", () => {
    const raw = {
      timelineData: [
        { time: "1700000000", value: "[50]" },
        { value: "[60]" },
        { time: null, value: "[70]" },
        { time: "1700604800", value: "[80]" },
      ],
    };
    const result = parsers.interestOverTimeToResult(raw as never, ["kw"], "US");
    expect(result.points.map((p) => p.scores.kw)).toEqual([50, 80]);
  });

  it("keeps regional rows that are missing a label", () => {
    const raw = { geoMapData: [{ value: "[42]" }, null, { geoName: "Texas", value: "[7]" }] };
    const rows = parsers.interestByRegionRows(raw as never, "kw", ["kw"]);
    expect(rows.map((r) => [r.label, r.value])).toEqual([
      ["", 42],
      ["", 0],
      ["Texas", 7],
    ]);
  });

  it("falls back to the sole bucket when the keyword does not match", () => {
    const raw = { "other keyword": { top: [{ query: "a", value: 1 }], rising: null } };
    const result = parsers.relatedQueriesToResult(raw as never, "kw");
    expect(result.top.map((q) => q.term)).toEqual(["a"]);
    expect(result.rising).toEqual([]);
  });

  it("declines to guess between several buckets", () => {
    // Picking one would attribute another term's data to this keyword.
    const raw = { a: { top: [{ query: "x" }] }, b: { top: [{ query: "y" }] } };
    expect(parsers.relatedQueriesToResult(raw as never, "kw").top).toEqual([]);
  });
});
