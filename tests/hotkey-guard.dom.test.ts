/**
 * The Content_Script's hotkey guard, end to end (expanded-popup-focus-trap-fix,
 * GitHub issue #18: "still trapped" on GitHub's branch picker).
 *
 * Firefox registers extension shortcuts as ordinary (non-reserved) browser key
 * bindings, so a hotkey press goes to the page first: `keydown` is dispatched
 * in the page, and the command only runs if the page didn't cancel it. Primer's
 * AnchoredOverlay anchor opens its menu on any ArrowDown/ArrowUp/Space/Enter
 * keydown, modifiers or not, and cancels the event. So without the guard,
 * Alt+Shift+Down on the branch button opens the picker, moves focus into it,
 * and never reaches Tab-Updown.
 *
 * `pressHotkey` models that order: it dispatches the `keydown` on the focused
 * element and then fires `commands.onCommand` only when the event wasn't
 * cancelled. Both scripts run against one mocked `browser`, with
 * `tabs.sendMessage` wired to the content script's listener and
 * `storage.local.set` firing `storage.onChanged`.
 */

import {
  BACKWARD_COMMAND_NAME,
  FORWARD_COMMAND_NAME,
} from "../src/lib/constants.js";
import type { Direction } from "../src/lib/focus.js";
import { SHORTCUTS_KEY } from "../src/lib/shortcut-sync.js";
import { installMockBrowser, type MockBrowser } from "./mock-browser.js";

const TAB_ID = 1;

const DEFAULT_COMMANDS = [
  { name: FORWARD_COMMAND_NAME, shortcut: "Alt+Shift+Down" },
  { name: BACKWARD_COMMAND_NAME, shortcut: "Alt+Shift+Up" },
];

/** Give an element non-zero layout dimensions so `isVisible` sees it as laid out. */
function layOut(element: Element): void {
  Object.defineProperty(element, "offsetWidth", { configurable: true, value: 10 });
  Object.defineProperty(element, "offsetHeight", { configurable: true, value: 10 });
  Object.defineProperty(element, "getClientRects", {
    configurable: true,
    value: () => [{ width: 10, height: 10, top: 0, left: 0, right: 10, bottom: 10 }],
  });
}

function layOutAll(root: ParentNode): void {
  for (const element of Array.from(root.querySelectorAll("a[href], button, input"))) {
    layOut(element);
  }
}

function byId(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`fixture element #${id} is missing`);
  }
  return element;
}

function activeId(): string {
  const active = document.activeElement;
  return active === null || active === document.body ? "body" : active.id;
}

/** Let the fire-and-forget storage / messaging chains settle. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

interface KeyInit {
  key: string;
  code: string;
  altKey?: boolean;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
}

const ALT_SHIFT_DOWN: KeyInit = { key: "ArrowDown", code: "ArrowDown", altKey: true, shiftKey: true };
const ALT_SHIFT_UP: KeyInit = { key: "ArrowUp", code: "ArrowUp", altKey: true, shiftKey: true };

/** Dispatch a `keydown` on the focused element (or `<body>`), as Firefox does. */
function keydown(init: KeyInit): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { ...init, bubbles: true, cancelable: true });
  (document.activeElement ?? document.body).dispatchEvent(event);
  return event;
}

// ---------------------------------------------------------------------------
// GitHub branch picker fixture
// ---------------------------------------------------------------------------

const ANCHOR = "--anchored-overlay-anchor-_R_dladahlik5H1_";
const PAGE_ORDER = ["a1", "a2", "branch-btn", "a3", "a4", "a5", "a6"];

/**
 * The page around the branch button, plus a Primer-style AnchoredOverlay:
 * the button opens the picker on ArrowDown/ArrowUp/Space/Enter keydown without
 * checking modifiers, cancels the event, renders the overlay into the Primer
 * portal, and focuses its filter input.
 */
