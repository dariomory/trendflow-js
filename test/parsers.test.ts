import { describe, expect, it } from "vitest";

import { Resolution } from "../src/enums.js";
import {
  inferGranularity,
  interestByRegionRows,
  interestByRegionToResult,
  interestOverTimeToResult,
  parseRisingRelated,
  parseTopRelated,
  relatedQueriesToResult,
  trendingResultFromTitles,
  trendingTitlesToItems,
} from "../src/parsers.js";

const JAN1 = Math.floor(Date.UTC(2024, 0, 1) / 1000);
const DAY = 86_400;

describe("inferGranularity", () => {
  it("returns weekly for a 7-day gap", () => {
    expect(inferGranularity(new Date(0), new Date(7 * DAY * 1000))).toBe("weekly");
  });

  it("returns weekly at the 6-day boundary", () => {
    expect(inferGranularity(new Date(0), new Date(6 * DAY * 1000))).toBe("weekly");
  });

  it("returns daily for a 1-day gap", () => {
    expect(inferGranularity(new Date(0), new Date(DAY * 1000))).toBe("daily");
  });

  it("returns hourly for a sub-day gap", () => {
    expect(inferGranularity(new Date(0), new Date(3600 * 1000))).toBe("hourly");
  });
});

describe("interestOverTimeToResult", () => {
  it("maps values positionally onto keywords", () => {
    const def = {
      timelineData: [
        { time: String(JAN1), value: "[80,70]" },
        { time: String(JAN1 + 7 * DAY), value: "[85,65]" },
      ],
    };
    const result = interestOverTimeToResult(def, ["Python", "JavaScript"], "US");

    expect(result.keywords).toEqual(["Python", "JavaScript"]);
    expect(result.granularity).toBe("weekly");
    expect(result.points).toHaveLength(2);
    expect(result.points[0]!.scores).toEqual({ Python: 80, JavaScript: 70 });
    expect(result.points[0]!.date.getTime()).toBe(JAN1 * 1000);
    expect(result.points[1]!.scores).toEqual({ Python: 85, JavaScript: 65 });
  });

  it("accepts values already given as arrays", () => {
    const def = { timelineData: [{ time: String(JAN1), value: [42, 7] }] };
    const result = interestOverTimeToResult(def, ["a", "b"], "");
    expect(result.points[0]!.scores).toEqual({ a: 42, b: 7 });
  });

  it("returns an empty unknown-granularity result when there is no timeline", () => {
    const result = interestOverTimeToResult({}, ["Python"], "US");
    expect(result.granularity).toBe("unknown");
    expect(result.points).toEqual([]);
  });

  it("cannot infer granularity from a single point", () => {
    const def = { timelineData: [{ time: String(JAN1), value: "[80]" }] };
    expect(interestOverTimeToResult(def, ["Python"], "US").granularity).toBe("unknown");
  });

  it("names series keyword|geo when comparing multiple geos", () => {
    const def = { timelineData: [{ time: String(JAN1), value: "[10,20]" }] };
    const result = interestOverTimeToResult(def, ["Python"], ["US", "GB"]);
    expect(result.points[0]!.scores).toEqual({ "Python|US": 10, "Python|GB": 20 });
  });

  it("stops at the number of values Google returned", () => {
    const def = { timelineData: [{ time: String(JAN1), value: "[80]" }] };
    const result = interestOverTimeToResult(def, ["Python", "JavaScript"], "US");
    expect(result.points[0]!.scores).toEqual({ Python: 80 });
  });
});

describe("interestByRegionRows", () => {
  const def = {
    geoMapData: [
      { geoName: "California", value: "[90,40]" },
      { geoName: "Texas", value: "[70,55]" },
    ],
  };

  it("selects the value column matching the keyword index", () => {
    expect(interestByRegionRows(def, "JavaScript", ["Python", "JavaScript"])).toEqual([
      { label: "California", value: 40 },
      { label: "Texas", value: 55 },
    ]);
  });

  it("falls back to the first column for an unknown keyword", () => {
    expect(interestByRegionRows(def, "Rust", ["Python", "JavaScript"])[0]!.value).toBe(90);
  });

  it("returns an empty list when geoMapData is missing", () => {
    expect(interestByRegionRows({}, "Python", ["Python"])).toEqual([]);
  });

  it("wraps rows with keyword and resolution", () => {
    const result = interestByRegionToResult(def, "Python", ["Python"], Resolution.REGION);
    expect(result.keyword).toBe("Python");
    expect(result.resolution).toBe(Resolution.REGION);
    expect(result.rows).toHaveLength(2);
  });
});

describe("trending helpers", () => {
  it("maps titles to items with empty traffic and articles", () => {
    expect(trendingTitlesToItems(["one", "two"])).toEqual([
      { title: "one", traffic: "", articles: [] },
      { title: "two", traffic: "", articles: [] },
    ]);
  });

  it("wraps items in a result", () => {
    expect(trendingResultFromTitles(["one"]).results).toHaveLength(1);
  });
});

describe("related query parsing", () => {
  it("parses top rows into terms and integer values", () => {
    expect(parseTopRelated([{ query: "python tutorial", value: 100 }])).toEqual([
      { term: "python tutorial", value: 100 },
    ]);
  });

  it("nulls out missing top values", () => {
    expect(parseTopRelated([{ query: "x", value: null }])[0]!.value).toBeNull();
    expect(parseTopRelated([{ query: "x" }])[0]!.value).toBeNull();
  });

  it("returns an empty list for null rows", () => {
    expect(parseTopRelated(null)).toEqual([]);
    expect(parseRisingRelated(undefined)).toEqual([]);
  });

  it("prefers formattedValue for rising breakouts", () => {
    expect(parseRisingRelated([{ query: "x", value: 5000, formattedValue: "Breakout" }])).toEqual([
      { term: "x", breakout: "Breakout" },
    ]);
  });

  it("falls back to value when formattedValue is absent", () => {
    expect(parseRisingRelated([{ query: "x", value: 250 }])[0]!.breakout).toBe("250");
  });

  it("nulls out missing rising breakouts", () => {
    expect(parseRisingRelated([{ query: "x" }])[0]!.breakout).toBeNull();
  });
});

describe("relatedQueriesToResult", () => {
  const bucket = {
    top: [{ query: "top one", value: 100 }],
    rising: [{ query: "rising one", formattedValue: "+900%" }],
  };

  it("picks the bucket matching the keyword", () => {
    const result = relatedQueriesToResult({ python: bucket, rust: { top: [], rising: [] } }, "python");
    expect(result.top).toEqual([{ term: "top one", value: 100 }]);
    expect(result.rising).toEqual([{ term: "rising one", breakout: "+900%" }]);
  });

  it("falls back to the sole bucket when the keyword does not match", () => {
    const result = relatedQueriesToResult({ "": bucket }, "python");
    expect(result.top).toHaveLength(1);
  });

  it("returns empty when the keyword is absent and several buckets exist", () => {
    const result = relatedQueriesToResult({ a: bucket, b: bucket }, "python");
    expect(result).toEqual({ top: [], rising: [] });
  });

  it("returns empty for an empty payload", () => {
    expect(relatedQueriesToResult({}, "python")).toEqual({ top: [], rising: [] });
  });
});
