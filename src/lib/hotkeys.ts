/**
 * Hotkey conflict detection for the Tab-Updown extension.
 *
 * DOM-free pure logic. Used by the Options_Page to reject a submission in which
 * the Forward_Hotkey and Backward_Hotkey resolve to the same key combination
 * (Requirement 4.8). See design.md "Correctness Properties" Property 9:
 * "the conflict predicate reports a conflict if and only if their normalized
 * forms are equal".
 */

/**
 * Normalize a key-combination string into a canonical form so that combinations
 * that differ only in token whitespace, casing, or modifier ordering compare
 * equal.
 *
 * The normalization:
 * - trims surrounding whitespace,
 * - splits on `+` into tokens and trims each token,
 * - lower-cases each token so casing is ignored (e.g. `"alt"` vs `"Alt"`),
 * - drops empty tokens (tolerating stray/duplicated `+` separators),
 * - removes duplicate tokens so a combination denotes a *set* of tokens (e.g.
 *   `"A+A"` normalizes the same as `"A"`),
 * - sorts the tokens so that modifier/key ordering is irrelevant (e.g.
 *   `"Alt+Shift+Down"` and `"Shift+Alt+Down"` normalize identically).
 *
 * The result is a `+`-joined string of the sorted, de-duplicated, lower-cased
 * tokens.
 */
export function normalizeHotkey(combination: string): string {
  const tokens = combination
    .trim()
    .split("+")
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 0);

  // De-duplicate so the combination is compared as a set of tokens (matching
  // Property 9: conflict iff the two token sets coincide).
  return [...new Set(tokens)].sort().join("+");
}

/**
 * Report whether two key-combination strings conflict (Requirement 4.8).
 *
 * Returns `true` if and only if the two combinations share the same normalized
 * form — i.e. they represent the same set of modifier/key tokens regardless of
 * ordering, casing, or surrounding whitespace. When this returns `true` the
 * Options_Page rejects the submission and updates neither command; when it
 * returns `false` the submission proceeds.
 */
export function hotkeysConflict(forward: string, backward: string): boolean {
  return normalizeHotkey(forward) === normalizeHotkey(backward);
}

/**
 * A plain, DOM-free description of a pressed key combination, built by the
 * Options_Page's `keydown` listener from a `KeyboardEvent`. Keeping the shape
 * plain lets {@link keyEventToShortcut} be property-tested without a DOM.
 *
 * See design.md "Hotkey_Recorder" (the `KeyDescriptor` definition).
 */
export interface KeyDescriptor {
  /** `event.ctrlKey` — the physical Control key. */
  ctrl: boolean;
  /** `event.altKey`. */
  alt: boolean;
  /** `event.shiftKey`. */
  shift: boolean;
  /** `event.metaKey` — the Command key on Mac. */
  meta: boolean;
  /** `event.key` — the non-modifier key that was pressed. */
  key: string;
  /** Platform flag: `true` on macOS (from `navigator.platform`/UA data). */
  isMac: boolean;
}

/**
 * Map a `KeyDescriptor.key` to its Firefox `commands` grammar token, or `null`
 * when the key has no grammar token (an unmapped key).
 *
 * Per design.md "KeyboardEvent → token mapping":
 * - `ArrowUp/Down/Left/Right` → `Up/Down/Left/Right`
 * - `" "` → `Space`, `","` → `Comma`, `"."` → `Period`
 * - a letter `a`–`z` → its uppercase `A`–`Z`
 * - a digit `0`–`9` → the digit unchanged
 * - `F1`–`F12` → the same token
 * - `Home`, `End`, `PageUp`, `PageDown`, `Insert`, `Delete` → the same token
 * - anything else → `null`
 */
function keyToToken(key: string): string | null {
  switch (key) {
    case "ArrowUp":
      return "Up";
    case "ArrowDown":
      return "Down";
    case "ArrowLeft":
      return "Left";
    case "ArrowRight":
      return "Right";
    case " ":
      return "Space";
    case ",":
      return "Comma";
    case ".":
      return "Period";
    default:
      break;
  }

  // A single letter — emit its uppercase form.
  if (/^[a-zA-Z]$/.test(key)) {
    return key.toUpperCase();
  }

  // A single digit — emit it as-is.
  if (/^[0-9]$/.test(key)) {
    return key;
  }

  // A function key F1–F12 — emit it as-is.
  if (/^F([1-9]|1[0-2])$/.test(key)) {
    return key;
  }

  // Named keys that carry through unchanged.
  switch (key) {
    case "Home":
    case "End":
    case "PageUp":
    case "PageDown":
    case "Insert":
    case "Delete":
      return key;
    default:
      return null;
  }
}

/** Whether a grammar token names a function key `F1`–`F12`. */
function isFunctionKeyToken(token: string): boolean {
  return /^F([1-9]|1[0-2])$/.test(token);
}

