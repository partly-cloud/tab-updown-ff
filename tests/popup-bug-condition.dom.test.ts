/**
 * Bug condition exploration test for GitHub issue #18 ("Focus trapped inside
 * expanded select/popup controls").
 *
 * Feature: expanded-popup-focus-trap-fix, Property 1: Bug Condition
 * Navigation never lands inside a Popup_Region.
 *
 * **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 2.5**
 *
 * This file encodes the EXPECTED behavior (bugfix.md 2.1-2.5, design.md
 * Property 1). It is written before the fix and is expected to FAIL on the
 * unfixed code: every failure is a counterexample showing the bug exists. After
 * the fix (tasks.md 3.8) the same file must pass unchanged.
 *
 * Fixture: a jsdom model of GitHub's "Code" button. The page body holds
 * `[a1, a2, codeBtn, a3, a4, a5, a6]`, where `codeBtn` is linked to the panel,
 * and the Popup_Region `#code-panel` holds
 * `[tabHttps, tabSsh, copyBtn, openDesktop, downloadZip]`. Variants change how
 * the region is rooted (Primer portal, `[popover]`, `<dialog open>`, an
 * `opacity:0` overlay wrapper) and where it sits (end of `<body>` or right after
 * the trigger).
 *
 * Navigation is driven through the content script's real `runtime.onMessage`
 * listener with a mocked `storage.local` (tests/mock-browser.ts), so the
 * unchanged `handleNavigate` pipeline in src/content.ts is what's under test.
 *
 * The expected region-free order O' is computed here, without depending on the
 * not-yet-written src/lib/popup.ts: the fixture knows its own Popup_Region, so
 * O' is `buildFocusOrder(document)` with every `#code-panel` descendant removed.
 * The start position follows design.md Property 4: focus inside the panel counts
 * from the trigger (`codeBtn`); otherwise it's the focused element's index in O'
 * (or "none"). The expected target is `computeTargetIndex(direction, s, c, |O'|)`.
 *
 * jsdom notes (checked against the jsdom bundled with jest-environment-jsdom):
 *   - No layout, so `offsetWidth`/`offsetHeight`/`getClientRects()` are stubbed
 *     as in tests/focus-order.dom.test.ts.
 *   - No Popover API (`showPopover` and the `popover` IDL attribute are
 *     undefined), and the UA stylesheet doesn't hide `[popover]`. A `[popover]`
 *     element therefore renders like an open popover; `popovertarget` stays a
 *     plain attribute.
 *   - `<dialog>` has no `show()`/`showModal()`, so the `open` attribute is used.
 *   - `focusin` fires on `focus()`, and a re-entrant `focus()` from a `focusin`
 *     handler works, so a page-side focus trap can be simulated.
 */

import fc from "fast-check";

import { CHUNK_SIZE_MAX, CHUNK_SIZE_MIN } from "../src/lib/constants.js";
import {
  buildFocusOrder,
  computeTargetIndex,
  indexOfCurrentFocus,
  NO_TARGET,
  type Direction,
} from "../src/lib/focus.js";
import { installMockBrowser, type MockBrowser } from "./mock-browser.js";

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const TRIGGER_ID = "codeBtn";
const PANEL_ID = "code-panel";
const LINKS_BEFORE: readonly string[] = ["a1", "a2"];
const LINKS_AFTER: readonly string[] = ["a3", "a4", "a5", "a6"];

/** Page elements in Native_Tab_Sequence order: `[a1, a2, codeBtn, a3, a4, a5, a6]`. */
const PAGE_IDS: readonly string[] = [...LINKS_BEFORE, TRIGGER_ID, ...LINKS_AFTER];

/** Focusable elements inside the Popup_Region, in document order. */
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

/** Primer-style trigger: `aria-haspopup` + `aria-expanded` + `aria-controls`. */
const PRIMER_TRIGGER_ATTRS = `aria-haspopup="true" aria-expanded="true" aria-controls="${PANEL_ID}"`;

