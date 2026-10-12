/**
 * DOM property tests for the expanded-popup focus-trap fix (GitHub issue #18).
 *
 * Feature: expanded-popup-focus-trap-fix, Property 1: Bug Condition
 * Feature: expanded-popup-focus-trap-fix, Property 5: Outside-focus navigation
 *
 * Both properties run the fixed content script (`handleNavigate` in
 * src/content.ts, with the Chunk_Size read from a mocked `storage.local`) over
 * generated documents: descriptor arrays (as in tab-updown Property 6) plus 1–3
 * Popup_Regions. Each region has a random root kind (trigger-linked via
 * `aria-controls`/`aria-owns`, `[popover]`, `<dialog open>`, or a Primer portal
 * child), a trigger that is in the Focus_Order, present but not in it, or absent,
 * an inline or portal placement, and 0–4 member descriptors.
 *
 * Oracle: the generator records which elements it put inside each region, so
 * the expected region-free order O' is `buildFocusOrder(document)` (unchanged,
 * covered by tab-updown Property 6) minus those recorded members. The expected
 * start position follows design.md Property 4 from the same knowledge: focus
 * outside counts from its own index in O'; focus inside counts from the
 * region's trigger when it is in O', else from the last O' element preceding
 * the region root in tree order, else `before-first`. `collectPopupRegions` is
 * only used for a premise cross-check that detection agrees with the model.
 *
 * jsdom performs no layout, so laid-out elements get stubbed `offsetWidth`/
 * `offsetHeight`/`getClientRects()`, mirroring tests/focus-order.dom.test.ts.
 * jsdom has no Popover API and no UA rule hiding `[popover]`, so a `[popover]`
 * renders like an open popover; `<dialog>` uses the `open` attribute.
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
import {
  collectPopupRegions,
  excludePopupRegions,
  regionContaining,
  resolveNavigationTarget,
  type StartPosition,
} from "../src/lib/popup.js";
import { installMockBrowser, type MockBrowser } from "./mock-browser.js";

const NUM_RUNS = 200;
/** Jest timeout for the async property tests (each run awaits real navigation). */
const PROPERTY_TIMEOUT_MS = 60_000;

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

/** One generated element (tab-updown Property 6 descriptor, plus `<a>`/`<input>`). */
interface ElementDescriptor {
  kind: ElementKind;
  tabindex: number | undefined;
  visible: boolean;
  enabled: boolean;
  hideMode: HideMode;
  disableMode: DisableMode;
}

/** How a Popup_Region root is recognised (design.md "Region detection"). */
type RegionKind = "linked" | "popover" | "dialog" | "portalChild";

/** Attributes that link a trigger to its region root. */
type LinkVia =
  /** `aria-haspopup` + `aria-expanded` + `aria-controls`. */
  | "haspopup-controls"
  /** `aria-expanded` + `aria-controls`; the root must be a popup container. */
  | "expanded-controls"
  /** `aria-haspopup` + `aria-owns`. */
  | "haspopup-owns"
  | "popovertarget"
  | "commandfor";

type NotInOrderHow = "tabindex-1" | "display-none" | "zero-size" | "disabled";

/** The region's trigger: in the Focus_Order, present but not in it, or absent. */
type TriggerSpec =
  | { mode: "inOrder"; tabindex: number | undefined }
  | { mode: "notInOrder"; how: NotInOrderHow }
  | { mode: "none" };

interface RegionSpec {
  kind: RegionKind;
  via: LinkVia;
  /** `role` on the root, or null for none. */
  role: string | null;
  /** `"portal"`: a child of the overlay container at the end of `<body>`. */
  placement: "inline" | "portal";
  trigger: TriggerSpec;
  members: ElementDescriptor[];
  /** Insertion slot of the trigger among the `<body>` children. */
  triggerSlot: number;
  /** Insertion slot of an inline root among the `<body>` children. */
  rootSlot: number;
}

interface DocumentSpec {
  page: ElementDescriptor[];
  regions: RegionSpec[];
  /** Which overlay container portal-placed roots go into. */
  portalContainer: "primer" | "data-portal-root";
}

