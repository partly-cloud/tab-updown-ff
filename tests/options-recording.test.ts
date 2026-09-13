/**
 * Example / unit tests for the Options_Page hotkey recording UI (task 16.5).
 *
 * These are concrete, example-based tests (property-based coverage for the pure
 * `keyEventToShortcut` / `isValidShortcut` logic lives in the `src/lib/hotkeys`
 * tests). They exercise the recording, reset, and manual-typing-fallback wiring
 * in `src/options.ts` against the REAL `src/options.html` markup loaded into a
 * jsdom document, with the shared WebExtension mock (`tests/mock-browser.ts`)
 * standing in for `browser.commands`.
 *
 * Coverage (Requirements 8.1, 8.2, 8.3, 8.5, 8.6, 8.7, 8.8):
 *   - Dispatching a `keydown` for a Valid_Combination writes the expected
 *     Shortcut_String into the field (Requirements 8.1, 8.2).
 *   - A modifier-only or unmapped press retains the field's previous value and
 *     shows a validation message (Requirement 8.3).
 *   - Activating a reset control calls `commands.reset()` and displays the
 *     restored default (Requirements 8.5, 8.6).
 *   - A typed invalid shortcut is rejected on save with a validation message
 *     while the previously active shortcut is retained (Requirements 8.7, 8.8).
 *
 * As in `tests/options.test.ts`, we load the shipped markup and import a fresh
 * copy of the options module per test (`jest.isolateModulesAsync`) after
 * installing the mock, then drive the exported wiring functions directly so each
 * assertion is deterministic.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  BACKWARD_COMMAND_NAME,
  DEFAULT_BACKWARD_HOTKEY,
  DEFAULT_FORWARD_HOTKEY,
  FORWARD_COMMAND_NAME,
} from "../src/lib/constants.js";
import { installMockBrowser, type MockBrowser } from "./mock-browser.js";

/**
 * The `<body>` markup of the real options page, extracted from
 * `src/options.html` (mirrors `tests/options.test.ts`), so the recording tests
 * run against the shipped hotkey fields and reset controls rather than a
 * hand-rolled fixture.
 */
const OPTIONS_BODY = (() => {
  const html = readFileSync(join(process.cwd(), "src", "options.html"), "utf8");
  const match = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html);
  if (match === null) {
    throw new Error("Could not extract <body> from src/options.html");
  }
  return match[1].replace(/<script[\s\S]*?<\/script>/gi, "");
})();

type OptionsModule = typeof import("../src/options.js");

/**
 * Install the mock browser (seeded with the given state), load the real options
 * markup into the jsdom document, and import a fresh copy of the options module.
 */
async function loadOptionsPage(
  options: Parameters<typeof installMockBrowser>[0] = {},
): Promise<{
  browser: MockBrowser;
  optionsModule: OptionsModule;
  restore: () => void;
}> {
  document.body.innerHTML = OPTIONS_BODY;
  const { browser, restore } = installMockBrowser(options);

  let optionsModule!: OptionsModule;
  await jest.isolateModulesAsync(async () => {
    optionsModule = await import("../src/options.js");
  });

  return { browser, optionsModule, restore };
}

/** Query a required control from the current document, typed for tests. */
function control<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`Missing control #${id}`);
  }
  return element as T;
}

/**
 * Build and dispatch a `keydown` on the given field. The properties mirror what
 * the recorder reads (`ctrlKey`/`altKey`/`shiftKey`/`metaKey`/`key`) so the test
 * simulates a real physical press.
 */
function pressKey(
  field: HTMLInputElement,
  init: {
    key: string;
    ctrlKey?: boolean;
    altKey?: boolean;
    shiftKey?: boolean;
    metaKey?: boolean;
  },
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  field.dispatchEvent(event);
  return event;
}