/**
 * Translate a {@link KeyDescriptor} into a grammar-valid Shortcut_String, or
 * return `null` when the descriptor is not a Valid_Combination (Requirement
 * 8.1, 8.2, 8.4).
 *
 * The key is mapped to a grammar token via {@link keyToToken}; unmapped keys
 * yield `null`. Modifiers are mapped per design.md "KeyboardEvent → token
 * mapping":
 * - `alt` → `Alt`, `shift` → `Shift`;
 * - on non-Mac, `ctrl` → `Ctrl`;
 * - on Mac, `meta` → `Command` (Firefox's `Ctrl`/main modifier) and `ctrl` →
 *   `MacCtrl` (the physical Control key).
 *
 * Tokens are ordered main modifier → secondary modifier → key. `Shift` acts as
 * the secondary modifier; the remaining modifier tokens are main modifiers.
 *
 * A descriptor is a Valid_Combination — and this returns a string — only when
 * the key maps to a token **and** either at least one main modifier is held or
 * the token is a function key `F1`–`F12` (which may stand alone). A
 * modifier-only press, an unmapped key, or a non-function key with no main
 * modifier yields `null`.
 */
export function keyEventToShortcut(descriptor: KeyDescriptor): string | null {
  const { ctrl, alt, shift, meta, key, isMac } = descriptor;

  const keyToken = keyToToken(key);
  if (keyToken === null) {
    return null;
  }

  // Collect the main modifiers (everything except Shift) in grammar order.
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

  // Valid_Combination requires a main modifier unless the key is a function key.
  if (!hasMainModifier && !isFunctionKeyToken(keyToken)) {
    return null;
  }

  // Order: main modifier(s) → secondary modifier (Shift) → key.
  const tokens = [...mainModifiers];
  if (shift) {
    tokens.push("Shift");
  }
  tokens.push(keyToken);

  return tokens.join("+");
}

/**
 * The main modifier tokens of Firefox's `commands` shortcut grammar. A
 * grammar-valid Shortcut_String must lead with exactly one of these (unless it
 * is a lone function key). See requirements.md "Shortcut_String" glossary and
 * design.md "KeyboardEvent → token mapping".
 */
const MAIN_MODIFIERS = new Set(["Ctrl", "Alt", "Command", "MacCtrl"]);

/**
 * The secondary modifier tokens Firefox permits after the main modifier. Per
 * the grammar the secondary modifier may be any modifier token — including
 * another main-modifier token — provided it differs from the chosen main
 * modifier; `Shift` is the modifier the Hotkey_Recorder itself emits.
 */
const SECONDARY_MODIFIERS = new Set([
  "Shift",
  "Ctrl",
  "Alt",
  "Command",
  "MacCtrl",
]);

/** Whether a token is a grammar-valid key (the final, non-modifier token). */
function isKeyToken(token: string): boolean {
  // A single letter A–Z.
  if (/^[A-Z]$/.test(token)) {
    return true;
  }
  // A single digit 0–9.
  if (/^[0-9]$/.test(token)) {
    return true;
  }
  // A function key F1–F12.
  if (isFunctionKeyToken(token)) {
    return true;
  }
  // Named keys that carry a dedicated grammar token.
  switch (token) {
    case "Comma":
    case "Period":
    case "Home":
    case "End":
    case "PageUp":
    case "PageDown":
    case "Space":
    case "Insert":
    case "Delete":
    case "Up":
    case "Down":
    case "Left":
    case "Right":
      return true;
    default:
      return false;
  }
}

/**
 * Report whether `str` is a Shortcut_String matching Firefox's `commands`
 * shortcut grammar (Requirement 8.8). Used to validate a hotkey the user types
 * into a field as an alternative to recording (design.md "Accessible
 * manual-typing fallback").
 *
 * A string matches when it is either:
 * - a main modifier (`Ctrl`, `Alt`, `Command`, or `MacCtrl`), then an optional
 *   secondary modifier that differs from that main modifier, then a key drawn
 *   from `A`–`Z`, `0`–`9`, `F1`–`F12`, or the named keys (`Comma`, `Period`,
 *   `Home`, `End`, `PageUp`, `PageDown`, `Space`, `Insert`, `Delete`, `Up`,
 *   `Down`, `Left`, `Right`); or
 * - a lone function key `F1`–`F12` (which may stand alone without a modifier).
 *
 * Tokens are separated by single `+` characters with no surrounding
 * whitespace, matching the strings {@link keyEventToShortcut} produces.
 * Modifier-only strings, a missing main modifier, a duplicated
 * main/secondary modifier, and unmapped keys are all rejected.
 */
export function isValidShortcut(str: string): boolean {
  const tokens = str.split("+");

  // A lone function key F1–F12 is valid on its own.
  if (tokens.length === 1) {
    return isFunctionKeyToken(tokens[0]);
  }

  // Otherwise the grammar is: main modifier + optional secondary modifier + key.
  if (tokens.length < 2 || tokens.length > 3) {
    return false;
  }

  const [mainModifier, ...rest] = tokens;
  if (!MAIN_MODIFIERS.has(mainModifier)) {
    return false;
  }

  // The final token is always the key.
  const keyToken = rest[rest.length - 1];
  if (!isKeyToken(keyToken)) {
    return false;
  }

  // With three tokens the middle one is the secondary modifier: it must be a
  // modifier token and must differ from the main modifier.
  if (rest.length === 2) {
    const secondaryModifier = rest[0];
    if (!SECONDARY_MODIFIERS.has(secondaryModifier)) {
      return false;
    }
    if (secondaryModifier === mainModifier) {
      return false;
    }
  }

  return true;
}
