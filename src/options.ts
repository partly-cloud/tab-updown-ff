/**
 * Options_Page logic for the Tab-Updown extension.
 *
 * Loads, validates, and saves the Chunk_Size and the two hotkeys, wiring the
 * pure logic in `src/lib/` to the `storage` and `commands` WebExtension APIs and
 * to the markup authored in `options.html` (see design.md "Options_Page"). The
 * markup exposes stable IDs — `#chunk-size`, `#forward-hotkey`, `#backward-hotkey`,
 * `#save-button`, `#status` — and a status region styled by the `.status--success`
 * / `.status--error` classes.
 *
 * Design decision (design.md "Options_Page"): the Chunk_Size is persisted in the
 * Settings_Store (`storage.local`), but the hotkeys are persisted by Firefox
 * itself via the `commands` API — updated with `commands.update()` and read back
 * with `commands.getAll()`. So only `chunkSize` is written to `storage.local`.
 *
 * Implements tasks 10.2 (load/display), 10.3 (Chunk_Size save), and 10.4 (hotkey
 * save) — Requirements 3.2, 3.5, 4.3, 4.4, 4.7, 4.8, 6.1, 6.2, 6.3, 4.5, 4.6,
 * 7.3, 7.4.
 */

import {
  BACKWARD_COMMAND_NAME,
  DEFAULT_BACKWARD_HOTKEY,
  DEFAULT_CHUNK_SIZE,
  DEFAULT_FORWARD_HOTKEY,
  FORWARD_COMMAND_NAME,
} from "./lib/constants";
import { hotkeysConflict, isValidShortcut, keyEventToShortcut } from "./lib/hotkeys";
import type { KeyDescriptor } from "./lib/hotkeys";
import { validateChunkSize } from "./lib/settings";

/** Storage key under which the Chunk_Size is persisted in `storage.local`. */
const CHUNK_SIZE_KEY = "chunkSize";

/** Kind of status message shown in the `#status` region. */
type StatusKind = "success" | "error";

/**
 * References to the interactive controls and status region on the options page.
 * Gathered once and threaded through the load/save functions so they remain
 * testable in isolation against a jsdom fixture (task 10.5).
 */
export interface OptionsElements {
  chunkSize: HTMLInputElement;
  forwardHotkey: HTMLInputElement;
  backwardHotkey: HTMLInputElement;
  forwardHotkeyReset: HTMLButtonElement;
  backwardHotkeyReset: HTMLButtonElement;
  saveButton: HTMLButtonElement;
  status: HTMLElement;
}

/**
 * Resolve the options-page controls from a document. Throws if a required
 * element is missing so wiring problems surface immediately rather than as a
 * silent no-op.
 */
export function getOptionsElements(doc: Document = document): OptionsElements {
  const chunkSize = doc.getElementById("chunk-size");
  const forwardHotkey = doc.getElementById("forward-hotkey");
  const backwardHotkey = doc.getElementById("backward-hotkey");
  const forwardHotkeyReset = doc.getElementById("forward-hotkey-reset");
  const backwardHotkeyReset = doc.getElementById("backward-hotkey-reset");
  const saveButton = doc.getElementById("save-button");
  const status = doc.getElementById("status");

  if (
    !(chunkSize instanceof HTMLInputElement) ||
    !(forwardHotkey instanceof HTMLInputElement) ||
    !(backwardHotkey instanceof HTMLInputElement) ||
    !(forwardHotkeyReset instanceof HTMLButtonElement) ||
    !(backwardHotkeyReset instanceof HTMLButtonElement) ||
    !(saveButton instanceof HTMLButtonElement) ||
    status === null
  ) {
    throw new Error("Options page is missing one or more required controls.");
  }

  return {
    chunkSize,
    forwardHotkey,
    backwardHotkey,
    forwardHotkeyReset,
    backwardHotkeyReset,
    saveButton,
    status,
  };
}

/**
 * Show a status message in the `#status` region (Requirements 3.2, 3.5, 4.7,
 * 4.8, 7.4). Applies the `.status--success` / `.status--error` modifier class so
 * the message is styled per its kind, replacing any previously applied modifier.
 */
export function showStatus(
  status: HTMLElement,
  kind: StatusKind,
  message: string,
): void {
  status.textContent = message;
  status.classList.remove("status--success", "status--error");
  status.classList.add(kind === "success" ? "status--success" : "status--error");
}

/**
 * Read the persisted Chunk_Size from `storage.local`. Returns the raw stored
 * value, which may be absent.
 */
