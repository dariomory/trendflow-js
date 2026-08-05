import { ExportFormat } from "./enums.js";
import type { InterestOverTimeResult } from "./models.js";

/** Strategy for serializing an {@link InterestOverTimeResult} to file contents. */
export type InterestOverTimeExporter = (result: InterestOverTimeResult) => string;

export const INTEREST_OVER_TIME_EXPORTERS: Record<ExportFormat, InterestOverTimeExporter> = {
  [ExportFormat.CSV]: (result) => result.toCSV(),
  [ExportFormat.JSON]: (result) => JSON.stringify(result.toJSON(), null, 2),
};

/**
 * Dispatch export by format and write the file as UTF-8. Node.js only.
 */
export async function exportInterestOverTime(
  result: InterestOverTimeResult,
  fmt: ExportFormat,
  path: string,
): Promise<void> {
  const exporter = INTEREST_OVER_TIME_EXPORTERS[fmt];
  if (!exporter) {
    throw new Error(`Unsupported export format: ${String(fmt)}`);
  }
  const { writeFile } = await import("node:fs/promises");
  await writeFile(path, exporter(result), "utf-8");
}
