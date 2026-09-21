/**
 * Chunk_Size validation and normalization for the Tab-Updown extension.
 *
 * DOM-free pure logic. `validateChunkSize` is used by the Options_Page on
 * user-submitted input; `normalizeChunkSize` is used by the Content_Script as a
 * defensive fallback when reading a stored value. See design.md
 * "Chunk_Size Validation and Normalization".
 */

import { CHUNK_SIZE_MAX, CHUNK_SIZE_MIN, DEFAULT_CHUNK_SIZE } from "./constants";

/**
 * Discriminated result of {@link validateChunkSize}.
 *
 * - `{ ok: true, value }` carries the parsed integer when the input is a valid
 *   Chunk_Size in `[CHUNK_SIZE_MIN, CHUNK_SIZE_MAX]`.
 * - `{ ok: false, invalidValue }` echoes back the original rejected input so the
 *   Options_Page can identify it in a validation message (Requirement 3.5).
 */
export type ChunkSizeValidation =
  | { ok: true; value: number }
  | { ok: false; invalidValue: unknown };

/**
 * Matches a string that represents a pure (optionally signed) base-10 integer,
 * ignoring surrounding whitespace. Rejects decimals ("5.5"), exponents ("1e2"),
 * unit suffixes ("5px"), hex/binary prefixes, and empty/whitespace-only strings.
 */
const PURE_INTEGER_STRING = /^[+-]?\d+$/;

/**
 * Parse an arbitrary user-submitted value into a pure integer, or `undefined`
 * when the input does not represent one exactly.
 *
 * Accepts:
 * - `number` values that are already integers (via `Number.isInteger`).
 * - `string` values that, once trimmed, consist solely of an optional sign and
 *   digits (e.g. `"5"`, `" 42 "`, `"-3"`).
 *
 * Rejects everything else: floats/float strings ("3.5", "5.5"), non-numeric
 * strings ("abc", "5px"), exponent notation ("1e2"), empty/blank strings,
 * `NaN`/`Infinity`, `undefined`, `null`, booleans, objects, arrays, etc.
 */
function parsePureInteger(raw: unknown): number | undefined {
  if (typeof raw === "number") {
    return Number.isInteger(raw) ? raw : undefined;
  }

  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!PURE_INTEGER_STRING.test(trimmed)) {
      return undefined;
    }
    const parsed = Number(trimmed);
    // Guard against precision loss for very large integers; only accept exact
    // safe integers.
    return Number.isSafeInteger(parsed) ? parsed : undefined;
  }

  return undefined;
}

/** True when `value` is an integer within the inclusive Chunk_Size range. */
function isChunkSizeInRange(value: number): boolean {
  return (
    Number.isInteger(value) &&
    value >= CHUNK_SIZE_MIN &&
    value <= CHUNK_SIZE_MAX
  );
}

/**
 * Validate a user-submitted Chunk_Size (Requirement 3.1, 3.5).
 *
 * Returns `{ ok: true, value }` — with `value` the parsed integer — only when
 * `raw` parses to an integer in `[CHUNK_SIZE_MIN, CHUNK_SIZE_MAX]`. Otherwise
 * returns `{ ok: false, invalidValue: raw }`, echoing the original input.
 *
 * Rejects non-numeric input, non-integers (e.g. `3.5`, `"5.5"`), and
 * out-of-range values.
 */
export function validateChunkSize(raw: unknown): ChunkSizeValidation {
  const parsed = parsePureInteger(raw);
  if (parsed !== undefined && isChunkSizeInRange(parsed)) {
    return { ok: true, value: parsed };
  }
  return { ok: false, invalidValue: raw };
}

/**
 * Normalize a stored Chunk_Size into the valid range (Requirement 3.4, 3.6).
 *
 * Returns `stored` unchanged when it is an integer in
 * `[CHUNK_SIZE_MIN, CHUNK_SIZE_MAX]`; otherwise returns `DEFAULT_CHUNK_SIZE`.
 * This is the defensive fallback for absent, corrupt, non-numeric, float, or
 * out-of-range stored values.
 */
export function normalizeChunkSize(stored: unknown): number {
  if (typeof stored === "number" && isChunkSizeInRange(stored)) {
    return stored;
  }
  return DEFAULT_CHUNK_SIZE;
}