type Variant =
  | "primer-portal"
  | "primer-portal-opacity0"
  | "popover-tail"
  | "popover-inline"
  | "dialog-tail"
  | "dialog-inline";

interface VariantSpec {
  /** Attributes on `codeBtn` that link it to the panel. */
  triggerAttrs: string;
  /** Markup for the Popup_Region, with the panel items inside `#code-panel`. */
  regionHtml: string;
  /**
   * `"tail"`: the region is the last child of `<body>` (portal-style).
   * `"inline"`: the region sits right after the trigger in the DOM.
   */
  placement: "tail" | "inline";
}

const VARIANTS: Record<Variant, VariantSpec> = {
  // GitHub's real shape: Primer renders the overlay into a portal root that is
  // the last child of <body>.
  "primer-portal": {
    triggerAttrs: PRIMER_TRIGGER_ATTRS,
    regionHtml: `<div id="__primerPortalRoot__"><div id="${PANEL_ID}" role="dialog" aria-label="Code">${PANEL_ITEMS_HTML}</div></div>`,
    placement: "tail",
  },
  // Same, with the overlay under an opacity:0 wrapper (hypothesis 5).
  "primer-portal-opacity0": {
    triggerAttrs: PRIMER_TRIGGER_ATTRS,
    regionHtml: `<div id="__primerPortalRoot__"><div id="overlay-wrapper" style="opacity: 0"><div id="${PANEL_ID}" role="dialog" aria-label="Code">${PANEL_ITEMS_HTML}</div></div></div>`,
    placement: "tail",
  },
  "popover-tail": {
    triggerAttrs: `popovertarget="${PANEL_ID}"`,
    regionHtml: `<div id="${PANEL_ID}" popover>${PANEL_ITEMS_HTML}</div>`,
    placement: "tail",
  },
  "popover-inline": {
    triggerAttrs: `popovertarget="${PANEL_ID}"`,
    regionHtml: `<div id="${PANEL_ID}" popover>${PANEL_ITEMS_HTML}</div>`,
    placement: "inline",
  },
  "dialog-tail": {
    triggerAttrs: `aria-haspopup="dialog" aria-expanded="true" aria-controls="${PANEL_ID}"`,
    regionHtml: `<dialog id="${PANEL_ID}" open>${PANEL_ITEMS_HTML}</dialog>`,
    placement: "tail",
  },
  "dialog-inline": {
    triggerAttrs: `aria-haspopup="dialog" aria-expanded="true" aria-controls="${PANEL_ID}"`,
    regionHtml: `<dialog id="${PANEL_ID}" open>${PANEL_ITEMS_HTML}</dialog>`,
    placement: "inline",
  },
};

const VARIANT_NAMES = Object.keys(VARIANTS) as Variant[];

interface Fixture {
  /** The Popup_Trigger (`codeBtn`). */
  trigger: HTMLElement;
  /** The Popup_Region root (`#code-panel`). */
  panel: HTMLElement;
}

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

/** Replace `<body>` with the given variant of the "Code" fixture. */
function buildFixture(variant: Variant): Fixture {
  // Drop focus left over from a previous run before replacing the DOM.
  (document.activeElement as HTMLElement | null)?.blur();

  const { triggerAttrs, regionHtml, placement } = VARIANTS[variant];
  const triggerHtml = `<button id="${TRIGGER_ID}" type="button" ${triggerAttrs}>Code</button>`;
  document.body.innerHTML =
    placement === "inline"
      ? `${linksHtml(LINKS_BEFORE)}${triggerHtml}${regionHtml}${linksHtml(LINKS_AFTER)}`
      : `${linksHtml(LINKS_BEFORE)}${triggerHtml}${linksHtml(LINKS_AFTER)}${regionHtml}`;

  for (const id of [...PAGE_IDS, ...PANEL_ITEM_IDS]) {
    makeLaidOut(byId(id));
  }
  return { trigger: byId(TRIGGER_ID), panel: byId(PANEL_ID) };
}

