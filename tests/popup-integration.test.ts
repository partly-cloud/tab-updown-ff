/**
 * Integration tests for the expanded-popup-focus-trap-fix (GitHub issue #18).
 * See the spec's tasks.md 3.7 and design.md "Integration Tests".
 *
 * **Validates: Requirements 2.2, 2.3, 2.4, 2.5, 3.6, 3.7**
 *
 * Every activation runs the whole extension path, the way a keyboard shortcut
 * does in Firefox:
 *
 *   commands.onCommand                          (src/background.ts)
 *     -> tabs.query + tabs.sendMessage({ type: "navigate", direction })
 *     -> runtime.onMessage                      (src/content.ts)
 *     -> storage.local.get("chunkSize") -> handleNavigate -> focus()
 *
 * Both scripts are loaded against one mocked `browser` (tests/mock-browser.ts).
 * `tabs.sendMessage` is wired to the content script's `runtime.onMessage`
 * listener, standing in for Firefox delivering the message to the active tab.
 * The Chunk_Size comes from the mocked `storage.local`.
 *
 * Fixtures:
 *   1. GitHub "Code" button. Page `[a1, a2, codeBtn, a3..a10]`, with the
 *      `#code-panel[role=dialog]` Popup_Region either in a Primer portal at the
 *      end of `<body>` (GitHub's real shape) or right after the trigger.
 *   2. The same fixture with a page-side focus trap on the panel.
 *   3. A mixed page with a Primer portal menu, a `[popover]`, and an expanded
 *      disclosure panel. Only the first two are Popup_Regions.
 *
 * jsdom does no layout, so every link and button gets stubbed dimensions (as in
 * tests/focus-order.dom.test.ts). Region members are therefore "visible", and
 * only region detection keeps them out of the Focus_Order.
 */

import { BACKWARD_COMMAND_NAME, FORWARD_COMMAND_NAME } from "../src/lib/constants.js";
import type { Direction } from "../src/lib/focus.js";
import { installMockBrowser, type MockBrowser } from "./mock-browser.js";

/** Id of the mocked active tab that receives the relayed navigate messages. */
const TAB_ID = 1;

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

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

/** Replace `<body>` and stub layout on every link and button in it. */
function setBody(html: string): void {
  // Drop focus left over from a previous fixture before replacing the DOM.
  (document.activeElement as HTMLElement | null)?.blur();
  document.body.innerHTML = html;
  const focusables = document.body.querySelectorAll<HTMLElement>("a[href], button");
  for (const element of Array.from(focusables)) {
    makeLaidOut(element);
  }
}

function byId(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`fixture element #${id} is missing`);
  }
  return element;
}

function linksHtml(ids: readonly string[]): string {
  return ids.map((id) => `<a id="${id}" href="#${id}">${id}</a>`).join("");
}

/** Put focus where a test starts: `"none"` blurs, anything else is an element id. */
function focusStart(start: string): void {
  if (start === "none") {
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);
    return;
  }
  byId(start).focus();
  expect(document.activeElement?.id).toBe(start);
}

/** Short, readable name for the focused element in assertion output. */
function activeLabel(): string {
  const active = document.activeElement;
  if (active === null) {
    return "null";
  }
  if (active === document.body) {
    return "body";
  }
  return active.id || active.localName;
}

/** Every direction sequence of the given length (2^length of them). */
function allSequences(length: number): Direction[][] {
  let sequences: Direction[][] = [[]];
  for (let step = 0; step < length; step += 1) {
    sequences = sequences.flatMap((sequence) => [
      [...sequence, "forward" as const],
      [...sequence, "backward" as const],
    ]);
  }
  return sequences;
}

// ---------------------------------------------------------------------------
// Fixture 1: GitHub "Code" button
// ---------------------------------------------------------------------------

const TRIGGER_ID = "codeBtn";
const PANEL_ID = "code-panel";
const LINKS_BEFORE: readonly string[] = ["a1", "a2"];
const LINKS_AFTER: readonly string[] = ["a3", "a4", "a5", "a6", "a7", "a8", "a9", "a10"];

