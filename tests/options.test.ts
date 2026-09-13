/**
 * Example / unit tests for the Options_Page (task 10.5).
 *
 * These are concrete, example-based tests (property-based coverage for the pure
 * Chunk_Size / hotkey logic lives in the `src/lib` tests). They exercise
 * `src/options.ts` against the REAL `src/options.html` markup loaded into a
 * jsdom document, with the shared WebExtension mock (`tests/mock-browser.ts`)
 * standing in for `browser.storage.local` and `browser.commands`.
 *
 * Coverage (design.md "Example / Unit Tests"):
 *   - The page renders the Chunk_Size control (min=1/max=100) and two hotkey
 *     controls (Requirements 3.1, 4.2).
 *   - A valid Chunk_Size calls `storage.local.set` and shows a confirmation
 *     (Requirement 3.2).
 *   - A valid hotkey calls `commands.update()` for each command
 *     (Requirements 4.3, 4.4).
 *   - Opening displays persisted values, and the defaults (5, Alt+Shift+Down,
 *     Alt+Shift+Up) when unconfigured (Requirements 6.2, 6.3, 4.5, 4.6).
 *   - A `commands.update()` rejection reverts the displayed hotkeys and messages
 *     (Requirement 4.7).
 *   - A `storage.local.set` rejection retains the value and messages
 *     (Requirement 7.4).
 *
 * The options module registers no listeners on import when the markup is absent,
 * but here we DO load the markup, so we import inside a fresh module registry per
 * test (`jest.isolateModulesAsync`) after installing the mock, and drive the
 * exported functions directly to keep each assertion deterministic.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  BACKWARD_COMMAND_NAME,
  DEFAULT_BACKWARD_HOTKEY,
  DEFAULT_CHUNK_SIZE,
  DEFAULT_FORWARD_HOTKEY,
  FORWARD_COMMAND_NAME,
} from "../src/lib/constants.js";
import { installMockBrowser, type MockBrowser } from "./mock-browser.js";

/**
 * The `<body>` markup of the real options page, extracted from
 * `src/options.html`. Using the shipped markup means the render assertions
 * (min/max, control presence) validate the actual HTML rather than a hand-rolled
 * fixture that could drift from it.
 */
