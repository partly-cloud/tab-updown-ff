/**
 * Property-based tests for the pure Popup_Region helpers in `./popup`
 * (`excludePopupRegions`, `mapStartPosition`, `resolveNavigationTarget`).
 *
 * Uses fast-check under Jest, per the expanded-popup-focus-trap-fix design's
 * Testing Strategy. See design.md "Correctness Properties" (Properties 3 and 4)
 * and tasks.md task 3.4. The helpers are DOM-free, so these properties run on
 * plain values. Each property runs a minimum of 100 iterations.
 */
import fc from "fast-check";

import { CHUNK_SIZE_MAX, CHUNK_SIZE_MIN } from "./constants.js";
import { computeTargetIndex, NO_TARGET, type Direction } from "./focus.js";
import {
  excludePopupRegions,
  mapStartPosition,
  resolveNavigationTarget,
  type StartPosition,
  type StartPositionArgs,
} from "./popup.js";

/** Chunk_Size arbitrary constrained to the valid range `[1, 100]`. */
const chunkSize = fc.integer({ min: CHUNK_SIZE_MIN, max: CHUNK_SIZE_MAX });

/** Navigation direction arbitrary. */
const direction = fc.constantFrom<Direction>("forward", "backward");

// ---------------------------------------------------------------------------
// Property 3: Region filtering
// ---------------------------------------------------------------------------

/**
 * A Focus_Order entry. Each position gets its own object, so identity checks
 * stay meaningful when generated values repeat.
 */
interface Entry {
  value: number;
  pos: number;
}

/** Wrap generated values as distinct {@link Entry} objects in order. */
function toEntries(values: readonly number[]): Entry[] {
  return values.map((value, pos) => ({ value, pos }));
}

/** Kind of a Focus_Order entry relative to Popup_Regions. */
type Role = "page" | "trigger" | "member";

interface RoleEntry {
  role: Role;
  pos: number;
}

