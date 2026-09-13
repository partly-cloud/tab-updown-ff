/**
 * Integration tests for the Tab-Updown extension (tasks.md 12.1).
 *
 * Two representative wiring cases from design.md "Integration Tests":
 *
 *   1. Empty-document no-op: with a document that contains no Focusable_Element,
 *      the content script's `handleNavigate` leaves `document.activeElement`
 *      unchanged on BOTH the forward and backward directions (Requirements 1.5,
 *      2.4). This exercises the real content-script path (read Chunk_Size →
 *      buildFocusOrder → computeTargetIndex → no focus change) against a jsdom
 *      fixture, not just the pure arithmetic in isolation.
 *
 *   2. Persistence round-trip: a Chunk_Size saved via `storage.local.set` is
 *      readable via `storage.local.get` after a simulated reload — i.e. after
 *      the extension context is torn down and re-created, the previously
 *      persisted value survives (Requirements 6.1, 7.3). The reload is simulated
 *      by re-reading from the same backing store through a fresh mock surface.
 *
 * The content script registers `browser.runtime.onMessage.addListener` at module
 * load, so a global `browser` must exist BEFORE the module is imported. Each
 * test installs the shared mock (`tests/mock-browser.ts`) first, then imports
 * `../src/content.js` dynamically with a reset module registry so the top-level
 * listener registration binds to the installed mock.
 */

import {
  createMockBrowser,
  installMockBrowser,
  type MockBrowser,
} from "./mock-browser.js";

/**
 * Install the mock browser (optionally seeded), reset the module registry, and
 * import the content script fresh so its top-level `onMessage` registration runs
 * against the just-installed mock. Returns the module's exports, the mock, and a
 * `restore()` that removes the global `browser`.
 */
async function loadContentScript(
  options: Parameters<typeof installMockBrowser>[0] = {},
): Promise<{
  content: typeof import("../src/content.js");
  browser: MockBrowser;
  restore: () => void;
}> {
  const { browser, restore } = installMockBrowser(options);
  let content!: typeof import("../src/content.js");
  await jest.isolateModulesAsync(async () => {
    content = await import("../src/content.js");
  });
  return { content, browser, restore };
}

describe("integration: empty-document no-op (Requirements 1.5, 2.4)", () => {
  let restore: (() => void) | undefined;

  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  it("leaves activeElement unchanged on a forward navigation", async () => {
    const loaded = await loadContentScript({ storage: { chunkSize: 5 } });
    restore = loaded.restore;

    // An empty document: <body> holds focus by default and there is nothing to
    // move to.
    const before = document.activeElement;
    expect(before).toBe(document.body);

    await loaded.content.handleNavigate("forward");

    expect(document.activeElement).toBe(before);
    expect(document.activeElement).toBe(document.body);
  });

  it("leaves activeElement unchanged on a backward navigation", async () => {
    const loaded = await loadContentScript({ storage: { chunkSize: 5 } });
    restore = loaded.restore;

    const before = document.activeElement;
    expect(before).toBe(document.body);

    await loaded.content.handleNavigate("backward");

    expect(document.activeElement).toBe(before);
    expect(document.activeElement).toBe(document.body);
  });

  it("is a no-op in both directions when no Chunk_Size is stored", async () => {
    // No seeded storage: the content script falls back to the default, but with
    // an empty Focus_Order the direction still resolves to no focus change.
    const loaded = await loadContentScript();
    restore = loaded.restore;

    const before = document.activeElement;

    await loaded.content.handleNavigate("forward");
    expect(document.activeElement).toBe(before);

    await loaded.content.handleNavigate("backward");
    expect(document.activeElement).toBe(before);
  });
});

describe("integration: Chunk_Size persistence round-trip (Requirements 6.1, 7.3)", () => {
  it("reads back a saved Chunk_Size from storage.local after a simulated reload", async () => {
    // Shared backing store that survives the "reload": the first mock writes
    // into it, the second (post-reload) mock reads from the same object.
    const backingStore: Record<string, unknown> = {};

    // --- Session 1: user saves a Chunk_Size on the Options_Page. ---
    const session1 = createMockBrowser({ storage: backingStore });
    await session1.storage.local.set({ chunkSize: 42 });

    // The write is reflected within the same session.
    const inSession = await session1.storage.local.get("chunkSize");
    expect(inSession).toEqual({ chunkSize: 42 });

    // --- Simulated reload: tear down session 1, re-seed session 2 from the
    // persisted backing store (as a browser restart would rehydrate storage). ---
    const persisted = await session1.storage.local.get();
    const session2 = createMockBrowser({ storage: persisted });

    // --- Session 2: the previously saved value is still readable. ---
    const afterReload = await session2.storage.local.get("chunkSize");
    expect(afterReload).toEqual({ chunkSize: 42 });
  });

  it("makes the persisted Chunk_Size the value the content script reads after reload", async () => {
    // End-to-end persistence → consumption: save a value, simulate a reload,
    // and confirm the content script (loaded fresh against the reloaded store)
    // moves focus using the persisted Chunk_Size rather than the default.
    const backingStore: Record<string, unknown> = {};

    // Session 1: persist a non-default Chunk_Size.
    const session1 = installMockBrowser({ storage: backingStore });
    await session1.browser.storage.local.set({ chunkSize: 3 });
    const persisted = await session1.browser.storage.local.get();
    session1.restore();

    // Simulated reload: fresh content-script context seeded from persisted store.
    document.body.innerHTML = `
      <button id="b0">0</button>
      <button id="b1">1</button>
      <button id="b2">2</button>
      <button id="b3">3</button>
      <button id="b4">4</button>
    `;
    // jsdom performs no layout, so give the buttons non-zero dimensions to pass
    // the Focus_Order visibility check.
    for (const button of Array.from(document.querySelectorAll("button"))) {
      Object.defineProperty(button, "offsetWidth", {
        configurable: true,
        value: 10,
      });
      Object.defineProperty(button, "offsetHeight", {
        configurable: true,
        value: 10,
      });
      Object.defineProperty(button, "getClientRects", {
        configurable: true,
        value: () => [{ width: 10, height: 10, top: 0, left: 0, right: 10, bottom: 10 }],
      });
    }

    const loaded = await loadContentScript({ storage: persisted });
    try {
      // Focus the first button, then a forward chunk move of the persisted size
      // (3) should land on index 3.
      (document.getElementById("b0") as HTMLButtonElement).focus();
      expect(document.activeElement?.id).toBe("b0");

      await loaded.content.handleNavigate("forward");

      expect(document.activeElement?.id).toBe("b3");
    } finally {
      loaded.restore();
    }
  });
});