const OPTIONS_BODY = (() => {
  const html = readFileSync(
    join(process.cwd(), "src", "options.html"),
    "utf8",
  );
  const match = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html);
  if (match === null) {
    throw new Error("Could not extract <body> from src/options.html");
  }
  // Drop the <script> tag so importing the module (not the built bundle) is what
  // wires the page in these tests.
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

describe("Options_Page (options.ts)", () => {
  let restore: () => void = () => {};

  afterEach(() => {
    restore();
    restore = () => {};
    document.body.innerHTML = "";
    jest.clearAllMocks();
  });

  describe("rendered markup (Requirements 3.1, 4.2)", () => {
    it("renders a numeric Chunk_Size control with min=1 and max=100", async () => {
      ({ restore } = await loadOptionsPage());

      const chunkSize = control<HTMLInputElement>("chunk-size");
      expect(chunkSize.type).toBe("number");
      expect(chunkSize.min).toBe("1");
      expect(chunkSize.max).toBe("100");
    });

    it("renders a forward and a backward hotkey control", async () => {
      ({ restore } = await loadOptionsPage());

      const forward = control<HTMLInputElement>("forward-hotkey");
      const backward = control<HTMLInputElement>("backward-hotkey");
      expect(forward).toBeInstanceOf(HTMLInputElement);
      expect(backward).toBeInstanceOf(HTMLInputElement);
    });
  });

  describe("loadSettings display (Requirements 6.2, 6.3, 4.5, 4.6)", () => {
    it("displays the defaults when nothing is persisted or configured", async () => {
      const loaded = await loadOptionsPage();
      restore = loaded.restore;
      const elements = loaded.optionsModule.getOptionsElements(document);

      await loaded.optionsModule.loadSettings(elements);

      expect(elements.chunkSize.value).toBe(String(DEFAULT_CHUNK_SIZE));
      expect(elements.forwardHotkey.value).toBe(DEFAULT_FORWARD_HOTKEY);
      expect(elements.backwardHotkey.value).toBe(DEFAULT_BACKWARD_HOTKEY);
    });

    it("displays the persisted Chunk_Size and configured hotkeys", async () => {
      const loaded = await loadOptionsPage({
        storage: { chunkSize: 42 },
        commands: [
          { name: FORWARD_COMMAND_NAME, shortcut: "Ctrl+Shift+Down" },
          { name: BACKWARD_COMMAND_NAME, shortcut: "Ctrl+Shift+Up" },
        ],
      });
      restore = loaded.restore;
      const elements = loaded.optionsModule.getOptionsElements(document);

      await loaded.optionsModule.loadSettings(elements);

      expect(elements.chunkSize.value).toBe("42");
      expect(elements.forwardHotkey.value).toBe("Ctrl+Shift+Down");
      expect(elements.backwardHotkey.value).toBe("Ctrl+Shift+Up");
    });
  });

  describe("saveChunkSize (Requirements 3.2, 7.4)", () => {
    it("persists a valid Chunk_Size via storage.local.set and shows a confirmation", async () => {
      const loaded = await loadOptionsPage();
      restore = loaded.restore;
      const elements = loaded.optionsModule.getOptionsElements(document);
      elements.chunkSize.value = "7";

      const saved = await loaded.optionsModule.saveChunkSize(elements);

      expect(saved).toBe(true);
      expect(loaded.browser.storage.local.set).toHaveBeenCalledWith({
        chunkSize: 7,
      });
      expect(elements.status.textContent).toContain("7");
      expect(elements.status.classList.contains("status--success")).toBe(true);
    });

    it("retains the previous value and messages when storage.local.set rejects", async () => {
      const loaded = await loadOptionsPage({ storage: { chunkSize: 5 } });
      restore = loaded.restore;
      loaded.browser.storage.local.set.mockRejectedValueOnce(
        new Error("quota exceeded"),
      );
      const elements = loaded.optionsModule.getOptionsElements(document);
      elements.chunkSize.value = "9";

      const saved = await loaded.optionsModule.saveChunkSize(elements);

      expect(saved).toBe(false);
      // The previously persisted value is untouched by the failed write.
      const persisted = await loaded.browser.storage.local.get("chunkSize");
      expect(persisted.chunkSize).toBe(5);
      expect(elements.status.classList.contains("status--error")).toBe(true);
      expect(elements.status.textContent).not.toBe("");
    });
  });

  describe("saveHotkeys (Requirements 4.3, 4.4, 4.7)", () => {
    it("calls commands.update() for each command with a valid pair", async () => {
      const loaded = await loadOptionsPage();
      restore = loaded.restore;
      const elements = loaded.optionsModule.getOptionsElements(document);
      elements.forwardHotkey.value = "Ctrl+Shift+Down";
      elements.backwardHotkey.value = "Ctrl+Shift+Up";

      const saved = await loaded.optionsModule.saveHotkeys(elements);

      expect(saved).toBe(true);
      expect(loaded.browser.commands.update).toHaveBeenCalledWith({
        name: FORWARD_COMMAND_NAME,
        shortcut: "Ctrl+Shift+Down",
      });
      expect(loaded.browser.commands.update).toHaveBeenCalledWith({
        name: BACKWARD_COMMAND_NAME,
        shortcut: "Ctrl+Shift+Up",
      });
    });

    it("reverts the displayed hotkeys and messages when commands.update() rejects", async () => {
      const loaded = await loadOptionsPage({
        commands: [
          { name: FORWARD_COMMAND_NAME, shortcut: "Alt+Shift+Down" },
          { name: BACKWARD_COMMAND_NAME, shortcut: "Alt+Shift+Up" },
        ],
      });
      restore = loaded.restore;
      loaded.browser.commands.update.mockRejectedValueOnce(
        new Error("invalid shortcut"),
      );
      const elements = loaded.optionsModule.getOptionsElements(document);
      // Submit a value Firefox would reject.
      elements.forwardHotkey.value = "NotAValidCombo";
      elements.backwardHotkey.value = "Ctrl+Shift+Up";

      const saved = await loaded.optionsModule.saveHotkeys(elements);

      expect(saved).toBe(false);
      // Displayed value is reverted to the previously active shortcut.
      expect(elements.forwardHotkey.value).toBe("Alt+Shift+Down");
      expect(elements.backwardHotkey.value).toBe("Alt+Shift+Up");
      expect(elements.status.classList.contains("status--error")).toBe(true);
      expect(elements.status.textContent).not.toBe("");
    });
  });
});