function buildBranchPicker(): { isOpen: () => boolean } {
  (document.activeElement as HTMLElement | null)?.blur();
  document.body.innerHTML = `
    <a id="a1" href="#">a1</a>
    <a id="a2" href="#">a2</a>
    <button id="branch-btn" type="button" aria-haspopup="true" aria-expanded="false" tabindex="0"
      style="min-width: 0px; anchor-name: ${ANCHOR};" aria-label="main branch">main</button>
    <div class="d-none"></div>
    <a id="a3" href="#">a3</a>
    <a id="a4" href="#">a4</a>
    <a id="a5" href="#">a5</a>
    <a id="a6" href="#">a6</a>
  `;
  layOutAll(document.body);

  const button = byId("branch-btn");
  let open = false;
  button.addEventListener("keydown", (event) => {
    if (!event.defaultPrevented && !open && ["ArrowDown", "ArrowUp", " ", "Enter"].includes(event.key)) {
      event.preventDefault();
      open = true;
      button.setAttribute("aria-expanded", "true");
      const portal = document.createElement("div");
      portal.id = "__primerPortalRoot__";
      portal.innerHTML = `
        <div style="position: relative; z-index: 1;">
          <div id="overlay" role="none" data-component="AnchoredOverlay" style="position-anchor: ${ANCHOR};">
            <input id="filter" aria-label="Filter branches">
            <a id="br-main" href="#">main</a>
            <a id="br-dev" href="#">dev</a>
            <a id="view-all" href="#">View all branches</a>
          </div>
        </div>
      `;
      document.body.appendChild(portal);
      layOutAll(portal);
      byId("filter").focus();
    }
  });
  return { isOpen: () => open };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("hotkey guard (keydown -> page -> command)", () => {
  let browser: MockBrowser;
  let restore: () => void = () => {};

  beforeAll(async () => {
    ({ browser, restore } = installMockBrowser({
      storage: { chunkSize: 1 },
      commands: DEFAULT_COMMANDS,
      tabs: [{ id: TAB_ID, active: true }],
    }));
    browser.tabs.sendMessage.mockImplementation(async (tabId: number, message: unknown) => {
      if (tabId === TAB_ID) {
        browser.runtime.onMessage.dispatch(message, {}, () => {});
      }
      return undefined;
    });
    await jest.isolateModulesAsync(async () => {
      await import("../src/background.js");
      await import("../src/content.js");
    });
    await settle();
  });

  afterAll(() => {
    restore();
  });

  afterEach(async () => {
    (document.activeElement as HTMLElement | null)?.blur();
    document.body.innerHTML = "";
    // Restore the default shortcuts for the next test.
    browser.commands.getAll.mockResolvedValue(DEFAULT_COMMANDS.map((command) => ({ ...command })));
    browser.commands.onChanged.dispatch({ name: FORWARD_COMMAND_NAME, newShortcut: "", oldShortcut: "" });
    await settle();
  });

  /** A hotkey press as Firefox handles it: keydown to the page, then the command if not cancelled. */
  async function pressHotkey(direction: Direction): Promise<KeyboardEvent> {
    const event = keydown(direction === "forward" ? ALT_SHIFT_DOWN : ALT_SHIFT_UP);
    if (!event.defaultPrevented) {
      browser.commands.onCommand.dispatch(
        direction === "forward" ? FORWARD_COMMAND_NAME : BACKWARD_COMMAND_NAME,
      );
    }
    await settle();
    return event;
  }

  /** Record which page listeners saw each keydown, at three depths. */
  function recordPageListeners(): string[] {
    document.body.innerHTML = `<button id="target">target</button>`;
    byId("target").focus();
    const seen: string[] = [];
    document.addEventListener("keydown", () => seen.push("document capture"), {
      capture: true,
      once: true,
    });
    document.body.addEventListener("keydown", () => seen.push("body"), { once: true });
    byId("target").addEventListener("keydown", () => seen.push("target"), { once: true });
    return seen;
  }

  it("stops the Forward and Backward hotkeys before any page listener, without cancelling them", () => {
    for (const init of [ALT_SHIFT_DOWN, ALT_SHIFT_UP]) {
      const seen = recordPageListeners();
      const event = keydown(init);
      expect(seen).toEqual([]);
      // Cancelling would stop Firefox from running the command.
      expect(event.defaultPrevented).toBe(false);
    }
  });

  it.each([
    ["ArrowDown", { key: "ArrowDown", code: "ArrowDown" }],
    ["Alt+Down", { key: "ArrowDown", code: "ArrowDown", altKey: true }],
    ["Shift+Down", { key: "ArrowDown", code: "ArrowDown", shiftKey: true }],
    ["Alt+Shift+Left", { key: "ArrowLeft", code: "ArrowLeft", altKey: true, shiftKey: true }],
    [
      "Ctrl+Alt+Shift+Down",
      { key: "ArrowDown", code: "ArrowDown", altKey: true, shiftKey: true, ctrlKey: true },
    ],
  ])("lets %s through to the page", (_name, init) => {
    const seen = recordPageListeners();
    keydown(init as KeyInit);
    expect(seen).toEqual(["document capture", "target", "body"]);
  });

  it("follows a shortcut changed in the Options_Page or about:addons", async () => {
    browser.commands.getAll.mockResolvedValue([
      { name: FORWARD_COMMAND_NAME, shortcut: "Ctrl+Shift+J" },
      { name: BACKWARD_COMMAND_NAME, shortcut: "Ctrl+Shift+K" },
    ]);
    browser.commands.onChanged.dispatch({
      name: FORWARD_COMMAND_NAME,
      newShortcut: "Ctrl+Shift+J",
      oldShortcut: "Alt+Shift+Down",
    });
    await settle();
    expect((await browser.storage.local.get(SHORTCUTS_KEY))[SHORTCUTS_KEY]).toEqual({
      forward: "Ctrl+Shift+J",
      backward: "Ctrl+Shift+K",
    });

    let seen = recordPageListeners();
    keydown({ key: "J", code: "KeyJ", ctrlKey: true, shiftKey: true });
    expect(seen).toEqual([]);

    // The old default is an ordinary key combination again.
    seen = recordPageListeners();
    keydown(ALT_SHIFT_DOWN);
    expect(seen).toEqual(["document capture", "target", "body"]);
  });

  it("stops nothing for an unassigned shortcut", async () => {
    browser.commands.getAll.mockResolvedValue([
      { name: FORWARD_COMMAND_NAME, shortcut: "" },
      { name: BACKWARD_COMMAND_NAME, shortcut: "" },
    ]);
    browser.commands.onChanged.dispatch({ name: FORWARD_COMMAND_NAME, newShortcut: "", oldShortcut: "Alt+Shift+Down" });
    await settle();

    const seen = recordPageListeners();
    keydown(ALT_SHIFT_DOWN);
    expect(seen).toEqual(["document capture", "target", "body"]);
  });

  describe("GitHub branch picker", () => {
    it("fixture check: an unguarded Alt+Shift+Down opens the picker and swallows the command", async () => {
      // With no shortcut copy to match, the keydown reaches the button.
      await browser.storage.local.set({ [SHORTCUTS_KEY]: { forward: "", backward: "" } });
      const picker = buildBranchPicker();
      byId("branch-btn").focus();

      const event = await pressHotkey("forward");

      // This was the reported bug: the picker opens, focus moves into it, and
      // the cancelled keydown means Firefox never runs the command.
      expect(event.defaultPrevented).toBe(true);
      expect(picker.isOpen()).toBe(true);
      expect(activeId()).toBe("filter");
    });

    it("Forward and Backward from the branch button walk past it without opening the picker", async () => {
      const picker = buildBranchPicker();
      byId("branch-btn").focus();

      const landed: string[] = [];
      for (const direction of ["forward", "backward", "backward", "forward", "forward"] as const) {
        await pressHotkey(direction);
        landed.push(activeId());
      }

      // c = 1 over [a1, a2, branch-btn, a3, ...]: each press passes over the
      // button like native Tab, including presses made while it has focus.
      expect(landed).toEqual(["a3", "branch-btn", "a2", "branch-btn", "a3"]);
      expect(picker.isOpen()).toBe(false);
      expect(byId("branch-btn").getAttribute("aria-expanded")).toBe("false");
    });

    it("walks every page element with c = 1 and never opens the picker", async () => {
      const picker = buildBranchPicker();

      const landed: string[] = [];
      for (let press = 0; press < PAGE_ORDER.length; press += 1) {
        await pressHotkey("forward");
        landed.push(activeId());
      }
      for (let press = 0; press < PAGE_ORDER.length; press += 1) {
        await pressHotkey("backward");
        landed.push(activeId());
      }

      expect(landed).toEqual([
        ...PAGE_ORDER,
        ...[...PAGE_ORDER].reverse().slice(1),
        "a1",
      ]);
      expect(picker.isOpen()).toBe(false);
    });

    it("with the picker opened by the user, one press exits counting from the branch button", async () => {
      for (const [direction, expected] of [
        ["forward", "a3"],
        ["backward", "a2"],
      ] as const) {
        const picker = buildBranchPicker();
        byId("branch-btn").focus();
        // The user opens the picker with a plain ArrowDown (or a click).
        keydown({ key: "ArrowDown", code: "ArrowDown" });
        expect(picker.isOpen()).toBe(true);
        expect(activeId()).toBe("filter");

        await pressHotkey(direction);

        expect(activeId()).toBe(expected);
        document.getElementById("__primerPortalRoot__")?.remove();
      }
    });
  });
});
