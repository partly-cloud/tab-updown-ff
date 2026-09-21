/**
 * Property-based tests for Chunk_Size normalization (`normalizeChunkSize`).
 *
 * Uses fast-check under Jest, per the design's Testing Strategy. See
 * design.md "Correctness Properties" and tasks.md task 3.2.
 */
import fc from "fast-check";

import { CHUNK_SIZE_MAX, CHUNK_SIZE_MIN, DEFAULT_CHUNK_SIZE } from "./constants.js";
import { normalizeChunkSize, validateChunkSize } from "./settings.js";

/** True when `value` is an integer within the inclusive Chunk_Size range. */
function isValidChunkSize(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= CHUNK_SIZE_MIN &&
    value <= CHUNK_SIZE_MAX
  );
}

describe("normalizeChunkSize", () => {
  // Feature: tab-updown, Property 7: Chunk_Size normalization is a total function into the valid range
  // Validates: Requirements 3.3, 3.4, 3.6
  it("returns an integer in [1, 100]: valid integers unchanged, DEFAULT_CHUNK_SIZE otherwise", () => {
    // A generator spanning the input space `normalizeChunkSize` must tolerate:
    // valid in-range integers, out-of-range/negative integers, floats, NaN,
    // Infinity, arbitrary strings, undefined, null, booleans, objects, arrays.
    const arbitraryStored = fc.oneof(
      // Valid integers strictly inside the range (exercises the "unchanged" case).
      fc.integer({ min: CHUNK_SIZE_MIN, max: CHUNK_SIZE_MAX }),
      // Out-of-range integers on both sides of the boundary.
      fc.integer({ min: -1000, max: CHUNK_SIZE_MIN - 1 }),
      fc.integer({ min: CHUNK_SIZE_MAX + 1, max: 1000 }),
      // Any integer (broad coverage).
      fc.integer(),
      // Floats and non-finite numbers (non-integers must fall back).
      fc.float(),
      fc.double(),
      fc.constantFrom(NaN, Infinity, -Infinity, 0, -0),
      // Strings, including numeric-looking ones (a stored non-number must fall back).
      fc.string(),
      fc.constantFrom("5", "50", "100", "3.5", "abc", "", " "),
      // Absent / other types.
      fc.constant(undefined),
      fc.constant(null),
      fc.boolean(),
      fc.object(),
      fc.array(fc.integer()),
    );

    fc.assert(
      fc.property(arbitraryStored, (stored) => {
        const result = normalizeChunkSize(stored);

        // Output is always an integer in [1, 100].
        expect(Number.isInteger(result)).toBe(true);
        expect(result).toBeGreaterThanOrEqual(CHUNK_SIZE_MIN);
        expect(result).toBeLessThanOrEqual(CHUNK_SIZE_MAX);

        if (isValidChunkSize(stored)) {
          // Unchanged for a valid in-range integer.
          expect(result).toBe(stored);
        } else {
          // DEFAULT_CHUNK_SIZE (5) for every other input.
          expect(result).toBe(DEFAULT_CHUNK_SIZE);
        }
      }),
      { numRuns: 100 },
    );
  });
});
/**
 * Independent oracle for {@link validateChunkSize}, derived from the acceptance
 * criteria rather than the implementation: a submitted value is a valid
 * Chunk_Size iff it parses to an integer in `[CHUNK_SIZE_MIN, CHUNK_SIZE_MAX]`.
 *
 * "Parses to an integer" means either an integer `number`, or a string that —
 * once trimmed — is an optionally-signed run of base-10 digits denoting a safe
 * integer. Returns the parsed integer when valid, otherwise `undefined`.
 */
function expectedParsedInteger(raw: unknown): number | undefined {
  let parsed: number | undefined;

  if (typeof raw === "number") {
    parsed = Number.isInteger(raw) ? raw : undefined;
  } else if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (/^[+-]?\d+$/.test(trimmed)) {
      const n = Number(trimmed);
      parsed = Number.isSafeInteger(n) ? n : undefined;
    }
  }

  if (
    parsed !== undefined &&
    parsed >= CHUNK_SIZE_MIN &&
    parsed <= CHUNK_SIZE_MAX
  ) {
    return parsed;
  }
  return undefined;
}

describe("validateChunkSize", () => {
  // Feature: tab-updown, Property 8: Chunk_Size validation accepts exactly the valid range and echoes invalid input
  // Validates: Requirements 3.2, 3.5
  it("returns { ok: true, value } iff input parses to an integer in [1, 100], else { ok: false } echoing the input", () => {
    // A generator spanning the user-submitted input space `validateChunkSize`
    // must classify: in-range integers, boundary values, out-of-range integers,
    // floats, non-finite numbers, numeric-looking strings (integer and float),
    // whitespace-padded integer strings, non-numeric strings, and other types.
    const arbitrarySubmitted = fc.oneof(
      // Valid in-range integers, plus the exact boundaries.
      fc.integer({ min: CHUNK_SIZE_MIN, max: CHUNK_SIZE_MAX }),
      fc.constantFrom(CHUNK_SIZE_MIN, CHUNK_SIZE_MAX),
      // Out-of-range integers on both sides of the boundary.
      fc.integer({ min: -1000, max: CHUNK_SIZE_MIN - 1 }),
      fc.integer({ min: CHUNK_SIZE_MAX + 1, max: 1000 }),
      // Any integer (broad coverage).
      fc.integer(),
      // Floats and non-finite numbers (non-integers must be rejected).
      fc.float(),
      fc.double(),
      fc.constantFrom(NaN, Infinity, -Infinity),
      // Integer-valued strings, including signed and whitespace-padded forms.
      fc.integer({ min: -1000, max: 1000 }).map((n) => String(n)),
      fc.integer({ min: CHUNK_SIZE_MIN, max: CHUNK_SIZE_MAX }).map((n) => `  ${n} `),
      // Numeric-looking strings that are not pure integers (floats, exponents, units).
      fc.constantFrom("5", "50", "100", "1", "3.5", "5.5", "1e2", "5px", "0x10", "", " ", "  "),
      // Arbitrary strings.
      fc.string(),
      // Absent / other types.
      fc.constant(undefined),
      fc.constant(null),
      fc.boolean(),
      fc.object(),
      fc.array(fc.integer()),
    );

    fc.assert(
      fc.property(arbitrarySubmitted, (submitted) => {
        const result = validateChunkSize(submitted);
        const expected = expectedParsedInteger(submitted);

        if (expected !== undefined) {
          // Accepted: ok with the parsed integer value.
          expect(result).toEqual({ ok: true, value: expected });
        } else {
          // Rejected: not ok, echoing the original invalid input.
          expect(result.ok).toBe(false);
          if (!result.ok) {
            // NaN is not `===` itself, so compare identity via Object.is.
            expect(Object.is(result.invalidValue, submitted)).toBe(true);
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});