/** A start focus: `"none"` (nothing focused) or the id of an element to focus. */
type StartFocus = string;

function applyStartFocus(start: StartFocus): void {
  if (start === "none") {
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);
    return;
  }
  byId(start).focus();
  expect(document.activeElement?.id).toBe(start);
}

/** Short, readable name for an element in assertion output. */
function label(element: Element | null): string {
  if (element === null) {
    return "null";
  }
  if (element === document.body) {
    return "body";
  }
  return element.id || element.tagName.toLowerCase();
}

/** Where focus is now, and whether it's inside the Popup_Region. */
function focusSnapshot(panel: HTMLElement): { active: string; insidePanel: boolean } {
  return {
    active: label(document.activeElement),
    insidePanel: panel.contains(document.activeElement),
  };
}

// ---------------------------------------------------------------------------
// Bug condition and expected behavior (design.md "Bug Condition", Property 1)
// ---------------------------------------------------------------------------

/**
 * isBugCondition from design.md, evaluated against the current (unfixed)
 * Focus_Order. The fixture always has exactly one Popup_Region (`#code-panel`).
 */
function isBugCondition(panel: HTMLElement, direction: Direction, chunkSize: number): boolean {
  const regions = [panel];
  const inRegion = (element: Element | null): boolean =>
    regions.some((region) => region.contains(element));

  const order = buildFocusOrder(document);
  const active = document.activeElement;
  const i = indexOfCurrentFocus(order, active);
  const t = computeTargetIndex(direction, i, chunkSize, order.length);

  const focusInside = inRegion(active);
  const targetInside = t >= 0 && inRegion(order[t]);
  const countsRegion = order.some((element) => inRegion(element));
  return focusInside || targetInside || countsRegion;
}

/**
 * The expected target: `computeTargetIndex(direction, s, c, |O'|)` over the
 * region-free order O', where s is the trigger's index in O' when focus is
 * inside the panel, and the focused element's index in O' (or none) otherwise.
 */
function expectedTarget(
  fixture: Fixture,
  direction: Direction,
  chunkSize: number,
): HTMLElement | null {
  const active = document.activeElement;
  const orderPrime = buildFocusOrder(document).filter(
    (element) => !fixture.panel.contains(element),
  );
  const start = fixture.panel.contains(active)
    ? orderPrime.indexOf(fixture.trigger)
    : indexOfCurrentFocus(orderPrime, active);
  const index = computeTargetIndex(direction, start, chunkSize, orderPrime.length);
  return index === NO_TARGET ? null : orderPrime[index];
}

// ---------------------------------------------------------------------------
// Page-side focus trap (hypothesis 4)
// ---------------------------------------------------------------------------

/**
 * Simulate a Primer-style focus trap: once focus has entered the panel, any
 * `focusin` outside it is pulled back to the last focused panel element.
 * Returns a function that removes the trap.
 */
function installFocusTrap(panel: HTMLElement): () => void {
  let lastInside: HTMLElement | null = null;
  const onFocusIn = (event: FocusEvent): void => {
    const target = event.target;
    if (target instanceof HTMLElement && panel.contains(target)) {
      lastInside = target;
      return;
    }
    if (lastInside !== null) {
      lastInside.focus();
    }
  };
  document.addEventListener("focusin", onFocusIn);
  return () => document.removeEventListener("focusin", onFocusIn);
}

interface TraceStep {
  step: number;
  direction: Direction;
  /** The element Tab-Updown called `focus()` on, or null if it didn't. */
  requested: string | null;
  /** Where focus ended up after the activation (and any trap). */
  active: string;
  insidePanel: boolean;
}