/**
 * The region-free order O' for the "Code" fixture, which is the
 * Native_Tab_Sequence: `[a1, a2, codeBtn, a3, ..., a10]`. The trigger is at
 * index 2.
 */
const CODE_PAGE_ORDER: readonly string[] = [...LINKS_BEFORE, TRIGGER_ID, ...LINKS_AFTER];

/** Focusable elements inside `#code-panel`, in document order. */
const PANEL_ITEM_IDS: readonly string[] = [
  "tabHttps",
  "tabSsh",
  "copyBtn",
  "openDesktop",
  "downloadZip",
];

const PANEL_ITEMS_HTML = [
  `<button id="tabHttps" type="button">HTTPS</button>`,
  `<button id="tabSsh" type="button">SSH</button>`,
  `<button id="copyBtn" type="button">Copy url to clipboard</button>`,
  `<a id="openDesktop" href="#open-with-desktop">Open with GitHub Desktop</a>`,
  `<a id="downloadZip" href="#download-zip">Download ZIP</a>`,
].join("");

/**
 * `"portal"`: the panel is in `#__primerPortalRoot__`, the last child of
 * `<body>`, as on GitHub. `"inline"`: the panel is anchored right after the
 * trigger in the DOM, so the unfixed Focus_Order would put it directly after
 * `codeBtn`.
 */
type Placement = "portal" | "inline";
const PLACEMENTS: readonly Placement[] = ["portal", "inline"];

/** Replace `<body>` with the "Code" fixture and return the panel root. */
function buildCodeFixture(placement: Placement): HTMLElement {
  const trigger = `<button id="${TRIGGER_ID}" type="button" aria-haspopup="true" aria-expanded="true" aria-controls="${PANEL_ID}">Code</button>`;
  const panel = `<div id="${PANEL_ID}" role="dialog" aria-label="Code">${PANEL_ITEMS_HTML}</div>`;
  setBody(
    placement === "portal"
      ? `${linksHtml(LINKS_BEFORE)}${trigger}${linksHtml(LINKS_AFTER)}<div id="__primerPortalRoot__">${panel}</div>`
      : `${linksHtml(LINKS_BEFORE)}${trigger}${panel}${linksHtml(LINKS_AFTER)}`,
  );
  return byId(PANEL_ID);
}

// ---------------------------------------------------------------------------
// Fixture 2: page-side focus trap
// ---------------------------------------------------------------------------

interface FocusTrap {
  /** Ids of panel elements that received focus, in order. */
  entered: string[];
  /** How many times the trap pulled focus back into the panel. */
  pulledBack: number;
  remove: () => void;
}

/**
 * A focus trap in the style of Primer's `focusTrap`. A `focusin` listener on
 * the panel remembers the last panel element that had focus. Once there is one,
 * a document-level `focusin` outside the panel refocuses it.
 *
 * The trap arms only when focus enters the panel. So if Tab-Updown never moves
 * focus inside, the trap never arms as a result of an activation
 * (Requirement 2.5). A trap the page arms by itself is the design's "Known
 * limitation" and isn't exercised here.
 */
function installFocusTrap(panel: HTMLElement): FocusTrap {
  let lastInside: HTMLElement | null = null;
  const trap: FocusTrap = {
    entered: [],
    pulledBack: 0,
    remove: () => {
      panel.removeEventListener("focusin", onPanelFocusIn);
      document.removeEventListener("focusin", onDocumentFocusIn);
    },
  };

  function onPanelFocusIn(event: FocusEvent): void {
    if (event.target instanceof HTMLElement) {
      lastInside = event.target;
      trap.entered.push(event.target.id);
    }
  }

  function onDocumentFocusIn(event: FocusEvent): void {
    const target = event.target;
    if (lastInside !== null && target instanceof Node && !panel.contains(target)) {
      trap.pulledBack += 1;
      lastInside.focus();
    }
  }

  panel.addEventListener("focusin", onPanelFocusIn);
  document.addEventListener("focusin", onDocumentFocusIn);
  return trap;
}

// ---------------------------------------------------------------------------
// Fixture 3: mixed page
// ---------------------------------------------------------------------------

