/**
 * Content_Script message-handling tests (Requirement 5.3).
 *
 * Concrete, example-based tests (NOT property-based) exercising the content
 * script's `runtime.onMessage` handling against jsdom fixtures and a mocked
 * `browser.storage.local`. They confirm the documented behavior from design.md
 * "Content_Script" / "Messaging Protocol":
 *
 *   - On a `navigate` message the handler reads the Chunk_Size from
 *     `storage.local` BEFORE moving focus (Requirement 5.3), and moves focus to
 *     the element the computed target index points at.
 *   - Non-`navigate` messages are ignored: storage is not read and focus is left
 *     unchanged (design.md Error Handling: "Unexpected message type").
 *
 * The content script (`src/content.ts`) registers its listener via
 * `browser.runtime.onMessage.addListener` at module load, so the mock `browser`
 * must be installed on `globalThis` BEFORE the module is imported. Each test
 * imports the module inside the test lifecycle (with a fresh module registry) so
 * the listener registers against that test's mock.
 *
 * jsdom performs no layout, so `buildFocusOrder`'s visibility check would treat
 * every element as zero-size and exclude it. We stub `offsetWidth`/
 * `offsetHeight`/`getClientRects()` on the fixture elements so they read as laid
 * out, mirroring `tests/focus-order.dom.test.ts`.
 */

import { installMockBrowser, type MockBrowser } from "./mock-browser.js";

/** Give an element non-zero layout dimensions so `isVisible` sees it as laid out. */
function makeLaidOut(element: HTMLElement): void {
  Object.defineProperty(element, "offsetWidth", {
    configurable: true,
    value: 10,
  });
  Object.defineProperty(element, "offsetHeight", {
    configurable: true,
    value: 10,
  });
  Object.defineProperty(element, "getClientRects", {
    configurable: true,
    value: () => [{ width: 10, height: 10, top: 0, left: 0, right: 10, bottom: 10 }],
  });
}

/**
 * Install a fresh mock browser (seeding `storage.local`), import the content
 * script against it so its `onMessage` listener registers, and return both the
 * mock and the module's exported `onMessage` handler plus a restore function.
 */
async function loadContentScript(
  storage: Record<string, unknown> = {},
): Promise<{
  browser: MockBrowser;
  onMessage: (message: unknown) => void;
  restore: () => void;
}> {
  const { browser, restore } = installMockBrowser({ storage });
  // Fresh module registry so the module-load listener registration re-runs
  // against this test's mock rather than a cached instance.
  let mod!: typeof import("../src/content.js");
  await jest.isolateModulesAsync(async () => {
    mod = await import("../src/content.js");
  });
  return { browser, onMessage: mod.onMessage, restore };
}