async function readStoredChunkSize(): Promise<unknown> {
  const result = await browser.storage.local.get(CHUNK_SIZE_KEY);
  return result[CHUNK_SIZE_KEY];
}

/**
 * Read the active shortcut for a command from `commands.getAll()`, or
 * `undefined` when the command is absent or carries no shortcut.
 */
function shortcutForCommand(
  commands: Array<{ name?: string; shortcut?: string }>,
  name: string,
): string | undefined {
  const command = commands.find((entry) => entry.name === name);
  const shortcut = command?.shortcut;
  // Firefox reports an unassigned shortcut as an empty string; treat that as
  // "no configured value" so the default is displayed (Requirement 4.5, 4.6).
  return shortcut !== undefined && shortcut.length > 0 ? shortcut : undefined;
}

/**
 * Load the persisted settings and display them (task 10.2, Requirements 6.2,
 * 6.3, 4.5, 4.6).
 *
 * Reads `chunkSize` from `storage.local` — displaying `DEFAULT_CHUNK_SIZE` when
 * absent — and reads the two hotkeys via `commands.getAll()`, displaying the
 * corresponding default when a command's shortcut is absent.
 */
export async function loadSettings(elements: OptionsElements): Promise<void> {
  const storedChunkSize = await readStoredChunkSize();
  const chunkSizeToDisplay =
    typeof storedChunkSize === "number" ? storedChunkSize : DEFAULT_CHUNK_SIZE;
  elements.chunkSize.value = String(chunkSizeToDisplay);

  const commands = await browser.commands.getAll();
  const forward =
    shortcutForCommand(commands, FORWARD_COMMAND_NAME) ?? DEFAULT_FORWARD_HOTKEY;
  const backward =
    shortcutForCommand(commands, BACKWARD_COMMAND_NAME) ??
    DEFAULT_BACKWARD_HOTKEY;
  elements.forwardHotkey.value = forward;
  elements.backwardHotkey.value = backward;
}

/**
 * Validate and save the Chunk_Size (task 10.3, Requirements 3.2, 3.5, 6.1, 7.3,
 * 7.4).
 *
 * - On validation failure: show a validation message identifying the invalid
 *   value and retain the stored value (no write, no field mutation).
 * - On success: `storage.local.set` the parsed value and show a save
 *   confirmation.
 * - On a `storage.local.set` rejection: retain the previous value and show a
 *   storage-error message.
 *
 * Returns `true` when the value was persisted, `false` otherwise, so the caller
 * can decide whether the overall save succeeded.
 */
export async function saveChunkSize(elements: OptionsElements): Promise<boolean> {
  const raw = elements.chunkSize.value;
  const result = validateChunkSize(raw);

  if (!result.ok) {
    // Reject; retain the previously stored value; identify the invalid value
    // (Requirement 3.5).
    showStatus(
      elements.status,
      "error",
      `"${String(result.invalidValue)}" is not a valid chunk size. Enter a whole number from 1 to 100.`,
    );
    return false;
  }

  try {
    await browser.storage.local.set({ [CHUNK_SIZE_KEY]: result.value });
    // Normalize the displayed value to the parsed integer (e.g. trims " 5 ").
    elements.chunkSize.value = String(result.value);
    showStatus(
      elements.status,
      "success",
      `Chunk size saved as ${result.value}.`,
    );
    return true;
  } catch {
    // Write failed: retain the previously persisted value and report the error
    // (Requirement 7.4).
    showStatus(
      elements.status,
      "error",
      "Could not save the chunk size. Your previous setting was kept.",
    );
    return false;
  }
}

/**
 * Validate and apply the two hotkeys (task 10.4, Requirements 4.3, 4.4, 4.7,
 * 4.8).
 *
 * - When the two combinations coincide (via the conflict predicate): reject with
 *   a conflict message and do not call `commands.update()` (Requirement 4.8).
 * - When either typed value does not match Firefox's `commands` shortcut grammar
 *   (via `isValidShortcut`): revert the displayed value(s) to the previously
 *   active shortcut(s), show a validation message, and do not call
 *   `commands.update()` (Requirements 8.7, 8.8). The fields remain ordinary text
 *   inputs, so a user may type a Shortcut_String directly instead of recording
 *   one; this guard is the manual-typing fallback's acceptance check.
 * - Otherwise: call `commands.update()` for each command (Requirements 4.3,
 *   4.4).
 * - On a rejected `commands.update()` (Firefox rejects an invalid combination):
 *   revert the displayed value(s) to the previously active shortcut(s) and show
 *   a validation message (Requirement 4.7).
 *
 * The previously active shortcuts are re-read from `commands.getAll()` so the
 * revert restores exactly what Firefox currently has, falling back to the
 * defaults when a command has no configured shortcut.
 *
 * Returns `true` when both commands were updated, `false` otherwise.
 */
