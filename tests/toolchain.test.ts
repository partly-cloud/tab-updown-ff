/**
 * Placeholder test confirming the Jest toolchain is wired up correctly:
 *   - TypeScript compiles and runs via ts-jest (ESM).
 *   - The jsdom test environment provides a DOM.
 *   - fast-check is importable and runnable.
 *   - The shared WebExtension mock helper works.
 *
 * These assertions exist purely to validate the test environment for later
 * tasks; they are replaced/augmented by real tests as modules are built.
 */
import fc from "fast-check";

import { createMockBrowser, installMockBrowser } from "./mock-browser.js";

describe("toolchain", () => {
  it("runs TypeScript tests via ts-jest", () => {
    const value: number = 1 + 1;
    expect(value).toBe(2);
  });

  it("provides a jsdom DOM environment", () => {
    document.body.innerHTML = `<button id="ok">click</button>`;
    const button = document.getElementById("ok");
    expect(button).not.toBeNull();
    expect(button?.tagName).toBe("BUTTON");
  });

  it("can run a fast-check property", () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer(), (a, b) => {
        return a + b === b + a;
      }),
      { numRuns: 100 },
    );
  });

  it("exposes a usable WebExtension mock helper", async () => {
    const browser = createMockBrowser({ storage: { chunkSize: 5 } });

    await browser.storage.local.set({ chunkSize: 7 });
    const result = await browser.storage.local.get("chunkSize");
    expect(result).toEqual({ chunkSize: 7 });

    const received: string[] = [];
    browser.commands.onCommand.addListener((command) => {
      received.push(command);
    });
    browser.commands.onCommand.dispatch("tab-updown-forward");
    expect(received).toEqual(["tab-updown-forward"]);
  });

  it("can install and restore the global browser mock", () => {
    const { browser, restore } = installMockBrowser();
    expect((globalThis as unknown as { browser: unknown }).browser).toBe(
      browser,
    );
    restore();
    expect(
      (globalThis as unknown as { browser: unknown }).browser,
    ).toBeUndefined();
  });
});
