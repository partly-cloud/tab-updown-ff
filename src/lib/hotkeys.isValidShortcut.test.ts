/**
 * Property-based test for `isValidShortcut` (design.md Property 11).
 *
 * Uses fast-check under Jest, per the design's Testing Strategy. Generates both
 * grammar-conforming and deliberately malformed Shortcut_Strings and asserts
 * that acceptance matches Firefox's `commands` shortcut grammar exactly —
 * rejecting modifier-only strings, a missing main modifier, a duplicated
 * main/secondary modifier, and unmapped keys.
 *
 * See design.md "Correctness Properties" Property 11 and tasks.md task 15.4.
 */
import fc from "fast-check";

import { isValidShortcut } from "./hotkeys.js";

// The grammar's token vocabulary, spelled out here rather than imported from
// the production module so the oracle checks behavior, not the implementation's
// internal representation.
const MAIN_MODIFIERS = ["Ctrl", "Alt", "Command", "MacCtrl"];
const SECONDARY_MODIFIERS = ["Shift", "Ctrl", "Alt", "Command", "MacCtrl"];
const FUNCTION_KEYS = Array.from({ length: 12 }, (_, i) => `F${i + 1}`);
const KEY_TOKENS = [
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""),
  ..."0123456789".split(""),
  ...FUNCTION_KEYS,
  "Comma",
  "Period",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Space",
  "Insert",
  "Delete",
  "Up",
  "Down",
  "Left",
  "Right",
];

const MAIN_MODIFIER_SET = new Set(MAIN_MODIFIERS);
const SECONDARY_MODIFIER_SET = new Set(SECONDARY_MODIFIERS);
const FUNCTION_KEY_SET = new Set(FUNCTION_KEYS);
const KEY_TOKEN_SET = new Set(KEY_TOKENS);

/**
 * Independent oracle for {@link isValidShortcut}, derived directly from the
 * design's Property 11 grammar rather than from the production implementation:
 *
 * - a lone function key `F1`–`F12`, or
 * - a main modifier (Ctrl/Alt/Command/MacCtrl), then an optional secondary
 *   modifier that differs from that main modifier, then a key token; tokens
 *   separated by single `+` with no surrounding whitespace.
 *
 * Every other string is rejected.
 */
function expectedValid(str: string): boolean {
  const tokens = str.split("+");

  if (tokens.length === 1) {
    return FUNCTION_KEY_SET.has(tokens[0]);
  }

  if (tokens.length !== 2 && tokens.length !== 3) {
    return false;
  }

  const main = tokens[0];
  if (!MAIN_MODIFIER_SET.has(main)) {
    return false;
  }

  const key = tokens[tokens.length - 1];
  if (!KEY_TOKEN_SET.has(key)) {
    return false;
  }

  if (tokens.length === 3) {
    const secondary = tokens[1];
    if (!SECONDARY_MODIFIER_SET.has(secondary)) {
      return false;
    }
    if (secondary === main) {
      return false;
    }
  }

  return true;
}

describe("isValidShortcut", () => {
  const mainModifierArb = fc.constantFrom(...MAIN_MODIFIERS);
  const secondaryModifierArb = fc.constantFrom(...SECONDARY_MODIFIERS);
  const keyTokenArb = fc.constantFrom(...KEY_TOKENS);
  const functionKeyArb = fc.constantFrom(...FUNCTION_KEYS);

  // Well-formed strings: main modifier + optional secondary + key, or a lone
  // function key. These exercise the accepting branch of the grammar.
  const conformingArb = fc.oneof(
    // main + key
    fc.tuple(mainModifierArb, keyTokenArb).map(([m, k]) => `${m}+${k}`),
    // main + secondary + key (secondary may equal main here; the oracle and the
    // implementation must agree on rejecting the duplicate case)
    fc
      .tuple(mainModifierArb, secondaryModifierArb, keyTokenArb)
      .map(([m, s, k]) => `${m}+${s}+${k}`),
    // lone function key
    functionKeyArb,
  );

  // Malformed strings targeting each rejection reason called out by the task:
  // modifier-only, missing main modifier, duplicate main/secondary, unmapped
  // key, extra tokens, and stray whitespace.
  const malformedArb = fc.oneof(
    // Modifier-only (no key): a single modifier, or two modifiers with no key.
    secondaryModifierArb,
    fc.tuple(mainModifierArb, secondaryModifierArb).map(([m, s]) => `${m}+${s}`),
    // Missing main modifier: leads with a secondary/non-main token.
    fc
      .tuple(fc.constantFrom("Shift"), keyTokenArb)
      .map(([s, k]) => `${s}+${k}`),
    // Duplicate main/secondary modifier.
    fc.tuple(mainModifierArb, keyTokenArb).map(([m, k]) => `${m}+${m}+${k}`),
    // Unmapped key token (not in the grammar vocabulary).
    fc
      .tuple(
        mainModifierArb,
        fc.constantFrom("Tab", "Escape", "Enter", "F13", "F0", "AB", "up", ""),
      )
      .map(([m, k]) => `${m}+${k}`),
    // Too many tokens.
    fc
      .tuple(mainModifierArb, secondaryModifierArb, secondaryModifierArb, keyTokenArb)
      .map(([m, s1, s2, k]) => `${m}+${s1}+${s2}+${k}`),
    // Lone non-function key (missing modifier).
    keyTokenArb.filter((k) => !FUNCTION_KEY_SET.has(k)),
    // Stray whitespace around otherwise-valid tokens.
    fc.tuple(mainModifierArb, keyTokenArb).map(([m, k]) => `${m} + ${k}`),
  );

  // A generator that also emits fully arbitrary strings so the predicate is
  // exercised well outside any structured token space.
  const anyShortcut = fc.oneof(
    { weight: 4, arbitrary: conformingArb },
    { weight: 4, arbitrary: malformedArb },
    { weight: 1, arbitrary: fc.string() },
  );

  // Feature: tab-updown, Property 11: isValidShortcut accepts exactly the strings matching the Firefox grammar
  // Validates: Requirements 8.8
  it("accepts exactly the strings matching the Firefox commands grammar", () => {
    fc.assert(
      fc.property(anyShortcut, (str) => {
        expect(isValidShortcut(str)).toBe(expectedValid(str));
      }),
      { numRuns: 200 },
    );
  });

  // Feature: tab-updown, Property 11: isValidShortcut accepts exactly the strings matching the Firefox grammar
  // Validates: Requirements 8.8
  it("rejects modifier-only, missing-main, duplicate-modifier, and unmapped-key strings", () => {
    fc.assert(
      fc.property(malformedArb, (str) => {
        // Every malformed generator above produces a string outside the grammar.
        expect(isValidShortcut(str)).toBe(false);
        // And the oracle agrees it is invalid.
        expect(expectedValid(str)).toBe(false);
      }),
      { numRuns: 200 },
    );
  });
});
