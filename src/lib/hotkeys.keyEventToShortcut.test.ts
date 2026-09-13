/**
 * Property-based test for `keyEventToShortcut` (design.md Property 10).
 *
 * Uses fast-check under Jest, per the design's Testing Strategy. Generates
 * arbitrary KeyDescriptors `{ ctrl, alt, shift, meta, key, isMac }` spanning
 * arrow / space / comma / period / letter / digit / function / named / unmapped
 * keys, modifier-only presses, and both platforms, and asserts that a non-null
 * grammar-valid Shortcut_String is produced exactly for Valid_Combinations and
 * `null` otherwise — including the Mac Command / MacCtrl mapping.
 *
 * See design.md "Correctness Properties" Property 10 and tasks.md task 15.2.
 */
import fc from "fast-check";

import { keyEventToShortcut, type KeyDescriptor } from "./hotkeys.js";

/**
 * Independent oracle for the key → grammar-token mapping, derived from the
 * acceptance criteria / design "KeyboardEvent → token mapping" table rather
 * than from the production `keyToToken`. Returns the expected token or `null`
 * for an unmapped key.
 */
function expectedToken(key: string): string | null {
  const arrows: Record<string, string> = {
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
  };
  if (key in arrows) {
    return arrows[key];
  }
  if (key === " ") {
    return "Space";
  }
  if (key === ",") {
    return "Comma";
  }
  if (key === ".") {
    return "Period";
  }
  if (/^[a-zA-Z]$/.test(key)) {
    return key.toUpperCase();
  }
  if (/^[0-9]$/.test(key)) {
    return key;
  }
  if (/^F([1-9]|1[0-2])$/.test(key)) {
    return key;
  }
  if (["Home", "End", "PageUp", "PageDown", "Insert", "Delete"].includes(key)) {
    return key;
  }
  return null;
}

function isFunctionKeyToken(token: string): boolean {
  return /^F([1-9]|1[0-2])$/.test(token);
}

/**
 * Independent oracle for {@link keyEventToShortcut}, built directly from the
 * design's validation predicate and token-ordering rules. Deliberately written
 * separately from the production code so the test checks behavior, not the
 * implementation's structure.
 */
function expectedShortcut(descriptor: KeyDescriptor): string | null {
  const { ctrl, alt, shift, meta, key, isMac } = descriptor;

  const token = expectedToken(key);
  if (token === null) {
    return null;
  }

  const mainModifiers: string[] = [];
  if (isMac) {
    if (meta) {
      mainModifiers.push("Command");
    }
    if (ctrl) {
      mainModifiers.push("MacCtrl");
    }
  } else if (ctrl) {
    mainModifiers.push("Ctrl");
  }
  if (alt) {
    mainModifiers.push("Alt");
  }

  const hasMainModifier = mainModifiers.length > 0;
  if (!hasMainModifier && !isFunctionKeyToken(token)) {
    return null;
  }

  const tokens = [...mainModifiers];
  if (shift) {
    tokens.push("Shift");
  }
  tokens.push(token);
  return tokens.join("+");
}

