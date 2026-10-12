/**
 * Tests for the `storage.local` copy of the navigation shortcuts that the
 * Content_Script's hotkey guard reads (src/lib/shortcut-sync.ts).
 */
import { installMockBrowser } from "../../tests/mock-browser.js";

import {
  BACKWARD_COMMAND_NAME,
  DEFAULT_BACKWARD_HOTKEY,
  DEFAULT_FORWARD_HOTKEY,
  FORWARD_COMMAND_NAME,
} from "./constants.js";
import {
  DEFAULT_SHORTCUTS,
  parseStoredShortcuts,
  SHORTCUTS_KEY,
  syncShortcutsToStorage,
} from "./shortcut-sync.js";

describe("parseStoredShortcuts", () => {
  it.each([undefined, null, "Alt+Shift+Down", 5, []])(
    "falls back to the defaults for %j",
    (value) => {
      expect(parseStoredShortcuts(value)).toEqual({
        forward: DEFAULT_FORWARD_HOTKEY,
        backward: DEFAULT_BACKWARD_HOTKEY,
      });
    },
  );

  it("keeps stored strings, including an unassigned (empty) shortcut", () => {
    expect(parseStoredShortcuts({ forward: "Ctrl+Shift+J", backward: "" })).toEqual({
      forward: "Ctrl+Shift+J",
      backward: "",
    });
  });

  it("defaults each malformed field on its own", () => {
    expect(parseStoredShortcuts({ forward: 3, backward: "Ctrl+Shift+K" })).toEqual({
      forward: DEFAULT_SHORTCUTS.forward,
      backward: "Ctrl+Shift+K",
    });
  });
});

describe("syncShortcutsToStorage", () => {
  let restore: () => void = () => {};

  afterEach(() => {
    restore();
    restore = () => {};
  });

  it("copies the active shortcuts from commands.getAll()", async () => {
    const installed = installMockBrowser({
      commands: [
        { name: FORWARD_COMMAND_NAME, shortcut: "Ctrl+Shift+J" },
        { name: BACKWARD_COMMAND_NAME, shortcut: "Ctrl+Shift+K" },
        { name: "_execute_action", shortcut: "Alt+Shift+A" },
      ],
    });
    restore = installed.restore;

    await syncShortcutsToStorage();

    expect(installed.browser.storage.local.set).toHaveBeenCalledWith({
      [SHORTCUTS_KEY]: { forward: "Ctrl+Shift+J", backward: "Ctrl+Shift+K" },
    });
  });

  it("stores an unassigned shortcut as empty, and a missing command as its default", async () => {
    const installed = installMockBrowser({
      commands: [{ name: FORWARD_COMMAND_NAME, shortcut: "" }],
    });
    restore = installed.restore;

    await syncShortcutsToStorage();

    expect(installed.browser.storage.local.set).toHaveBeenCalledWith({
      [SHORTCUTS_KEY]: { forward: "", backward: DEFAULT_BACKWARD_HOTKEY },
    });
  });

  it("skips the write when the stored copy is already current", async () => {
    const installed = installMockBrowser({
      commands: [
        { name: FORWARD_COMMAND_NAME, shortcut: "Alt+Shift+Down" },
        { name: BACKWARD_COMMAND_NAME, shortcut: "Alt+Shift+Up" },
      ],
      storage: {
        [SHORTCUTS_KEY]: { forward: "Alt+Shift+Down", backward: "Alt+Shift+Up" },
      },
    });
    restore = installed.restore;

    await syncShortcutsToStorage();

    expect(installed.browser.storage.local.set).not.toHaveBeenCalled();
  });
});