export async function saveHotkeys(elements: OptionsElements): Promise<boolean> {
  const forward = elements.forwardHotkey.value;
  const backward = elements.backwardHotkey.value;

  // Reject identical combinations without touching the commands (Requirement
  // 4.8).
  if (hotkeysConflict(forward, backward)) {
    showStatus(
      elements.status,
      "error",
      "The forward and backward hotkeys must be different.",
    );
    return false;
  }

  // Reject a typed value that does not match Firefox's shortcut grammar without
  // touching the commands: revert the displayed values to the previously active
  // shortcuts and report the error (Requirements 8.7, 8.8). This is the
  // acceptance check for the manual-typing fallback and reuses the same revert
  // path as a rejected `commands.update()` (Requirement 4.7).
  if (!isValidShortcut(forward) || !isValidShortcut(backward)) {
    await revertHotkeyDisplay(elements);
    showStatus(
      elements.status,
      "error",
      "That hotkey is not valid. Your previous hotkeys were kept.",
    );
    return false;
  }

  try {
    await browser.commands.update({
      name: FORWARD_COMMAND_NAME,
      shortcut: forward,
    });
    await browser.commands.update({
      name: BACKWARD_COMMAND_NAME,
      shortcut: backward,
    });
    return true;
  } catch {
    // Firefox rejected an invalid combination: revert the displayed values to
    // the previously active shortcuts and report the error (Requirement 4.7).
    await revertHotkeyDisplay(elements);
    showStatus(
      elements.status,
      "error",
      "That hotkey is not valid. Your previous hotkeys were kept.",
    );
    return false;
  }
}

/**
 * Revert the displayed hotkey values to the previously active shortcuts
 * (Requirement 4.7). Reads the current shortcuts from `commands.getAll()`,
 * falling back to the defaults when a command has no configured shortcut.
 */
async function revertHotkeyDisplay(elements: OptionsElements): Promise<void> {
  const commands = await browser.commands.getAll();
  elements.forwardHotkey.value =
    shortcutForCommand(commands, FORWARD_COMMAND_NAME) ?? DEFAULT_FORWARD_HOTKEY;
  elements.backwardHotkey.value =
    shortcutForCommand(commands, BACKWARD_COMMAND_NAME) ??
    DEFAULT_BACKWARD_HOTKEY;
}

/**
 * Handle a save action: apply the hotkeys and the Chunk_Size, then show a
 * combined confirmation when both succeeded.
 *
 * The individual save functions surface their own validation/conflict/error
 * messages; this wrapper only overrides with a success confirmation when the
 * whole save went through, so a partial failure leaves the most relevant error
 * on screen.
 */
export async function handleSave(elements: OptionsElements): Promise<void> {
  const hotkeysSaved = await saveHotkeys(elements);
  const chunkSaved = await saveChunkSize(elements);

  if (hotkeysSaved && chunkSaved) {
    showStatus(elements.status, "success", "Settings saved.");
  }
}

/**
 * `event.key` values that name a modifier key rather than a real key. A
 * `keydown` for one of these is ignored by the recorder so that holding
 * modifiers before the final key produces no output (Requirement 8.3).
 */
const MODIFIER_KEY_NAMES = new Set(["Shift", "Control", "Alt", "Meta"]);

/**
 * Detect whether the current platform is macOS, so the recorder can emit the
 * Mac-specific `Command` / `MacCtrl` modifier tokens (Requirement 8.4).
 *
 * Prefers the modern `navigator.userAgentData.platform`, falling back to the
 * legacy `navigator.platform`. Guarded so it is safe in a non-browser context.
 */
export function detectIsMac(nav: Navigator = navigator): boolean {
  const uaPlatform = (
    nav as Navigator & { userAgentData?: { platform?: string } }
  ).userAgentData?.platform;
  const platform = uaPlatform ?? nav.platform ?? "";
  return /mac/i.test(platform);
}