describe("content script message handling (jsdom + mocked storage)", () => {
  let restore: () => void = () => {};

  afterEach(() => {
    restore();
    restore = () => {};
    document.body.innerHTML = "";
    jest.clearAllMocks();
  });

  it("registers a runtime.onMessage listener at module load", async () => {
    const loaded = await loadContentScript();
    restore = loaded.restore;

    expect(loaded.browser.runtime.onMessage.addListener).toHaveBeenCalledTimes(1);
    expect(loaded.browser.runtime.onMessage.listeners).toContain(loaded.onMessage);
  });

  it("reads Chunk_Size from storage before moving focus and focuses the computed target", async () => {
    // Focus_Order: [b0, b1, b2, b3, b4]. With chunkSize 2 and no current focus,
    // a forward move targets index min(c - 1, n - 1) = index 1 (Property 3).
    const loaded = await loadContentScript({ chunkSize: 2 });
    restore = loaded.restore;
    const { browser, onMessage } = loaded;

    document.body.innerHTML = `
      <button id="b0">0</button>
      <button id="b1">1</button>
      <button id="b2">2</button>
      <button id="b3">3</button>
      <button id="b4">4</button>
    `;
    for (const id of ["b0", "b1", "b2", "b3", "b4"]) {
      makeLaidOut(document.getElementById(id) as HTMLElement);
    }

    // Record the order of side effects: storage read must happen before focus.
    const events: string[] = [];
    browser.storage.local.get.mockImplementationOnce(async () => {
      events.push("storage.get");
      return { chunkSize: 2 };
    });
    const target = document.getElementById("b1") as HTMLButtonElement;
    jest.spyOn(target, "focus").mockImplementation(() => {
      events.push("focus");
    });

    onMessage({ type: "navigate", direction: "forward" });
    // The handler is async (fire-and-forget); flush the microtask queue.
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Storage was read (Requirement 5.3)...
    expect(browser.storage.local.get).toHaveBeenCalledWith("chunkSize");
    // ...and it was read BEFORE focus moved.
    expect(events).toEqual(["storage.get", "focus"]);
    // Focus moved to the computed target element.
    expect(target.focus).toHaveBeenCalledTimes(1);
  });

  it("moves focus to the computed target for a backward move from the current focus", async () => {
    // chunkSize 2, current focus at index 4 → backward target max(4 - 2, 0) = 2.
    const loaded = await loadContentScript({ chunkSize: 2 });
    restore = loaded.restore;
    const { onMessage } = loaded;

    document.body.innerHTML = `
      <button id="b0">0</button>
      <button id="b1">1</button>
      <button id="b2">2</button>
      <button id="b3">3</button>
      <button id="b4">4</button>
    `;
    for (const id of ["b0", "b1", "b2", "b3", "b4"]) {
      makeLaidOut(document.getElementById(id) as HTMLElement);
    }

    const current = document.getElementById("b4") as HTMLButtonElement;
    current.focus();
    expect(document.activeElement).toBe(current);

    const expectedTarget = document.getElementById("b2") as HTMLButtonElement;
    const focusSpy = jest.spyOn(expectedTarget, "focus");

    onMessage({ type: "navigate", direction: "backward" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(focusSpy).toHaveBeenCalledTimes(1);
  });

  it("falls back to the default Chunk_Size when storage holds no value", async () => {
    // No chunkSize stored → normalizeChunkSize → default 5. Forward from no
    // focus targets min(5 - 1, n - 1). With 3 elements that clamps to index 2.
    const loaded = await loadContentScript({});
    restore = loaded.restore;
    const { browser, onMessage } = loaded;

    document.body.innerHTML = `
      <button id="b0">0</button>
      <button id="b1">1</button>
      <button id="b2">2</button>
    `;
    for (const id of ["b0", "b1", "b2"]) {
      makeLaidOut(document.getElementById(id) as HTMLElement);
    }

    const expectedTarget = document.getElementById("b2") as HTMLButtonElement;
    const focusSpy = jest.spyOn(expectedTarget, "focus");

    onMessage({ type: "navigate", direction: "forward" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(browser.storage.local.get).toHaveBeenCalledWith("chunkSize");
    expect(focusSpy).toHaveBeenCalledTimes(1);
  });

  describe("ignores non-navigate messages", () => {
    const cases: Array<{ name: string; message: unknown }> = [
      { name: "an unrelated message type", message: { type: "something-else" } },
      { name: "a navigate message with a bad direction", message: { type: "navigate", direction: "sideways" } },
      { name: "a message missing a type", message: { direction: "forward" } },
      { name: "a null message", message: null },
      { name: "a string message", message: "navigate" },
    ];

    it.each(cases)("ignores $name: no storage read, focus unchanged", async ({ message }) => {
      const loaded = await loadContentScript({ chunkSize: 2 });
      restore = loaded.restore;
      const { browser, onMessage } = loaded;

      document.body.innerHTML = `
        <button id="b0">0</button>
        <button id="b1">1</button>
      `;
      for (const id of ["b0", "b1"]) {
        makeLaidOut(document.getElementById(id) as HTMLElement);
      }
      const b0 = document.getElementById("b0") as HTMLButtonElement;
      const b1 = document.getElementById("b1") as HTMLButtonElement;
      const focusSpy0 = jest.spyOn(b0, "focus");
      const focusSpy1 = jest.spyOn(b1, "focus");

      onMessage(message);
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Non-navigate messages short-circuit before reading storage or focusing.
      expect(browser.storage.local.get).not.toHaveBeenCalled();
      expect(focusSpy0).not.toHaveBeenCalled();
      expect(focusSpy1).not.toHaveBeenCalled();
    });
  });
});