/** What the generator knows about one region it built. */
interface BuiltRegion {
  root: HTMLElement;
  trigger: HTMLElement | null;
  /** The root and every element the generator put inside it. */
  members: ReadonlySet<Element>;
}

interface BuiltDocument {
  regions: BuiltRegion[];
  /** Page elements and triggers: focus candidates outside every region. */
  outside: HTMLElement[];
  /** Region members: focus candidates inside a region. */
  inside: HTMLElement[];
}

/** The generator's own membership oracle: the region that holds `element`, if any. */
function modelRegionOf(
  built: BuiltDocument,
  element: Element | null,
): BuiltRegion | undefined {
  if (element === null) {
    return undefined;
  }
  return built.regions.find((region) => region.members.has(element));
}

function isModelMember(built: BuiltDocument, element: Element | null): boolean {
  return modelRegionOf(built, element) !== undefined;
}

/** Build a jsdom element from a descriptor. */
function makeElement(descriptor: ElementDescriptor, id: string): HTMLElement {
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
  } else {
    layOut(element);
  }
  return element;
}

/** Build the region root element for a spec. */
function makeRoot(spec: RegionSpec, id: string): HTMLElement {
  let root: HTMLElement;
  switch (spec.kind) {
    case "linked":
    case "portalChild":
      root = document.createElement("div");
      break;
    case "popover":
      root = document.createElement("div");
      root.setAttribute("popover", "auto");
      break;
    case "dialog":
      root = document.createElement("dialog");
      root.setAttribute("open", "");
      break;
  }
  root.id = id;
  if (spec.role !== null) {
    root.setAttribute("role", spec.role);
  }
  return root;
}

/** Build a trigger button that is either in the Focus_Order or kept out of it. */
function makeTrigger(spec: Exclude<TriggerSpec, { mode: "none" }>, id: string): HTMLElement {
  const button = document.createElement("button");
  button.type = "button";
  button.id = id;
  button.textContent = id;
  if (spec.mode === "inOrder") {
    if (spec.tabindex !== undefined) {
      button.setAttribute("tabindex", String(spec.tabindex));
    }
    layOut(button);
    return button;
  }
  switch (spec.how) {
    case "tabindex-1":
      button.setAttribute("tabindex", "-1");
      layOut(button);
      break;
    case "display-none":
      button.style.display = "none";
      layOut(button);
      break;
    case "zero-size":
      // jsdom default: zero layout dimensions.
      break;
    case "disabled":
      button.disabled = true;
      layOut(button);
      break;
  }
  return button;
}

/** Add the attributes that link `trigger` to the root with id `rootId`. */
function linkTrigger(trigger: HTMLElement, via: LinkVia, rootId: string): void {
  switch (via) {
    case "haspopup-controls":
      trigger.setAttribute("aria-haspopup", "true");
      trigger.setAttribute("aria-expanded", "true");
      trigger.setAttribute("aria-controls", rootId);
      break;
    case "expanded-controls":
      trigger.setAttribute("aria-expanded", "true");
      trigger.setAttribute("aria-controls", rootId);
      break;
    case "haspopup-owns":
      trigger.setAttribute("aria-haspopup", "true");
      trigger.setAttribute("aria-owns", rootId);
      break;
    case "popovertarget":
      trigger.setAttribute("popovertarget", rootId);
      break;
    case "commandfor":
      trigger.setAttribute("commandfor", rootId);
      trigger.setAttribute("command", "show-modal");
      break;
  }
}