// A grammar recognizer used only to double-check that any non-null result
// matches Firefox's shortcut grammar. Independent of the production regexes.
const MAIN_MODIFIERS = new Set(["Ctrl", "Alt", "Command", "MacCtrl"]);
const KEY_TOKENS = new Set([
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""),
  ..."0123456789".split(""),
  ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`),
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
]);

/**
 * True iff `str` is a grammar-valid Shortcut_String producible by the recorder:
 * a lone function key, or one or more distinct main modifiers followed by an
 * optional `Shift` secondary modifier and a key token. Shift, when present,
 * must be the last modifier.
 */
function isGrammarValid(str: string): boolean {
  const parts = str.split("+");
  const key = parts[parts.length - 1];
  const modifiers = parts.slice(0, -1);

  if (!KEY_TOKENS.has(key)) {
    return false;
  }

  // A lone function key is allowed with no modifiers.
  if (modifiers.length === 0) {
    return isFunctionKeyToken(key);
  }

  // Split into main modifiers followed by an optional trailing Shift.
  const mains =
    modifiers[modifiers.length - 1] === "Shift"
      ? modifiers.slice(0, -1)
      : modifiers;

  // A main modifier is required alongside a non-function key. A function key may
  // stand alone, so it can carry just Shift with no main modifier.
  if (mains.length === 0) {
    return isFunctionKeyToken(key);
  }

  // Every leading modifier is a distinct main modifier, and none is Shift.
  const seen = new Set<string>();
  for (const modifier of mains) {
    if (!MAIN_MODIFIERS.has(modifier) || seen.has(modifier)) {
      return false;
    }
    seen.add(modifier);
  }
  return true;
}

describe("keyEventToShortcut", () => {
  // A key generator spanning every mapped category plus unmapped keys and
  // modifier names (which arrive as `event.key` for a modifier-only press).
  const keyArb = fc.oneof(
    fc.constantFrom("ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"),
    fc.constantFrom(" ", ",", "."),
    fc.constantFrom("a", "z", "A", "Q", "m"),
    fc.constantFrom("0", "5", "9"),
    fc.constantFrom("F1", "F5", "F9", "F12"),
    fc.constantFrom("Home", "End", "PageUp", "PageDown", "Insert", "Delete"),
    // Unmapped / out-of-range keys, including modifier-only presses.
    fc.constantFrom("Tab", "Escape", "Enter", "F13", "F0", "!", "€", "ArrowThere"),
    fc.constantFrom("Control", "Alt", "Shift", "Meta"),
  );

  const descriptorArb: fc.Arbitrary<KeyDescriptor> = fc.record({
    ctrl: fc.boolean(),
    alt: fc.boolean(),
    shift: fc.boolean(),
    meta: fc.boolean(),
    key: keyArb,
    isMac: fc.boolean(),
  });

  // Feature: tab-updown, Property 10: keyEventToShortcut maps valid combinations to grammar-valid strings and everything else to null
  // Validates: Requirements 8.1, 8.2, 8.3, 8.4
  it("returns a grammar-valid string exactly for Valid_Combinations and null otherwise", () => {
    fc.assert(
      fc.property(descriptorArb, (descriptor) => {
        const result = keyEventToShortcut(descriptor);
        const expected = expectedShortcut(descriptor);

        // Matches the independent oracle exactly (covers null vs non-null, the
        // Valid_Combination predicate, token mapping, ordering, and the Mac
        // Command / MacCtrl mapping — Requirements 8.1, 8.2, 8.3, 8.4).
        expect(result).toBe(expected);

        // Whenever non-null, the string conforms to Firefox's grammar.
        if (result !== null) {
          expect(isGrammarValid(result)).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });

  // Feature: tab-updown, Property 10: keyEventToShortcut maps valid combinations to grammar-valid strings and everything else to null
  // Validates: Requirements 8.4
  it("maps the Mac Command key to Command and the Mac Control key to MacCtrl", () => {
    // On Mac, a held metaKey must surface as `Command` and a held ctrlKey as
    // `MacCtrl`; on non-Mac, ctrlKey surfaces as `Ctrl` and metaKey never maps.
    const mappedKey = fc.oneof(
      fc.constantFrom("ArrowUp", "ArrowDown", " ", ",", "."),
      fc.constantFrom("a", "Z", "5", "Home", "End"),
    );

    fc.assert(
      fc.property(mappedKey, fc.boolean(), fc.boolean(), (key, meta, ctrl) => {
        // At least one main modifier so the mapped (non-function) key is valid.
        const withMeta = meta || !ctrl;
        const macResult = keyEventToShortcut({
          ctrl,
          alt: false,
          shift: false,
          meta: withMeta,
          key,
          isMac: true,
        });

        expect(macResult).not.toBeNull();
        const macTokens = (macResult as string).split("+");
        expect(macTokens.includes("Ctrl")).toBe(false);
        if (withMeta) {
          expect(macTokens).toContain("Command");
        }
        if (ctrl) {
          expect(macTokens).toContain("MacCtrl");
        }

        // Same physical keys on non-Mac: ctrl → Ctrl, meta ignored.
        const pcResult = keyEventToShortcut({
          ctrl: true,
          alt: false,
          shift: false,
          meta: true,
          key,
          isMac: false,
        });
        const pcTokens = (pcResult as string).split("+");
        expect(pcTokens).toContain("Ctrl");
        expect(pcTokens.includes("Command")).toBe(false);
        expect(pcTokens.includes("MacCtrl")).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});
