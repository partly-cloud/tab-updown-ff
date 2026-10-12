/**
 * Preservation property tests for the expanded-popup focus-trap fix.
 *
 * Feature: expanded-popup-focus-trap-fix, Property 2: Preservation
 * (No Popup_Region means identical order and target).
 *
 * Observation-first: these tests are written and run against the UNFIXED
 * content script, where they pass, to record the baseline the fix must keep.
 * They are re-run unchanged after the fix (tasks.md 3.9).
 *
 * Inputs are drawn from the non-bug condition (¬isBugCondition, design.md):
 *
 *   - Region-free documents: descriptor arrays as in Property 6 of the
 *     tab-updown spec, with no region signals at all.
 *   - Look-alike structures that must NOT become Popup_Regions: disclosure
 *     panels (`aria-expanded` + `aria-controls` to a plain `div`), tab/tabpanel
 *     pairs, a standalone `role=listbox`, and `role=dialog` wrapping main
 *     content.
 *   - Popup_Regions whose contents are not in the Focus_Order O (a closed
 *     `aria-haspopup` menu, a closed `[popover]`, a closed `<dialog>`, and an
 *     empty or hidden Primer portal), with focus outside them.
 *
 * For each input, the element focused by the content script's `handleNavigate`
 * must equal the reference F: `buildFocusOrder` + `indexOfCurrentFocus` +
 * `computeTargetIndex` over the same document. The Chunk_Size read and its
 * fallback to 5 for absent/invalid stored values (3.9) are checked as well.
 *
 * jsdom performs no layout, so visible elements get stubbed `offsetWidth`/
 * `offsetHeight`/`getClientRects()`, mirroring `tests/focus-order.dom.test.ts`.
 * Elements inside a hidden container are left unstubbed (zero-size), as a real
 * browser would report them.
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

const NUM_RUNS = 100;
/** Jest timeout for the async property tests (each run awaits real navigation). */
const PROPERTY_TIMEOUT_MS = 30_000;
/** Default_Chunk_Size required by Requirement 3.9 for absent/invalid values. */
const FALLBACK_CHUNK_SIZE = 5;
/** Marker on closed Popup_Region roots so the generator's ¬C premise can be checked. */
const CLOSED_REGION_ATTR = "data-test-closed-region";

// ---------------------------------------------------------------------------
// Layout stubs
// ---------------------------------------------------------------------------

/** Give an element non-zero layout dimensions so `isVisible` sees it as laid out. */
function layOut(element: HTMLElement): void {
  Object.defineProperty(element, "offsetWidth", { configurable: true, value: 10 });
  Object.defineProperty(element, "offsetHeight", { configurable: true, value: 10 });
  Object.defineProperty(element, "getClientRects", {
    configurable: true,
    value: () => [{ width: 10, height: 10, top: 0, left: 0, right: 10, bottom: 10 }],
  });
}

// ---------------------------------------------------------------------------
// Document model
// ---------------------------------------------------------------------------

type ElementKind = "button" | "link" | "input" | "div";
type HideMode = "display" | "visibility" | "size";
type DisableMode = "disabled" | "inert";

/**
 * One generated element, extending the tab-updown Property 6 descriptor with a
 * few more tag kinds (`<a href>`, `<input>`).
 */
interface ElementDescriptor {
  kind: ElementKind;
  tabindex: number | undefined;
  visible: boolean;
  enabled: boolean;
  hideMode: HideMode;
  disableMode: DisableMode;
}

type PanelRole = "none" | "region" | "group";
type ClosedVariant = "menu" | "popover" | "dialog";