/** Replace `<body>` with the document described by `spec`, and return the model. */
function buildDocument(spec: DocumentSpec): BuiltDocument {
  (document.activeElement as HTMLElement | null)?.blur();
  document.body.innerHTML = "";

  let seq = 0;
  const nextId = (prefix: string): string => `${prefix}-${seq++}`;

  const bodyNodes: HTMLElement[] = spec.page.map((descriptor) =>
    makeElement(descriptor, nextId(descriptor.kind)),
  );
  const outside: HTMLElement[] = [...bodyNodes];
  const inside: HTMLElement[] = [];
  const regions: BuiltRegion[] = [];
  const portalRoots: HTMLElement[] = [];

  for (const regionSpec of spec.regions) {
    const rootId = nextId(`region-${regionSpec.kind}`);
    const root = makeRoot(regionSpec, rootId);
    const members = regionSpec.members.map((descriptor) => {
      const element = makeElement(descriptor, nextId(`${rootId}-${descriptor.kind}`));
      root.appendChild(element);
      return element;
    });
    inside.push(...members);

    let trigger: HTMLElement | null = null;
    if (regionSpec.trigger.mode !== "none") {
      trigger = makeTrigger(regionSpec.trigger, nextId(`trigger-${rootId}`));
      linkTrigger(trigger, regionSpec.via, rootId);
      bodyNodes.splice(regionSpec.triggerSlot % (bodyNodes.length + 1), 0, trigger);
      outside.push(trigger);
    }

    if (regionSpec.placement === "inline") {
      bodyNodes.splice(regionSpec.rootSlot % (bodyNodes.length + 1), 0, root);
    } else {
      portalRoots.push(root);
    }

    regions.push({ root, trigger, members: new Set<Element>([root, ...members]) });
  }

  for (const node of bodyNodes) {
    document.body.appendChild(node);
  }
  if (portalRoots.length > 0) {
    const container = document.createElement("div");
    if (spec.portalContainer === "primer") {
      container.id = "__primerPortalRoot__";
    } else {
      container.setAttribute("data-portal-root", "");
    }
    for (const root of portalRoots) {
      container.appendChild(root);
    }
    document.body.appendChild(container);
  }

  return { regions, outside, inside };
}

/** Where the navigation starts from. */
type ActivePick =
  | { where: "none" }
  | { where: "outside"; pick: number }
  | { where: "inside"; pick: number };

/**
 * Focus the first candidate, starting at `pick`, that actually takes focus in
 * jsdom (plain `<div>`s and disabled controls don't). Leaves focus on `<body>`
 * when none does.
 */
function focusFirstTaking(candidates: readonly HTMLElement[], pick: number): void {
  for (let k = 0; k < candidates.length; k += 1) {
    const candidate = candidates[(pick + k) % candidates.length];
    candidate.focus();
    if (document.activeElement === candidate) {
      return;
    }
  }
}

function applyActivePick(built: BuiltDocument, active: ActivePick): void {
  switch (active.where) {
    case "none":
      (document.activeElement as HTMLElement | null)?.blur();
      break;
    case "outside":
      focusFirstTaking(built.outside, active.pick);
      break;
    case "inside":
      focusFirstTaking(built.inside, active.pick);
      break;
  }
}

/** Short, readable name for an element in assertion output. */
function label(element: Element | null | undefined): string {
  if (element === null || element === undefined) {
    return "null";
  }
  if (element === document.body) {
    return "body";
  }
  return element.id || element.tagName.toLowerCase();
}

// ---------------------------------------------------------------------------
// Oracle (generator knowledge)
// ---------------------------------------------------------------------------

/** Expected O': the unchanged Focus_Order minus every element the generator put in a region. */
function modelOrderPrime(built: BuiltDocument): HTMLElement[] {
  return buildFocusOrder(document).filter((element) => !isModelMember(built, element));
}

/** True when `a` comes before `b` in tree order (preorder over the document). */
function precedesInTreeOrder(a: Element, b: Element): boolean {
  const treeOrder = Array.from(document.querySelectorAll("*"));
  return treeOrder.indexOf(a) < treeOrder.indexOf(b);
}

/** Expected start position (design.md Property 4), from the generator's model. */
function modelStart(
  built: BuiltDocument,
  orderPrime: readonly HTMLElement[],
  active: Element | null,
): StartPosition {
  const region = modelRegionOf(built, active);
  if (region === undefined) {
    const index = orderPrime.findIndex((element) => element === active);
    return index >= 0 ? { kind: "at", index } : { kind: "none" };
  }
  const triggerIndex =
    region.trigger === null ? -1 : orderPrime.indexOf(region.trigger);
  if (triggerIndex >= 0) {
    return { kind: "at", index: triggerIndex };
  }
  let preceding = -1;
  orderPrime.forEach((element, index) => {
    if (precedesInTreeOrder(element, region.root)) {
      preceding = index;
    }
  });
  return preceding >= 0 ? { kind: "at", index: preceding } : { kind: "before-first" };
}

