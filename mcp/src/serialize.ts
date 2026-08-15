/**
 * Result shaping for MCP.
 *
 * The library already returns plain objects, so there is no dataclass walker to write —
 * only `Date` needs converting, since JSON has no date type and an agent reading
 * `"2026-08-15T19:10:00.000Z"` can reason about it directly.
 */

/** Recursively replace `Date` values with ISO 8601 strings. */
export function toJsonSafe<T>(value: T): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(toJsonSafe);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, toJsonSafe(v)]),
    );
  }
  return value;
}

/** A successful tool result: pretty JSON in a single text block. */
export function ok(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(toJsonSafe(payload), null, 2) }],
  };
}

/**
 * A failed tool result. Returns `isError` rather than throwing so the model sees the
 * message and can act on it — the library's errors already say what to do (back off, use a
 * proxy, override a renamed RPC id).
 */
export function fail(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : "Error";
  return {
    isError: true,
    content: [{ type: "text" as const, text: `${name}: ${message}` }],
  };
}