type Segment =
  | { kind: "plain"; element: ElementDescriptor }
  /** `<button aria-expanded aria-controls>` + a plain panel `div` (not a region). */
  | {
      kind: "disclosure";
      expanded: boolean;
      panelRole: PanelRole;
      children: ElementDescriptor[];
    }
  /** `role=tablist` of `role=tab` buttons with `aria-controls` to `role=tabpanel`s (not regions). */
  | {
      kind: "tabs";
      panels: ElementDescriptor[][];
      selected: number;
      roving: boolean;
      panelTabbable: boolean;
    }
  /** A standalone, always-visible `role=listbox` with no trigger (not a region). */
  | {
      kind: "listbox";
      options: number;
      tabbable: boolean;
      optionTabindex: 0 | -1 | undefined;
    }
  /** Main content wrapped in an unlinked `role=dialog` (not a region). */
  | { kind: "dialogMain"; children: ElementDescriptor[] }
  /** A real Popup_Region that is closed: its contents are not in O. */
  | { kind: "closedPopup"; variant: ClosedVariant; children: ElementDescriptor[] };

/** Optional Primer portal root at the end of `<body>`: absent, empty, or with hidden overlays. */
type PortalShape =
  | { kind: "none" }
  | { kind: "empty" }
  | { kind: "hidden"; overlays: ElementDescriptor[][] };

interface DocumentSpec {
  segments: Segment[];
  portal: PortalShape;
}

interface BuiltDocument {
  /** Elements a navigation may start from. Never inside a (closed) Popup_Region. */
  focusCandidates: HTMLElement[];
}

/** Build a jsdom element from a descriptor. `laidOut` is false inside hidden containers. */
function makeElement(
  descriptor: ElementDescriptor,
  id: string,
  laidOut: boolean,
): HTMLElement {
  let element: HTMLElement;
  switch (descriptor.kind) {
    case "link": {
      const anchor = document.createElement("a");
      anchor.href = "#";
      element = anchor;
      break;
    }
    case "button":
      element = document.createElement("button");
      break;
    case "input":
      element = document.createElement("input");
      break;
    case "div":
      element = document.createElement("div");
      break;
  }
  element.id = id;
  if (descriptor.kind !== "input") {
    element.textContent = id;
  }

  if (descriptor.tabindex !== undefined) {
    element.setAttribute("tabindex", String(descriptor.tabindex));
  }

  if (!descriptor.enabled) {
    if (
      descriptor.disableMode === "disabled" &&
      (descriptor.kind === "button" || descriptor.kind === "input")
    ) {
      (element as HTMLButtonElement | HTMLInputElement).disabled = true;
    } else {
      element.setAttribute("inert", "");
    }
  }

  if (!descriptor.visible) {
    switch (descriptor.hideMode) {
      case "display":
        element.style.display = "none";
        break;
      case "visibility":
        element.style.visibility = "hidden";
        break;
      case "size":
        // jsdom default: zero layout dimensions.
        break;
    }
  } else if (laidOut) {
    layOut(element);
  }
  return element;
}