/**
 * isBugCondition from design.md, evaluated against the unfixed pipeline F
 * (`buildFocusOrder` + `indexOfCurrentFocus` + `computeTargetIndex`) with the
 * generator's membership oracle.
 */
function isBugCondition(built: BuiltDocument, direction: Direction, chunkSize: number): boolean {
  const order = buildFocusOrder(document);
  const active = document.activeElement;
  const i = indexOfCurrentFocus(order, active);
  const t = computeTargetIndex(direction, i, chunkSize, order.length);

  const focusInside = isModelMember(built, active);
  const targetInside = t >= 0 && isModelMember(built, order[t]);
  const countsRegion = order.some((element) => isModelMember(built, element));
  return focusInside || targetInside || countsRegion;
}

/**
 * Premise cross-check: `collectPopupRegions` finds exactly the modelled roots
 * with the modelled triggers, and the O' that F' walks equals the model's O'.
 */
function expectDetectionMatchesModel(
  built: BuiltDocument,
  orderPrime: readonly HTMLElement[],
): void {
  const describeRegions = (
    regions: ReadonlyArray<{ root: Element; trigger: HTMLElement | null }>,
  ): Array<{ root: string; trigger: string | null }> =>
    regions
      .map((region) => ({
        root: label(region.root),
        trigger: region.trigger === null ? null : label(region.trigger),
      }))
      .sort((a, b) => a.root.localeCompare(b.root));

  const detected = collectPopupRegions(document);
  expect(describeRegions(detected)).toEqual(describeRegions(built.regions));

  const fixedOrder = excludePopupRegions(
    buildFocusOrder(document),
    (element) => regionContaining(detected, element) !== null,
  );
  expect(fixedOrder.map(label)).toEqual(orderPrime.map(label));
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

const inOrderTriggerArb: fc.Arbitrary<TriggerSpec> = fc.record({
  mode: fc.constant("inOrder" as const),
  // Mostly the normal group; sometimes a positive tabindex (ordered first).
  tabindex: fc.oneof(
    { weight: 3, arbitrary: fc.constant<number | undefined>(undefined) },
    { weight: 1, arbitrary: fc.integer({ min: 0, max: 3 }) },
  ),
});

const notInOrderTriggerArb: fc.Arbitrary<TriggerSpec> = fc.record({
  mode: fc.constant("notInOrder" as const),
  how: fc.constantFrom<NotInOrderHow>("tabindex-1", "display-none", "zero-size", "disabled"),
});

/** A trigger-linked root needs a trigger element; it may still be out of the Focus_Order. */
const requiredTriggerArb: fc.Arbitrary<TriggerSpec> = fc.oneof(
  { weight: 3, arbitrary: inOrderTriggerArb },
  { weight: 1, arbitrary: notInOrderTriggerArb },
);

/** `[popover]`, `<dialog>` and portal children are regions with or without a trigger. */
const optionalTriggerArb: fc.Arbitrary<TriggerSpec> = fc.oneof(
  { weight: 2, arbitrary: inOrderTriggerArb },
  { weight: 1, arbitrary: notInOrderTriggerArb },
  { weight: 1, arbitrary: fc.constant<TriggerSpec>({ mode: "none" }) },
);

const placementArb = fc.constantFrom<"inline" | "portal">("inline", "portal");
const membersArb = fc.array(descriptorArb, { maxLength: 4 });

const commonRegionFields = {
  members: membersArb,
  triggerSlot: fc.nat(),
  rootSlot: fc.nat(),
};

const regionArb: fc.Arbitrary<RegionSpec> = fc.oneof(
  // Trigger-linked: a popup-role container referenced by aria-controls/aria-owns.
  fc.record({
    kind: fc.constant<RegionKind>("linked"),
    via: fc.constantFrom<LinkVia>("haspopup-controls", "expanded-controls", "haspopup-owns"),
    role: fc.constantFrom<string | null>("dialog", "alertdialog", "menu", "listbox", "tree", "grid"),
    placement: placementArb,
    trigger: requiredTriggerArb,
    ...commonRegionFields,
  }),
  fc.record({
    kind: fc.constant<RegionKind>("popover"),
    via: fc.constantFrom<LinkVia>("popovertarget", "expanded-controls"),
    role: fc.constant<string | null>(null),
    placement: placementArb,
    trigger: optionalTriggerArb,
    ...commonRegionFields,
  }),
  fc.record({
    kind: fc.constant<RegionKind>("dialog"),
    via: fc.constantFrom<LinkVia>("commandfor", "haspopup-controls"),
    role: fc.constant<string | null>(null),
    placement: placementArb,
    trigger: optionalTriggerArb,
    ...commonRegionFields,
  }),
  // Primer portal child: always inside the overlay container.
  fc.record({
    kind: fc.constant<RegionKind>("portalChild"),
    via: fc.constantFrom<LinkVia>("haspopup-controls", "expanded-controls"),
    role: fc.constantFrom<string | null>(null, "dialog", "menu"),
    placement: fc.constant<"inline" | "portal">("portal"),
    trigger: optionalTriggerArb,
    ...commonRegionFields,
  }),
);

const documentArb: fc.Arbitrary<DocumentSpec> = fc.record({
  page: fc.array(descriptorArb, { maxLength: 15 }),
  regions: fc.array(regionArb, { minLength: 1, maxLength: 3 }),
  portalContainer: fc.constantFrom<"primer" | "data-portal-root">("primer", "data-portal-root"),
});

const activePickArb: fc.Arbitrary<ActivePick> = fc.oneof(
  { weight: 1, arbitrary: fc.constant<ActivePick>({ where: "none" }) },
  {
    weight: 2,
    arbitrary: fc.nat().map((pick): ActivePick => ({ where: "outside", pick })),
  },
  {
    weight: 2,
    arbitrary: fc.nat().map((pick): ActivePick => ({ where: "inside", pick })),
  },
);

const directionArb = fc.constantFrom<Direction>("forward", "backward");
/** Chunk_Size in [1, 100], biased toward small values so moves don't always clamp. */
const chunkSizeArb = fc.oneof(
  fc.integer({ min: CHUNK_SIZE_MIN, max: 10 }),
  fc.integer({ min: CHUNK_SIZE_MIN, max: CHUNK_SIZE_MAX }),
);

// ---------------------------------------------------------------------------
// Harness: one content-script instance with mocked storage and a focus spy
// ---------------------------------------------------------------------------

let browser: MockBrowser;
let restoreBrowser: () => void = () => {};
let content: typeof import("../src/content.js");
let focusSpy: jest.SpyInstance;

beforeAll(async () => {
  ({ browser, restore: restoreBrowser } = installMockBrowser());
  // The content script registers its listener at module load, so import it
  // after the mock `browser` global is in place.
  await jest.isolateModulesAsync(async () => {
    content = await import("../src/content.js");
  });
  focusSpy = jest.spyOn(HTMLElement.prototype, "focus");
});

afterAll(() => {
  focusSpy.mockRestore();
  restoreBrowser();
});

afterEach(() => {
  (document.activeElement as HTMLElement | null)?.blur();
  document.body.innerHTML = "";
});

/**
 * Run the real `handleNavigate` with the given Chunk_Size stored, and return
 * the elements it called `focus()` on.
 */
async function navigate(direction: Direction, chunkSize: number): Promise<string[]> {
  await browser.storage.local.set({ chunkSize });
  focusSpy.mockClear();
  await content.handleNavigate(direction);
  return focusSpy.mock.contexts.map((element) => label(element as Element));
}

/**
 * Assert the navigation focused exactly `expected` (outside every modelled
 * region), or left focus untouched when `expected` is null (empty O').
 */
function expectLanded(
  built: BuiltDocument,
  requested: readonly string[],
  expected: HTMLElement | null,
  before: Element | null,
): void {
  if (expected === null) {
    expect({ requested, active: label(document.activeElement) }).toEqual({
      requested: [],
      active: label(before),
    });
    return;
  }
  expect({
    requested,
    active: label(document.activeElement),
    activeInRegion: isModelMember(built, document.activeElement),
  }).toEqual({
    requested: [label(expected)],
    active: label(expected),
    activeInRegion: false,
  });
}

// ---------------------------------------------------------------------------
// Property 1: Bug Condition (fix checking)
// ---------------------------------------------------------------------------

describe("Feature: expanded-popup-focus-trap-fix, Property 1: Bug Condition", () => {
  // Feature: expanded-popup-focus-trap-fix, Property 1: Bug Condition - Navigation never lands inside a Popup_Region
  // **Validates: Requirements 2.1, 2.2, 2.3, 2.5**
  it(
    "for every C(X), F' focuses a target outside every region, equal to resolveNavigationTarget over O'",
    async () => {
      const seen = { none: 0, outside: 0, inside: 0 };

      await fc.assert(
        fc.asyncProperty(
          documentArb,
          activePickArb,
          directionArb,
          chunkSizeArb,
          async (spec, activePick, direction, chunkSize) => {
            const built = buildDocument(spec);
            applyActivePick(built, activePick);
            const before = document.activeElement;
            fc.pre(isBugCondition(built, direction, chunkSize));

            const orderPrime = modelOrderPrime(built);
            expectDetectionMatchesModel(built, orderPrime);

            const start = modelStart(built, orderPrime, before);
            const index = resolveNavigationTarget(
              direction,
              start,
              chunkSize,
              orderPrime.length,
            );
            const expected = index === NO_TARGET ? null : orderPrime[index];
            // Oracle sanity: O' never holds a region member.
            expect(isModelMember(built, expected)).toBe(false);

            const requested = await navigate(direction, chunkSize);

            expectLanded(built, requested, expected, before);

            if (before === document.body) seen.none += 1;
            else if (isModelMember(built, before)) seen.inside += 1;
            else seen.outside += 1;
          },
        ),
        { numRuns: NUM_RUNS },
      );

      // The generator reaches every start kind (none, outside, inside).
      expect(seen.none).toBeGreaterThan(0);
      expect(seen.outside).toBeGreaterThan(0);
      expect(seen.inside).toBeGreaterThan(0);
    },
    PROPERTY_TIMEOUT_MS,
  );
});

// ---------------------------------------------------------------------------
// Property 5: Outside-focus navigation
// ---------------------------------------------------------------------------

describe("Feature: expanded-popup-focus-trap-fix, Property 5: Outside-focus navigation", () => {
  // Feature: expanded-popup-focus-trap-fix, Property 5: Outside-focus navigation with regions present counts only region-free elements
  // **Validates: Requirements 3.6, 2.2**
  it(
    "with focus outside every region, F' focuses O'[computeTargetIndex(direction, indexOf(O', active), c, |O'|)]",
    async () => {
      let countedRegionRuns = 0;

      await fc.assert(
        fc.asyncProperty(
          documentArb,
          fc.nat(),
          directionArb,
          chunkSizeArb,
          async (spec, pick, direction, chunkSize) => {
            const built = buildDocument(spec);
            focusFirstTaking(built.outside, pick);
            const active = document.activeElement;
            // Premise: focus is outside every region (an outside element, or <body>).
            expect(isModelMember(built, active)).toBe(false);

            const orderPrime = modelOrderPrime(built);
            const index = computeTargetIndex(
              direction,
              orderPrime.findIndex((element) => element === active),
              chunkSize,
              orderPrime.length,
            );
            const expected = index === NO_TARGET ? null : orderPrime[index];

            const requested = await navigate(direction, chunkSize);

            expectLanded(built, requested, expected, active);

            if (buildFocusOrder(document).length !== orderPrime.length) {
              countedRegionRuns += 1;
            }
          },
        ),
        { numRuns: NUM_RUNS },
      );

      // Most runs have region members in O, so O' really differs from O.
      expect(countedRegionRuns).toBeGreaterThan(0);
    },
    PROPERTY_TIMEOUT_MS,
  );
});
