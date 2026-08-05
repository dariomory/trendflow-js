import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ExportFormat } from "../src/enums.js";
import { InterestOverTimeResult, type TrendPoint } from "../src/models.js";

const points: TrendPoint[] = [
  { date: new Date(Date.UTC(2024, 0, 1)), scores: { Python: 80, JavaScript: 70 } },
  { date: new Date(Date.UTC(2024, 0, 8)), scores: { Python: 85, JavaScript: 65 } },
];

const result = new InterestOverTimeResult(["Python", "JavaScript"], "weekly", points);
const empty = new InterestOverTimeResult(["Python"], "unknown", []);

describe("InterestOverTimeResult.columns", () => {
  it("derives columns from the points", () => {
    expect(result.columns).toEqual(["Python", "JavaScript"]);
  });

  it("falls back to the keywords when there are no points", () => {
    expect(empty.columns).toEqual(["Python"]);
  });
});

describe("InterestOverTimeResult.toArray", () => {
  it("returns one plain object per point", () => {
    expect(result.toArray()).toEqual([
      { date: points[0]!.date, Python: 80, JavaScript: 70 },
      { date: points[1]!.date, Python: 85, JavaScript: 65 },
    ]);
  });

  it("returns an empty array for an empty result", () => {
    expect(empty.toArray()).toEqual([]);
  });
});

describe("InterestOverTimeResult.toJSON", () => {
  it("serializes dates as ISO 8601 strings", () => {
    expect(result.toJSON()[0]).toEqual({
      date: "2024-01-01T00:00:00.000Z",
      Python: 80,
      JavaScript: 70,
    });
  });

  it("drives JSON.stringify", () => {
    expect(JSON.parse(JSON.stringify(result))).toHaveLength(2);
  });
});

describe("InterestOverTimeResult.toCSV", () => {
  it("writes a header row and one row per point", () => {
    expect(result.toCSV()).toBe(
      "date,Python,JavaScript\n" +
        "2024-01-01T00:00:00.000Z,80,70\n" +
        "2024-01-08T00:00:00.000Z,85,65\n",
    );
  });

  it("writes only a header for an empty result", () => {
    expect(empty.toCSV()).toBe("date,Python\n");
  });

  it("quotes keywords containing commas", () => {
    const tricky = new InterestOverTimeResult(
      ["a,b"],
      "weekly",
      [{ date: new Date(Date.UTC(2024, 0, 1)), scores: { "a,b": 5 } }],
    );
    expect(tricky.toCSV().split("\n")[0]).toBe('date,"a,b"');
  });

  it("leaves cells empty for series missing from a point", () => {
    const sparse = new InterestOverTimeResult(
      ["a", "b"],
      "weekly",
      [
        { date: new Date(Date.UTC(2024, 0, 1)), scores: { a: 1, b: 2 } },
        { date: new Date(Date.UTC(2024, 0, 8)), scores: { a: 3 } },
      ],
    );
    expect(sparse.toCSV().trim().split("\n")[2]).toBe("2024-01-08T00:00:00.000Z,3,");
  });
});

describe("InterestOverTimeResult.export", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "trendflow-js-"));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes CSV to disk", async () => {
    const path = join(dir, "trends.csv");
    await result.export(ExportFormat.CSV, path);
    expect(await readFile(path, "utf-8")).toBe(result.toCSV());
  });

  it("writes JSON to disk", async () => {
    const path = join(dir, "trends.json");
    await result.export(ExportFormat.JSON, path);
    expect(JSON.parse(await readFile(path, "utf-8"))).toEqual(result.toJSON());
  });

  it("rejects an unsupported format", async () => {
    await expect(
      result.export("xml" as ExportFormat, join(dir, "trends.xml")),
    ).rejects.toThrow(/Unsupported export format/);
  });
});