/** Expected-behavior violations in a trapped run: entering the panel, or being pulled back. */
function trapViolations(trace: readonly TraceStep[]): {
  enteredPanel: TraceStep[];
  pulledBack: TraceStep[];
} {
  return {
    enteredPanel: trace.filter((step) => step.insidePanel),
    pulledBack: trace.filter(
      (step) => step.requested !== null && step.requested !== step.active,
    ),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Feature: expanded-popup-focus-trap-fix, Property 1: Bug Condition", () => {
  let browser: MockBrowser;
  let restore: () => void = () => {};

  /**
   * Send a navigate message through the registered `runtime.onMessage`
   * listener, then let the fire-and-forget `handleNavigate` settle (it awaits
   * `storage.local.get`).
   */
  async function navigate(direction: Direction): Promise<void> {
    browser.runtime.onMessage.dispatch({ type: "navigate", direction }, {}, () => {});
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  /**
   * Run a sequence of activations with a focus trap on the panel and record,
   * per step, what Tab-Updown asked to focus and where focus ended up.
   */
  async function runWithFocusTrap(
    panel: HTMLElement,
    directions: readonly Direction[],
  ): Promise<TraceStep[]> {
    const removeTrap = installFocusTrap(panel);
    const focusSpy = jest.spyOn(HTMLElement.prototype, "focus");
    try {
      const trace: TraceStep[] = [];
      for (let index = 0; index < directions.length; index += 1) {
        const direction = directions[index];
        focusSpy.mockClear();
        await navigate(direction);
        // The first focus() call is Tab-Updown's; a trap's refocus comes after
        // it, re-entrantly from the focusin handler.
        const requested = focusSpy.mock.contexts[0] as Element | undefined;
        trace.push({
          step: index + 1,
          direction,
          requested: requested === undefined ? null : label(requested),
          active: label(document.activeElement),
          insidePanel: panel.contains(document.activeElement),
        });
      }
      return trace;
    } finally {
      focusSpy.mockRestore();
      removeTrap();
    }
  }

  beforeAll(async () => {
    ({ browser, restore } = installMockBrowser({ storage: { chunkSize: 5 } }));
    // The content script registers its listener at module load, so import it
    // after the mock `browser` global is in place.
    await jest.isolateModulesAsync(async () => {
      await import("../src/content.js");
    });
    expect(browser.runtime.onMessage.listeners).toHaveLength(1);
  });

  afterAll(() => {
    restore();
  });

  afterEach(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    document.body.innerHTML = "";
  });

  describe("observations on the unfixed Focus_Order (hypotheses 1, 2, 5)", () => {
    // These record facts about the unchanged `buildFocusOrder`, which the fix
    // keeps as is. They hold before and after the fix.

    it("hypotheses 1 and 2: buildFocusOrder counts the portal panel, and places it after all page content", () => {
      buildFixture("primer-portal");
      const ids = buildFocusOrder(document).map((element) => element.id);
      expect(ids).toEqual([...PAGE_IDS, ...PANEL_ITEM_IDS]);
    });

    it("hypothesis 5: an opacity:0 overlay wrapper doesn't hide the panel from buildFocusOrder", () => {
      const fixture = buildFixture("primer-portal-opacity0");
      expect(window.getComputedStyle(byId("overlay-wrapper")).opacity).toBe("0");
      // `isVisible` reads the element's own opacity, which doesn't inherit, so
      // every panel item is still counted. The fix must exclude them by region
      // membership, not by visibility.
      const counted = buildFocusOrder(document)
        .filter((element) => fixture.panel.contains(element))
        .map((element) => element.id);
      expect(counted).toEqual(PANEL_ITEM_IDS);
    });
  });

  describe.each(VARIANT_NAMES)('GitHub "Code" fixture, %s variant (c = 5)', (variant) => {
    beforeEach(async () => {
      await browser.storage.local.set({ chunkSize: 5 });
    });

    // Requirements 1.1, 2.2
    it("Forward from codeBtn skips the panel and lands on a6", async () => {
      const fixture = buildFixture(variant);
      applyStartFocus(TRIGGER_ID);

      await navigate("forward");

      expect(focusSnapshot(fixture.panel)).toEqual({ active: "a6", insidePanel: false });
    });

    // Requirements 1.2, 2.3
    it("Backward with no focus lands on a6, the last element outside the panel", async () => {
      const fixture = buildFixture(variant);
      applyStartFocus("none");

      await navigate("backward");

      expect(focusSnapshot(fixture.panel)).toEqual({ active: "a6", insidePanel: false });
    });

    // Requirements 1.3, 2.4, 2.5
    it("Forward x3 from copyBtn (inside the panel) exits to a6 and stays outside", async () => {
      buildFixture(variant);
      applyStartFocus("copyBtn");

      const landed: string[] = [];
      for (let press = 0; press < 3; press += 1) {
        await navigate("forward");
        landed.push(label(document.activeElement));
      }

      expect(landed).toEqual(["a6", "a6", "a6"]);
    });

    // Requirements 1.3, 2.4
    it("Backward from copyBtn (inside the panel) counts from codeBtn and lands on a1", async () => {
      const fixture = buildFixture(variant);
      applyStartFocus("copyBtn");

      await navigate("backward");

      expect(focusSnapshot(fixture.panel)).toEqual({ active: "a1", insidePanel: false });
    });
  });

  describe("focus-trap simulation (hypothesis 4)", () => {
    // Requirement 2.5
    it("starting on codeBtn, Forward/Backward presses never enter the trapped panel", async () => {
      await browser.storage.local.set({ chunkSize: 5 });
      const fixture = buildFixture("primer-portal");
      applyStartFocus(TRIGGER_ID);

      const trace = await runWithFocusTrap(fixture.panel, [
        "forward",
        "backward",
        "backward",
        "forward",
      ]);

      expect(trapViolations(trace)).toEqual({ enteredPanel: [], pulledBack: [] });
    });

    // Feature: expanded-popup-focus-trap-fix, Property 1: Bug Condition
    // **Validates: Requirements 2.5**
    it("property: from any outside start, no activation sequence moves focus into the trapped panel", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(...VARIANT_NAMES),
          fc.constantFrom<StartFocus>("none", ...PAGE_IDS),
          fc.integer({ min: CHUNK_SIZE_MIN, max: CHUNK_SIZE_MAX }),
          fc.array(fc.constantFrom<Direction>("forward", "backward"), {
            minLength: 1,
            maxLength: 5,
          }),
          async (variant, start, chunkSize, directions) => {
            const fixture = buildFixture(variant);
            applyStartFocus(start);
            // Every activation here satisfies C(X): the panel's items are in
            // the unfixed Focus_Order (countsRegion).
            fc.pre(isBugCondition(fixture.panel, directions[0], chunkSize));
            await browser.storage.local.set({ chunkSize });

            const trace = await runWithFocusTrap(fixture.panel, directions);

            expect(trapViolations(trace)).toEqual({ enteredPanel: [], pulledBack: [] });
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // Feature: expanded-popup-focus-trap-fix, Property 1: Bug Condition
  // **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 2.5**
  it("property: for every C(X), focus never lands inside the panel and equals computeTargetIndex over O'", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...VARIANT_NAMES),
        fc.constantFrom<Direction>("forward", "backward"),
        fc.integer({ min: CHUNK_SIZE_MIN, max: CHUNK_SIZE_MAX }),
        // Start focus: none, the trigger or another page element, or an
        // element inside the panel.
        fc.constantFrom<StartFocus>("none", ...PAGE_IDS, ...PANEL_ITEM_IDS),
        async (variant, direction, chunkSize, start) => {
          const fixture = buildFixture(variant);
          applyStartFocus(start);
          fc.pre(isBugCondition(fixture.panel, direction, chunkSize));
          const expected = expectedTarget(fixture, direction, chunkSize);
          await browser.storage.local.set({ chunkSize });

          await navigate(direction);

          expect(focusSnapshot(fixture.panel)).toEqual({
            active: label(expected),
            insidePanel: false,
          });
        },
      ),
      { numRuns: 100 },
    );
  });
});