/**
 * - `menuBtn` opens `#menu-overlay[role=menu]`, rendered into the Primer portal
 *   at the end of `<body>` (Popup_Region).
 * - `popBtn` opens `#info-popover[popover]`, placed inline after it
 *   (Popup_Region). Its close button also carries `popovertarget`, but it sits
 *   inside the popover, so it isn't the trigger.
 * - `discBtn` expands `#disc-panel`, a plain disclosure panel. It isn't a
 *   Popup_Region, and native Tab visits its links.
 */
const MIXED_HTML = [
  `<a id="p1" href="#p1">p1</a>`,
  `<button id="menuBtn" type="button" aria-haspopup="menu" aria-expanded="true" aria-controls="menu-overlay">Menu</button>`,
  `<a id="p2" href="#p2">p2</a>`,
  `<button id="popBtn" type="button" popovertarget="info-popover">Info</button>`,
  `<div id="info-popover" popover>`,
  `<a id="pop1" href="#pop1">pop1</a>`,
  `<button id="pop2" type="button" popovertarget="info-popover" popovertargetaction="hide">Close</button>`,
  `</div>`,
  `<a id="p3" href="#p3">p3</a>`,
  `<button id="discBtn" type="button" aria-expanded="true" aria-controls="disc-panel">Details</button>`,
  `<div id="disc-panel">${linksHtml(["d1", "d2", "d3"])}</div>`,
  `<a id="p4" href="#p4">p4</a>`,
  `<a id="p5" href="#p5">p5</a>`,
  `<div id="__primerPortalRoot__">`,
  `<div id="menu-overlay" role="menu">`,
  `<button id="m1" type="button" role="menuitem">m1</button>`,
  `<button id="m2" type="button" role="menuitem">m2</button>`,
  `<button id="m3" type="button" role="menuitem">m3</button>`,
  `</div>`,
  `</div>`,
].join("");

/**
 * O' for the mixed page: the portal menu and the popover are skipped, while
 * the disclosure links `d1..d3` keep their place in document order.
 */