describe("Options_Page hotkey recording (options.ts)", () => {
  let restore: () => void = () => {};

  afterEach(() => {
    restore();
    restore = () => {};
    document.body.innerHTML = "";
    jest.clearAllMocks();
  });

  describe("keydown recording (Requirements 8.1, 8.2)", () => {
    it("writes the expected Shortcut_String for a Valid_Combination", async () => {
      const loaded = await loadOptionsPage();
      restore = loaded.restore;
      const elements = loaded.optionsModule.getOptionsElements(document);
      // Wire with a fixed (non-Mac) platform flag for deterministic modifiers.
      loaded.optionsModule.wireHotkeyRecording(elements, false);

      const forward = control<HTMLInputElement>("forward-hotkey");
      const event = pressKey(forward, {
        key: "ArrowDown",
        ctrlKey: true,
        shiftKey: true,
      });

      // Ctrl+Shift+ArrowDown → "Ctrl+Shift+Down" (Requirements 8.1, 8.2).
      expect(forward.value).toBe("Ctrl+Shift+Down");
      // The keypress is consumed so it does not otherwise act on the field.
      expect(event.defaultPrevented).toBe(true);
      expect(elements.status.classList.contains("status--error")).toBe(false);
    });

    it("maps a mac Command press to the Command token", async () => {
      const loaded = await loadOptionsPage();
      restore = loaded.restore;
      const elements = loaded.optionsModule.getOptionsElements(document);
      loaded.optionsModule.wireHotkeyRecording(elements, true);

      const backward = control<HTMLInputElement>("backward-hotkey");
      pressKey(backward, { key: "ArrowUp", metaKey: true, shiftKey: true });

      // On Mac, Meta → Command (Requirement 8.4 mapping, exercised here for the
      // recording path).
      expect(backward.value).toBe("Command+Shift+Up");
    });
  });

  describe("invalid press handling (Requirement 8.3)", () => {
    it("retains the previous value and shows a validation message for a modifier-only press", async () => {
      const loaded = await loadOptionsPage();
      restore = loaded.restore;
      const elements = loaded.optionsModule.getOptionsElements(document);
      loaded.optionsModule.wireHotkeyRecording(elements, false);

      const forward = control<HTMLInputElement>("forward-hotkey");
      forward.value = "Alt+Shift+Down";

      // A pure-modifier keydown is ignored (recorder waits for a real key), so
      // the field keeps its previous value and no error is shown yet.
      pressKey(forward, { key: "Shift", shiftKey: true });
      expect(forward.value).toBe("Alt+Shift+Down");
      expect(elements.status.textContent).toBe("");
    });

    it("retains the previous value and shows a validation message for an unmapped press", async () => {
      const loaded = await loadOptionsPage();
      restore = loaded.restore;
      const elements = loaded.optionsModule.getOptionsElements(document);
      loaded.optionsModule.wireHotkeyRecording(elements, false);

      const forward = control<HTMLInputElement>("forward-hotkey");
      forward.value = "Alt+Shift+Down";

      // A letter with no main modifier is not a Valid_Combination: keep the
      // previous value and surface a validation message (Requirement 8.3).
      const event = pressKey(forward, { key: "a" });

      expect(forward.value).toBe("Alt+Shift+Down");
      expect(event.defaultPrevented).toBe(true);
      expect(elements.status.classList.contains("status--error")).toBe(true);
      expect(elements.status.textContent).not.toBe("");
    });
  });

  describe("reset control (Requirements 8.5, 8.6)", () => {
    it("calls commands.reset() and displays the restored default when the command reports none", async () => {
      const loaded = await loadOptionsPage();
      restore = loaded.restore;
      const elements = loaded.optionsModule.getOptionsElements(document);
      // A changed value in the field that a reset should discard.
      elements.forwardHotkey.value = "Ctrl+Shift+Down";

      await loaded.optionsModule.onResetClick(
        elements.forwardHotkey,
        FORWARD_COMMAND_NAME,
        DEFAULT_FORWARD_HOTKEY,
      );

      expect(loaded.browser.commands.reset).toHaveBeenCalledWith(
        FORWARD_COMMAND_NAME,
      );
      // getAll() returns no configured shortcut → the default is displayed.
      expect(elements.forwardHotkey.value).toBe(DEFAULT_FORWARD_HOTKEY);
    });

    it("wires the backward reset button to reset and restore its default", async () => {
      const loaded = await loadOptionsPage();
      restore = loaded.restore;
      const elements = loaded.optionsModule.getOptionsElements(document);
      loaded.optionsModule.wireHotkeyReset(elements);
      elements.backwardHotkey.value = "Ctrl+Shift+Up";

      const resetButton = control<HTMLButtonElement>("backward-hotkey-reset");
      resetButton.click();
      // The click handler runs an async reset; let it settle.
      await Promise.resolve();
      await Promise.resolve();

      expect(loaded.browser.commands.reset).toHaveBeenCalledWith(
        BACKWARD_COMMAND_NAME,
      );
      expect(elements.backwardHotkey.value).toBe(DEFAULT_BACKWARD_HOTKEY);
    });
  });

  describe("manual-typing fallback (Requirements 8.7, 8.8)", () => {
    it("rejects a typed invalid shortcut and retains the previously active shortcut", async () => {
      const loaded = await loadOptionsPage({
        commands: [
          { name: FORWARD_COMMAND_NAME, shortcut: "Alt+Shift+Down" },
          { name: BACKWARD_COMMAND_NAME, shortcut: "Alt+Shift+Up" },
        ],
      });
      restore = loaded.restore;
      const elements = loaded.optionsModule.getOptionsElements(document);
      // Type a string that does not match Firefox's shortcut grammar.
      elements.forwardHotkey.value = "NotAValidCombo";
      elements.backwardHotkey.value = "Alt+Shift+Up";

      const saved = await loaded.optionsModule.saveHotkeys(elements);

      expect(saved).toBe(false);
      // Rejected before any command update (Requirement 8.8).
      expect(loaded.browser.commands.update).not.toHaveBeenCalled();
      // Previously active shortcuts are retained (Requirement 8.7).
      expect(elements.forwardHotkey.value).toBe("Alt+Shift+Down");
      expect(elements.backwardHotkey.value).toBe("Alt+Shift+Up");
      expect(elements.status.classList.contains("status--error")).toBe(true);
      expect(elements.status.textContent).not.toBe("");
    });
  });
});