/** Replace `<body>` with the document described by `spec`. */
function buildDocument(spec: DocumentSpec): BuiltDocument {
  (document.activeElement as HTMLElement | null)?.blur();
  document.body.innerHTML = "";

  const body = document.body;
  const focusCandidates: HTMLElement[] = [];
  let seq = 0;
  const nextId = (prefix: string): string => `${prefix}-${seq++}`;

  const addDescriptor = (
    descriptor: ElementDescriptor,
    parent: HTMLElement,
    laidOut: boolean,
    candidate: boolean,
  ): void => {
    const element = makeElement(descriptor, nextId(descriptor.kind), laidOut);
    parent.appendChild(element);
    if (candidate) {
      focusCandidates.push(element);
    }
  };

  const addControl = (
    tag: "button" | "div",
    idPrefix: string,
    parent: HTMLElement,
  ): HTMLElement => {
    const element = document.createElement(tag);
    element.id = nextId(idPrefix);
    element.textContent = element.id;
    parent.appendChild(element);
    return element;
  };

  for (const segment of spec.segments) {
    switch (segment.kind) {
      case "plain":
        addDescriptor(segment.element, body, true, true);
        break;

      case "disclosure": {
        const panelId = nextId("disclosure-panel");
        const trigger = addControl("button", "disclosure-trigger", body);
        trigger.setAttribute("aria-expanded", String(segment.expanded));
        trigger.setAttribute("aria-controls", panelId);
        layOut(trigger);
        focusCandidates.push(trigger);

        const panel = document.createElement("div");
        panel.id = panelId;
        if (segment.panelRole !== "none") {
          panel.setAttribute("role", segment.panelRole);
        }
        if (!segment.expanded) {
          panel.style.display = "none";
        }
        body.appendChild(panel);
        for (const child of segment.children) {
          addDescriptor(child, panel, segment.expanded, true);
        }
        break;
      }

      case "tabs": {
        const tablist = document.createElement("div");
        tablist.setAttribute("role", "tablist");
        body.appendChild(tablist);
        const selected = segment.selected % segment.panels.length;
        const panelIds = segment.panels.map(() => nextId("tabpanel"));

        panelIds.forEach((panelId, k) => {
          const tab = addControl("button", "tab", tablist);
          tab.setAttribute("role", "tab");
          tab.setAttribute("aria-selected", String(k === selected));
          tab.setAttribute("aria-controls", panelId);
          if (segment.roving && k !== selected) {
            tab.setAttribute("tabindex", "-1");
          }
          layOut(tab);
          focusCandidates.push(tab);
        });

        segment.panels.forEach((children, k) => {
          const shown = k === selected;
          const panel = document.createElement("div");
          panel.id = panelIds[k];
          panel.setAttribute("role", "tabpanel");
          if (!shown) {
            panel.style.display = "none";
          }
          if (segment.panelTabbable) {
            panel.setAttribute("tabindex", "0");
            if (shown) {
              layOut(panel);
            }
            focusCandidates.push(panel);
          }
          body.appendChild(panel);
          for (const child of children) {
            addDescriptor(child, panel, shown, true);
          }
        });
        break;
      }

      case "listbox": {
        const listbox = addControl("div", "listbox", body);
        listbox.textContent = "";
        listbox.setAttribute("role", "listbox");
        listbox.setAttribute("aria-label", "Choices");
        if (segment.tabbable) {
          listbox.setAttribute("tabindex", "0");
        }
        layOut(listbox);
        focusCandidates.push(listbox);
        for (let k = 0; k < segment.options; k++) {
          const option = addControl("div", "option", listbox);
          option.setAttribute("role", "option");
          if (segment.optionTabindex !== undefined) {
            option.setAttribute("tabindex", String(segment.optionTabindex));
          }
          layOut(option);
          focusCandidates.push(option);
        }
        break;
      }

      case "dialogMain": {
        const main = document.createElement("div");
        main.id = nextId("main-dialog");
        main.setAttribute("role", "dialog");
        main.setAttribute("aria-label", "Main content");
        body.appendChild(main);
        for (const child of segment.children) {
          addDescriptor(child, main, true, true);
        }
        break;
      }

      case "closedPopup": {
        const rootId = nextId(`closed-${segment.variant}`);
        const trigger = addControl("button", `${segment.variant}-trigger`, body);
        layOut(trigger);
        focusCandidates.push(trigger);

        let root: HTMLElement;
        switch (segment.variant) {
          case "menu":
            trigger.setAttribute("aria-haspopup", "menu");
            trigger.setAttribute("aria-expanded", "false");
            trigger.setAttribute("aria-controls", rootId);
            root = document.createElement("div");
            root.setAttribute("role", "menu");
            break;
          case "popover":
            trigger.setAttribute("popovertarget", rootId);
            root = document.createElement("div");
            root.setAttribute("popover", "auto");
            break;
          case "dialog":
            trigger.setAttribute("aria-haspopup", "dialog");
            trigger.setAttribute("aria-controls", rootId);
            root = document.createElement("dialog");
            break;
        }
        root.id = rootId;
        root.setAttribute(CLOSED_REGION_ATTR, "");
        root.style.display = "none";
        body.appendChild(root);
        // Closed: contents are never laid out and never a focus start (¬C).
        for (const child of segment.children) {
          addDescriptor(child, root, false, false);
        }
        break;
      }
    }
  }

  if (spec.portal.kind !== "none") {
    const portalRoot = document.createElement("div");
    portalRoot.id = "__primerPortalRoot__";
    body.appendChild(portalRoot);
    if (spec.portal.kind === "hidden") {
      for (const overlay of spec.portal.overlays) {
        const container = document.createElement("div");
        container.id = nextId("portal-overlay");
        container.setAttribute(CLOSED_REGION_ATTR, "");
        container.style.display = "none";
        portalRoot.appendChild(container);
        for (const child of overlay) {
          addDescriptor(child, container, false, false);
        }
      }
    }
  }

  return { focusCandidates };
}

