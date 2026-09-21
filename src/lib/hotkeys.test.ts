/**
 * Property-based test for the hotkey conflict predicate (`hotkeysConflict`).
 *
 * Uses fast-check under Jest, per the design's Testing Strategy. See
 * design.md "Correctness Properties" Property 9 and tasks.md task 4.2.
 */
import fc from "fast-check";

import { hotkeysConflict } from "./hotkeys.js";

/**
 * Independent oracle for {@link hotkeysConflict}, derived from the acceptance
 * criteria (Requirement 4.8) rather than the implementation: two key
 * combinations conflict if and only if they denote the same set of tokens once
 * whitespace, casing, and ordering are ignored, and empty tokens (from stray
 * `+` separators) are dropped.
 *
 * Implemented deliberately differently from the production `normalizeHotkey`
 * (a `Set`-of-tokens comparison rather than a sorted `+`-joined string) so it
 * checks behavior, not the implementation's internal representation.
 */
function expectedConflict(forward: string, backward: string): boolean {
  const tokenSet = (combination: string): Set<string> => {
    const tokens = combination
      .split("+")
      .map((token) => token.trim().toLowerCase())
      .filter((token) => token.length > 0);
    return new Set(tokens);
  };

  const a = tokenSet(forward);
  const b = tokenSet(backward);

  if (a.size !== b.size) {
    return false;
  }
  for (const token of a) {
    if (!b.has(token)) {
      return false;
    }
  }
  return true;
}

describe("hotkeysConflict", () => {
  // Feature: tab-updown, Property 9: Hotkey conflict is detected exactly when the two combinations coincide
  // Validates: Requirements 4.8
  it("reports a conflict iff the two combinations normalize to the same token set", () => {
    // Realistic modifier/key tokens the Options_Page might submit. Kept small so
    // that generated combinations frequently coincide (exercising the conflict
    // branch) as well as differ (exercising the no-conflict branch).
    const token = fc.constantFrom(
      "Alt",
      "alt",
      "Shift",
      "shift",
      "Ctrl",
      "Control",
      "Down",
      "down",
      "Up",
      "PageUp",
      "PageDown",
      "F5",
      "A",
      "b",
    );

    // Build a combination string from tokens, inserting varied separators and
    // surrounding whitespace to exercise the normalizer's trimming, empty-token
    // dropping (stray `+`), and casing handling.
    const combination = fc
      .array(token, { minLength: 1, maxLength: 4 })
      .chain((tokens) =>
        fc.record({
          tokens: fc.constant(tokens),
          // Extra leading/trailing padding and duplicated separators.
          leftPad: fc.constantFrom("", " ", "  "),
          rightPad: fc.constantFrom("", " ", "  "),
          separator: fc.constantFrom("+", " + ", "++"),
        }),
      )
      .map(
        ({ tokens, leftPad, rightPad, separator }) =>
          `${leftPad}${tokens.join(separator)}${rightPad}`,
      );

    // Also allow arbitrary strings so the predicate is exercised on inputs well
    // outside the well-formed combination space.
    const anyCombination = fc.oneof(combination, fc.string());

    fc.assert(
      fc.property(anyCombination, anyCombination, (forward, backward) => {
        const result = hotkeysConflict(forward, backward);

        // Conflict is reported exactly when the normalized token sets coincide.
        expect(result).toBe(expectedConflict(forward, backward));

        // The predicate is symmetric: order of arguments does not matter.
        expect(hotkeysConflict(backward, forward)).toBe(result);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: tab-updown, Property 9: Hotkey conflict is detected exactly when the two combinations coincide
  // Validates: Requirements 4.8
  it("is reflexive: any combination conflicts with itself", () => {
    const combination = fc.array(
      fc.constantFrom("Alt", "Shift", "Ctrl", "Down", "Up", "A"),
      { minLength: 1, maxLength: 4 },
    ).map((tokens) => tokens.join("+"));

    fc.assert(
      fc.property(combination, (combo) => {
        expect(hotkeysConflict(combo, combo)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});