const MIXED_ORDER: readonly string[] = [
  "p1",
  "menuBtn",
  "p2",
  "popBtn",
  "p3",
  "discBtn",
  "d1",
  "d2",
  "d3",
  "p4",
  "p5",
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("popup integration: keyboard command -> background -> content script", () => {
  let browser: MockBrowser;
  let restore: () => void = () => {};

  beforeAll(async () => {
    ({ browser, restore } = installMockBrowser({
      storage: { chunkSize: 5 },
      tabs: [{ id: TAB_ID, active: true }],
    }));
    // Deliver messages sent to the active tab to the content script's
    // runtime.onMessage listener, as Firefox does. Other tabs have no receiver.
    browser.tabs.sendMessage.mockImplementation(
      async (tabId: number, message: unknown): Promise<unknown> => {
        if (tabId !== TAB_ID) {
          throw new Error("Could not establish connection. Receiving end does not exist.");
        }
        browser.runtime.onMessage.dispatch(message, { id: "tab-updown@test" }, () => {});
        return undefined;
      },
    );
    // Both scripts register their listeners at module load, so import them
    // after the mock `browser` global is in place.
    await jest.isolateModulesAsync(async () => {
      await import("../src/background.js");
      await import("../src/content.js");
    });
    expect(browser.commands.onCommand.listeners).toHaveLength(1);
    expect(browser.runtime.onMessage.listeners).toHaveLength(1);
  });

  afterAll(() => {
    restore();
  });

  afterEach(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    document.body.innerHTML = "";
  });

  async function setChunkSize(chunkSize: number): Promise<void> {
    await browser.storage.local.set({ chunkSize });
  }

  /**
   * Fire the Forward_Hotkey / Backward_Hotkey command, then wait for the
   * fire-and-forget chain (tabs.query, sendMessage, storage.local.get, focus)
   * to settle. Every mock resolves in a microtask, so one macrotask is enough.
   */
  async function press(direction: Direction): Promise<void> {
    browser.commands.onCommand.dispatch(
      direction === "forward" ? FORWARD_COMMAND_NAME : BACKWARD_COMMAND_NAME,
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  /** Press each direction in turn and return where focus landed after each press. */
  async function pressAll(directions: readonly Direction[]): Promise<string[]> {
    const landed: string[] = [];
    for (const direction of directions) {
      await press(direction);
      landed.push(activeLabel());
    }
    return landed;
  }

  describe.each(PLACEMENTS)('GitHub "Code" fixture, %s placement', (placement) => {
    // Requirements 2.2, 3.6, 3.9
    it.each([
      { chunkSize: 1, expected: "a3" },
      { chunkSize: 3, expected: "a5" },
    ])(
      "Forward from codeBtn with c=$chunkSize lands on $expected, the page element at chunk distance",
      async ({ chunkSize, expected }) => {
        await setChunkSize(chunkSize);
        buildCodeFixture(placement);
        focusStart(TRIGGER_ID);
        browser.storage.local.get.mockClear();
        browser.tabs.sendMessage.mockClear();

        await press("forward");

        // The command went through the background relay, and the content
        // script read the Chunk_Size before moving focus.
        expect(browser.tabs.sendMessage).toHaveBeenCalledTimes(1);
        expect(browser.tabs.sendMessage).toHaveBeenCalledWith(TAB_ID, {
          type: "navigate",
          direction: "forward",
        });
        expect(browser.storage.local.get).toHaveBeenCalledWith("chunkSize");
        // O'[2 + c], counting only page elements after the trigger.
        expect(activeLabel()).toBe(expected);
        expect(CODE_PAGE_ORDER.indexOf(expected)).toBe(2 + chunkSize);
      },
    );

    // Requirements 2.2, 2.3, 2.5, 3.6
    it("repeated Forward and Backward presses walk the page and never enter the panel", async () => {
      await setChunkSize(3);
      const panel = buildCodeFixture(placement);
      focusStart(TRIGGER_ID);

      const directions: Direction[] = [
        "forward",
        "forward",
        "forward",
        "forward",
        "backward",
        "backward",
        "backward",
        "backward",
        "forward",
      ];
      const landed: string[] = [];
      const insidePanel: string[] = [];
      for (const direction of directions) {
        await press(direction);
        landed.push(activeLabel());
        if (panel.contains(document.activeElement)) {
          insidePanel.push(activeLabel());
        }
      }

      // O' = [a1, a2, codeBtn, a3, ..., a10], c = 3, starting at index 2:
      // forward 5, 8, 10 (clamped), 10; backward 7, 4, 1, 0 (clamped);
      // forward 3.
      expect(landed).toEqual(["a5", "a8", "a10", "a10", "a7", "a4", "a2", "a1", "a3"]);
      expect(insidePanel).toEqual([]);
    });

    // Requirements 2.3, 2.4
    it.each(
      PANEL_ITEM_IDS.flatMap((start) => [
        { start, direction: "forward" as const, expected: "a4" },
        { start, direction: "backward" as const, expected: "a1" },
      ]),
    )(
      "with focus on $start inside the panel, one $direction press exits to $expected (counted from codeBtn)",
      async ({ start, direction, expected }) => {
        await setChunkSize(2);
        const panel = buildCodeFixture(placement);
        focusStart(start);

        await press(direction);

        // Counted from the trigger at index 2 of O' with c = 2: forward to
        // index 4 (a4), backward to index 0 (a1).
        expect(activeLabel()).toBe(expected);
        expect(panel.contains(document.activeElement)).toBe(false);
      },
    );
  });

  describe("focus-trap fixture (Requirement 2.5)", () => {
    it("fixture check: once focus is inside the panel, the trap pulls outside focus back", () => {
      const panel = buildCodeFixture("portal");
      const trap = installFocusTrap(panel);
      try {
        // Simulate a mouse click placing focus in the panel, then leaving it.
        byId("copyBtn").focus();
        byId("a5").focus();

        expect(activeLabel()).toBe("copyBtn");
        expect(trap.entered).toEqual(["copyBtn", "copyBtn"]);
        expect(trap.pulledBack).toBe(1);
      } finally {
        trap.remove();
      }
    });

    it("from every outside start, no sequence of activations moves focus into the panel", async () => {
      // Exhaustive over both placements, c in {1, 5} (5 is the default), every
      // outside start (none, the trigger, and each page link), and every
      // Forward/Backward sequence of three presses.
      const sequences = allSequences(3);
      const violations: string[] = [];
      let runs = 0;

      for (const placement of PLACEMENTS) {
        for (const chunkSize of [1, 5]) {
          await setChunkSize(chunkSize);
          for (const start of ["none", ...CODE_PAGE_ORDER]) {
            for (const directions of sequences) {
              const panel = buildCodeFixture(placement);
              focusStart(start);
              const trap = installFocusTrap(panel);
              try {
                const landed = await pressAll(directions);
                runs += 1;
                if (
                  trap.entered.length > 0 ||
                  trap.pulledBack > 0 ||
                  panel.contains(document.activeElement)
                ) {
                  violations.push(
                    `${placement} c=${chunkSize} start=${start} [${directions.join(", ")}]: ` +
                      `landed [${landed.join(", ")}], entered [${trap.entered.join(", ")}], ` +
                      `pulled back ${trap.pulledBack}x`,
                  );
                }
              } finally {
                trap.remove();
              }
            }
          }
        }
      }

      expect(runs).toBe(PLACEMENTS.length * 2 * (1 + CODE_PAGE_ORDER.length) * sequences.length);
      expect(violations).toEqual([]);
    }, 30_000);
  });

  describe("mixed page: portal menu, [popover], and disclosure panel (Requirements 3.6, 3.7)", () => {
    it("Forward with c=1 visits every page element and disclosure link, skipping the menu and popover", async () => {
      await setChunkSize(1);
      setBody(MIXED_HTML);
      focusStart("none");

      const landed = await pressAll(Array<Direction>(MIXED_ORDER.length + 1).fill("forward"));

      // One press per O' element, then a clamped press on the last one.
      expect(landed).toEqual([...MIXED_ORDER, "p5"]);
    });

    it("Backward with c=1 visits the same elements in reverse", async () => {
      await setChunkSize(1);
      setBody(MIXED_HTML);
      focusStart("none");

      const landed = await pressAll(Array<Direction>(MIXED_ORDER.length + 1).fill("backward"));

      // No focus + Backward starts at the last O' element; the extra press
      // clamps on the first one.
      expect(landed).toEqual([...[...MIXED_ORDER].reverse(), "p1"]);
    });

    it("chunk moves with c=3 count disclosure links but not menu or popover items", async () => {
      await setChunkSize(3);
      setBody(MIXED_HTML);
      focusStart("none");

      const landed = await pressAll([
        "forward",
        "forward",
        "forward",
        "forward",
        "backward",
        "backward",
        "backward",
        "backward",
      ]);

      // Over MIXED_ORDER (n = 11): forward from no focus to index 2, then 5,
      // 8, 10 (clamped); backward 7, 4, 1, 0 (clamped).
      expect(landed).toEqual(["p2", "discBtn", "d3", "p5", "d2", "p3", "menuBtn", "p1"]);
    });

    it.each([
      // Inside the popover: counted from popBtn (index 3).
      { start: "pop1", direction: "forward" as const, expected: "p3" },
      { start: "pop2", direction: "backward" as const, expected: "p2" },
      // Inside the portal menu: counted from menuBtn (index 1).
      { start: "m2", direction: "forward" as const, expected: "p2" },
      { start: "m3", direction: "backward" as const, expected: "p1" },
      // Inside the disclosure panel: an ordinary page position (index 7).
      { start: "d2", direction: "forward" as const, expected: "d3" },
      { start: "d2", direction: "backward" as const, expected: "d1" },
    ])(
      "with focus on $start, one $direction press with c=1 lands on $expected",
      async ({ start, direction, expected }) => {
        await setChunkSize(1);
        setBody(MIXED_HTML);
        focusStart(start);

        await press(direction);

        expect(activeLabel()).toBe(expected);
      },
    );
  });
});