describe("excludePopupRegions", () => {
  // Feature: expanded-popup-focus-trap-fix, Property 3: Region filtering removes exactly the region members and keeps order
  // **Validates: Requirements 2.1, 3.5**
  it("returns exactly the elements with R(e) = false, in their original relative order", () => {
    fc.assert(
      // Arbitrary int arrays (duplicates allowed) and an arbitrary pure
      // predicate R over the values.
      fc.property(
        fc.array(fc.integer(), { maxLength: 200 }),
        fc.func<[number], boolean>(fc.boolean()),
        (values, inRegion) => {
          const order = toEntries(values);
          const snapshot = [...order];
          const isInRegion = (entry: Entry): boolean => inRegion(entry.value);

          const result = excludePopupRegions(order, isInRegion);

          // Oracle: walk O once and keep each entry R rejects, by position.
          const expected: Entry[] = [];
          for (const entry of order) {
            if (!isInRegion(entry)) {
              expected.push(entry);
            }
          }

          // Same entries (by identity), same order.
          expect(result).toHaveLength(expected.length);
          result.forEach((entry, k) => expect(entry).toBe(expected[k]));
          // No region member survives, and original positions stay ascending.
          expect(result.every((entry) => !isInRegion(entry))).toBe(true);
          for (let k = 1; k < result.length; k += 1) {
            expect(result[k].pos).toBeGreaterThan(result[k - 1].pos);
          }
          // The input order is not mutated.
          expect(order).toEqual(snapshot);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: expanded-popup-focus-trap-fix, Property 3: Region filtering removes exactly the region members and keeps order
  // **Validates: Requirements 2.1, 3.7**
  it("keeps every Popup_Trigger and page element and drops every region member", () => {
    fc.assert(
      // Arbitrary mixes of page elements, triggers, and region members; R is
      // "is a region member", so triggers are outside every region.
      fc.property(
        fc.array(fc.constantFrom<Role>("page", "trigger", "member"), {
          maxLength: 200,
        }),
        (roles) => {
          const order: RoleEntry[] = roles.map((role, pos) => ({ role, pos }));
          const isInRegion = (entry: RoleEntry): boolean => entry.role === "member";

          const result = excludePopupRegions(order, isInRegion);

          const byRole = (list: readonly RoleEntry[], role: Role): RoleEntry[] =>
            list.filter((entry) => entry.role === role);

          // Every trigger and every page element is kept, by identity and in
          // the same relative order; no member remains.
          const keptTriggers = byRole(result, "trigger");
          const allTriggers = byRole(order, "trigger");
          expect(keptTriggers).toHaveLength(allTriggers.length);
          keptTriggers.forEach((entry, k) => expect(entry).toBe(allTriggers[k]));

          const keptPage = byRole(result, "page");
          const allPage = byRole(order, "page");
          expect(keptPage).toHaveLength(allPage.length);
          keptPage.forEach((entry, k) => expect(entry).toBe(allPage[k]));

          expect(byRole(result, "member")).toHaveLength(0);
          // Triggers keep their positions relative to page elements.
          expect(result.map((entry) => entry.pos)).toEqual(
            order.filter((entry) => entry.role !== "member").map((entry) => entry.pos),
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: expanded-popup-focus-trap-fix, Property 3: Region filtering removes exactly the region members and keeps order
  // **Validates: Requirements 3.5, 3.7**
  it("is the identity when R is always false (region-free page)", () => {
    fc.assert(
      fc.property(fc.array(fc.integer(), { maxLength: 200 }), (values) => {
        const order = toEntries(values);

        const result = excludePopupRegions(order, () => false);

        // Same contents as O, element for element.
        expect(result).toEqual(order);
        result.forEach((entry, k) => expect(entry).toBe(order[k]));
        // Plain int arrays too.
        expect(excludePopupRegions(values, () => false)).toEqual(values);
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 4: Start position mapping
// ---------------------------------------------------------------------------

/** A generated navigation scenario for Property 4 (indices into O'). */
interface Scenario extends StartPositionArgs {
  n: number;
  direction: Direction;
  c: number;
}

/**
 * An index into an order of length `n`, or `-1` (absent) about half the time,
 * so the "absent" branches of the precedence rules are well exercised.
 */
function optionalIndex(n: number): fc.Arbitrary<number> {
  if (n === 0) {
    return fc.constant(NO_TARGET);
  }
  return fc.oneof(fc.constant(NO_TARGET), fc.integer({ min: 0, max: n - 1 }));
}

/**
 * Length of O'. Weighted so an empty order (n == 0) shows up regularly
 * alongside non-empty orders up to 1000.
 */
const orderLength = fc.oneof(
  { arbitrary: fc.constant(0), weight: 1 },
  { arbitrary: fc.integer({ min: 1, max: 1000 }), weight: 9 },
);

/**
 * Arbitrary `{ n, focusedIndex, focusInRegion, triggerIndex, precedingIndex,
 * direction, c }`. `focusedIndex` is generated independently of
 * `focusInRegion` so the tests also confirm it's ignored when focus is inside
 * a region (and that trigger/preceding are ignored when it's outside).
 */
const scenario: fc.Arbitrary<Scenario> = orderLength.chain((n) =>
  fc.record({
    n: fc.constant(n),
    focusedIndex: optionalIndex(n),
    focusInRegion: fc.boolean(),
    triggerIndex: optionalIndex(n),
    precedingIndex: optionalIndex(n),
    direction,
    c: chunkSize,
  }),
);

/** Oracle for design Property 4's start precedence, written from the spec. */
function expectedStart(args: StartPositionArgs): StartPosition {
  if (!args.focusInRegion) {
    return args.focusedIndex === NO_TARGET
      ? { kind: "none" }
      : { kind: "at", index: args.focusedIndex };
  }
  if (args.triggerIndex !== NO_TARGET) {
    return { kind: "at", index: args.triggerIndex };
  }
  if (args.precedingIndex !== NO_TARGET) {
    return { kind: "at", index: args.precedingIndex };
  }
  return { kind: "before-first" };
}

/**
 * Oracle for the chunk target from a start, in closed form (independent of
 * `computeTargetIndex`): `at(i)` → `min(i+c, n-1)` / `max(i-c, 0)`; `none` →
 * `min(c-1, n-1)` / `n-1`; `before-first` → `min(c-1, n-1)` / `0`; and
 * `NO_TARGET` whenever `n == 0`.
 */
function expectedTarget(
  dir: Direction,
  start: StartPosition,
  c: number,
  n: number,
): number {
  if (n === 0) {
    return NO_TARGET;
  }
  const last = n - 1;
  switch (start.kind) {
    case "at":
      return dir === "forward" ? Math.min(start.index + c, last) : Math.max(start.index - c, 0);
    case "none":
      return dir === "forward" ? Math.min(c - 1, last) : last;
    case "before-first":
      return dir === "forward" ? Math.min(c - 1, last) : 0;
  }
}

/** Arbitrary start position of every kind, with `at` indices in `[0, 1000]`. */
const anyStart: fc.Arbitrary<StartPosition> = fc.oneof(
  fc.record({
    kind: fc.constant("at" as const),
    index: fc.integer({ min: 0, max: 1000 }),
  }),
  fc.constant<StartPosition>({ kind: "none" }),
  fc.constant<StartPosition>({ kind: "before-first" }),
);

describe("mapStartPosition and resolveNavigationTarget", () => {
  // Feature: expanded-popup-focus-trap-fix, Property 4: Start position maps in-region focus to the trigger
  // **Validates: Requirements 2.4**
  it("mapStartPosition: outside → at(focused) or none; inside → at(trigger), else at(preceding), else before-first", () => {
    fc.assert(
      fc.property(scenario, ({ focusedIndex, focusInRegion, triggerIndex, precedingIndex }) => {
        const args: StartPositionArgs = {
          focusedIndex,
          focusInRegion,
          triggerIndex,
          precedingIndex,
        };

        expect(mapStartPosition(args)).toEqual(expectedStart(args));
      }),
      { numRuns: 100 },
    );
  });

  // Feature: expanded-popup-focus-trap-fix, Property 4: Start position maps in-region focus to the trigger
  // **Validates: Requirements 2.1, 2.4**
  it("resolveNavigationTarget maps the resolved start like computeTargetIndex, with before-first → min(c-1, n-1) forward / 0 backward", () => {
    fc.assert(
      fc.property(scenario, (s) => {
        const start = mapStartPosition(s);
        const target = resolveNavigationTarget(s.direction, start, s.c, s.n);

        // Closed-form oracle, including before-first and the empty order.
        expect(target).toBe(expectedTarget(s.direction, start, s.c, s.n));

        if (s.n === 0) {
          expect(target).toBe(NO_TARGET);
          return;
        }
        // Always a valid index into O' when O' is non-empty.
        expect(target).toBeGreaterThanOrEqual(0);
        expect(target).toBeLessThanOrEqual(s.n - 1);

        // Non-anchor starts map exactly as computeTargetIndex does.
        if (start.kind === "at") {
          expect(target).toBe(computeTargetIndex(s.direction, start.index, s.c, s.n));
        } else if (start.kind === "none") {
          expect(target).toBe(computeTargetIndex(s.direction, NO_TARGET, s.c, s.n));
        }
      }),
      { numRuns: 100 },
    );
  });

  // Feature: expanded-popup-focus-trap-fix, Property 4: Start position maps in-region focus to the trigger
  // **Validates: Requirements 2.4, 3.4**
  it("resolveNavigationTarget returns NO_TARGET on an empty order for every start kind", () => {
    fc.assert(
      fc.property(direction, anyStart, chunkSize, (dir, start, c) => {
        expect(resolveNavigationTarget(dir, start, c, 0)).toBe(NO_TARGET);
      }),
      { numRuns: 100 },
    );
  });
});