/** Focus the picked candidate, or leave focus on `<body>` when `pick` is none. */
function focusStart(built: BuiltDocument, pick: number | undefined): void {
  if (pick === undefined || built.focusCandidates.length === 0) {
    return;
  }
  built.focusCandidates[pick % built.focusCandidates.length].focus();
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Biased toward `true` so generated Focus_Orders are usually non-trivial. */
const mostlyTrue = fc.oneof(
  { weight: 3, arbitrary: fc.constant(true) },
  { weight: 1, arbitrary: fc.constant(false) },
);

const descriptorArb: fc.Arbitrary<ElementDescriptor> = fc.record({
  kind: fc.constantFrom<ElementKind>("button", "link", "input", "div"),
  tabindex: fc.option(fc.integer({ min: -3, max: 5 }), { nil: undefined }),
  visible: mostlyTrue,
  enabled: mostlyTrue,
  hideMode: fc.constantFrom<HideMode>("display", "visibility", "size"),
  disableMode: fc.constantFrom<DisableMode>("disabled", "inert"),
});

const childrenArb = fc.array(descriptorArb, { maxLength: 4 });

const plainSegmentArb: fc.Arbitrary<Segment> = descriptorArb.map(
  (element): Segment => ({ kind: "plain", element }),
);

const lookAlikeArbs: Array<fc.Arbitrary<Segment>> = [
  fc.record({
    kind: fc.constant("disclosure" as const),
    expanded: fc.boolean(),
    panelRole: fc.constantFrom<PanelRole>("none", "region", "group"),
    children: childrenArb,
  }),
  fc.record({
    kind: fc.constant("tabs" as const),
    panels: fc.array(fc.array(descriptorArb, { maxLength: 3 }), {
      minLength: 1,
      maxLength: 3,
    }),
    selected: fc.nat(),
    roving: fc.boolean(),
    panelTabbable: fc.boolean(),
  }),
  fc.record({
    kind: fc.constant("listbox" as const),
    options: fc.integer({ min: 0, max: 4 }),
    tabbable: fc.boolean(),
    optionTabindex: fc.constantFrom<0 | -1 | undefined>(undefined, -1, 0),
  }),
  fc.record({
    kind: fc.constant("dialogMain" as const),
    children: childrenArb,
  }),
];

/** A segment that is either a plain element or one of the look-alike structures. */
const lookAlikeSegmentArb: fc.Arbitrary<Segment> = fc.oneof(
  { weight: 4, arbitrary: plainSegmentArb },
  ...lookAlikeArbs.map((arbitrary) => ({ weight: 1, arbitrary })),
);

const closedPopupArb: fc.Arbitrary<Segment> = fc.record({
  kind: fc.constant("closedPopup" as const),
  variant: fc.constantFrom<ClosedVariant>("menu", "popover", "dialog"),
  children: fc.array(descriptorArb, { minLength: 1, maxLength: 4 }),
});

const portalArb: fc.Arbitrary<PortalShape> = fc.oneof(
  fc.constant<PortalShape>({ kind: "none" }),
  fc.constant<PortalShape>({ kind: "empty" }),
  fc
    .array(fc.array(descriptorArb, { minLength: 1, maxLength: 3 }), {
      minLength: 1,
      maxLength: 2,
    })
    .map((overlays): PortalShape => ({ kind: "hidden", overlays })),
);

/** Region-free descriptor arrays (tab-updown Property 6 shape). */
const regionFreeDocArb: fc.Arbitrary<DocumentSpec> = fc
  .array(descriptorArb, { maxLength: 25 })
  .map((elements) => ({
    segments: elements.map((element): Segment => ({ kind: "plain", element })),
    portal: { kind: "none" },
  }));

/** Documents built from plain elements and look-alike structures only. */
const lookAlikeDocArb: fc.Arbitrary<DocumentSpec> = fc
  .array(lookAlikeSegmentArb, { minLength: 1, maxLength: 8 })
  .map((segments) => ({ segments, portal: { kind: "none" } }));

/** Documents with at least one closed Popup_Region whose contents are not in O. */
const closedRegionDocArb: fc.Arbitrary<DocumentSpec> = fc
  .record({
    before: fc.array(lookAlikeSegmentArb, { maxLength: 4 }),
    closed: closedPopupArb,
    after: fc.array(fc.oneof(lookAlikeSegmentArb, closedPopupArb), { maxLength: 4 }),
    portal: portalArb,
  })
  .map(({ before, closed, after, portal }) => ({
    segments: [...before, closed, ...after],
    portal,
  }));

const directionArb = fc.constantFrom<Direction>("forward", "backward");
/** Chunk_Size in [1, 100], biased toward small values so moves don't always clamp. */
const chunkSizeArb = fc.oneof(
  fc.integer({ min: CHUNK_SIZE_MIN, max: 10 }),
  fc.integer({ min: CHUNK_SIZE_MIN, max: CHUNK_SIZE_MAX }),
);
/** Index into the focus candidates, or `undefined` for "no focus". */
const focusPickArb = fc.option(fc.nat(), { nil: undefined });

type StoredChunk = { present: false } | { present: true; value: unknown };

/** Stored Chunk_Size values: absent, valid, or invalid in several ways. */
const storedChunkArb: fc.Arbitrary<StoredChunk> = fc.oneof(
  fc.constant<StoredChunk>({ present: false }),
  fc
    .integer({ min: CHUNK_SIZE_MIN, max: CHUNK_SIZE_MAX })
    .map((value): StoredChunk => ({ present: true, value })),
  fc
    .oneof(
      fc.integer({ max: CHUNK_SIZE_MIN - 1 }),
      fc.integer({ min: CHUNK_SIZE_MAX + 1 }),
      fc.double({ noInteger: true }),
      fc.integer({ min: CHUNK_SIZE_MIN, max: CHUNK_SIZE_MAX }).map(String),
      fc.string({ maxLength: 4 }),
      fc.constantFrom<unknown>(null, undefined, true, false, {}, [], [5]),
    )
    .map((value): StoredChunk => ({ present: true, value })),
);

/** Independent oracle for the effective Chunk_Size (Requirement 3.9). */
function expectedChunkSize(stored: StoredChunk): number {
  if (
    stored.present &&
    typeof stored.value === "number" &&
    Number.isInteger(stored.value) &&
    stored.value >= CHUNK_SIZE_MIN &&
    stored.value <= CHUNK_SIZE_MAX
  ) {
    return stored.value;
  }
  return FALLBACK_CHUNK_SIZE;
}

// ---------------------------------------------------------------------------
// Harness: one content-script instance with mocked storage and a focus recorder
// ---------------------------------------------------------------------------

let browser: MockBrowser;
let restoreBrowser: () => void = () => {};
let content: typeof import("../src/content.js");
let originalFocus: HTMLElement["focus"];
/** Value the mocked `storage.local.get` returns for the Chunk_Size key. */
let stored: StoredChunk = { present: false };
/** Elements `focus()` was called on, in call order. */
const focusCalls: HTMLElement[] = [];

beforeAll(async () => {
  const installed = installMockBrowser();
  browser = installed.browser;
  restoreBrowser = installed.restore;
  browser.storage.local.get.mockImplementation(async () =>
    stored.present ? { chunkSize: stored.value } : {},
  );

  await jest.isolateModulesAsync(async () => {
    content = await import("../src/content.js");
  });

  originalFocus = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = function recordFocus(
    this: HTMLElement,
    options?: FocusOptions,
  ): void {
    focusCalls.push(this);
    originalFocus.call(this, options);
  };
});

afterAll(() => {
  HTMLElement.prototype.focus = originalFocus;
  restoreBrowser();
  document.body.innerHTML = "";
});

/**
 * Reference F: the unchanged `buildFocusOrder` + `indexOfCurrentFocus` +
 * `computeTargetIndex` composition over the current document. Returns the
 * element F would focus, or `null` for the no-op case.
 */
function referenceTarget(direction: Direction, chunkSize: number): HTMLElement | null {
  const order = buildFocusOrder(document);
  const current = indexOfCurrentFocus(order, document.activeElement);
  const index = computeTargetIndex(direction, current, chunkSize, order.length);
  return index === NO_TARGET ? null : order[index];
}

/**
 * Run the real `handleNavigate` and assert it focuses exactly the reference
 * target, or leaves focus unchanged when the reference is a no-op.
 */
async function expectNavigationMatchesReference(
  direction: Direction,
  effectiveChunkSize: number,
): Promise<void> {
  const before = document.activeElement;
  const expected = referenceTarget(direction, effectiveChunkSize);

  focusCalls.length = 0;
  await content.handleNavigate(direction);

  if (expected === null) {
    expect(focusCalls.map((element) => element.id)).toEqual([]);
    expect(document.activeElement).toBe(before);
  } else {
    expect(focusCalls.map((element) => element.id)).toEqual([expected.id]);
    expect(focusCalls[0]).toBe(expected);
    expect(document.activeElement).toBe(expected);
  }
}

/** Resolve pending storage promises and the fire-and-forget handler. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// ---------------------------------------------------------------------------
// Property 2: Preservation
// ---------------------------------------------------------------------------

describe("Feature: expanded-popup-focus-trap-fix, Property 2: Preservation", () => {
  // Feature: expanded-popup-focus-trap-fix, Property 2: Preservation
  // **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.8**
  it(
    "region-free documents: handleNavigate focuses the same target as F",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          regionFreeDocArb,
          focusPickArb,
          directionArb,
          chunkSizeArb,
          async (spec, pick, direction, c) => {
            const built = buildDocument(spec);
            focusStart(built, pick);
            stored = { present: true, value: c };
            await expectNavigationMatchesReference(direction, c);
          },
        ),
        { numRuns: NUM_RUNS },
      );
    },
    PROPERTY_TIMEOUT_MS,
  );

  // Feature: expanded-popup-focus-trap-fix, Property 2: Preservation
  // **Validates: Requirements 3.1, 3.2, 3.3, 3.5, 3.7, 3.8**
  it(
    "look-alike structures (disclosure, tabs, standalone listbox, role=dialog main): handleNavigate focuses the same target as F",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          lookAlikeDocArb,
          focusPickArb,
          directionArb,
          chunkSizeArb,
          async (spec, pick, direction, c) => {
            const built = buildDocument(spec);
            focusStart(built, pick);
            stored = { present: true, value: c };
            await expectNavigationMatchesReference(direction, c);
          },
        ),
        { numRuns: NUM_RUNS },
      );
    },
    PROPERTY_TIMEOUT_MS,
  );

  // Feature: expanded-popup-focus-trap-fix, Property 2: Preservation
  // **Validates: Requirements 3.1, 3.2, 3.3, 3.5, 3.7**
  it(
    "closed Popup_Regions whose contents are not in O, focus outside: handleNavigate focuses the same target as F",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          closedRegionDocArb,
          focusPickArb,
          directionArb,
          chunkSizeArb,
          async (spec, pick, direction, c) => {
            const built = buildDocument(spec);
            // ¬C premise: no element of O is inside a closed region.
            const order = buildFocusOrder(document);
            expect(
              order.filter((element) => element.closest(`[${CLOSED_REGION_ATTR}]`) !== null),
            ).toEqual([]);

            focusStart(built, pick);
            stored = { present: true, value: c };
            await expectNavigationMatchesReference(direction, c);
          },
        ),
        { numRuns: NUM_RUNS },
      );
    },
    PROPERTY_TIMEOUT_MS,
  );

  // Feature: expanded-popup-focus-trap-fix, Property 2: Preservation
  // **Validates: Requirements 3.1, 3.2, 3.3, 3.5, 3.7, 3.8**
  it(
    "the order handleNavigate walks with Chunk_Size 1 is exactly buildFocusOrder, in both directions",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.oneof(lookAlikeDocArb, closedRegionDocArb),
          async (spec) => {
            buildDocument(spec);
            stored = { present: true, value: 1 };
            const ids = buildFocusOrder(document).map((element) => element.id);
            const n = ids.length;

            const visited: string[] = [];
            const press = async (direction: Direction): Promise<void> => {
              await content.handleNavigate(direction);
              visited.push(document.activeElement?.id ?? "");
            };

            // From no focus: n forward presses, one clamped press, then back.
            for (let k = 0; k < n; k++) await press("forward");
            await press("forward");
            for (let k = 0; k < n - 1; k++) await press("backward");
            await press("backward");

            const expected =
              n === 0
                ? ["", ""] // empty order: both presses are no-ops on <body>
                : [...ids, ids[n - 1], ...ids.slice(0, n - 1).reverse(), ids[0]];
            expect(visited).toEqual(expected);
          },
        ),
        { numRuns: NUM_RUNS },
      );
    },
    PROPERTY_TIMEOUT_MS,
  );

  // Feature: expanded-popup-focus-trap-fix, Property 2: Preservation
  // **Validates: Requirements 3.9**
  it(
    "reads Chunk_Size on every navigation and falls back to 5 for absent or invalid stored values",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          lookAlikeDocArb,
          focusPickArb,
          directionArb,
          storedChunkArb,
          async (spec, pick, direction, storedValue) => {
            const built = buildDocument(spec);
            focusStart(built, pick);
            stored = storedValue;
            browser.storage.local.get.mockClear();

            await expectNavigationMatchesReference(direction, expectedChunkSize(storedValue));

            expect(browser.storage.local.get).toHaveBeenCalledTimes(1);
            expect(browser.storage.local.get).toHaveBeenCalledWith("chunkSize");
          },
        ),
        { numRuns: NUM_RUNS },
      );
    },
    PROPERTY_TIMEOUT_MS,
  );
});

// ---------------------------------------------------------------------------
// Concrete baseline observations (unit examples)
// ---------------------------------------------------------------------------

describe("Feature: expanded-popup-focus-trap-fix, Property 2: Preservation (observed baseline)", () => {
  /** Twelve laid-out buttons b0..b11. */
  function buildButtons(): void {
    (document.activeElement as HTMLElement | null)?.blur();
    document.body.innerHTML = Array.from(
      { length: 12 },
      (_, k) => `<button id="b${k}">${k}</button>`,
    ).join("");
    for (const button of Array.from(document.querySelectorAll("button"))) {
      layOut(button);
    }
  }

  const fallbackCases: Array<{ name: string; value: StoredChunk; chunk: number }> = [
    { name: "absent", value: { present: false }, chunk: FALLBACK_CHUNK_SIZE },
    { name: "0 (below range)", value: { present: true, value: 0 }, chunk: FALLBACK_CHUNK_SIZE },
    { name: "101 (above range)", value: { present: true, value: 101 }, chunk: FALLBACK_CHUNK_SIZE },
    { name: "3.5 (non-integer)", value: { present: true, value: 3.5 }, chunk: FALLBACK_CHUNK_SIZE },
    { name: "NaN", value: { present: true, value: Number.NaN }, chunk: FALLBACK_CHUNK_SIZE },
    { name: 'the string "7"', value: { present: true, value: "7" }, chunk: FALLBACK_CHUNK_SIZE },
    { name: "null", value: { present: true, value: null }, chunk: FALLBACK_CHUNK_SIZE },
    { name: "3 (valid control)", value: { present: true, value: 3 }, chunk: 3 },
  ];

  // **Validates: Requirements 3.9**
  it.each(fallbackCases)(
    "stored Chunk_Size $name moves by $chunk through runtime.onMessage",
    async ({ value, chunk }) => {
      buildButtons();
      stored = value;

      (document.getElementById("b0") as HTMLButtonElement).focus();
      browser.runtime.onMessage.dispatch({ type: "navigate", direction: "forward" }, {}, () => {});
      await flush();
      expect(document.activeElement?.id).toBe(`b${chunk}`);

      (document.getElementById("b11") as HTMLButtonElement).focus();
      browser.runtime.onMessage.dispatch({ type: "navigate", direction: "backward" }, {}, () => {});
      await flush();
      expect(document.activeElement?.id).toBe(`b${11 - chunk}`);
    },
  );

  // **Validates: Requirements 3.1, 3.2, 3.3, 3.5, 3.7, 3.8**
  it("records the Focus_Order and chunk targets on a representative look-alike page", async () => {
    (document.activeElement as HTMLElement | null)?.blur();
    document.body.innerHTML = `
      <a id="skip" href="#">Skip</a>
      <button id="disc" aria-expanded="true" aria-controls="disc-panel">Details</button>
      <div id="disc-panel"><a id="disc-link" href="#">More</a></div>
      <div role="tablist">
        <button id="tab-1" role="tab" aria-selected="true" aria-controls="tp-1">One</button>
        <button id="tab-2" role="tab" aria-selected="false" aria-controls="tp-2" tabindex="-1">Two</button>
      </div>
      <div id="tp-1" role="tabpanel"><button id="tp-1-btn">In panel</button></div>
      <div id="tp-2" role="tabpanel" style="display: none"><button id="tp-2-btn">Hidden</button></div>
      <button id="menu-btn" aria-haspopup="menu" aria-expanded="false" aria-controls="menu">Menu</button>
      <div id="menu" role="menu" style="display: none"><button id="menu-item" role="menuitem">Item</button></div>
      <div id="lb" role="listbox" tabindex="0" aria-label="Choices"><div role="option">A</div></div>
      <div role="dialog" aria-label="Main content">
        <input id="main-input" />
        <button id="main-btn">Go</button>
      </div>
      <a id="footer" href="#">Footer</a>
    `;
    // Everything outside a hidden container is laid out.
    for (const id of [
      "skip", "disc", "disc-link", "tab-1", "tab-2", "tp-1-btn",
      "menu-btn", "lb", "main-input", "main-btn", "footer",
    ]) {
      layOut(document.getElementById(id) as HTMLElement);
    }
    stored = { present: false }; // default Chunk_Size 5

    // Observed Focus_Order: look-alike members and the closed menu's trigger
    // are in it; the roving tab, hidden tab panel, and closed menu are not.
    expect(buildFocusOrder(document).map((element) => element.id)).toEqual([
      "skip", "disc", "disc-link", "tab-1", "tp-1-btn",
      "menu-btn", "lb", "main-input", "main-btn", "footer",
    ]);

    const observed: Array<{ from: string | null; direction: Direction; to: string }> = [
      { from: null, direction: "forward", to: "tp-1-btn" }, // min(5-1, 9) = 4
      { from: null, direction: "backward", to: "footer" }, // n-1 = 9
      { from: "disc", direction: "forward", to: "lb" }, // 1+5 = 6
      { from: "footer", direction: "backward", to: "tp-1-btn" }, // 9-5 = 4
      { from: "main-btn", direction: "forward", to: "footer" }, // min(8+5, 9) = 9
      { from: "disc-link", direction: "backward", to: "skip" }, // max(2-5, 0) = 0
      { from: "menu-btn", direction: "forward", to: "footer" }, // min(5+5, 9) = 9
      { from: "menu-btn", direction: "backward", to: "skip" }, // max(5-5, 0) = 0
      { from: "tp-2-btn", direction: "forward", to: "tp-1-btn" }, // not in O: acts as no focus
    ];
    for (const { from, direction, to } of observed) {
      (document.activeElement as HTMLElement | null)?.blur();
      if (from !== null) {
        (document.getElementById(from) as HTMLElement).focus();
      }
      await expectNavigationMatchesReference(direction, FALLBACK_CHUNK_SIZE);
      expect(document.activeElement?.id).toBe(to);
    }
  });
});
