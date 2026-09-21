/**
 * Integration tests for the Background_Script command dispatch and no-op paths
 * (Requirements 5.1, 5.2, 5.4). See design.md "Background_Script",
 * "Messaging Protocol", the Error Handling table, and tasks.md task 8.2.
 *
 * These are example-based integration tests (NOT property-based). They drive
 * `handleCommand` from `src/background.ts` against the shared mocked
 * WebExtension `browser` API (`tests/mock-browser.ts`) to confirm:
 *
 *   - Firing `tab-updown-forward` sends a `navigate` message with
 *     `direction: "forward"` to the active tab (Requirement 5.1).
 *   - Firing `tab-updown-backward` sends a `navigate` message with
 *     `direction: "backward"` to the active tab (Requirement 5.2).
 *   - No message is sent (focus unchanged) when there is no active tab, when the
 *     active tab has no `id`, or when `tabs.sendMessage` rejects — a privileged
 *     page with no content-script receiver (Requirement 5.4).
 *   - A command this extension does not own is ignored entirely.
 *
 * `handleCommand` reads the `browser` global, so each test installs a fresh mock
 * and restores the previous global afterwards. The module under test is imported
 * inside the test lifecycle (after the mock is installed) so that the top-level
 * `browser.commands.onCommand.addListener(...)` call in `background.ts` binds to
 * the mock rather than an undefined global.
 */
import {
  FORWARD_COMMAND_NAME,
  BACKWARD_COMMAND_NAME,
} from "../src/lib/constants.js";
import { installMockBrowser, type MockBrowser } from "./mock-browser.js";

describe("Background_Script command dispatch (integration)", () => {
  let restore: () => void;

  afterEach(() => {
    restore?.();
    jest.resetModules();
  });

  /**
   * Install a fresh mock `browser` (seeded with the given tabs), then import a
   * fresh copy of the background module so its top-level listener registration
   * binds to this mock.
   */
  async function setup(
    tabs: Array<{ id?: number; active?: boolean }>,
  ): Promise<{
    browser: MockBrowser;
    handleCommand: typeof import("../src/background.js").handleCommand;
  }> {
    jest.resetModules();
    const installed = installMockBrowser({ tabs });
    restore = installed.restore;
    const { handleCommand } = await import("../src/background.js");
    return { browser: installed.browser, handleCommand };
  }

  describe("dispatch to the active tab", () => {
    it("sends a forward navigate message to the active tab (Requirement 5.1)", async () => {
      const { browser, handleCommand } = await setup([{ id: 42, active: true }]);

      await handleCommand(FORWARD_COMMAND_NAME);

      expect(browser.tabs.query).toHaveBeenCalledWith({
        active: true,
        currentWindow: true,
      });
      expect(browser.tabs.sendMessage).toHaveBeenCalledTimes(1);
      expect(browser.tabs.sendMessage).toHaveBeenCalledWith(42, {
        type: "navigate",
        direction: "forward",
      });
    });

    it("sends a backward navigate message to the active tab (Requirement 5.2)", async () => {
      const { browser, handleCommand } = await setup([{ id: 7, active: true }]);

      await handleCommand(BACKWARD_COMMAND_NAME);

      expect(browser.tabs.sendMessage).toHaveBeenCalledTimes(1);
      expect(browser.tabs.sendMessage).toHaveBeenCalledWith(7, {
        type: "navigate",
        direction: "backward",
      });
    });

    it("routes to the message of the first (active) tab returned by the query", async () => {
      const { browser, handleCommand } = await setup([{ id: 99, active: true }]);

      await handleCommand(FORWARD_COMMAND_NAME);

      const [tabId] = browser.tabs.sendMessage.mock.calls[0];
      expect(tabId).toBe(99);
    });
  });

  describe("no-op paths (leave focus unchanged, Requirement 5.4)", () => {
    it("sends no message when no active tab exists", async () => {
      const { browser, handleCommand } = await setup([]);

      await handleCommand(FORWARD_COMMAND_NAME);

      expect(browser.tabs.query).toHaveBeenCalledTimes(1);
      expect(browser.tabs.sendMessage).not.toHaveBeenCalled();
    });

    it("sends no message when the active tab has no id", async () => {
      const { browser, handleCommand } = await setup([{ active: true }]);

      await handleCommand(BACKWARD_COMMAND_NAME);

      expect(browser.tabs.sendMessage).not.toHaveBeenCalled();
    });

    it("swallows a rejected sendMessage (no content-script receiver) without throwing", async () => {
      const { browser, handleCommand } = await setup([{ id: 5, active: true }]);
      browser.tabs.sendMessage.mockRejectedValueOnce(
        new Error("Could not establish connection. Receiving end does not exist."),
      );

      // The command still attempts a single send, but the rejection is caught
      // and treated as a no-op — `handleCommand` resolves rather than rejects.
      await expect(handleCommand(FORWARD_COMMAND_NAME)).resolves.toBeUndefined();
      expect(browser.tabs.sendMessage).toHaveBeenCalledTimes(1);
    });
  });

  describe("unrelated commands", () => {
    it("ignores a command this extension does not own", async () => {
      const { browser, handleCommand } = await setup([{ id: 1, active: true }]);

      await handleCommand("some-other-extension-command");

      expect(browser.tabs.query).not.toHaveBeenCalled();
      expect(browser.tabs.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe("onCommand listener wiring", () => {
    it("registers a top-level onCommand listener that dispatches via handleCommand", async () => {
      const { browser } = await setup([{ id: 21, active: true }]);

      // The module registered exactly one listener at import time.
      expect(browser.commands.onCommand.addListener).toHaveBeenCalledTimes(1);

      // Simulate Firefox firing the command; the listener is fire-and-forget,
      // so await a microtask flush before asserting the relayed send.
      browser.commands.onCommand.dispatch(FORWARD_COMMAND_NAME);
      await Promise.resolve();
      await Promise.resolve();

      expect(browser.tabs.sendMessage).toHaveBeenCalledWith(21, {
        type: "navigate",
        direction: "forward",
      });
    });
  });
});