/**
 * Handle a `keydown` on a hotkey field: record the pressed combination as a
 * Shortcut_String (task 16.2, Requirements 8.1, 8.2, 8.3, 8.4).
 *
 * - Ignores pure-modifier keydowns (`event.key` is Shift/Control/Alt/Meta) so
 *   the recorder waits for a real key (Requirement 8.3).
 * - Otherwise builds a {@link KeyDescriptor} — with the `isMac` platform flag —
 *   from the event, calls `keyEventToShortcut`, and `preventDefault()`s so the
 *   keypress does not otherwise act on the field.
 * - On a non-null result writes the Shortcut_String into the field (Requirement
 *   8.1). On `null` shows a validation message and keeps the field's previous
 *   value (Requirement 8.3).
 */
export function onHotkeyKeydown(
  event: KeyboardEvent,
  field: HTMLInputElement,
  status: HTMLElement,
  isMac: boolean,
): void {
  // Wait for a real (non-modifier) key (Requirement 8.3).
  if (MODIFIER_KEY_NAMES.has(event.key)) {
    return;
  }

  const descriptor: KeyDescriptor = {
    ctrl: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
    meta: event.metaKey,
    key: event.key,
    isMac,
  };

  const shortcut = keyEventToShortcut(descriptor);
  event.preventDefault();

  if (shortcut === null) {
    // Modifier-only or unmapped press: keep the field's previous value and
    // report it (Requirement 8.3).
    showStatus(
      status,
      "error",
      "That key combination can't be used as a hotkey. Try one with Ctrl, Alt, or Command, or a function key.",
    );
    return;
  }

  field.value = shortcut;
}

/**
 * Attach the recording `keydown` listener to both hotkey fields (task 16.2).
 */
export function wireHotkeyRecording(
  elements: OptionsElements,
  isMac: boolean = detectIsMac(),
): void {
  for (const field of [elements.forwardHotkey, elements.backwardHotkey]) {
    field.addEventListener("keydown", (event) => {
      onHotkeyKeydown(event, field, elements.status, isMac);
    });
  }
}

/**
 * Handle a reset activation for one hotkey field (task 16.3, Requirements 8.5,
 * 8.6).
 *
 * Calls `commands.reset(commandName)` to restore the command to its manifest
 * default, then re-reads `commands.getAll()` and displays the restored
 * Shortcut_String in the field — falling back to `defaultShortcut` when the
 * command reports no configured shortcut (Firefox reports an unassigned
 * shortcut as an empty string, which `shortcutForCommand` treats as absent).
 */
export async function onResetClick(
  field: HTMLInputElement,
  commandName: string,
  defaultShortcut: string,
): Promise<void> {
  await browser.commands.reset(commandName);
  const commands = await browser.commands.getAll();
  field.value = shortcutForCommand(commands, commandName) ?? defaultShortcut;
}

/**
 * Attach the reset `click` listener to both hotkey reset controls (task 16.3).
 */
export function wireHotkeyReset(elements: OptionsElements): void {
  elements.forwardHotkeyReset.addEventListener("click", () => {
    void onResetClick(
      elements.forwardHotkey,
      FORWARD_COMMAND_NAME,
      DEFAULT_FORWARD_HOTKEY,
    );
  });
  elements.backwardHotkeyReset.addEventListener("click", () => {
    void onResetClick(
      elements.backwardHotkey,
      BACKWARD_COMMAND_NAME,
      DEFAULT_BACKWARD_HOTKEY,
    );
  });
}

/**
 * Wire the options page: load the persisted settings on `DOMContentLoaded`,
 * attach hotkey recording to the hotkey fields, wire the reset controls, and run
 * a save when the save button is clicked.
 */
export function initOptionsPage(doc: Document = document): void {
  const elements = getOptionsElements(doc);

  void loadSettings(elements);

  wireHotkeyRecording(elements);
  wireHotkeyReset(elements);

  elements.saveButton.addEventListener("click", () => {
    void handleSave(elements);
  });
}

/**
 * Auto-wire the page when this module is loaded as the options-page script.
 *
 * Guarded so importing the module in a test — to exercise the exported functions
 * directly against a custom fixture — does not throw or register a listener when
 * the options markup is not present. When the document is still loading we defer
 * to `DOMContentLoaded`; otherwise we wire immediately.
 */
function autoWire(): void {
  if (typeof document === "undefined") {
    return;
  }
  // Only wire when the options markup is present (i.e. this really is the
  // options page), so a bare import in a test is inert.
  if (document.getElementById("save-button") === null) {
    return;
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      initOptionsPage();
    });
  } else {
    initOptionsPage();
  }
}

autoWire();
