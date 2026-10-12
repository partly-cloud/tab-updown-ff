/**
 * Unit tests for Popup_Region detection and start resolution
 * (expanded-popup-focus-trap-fix, GitHub issue #18; Requirements 2.1, 2.4,
 * 3.7, 3.8).
 *
 * Example-based coverage of the DOM helpers in src/lib/popup.ts, one fixture
 * per rule from design.md "Region detection", "Membership" and "Start
 * mapping". The property-based coverage lives in src/lib/popup.test.ts
 * (Properties 3, 4) and tests/popup-properties.dom.test.ts (Properties 1, 5).
 *
 * - `collectPopupRegions`: each detection rule, and the look-alike structures
 *   that must not become regions (so O' = O on those pages);
 * - `regionContaining`: the innermost region wins, and a trigger inside an
 *   outer region is a member of it;
 * - `resolveStartPosition`: trigger mapping, the nested-trigger climb, the
 *   preceding-element and `before-first` fallbacks, and cyclic trigger links;
 * - `resolveNavigationTarget`: `before-first` in both directions and the
 *   empty-order no-op.
 *
 * jsdom performs no layout, so `render` stubs `offsetWidth`/`offsetHeight`/
 * `getClientRects()` on every element, as tests/focus-order.dom.test.ts does.
 * Elements marked `data-zero-size` keep jsdom's zero dimensions.
 */

import { buildFocusOrder, NO_TARGET, type Direction } from "../src/lib/focus.js";
import {
  collectPopupRegions,
  excludePopupRegions,
  regionContaining,
  resolveNavigationTarget,
  resolveStartPosition,
  type PopupRegion,
  type StartPosition,
} from "../src/lib/popup.js";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** Give an element non-zero layout dimensions so `isVisible` sees it as laid out. */
function layOut(element: Element): void {
  Object.defineProperty(element, "offsetWidth", { configurable: true, value: 10 });
  Object.defineProperty(element, "offsetHeight", { configurable: true, value: 10 });
  Object.defineProperty(element, "getClientRects", {
    configurable: true,
    value: () => [{ width: 10, height: 10, top: 0, left: 0, right: 10, bottom: 10 }],
  });
}

/** Replace `<body>` with `html` and lay out every element not marked `data-zero-size`. */
function render(html: string): void {
  document.body.innerHTML = html;
  for (const element of Array.from(document.body.querySelectorAll("*"))) {
    if (!element.hasAttribute("data-zero-size")) {
      layOut(element);
    }
  }
}

function byId(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`fixture has no #${id}`);
  }
  return element;
}

function ids(elements: readonly Element[]): string[] {
  return elements.map((element) => element.id);
}

/** Regions as `{ root, trigger }` ids, sorted by root id so assertions don't depend on discovery order. */
function describeRegions(
  regions: readonly PopupRegion[],
): Array<{ root: string; trigger: string | null }> {
  return regions
    .map((region) => ({
      root: region.root.id,
      trigger: region.trigger === null ? null : region.trigger.id,
    }))
    .sort((a, b) => (a.root < b.root ? -1 : a.root > b.root ? 1 : 0));
}

/** The filtered order O', exactly as `handleNavigate` builds it. */
function orderPrime(regions: readonly PopupRegion[]): HTMLElement[] {
  return excludePopupRegions(
    buildFocusOrder(document),
    (element) => regionContaining(regions, element) !== null,
  );
}

/** Detect regions, build O', and resolve the start position for `active`. */
function resolve(active: Element | null): { order: HTMLElement[]; start: StartPosition } {
  const regions = collectPopupRegions(document);
  const order = orderPrime(regions);
  return { order, start: resolveStartPosition(order, active, regions) };
}

/**
 * Assert the page has no Popup_Region, so O' is today's Focus_Order and every
 * start position is today's `indexOfCurrentFocus` (Requirement 3.8).
 */
function expectNoRegions(): void {
  const regions = collectPopupRegions(document);
  expect(describeRegions(regions)).toEqual([]);

  const order = buildFocusOrder(document);
  expect(order.length).toBeGreaterThan(0);
  const filtered = orderPrime(regions);
  expect(filtered).toEqual(order);
  order.forEach((element, index) => {
    expect(resolveStartPosition(filtered, element, regions)).toEqual({ kind: "at", index });
  });
}

afterEach(() => {
  document.body.innerHTML = "";
});

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

/** GitHub's "Code" button: a trigger-linked panel rendered into Primer's portal. */
const CODE_FIXTURE = `
  <a id="a1" href="#">a1</a>
  <a id="a2" href="#">a2</a>
  <button id="code-btn" aria-haspopup="true" aria-expanded="true" aria-controls="code-panel">Code</button>
  <a id="a3" href="#">a3</a>
  <div id="__primerPortalRoot__">
    <div id="code-panel" role="dialog" tabindex="-1">
      <button id="copy-btn">Copy</button>
      <button id="download">Download ZIP</button>
    </div>
  </div>
`;

/** A menu trigger inside a dialog, which is itself opened from the page. */
const NESTED_FIXTURE = `
  <a id="a1" href="#">a1</a>
  <button id="outer-trigger" commandfor="outer" command="show-modal">Settings</button>
  <dialog id="outer" open>
    <button id="inner-trigger" aria-haspopup="menu" aria-controls="menu">More</button>
  </dialog>
  <a id="a2" href="#">a2</a>
  <div id="__primerPortalRoot__">
    <div id="menu" role="menu"><button id="menu-item" role="menuitem">Item</button></div>
  </div>
`;

const POPUP_ROLES = ["dialog", "alertdialog", "menu", "listbox", "tree", "grid"];

// ---------------------------------------------------------------------------
// collectPopupRegions: positives
// ---------------------------------------------------------------------------

describe("collectPopupRegions: detection rules", () => {
  it.each(["true", "menu", "listbox", "dialog", " TRUE "])(
    'links an aria-haspopup="%s" trigger to its aria-controls root, even a plain element',
    (value) => {
      render(`
        <a id="a1" href="#">a1</a>
        <button id="trigger" aria-controls="panel">Open</button>
        <a id="a2" href="#">a2</a>
        <div id="panel"><button id="panel-btn">inside</button></div>
      `);
      byId("trigger").setAttribute("aria-haspopup", value);

      const regions = collectPopupRegions(document);

      expect(describeRegions(regions)).toEqual([{ root: "panel", trigger: "trigger" }]);
      // The trigger stays in O'; the region's members don't (Requirements 2.1, 3.7).
      expect(ids(orderPrime(regions))).toEqual(["a1", "trigger", "a2"]);
    },
  );

  it.each(POPUP_ROLES)(
    "links an aria-expanded trigger to an aria-controls root with role=%s",
    (role) => {
      render(`
        <button id="trigger" aria-expanded="false" aria-controls="popup">Open</button>
        <div id="popup"><button>inside</button></div>
      `);
      byId("popup").setAttribute("role", role);

      expect(describeRegions(collectPopupRegions(document))).toEqual([
        { root: "popup", trigger: "trigger" },
      ]);
    },
  );

  it("detects [popover] roots in any state, with the trigger from popovertarget, else aria-controls, else null", () => {
    render(`
      <div id="pop-a" popover>
        <button id="pop-a-close" popovertarget="pop-a" popovertargetaction="hide">Close</button>
      </div>
      <button id="pop-a-trigger" popovertarget="pop-a">Open A</button>
      <button id="pop-b-trigger" aria-controls="pop-b">Open B</button>
      <div id="pop-b" popover="manual"><button>inside</button></div>
      <div id="pop-c" popover><button popovertarget="pop-c">Close</button></div>
    `);

    expect(describeRegions(collectPopupRegions(document))).toEqual([
      // The close button inside the root comes first but is skipped.
      { root: "pop-a", trigger: "pop-a-trigger" },
      // No popovertarget: falls back to the aria-controls link.
      { root: "pop-b", trigger: "pop-b-trigger" },
      // Only an in-root popovertarget: no trigger.
      { root: "pop-c", trigger: null },
    ]);
  });

  it("reads popovertarget and commandfor as a single id, not an id list", () => {
    render(`
      <button popovertarget="pop dlg">Open</button>
      <button commandfor="dlg pop" command="show-modal">Open</button>
      <div id="pop" popover><button>inside</button></div>
      <dialog id="dlg"><button>inside</button></dialog>
    `);

    expect(describeRegions(collectPopupRegions(document))).toEqual([
      { root: "dlg", trigger: null },
      { root: "pop", trigger: null },
    ]);
  });

  it("detects <dialog> roots open or closed, with the trigger from commandfor or aria-controls, else null", () => {
    render(`
      <button id="open-trigger" commandfor="open-dialog" command="show-modal">Open</button>
      <dialog id="open-dialog" open>
        <button commandfor="open-dialog" command="close">Close</button>
      </dialog>
      <button id="closed-trigger" aria-controls="closed-dialog">Show</button>
      <dialog id="closed-dialog"><button>inside</button></dialog>
      <dialog id="orphan-dialog" open><button>inside</button></dialog>
    `);

    expect(describeRegions(collectPopupRegions(document))).toEqual([
      { root: "closed-dialog", trigger: "closed-trigger" },
      { root: "open-dialog", trigger: "open-trigger" },
      { root: "orphan-dialog", trigger: null },
    ]);
  });

  it.each([
    ["#__primerPortalRoot__", `<div id="__primerPortalRoot__">`],
    ["[data-portal-root]", `<div id="portal" data-portal-root>`],
  ])(
    "makes each child of a %s overlay container a root, without a trigger",
    (_selector, containerOpenTag) => {
      render(`
        <button id="page">page</button>
        ${containerOpenTag}
          <div id="overlay-1">
            <button>one</button>
            <div id="nested"><button>nested</button></div>
          </div>
          <div id="overlay-2"><button>two</button></div>
        </div>
      `);

      // Only direct children are roots; the container and grandchildren aren't.
      expect(describeRegions(collectPopupRegions(document))).toEqual([
        { root: "overlay-1", trigger: null },
        { root: "overlay-2", trigger: null },
      ]);
    },
  );

  it("pairs a Primer portal child with an aria-expanded trigger (the portal makes it a popup container)", () => {
    render(`
      <button id="code-btn" aria-expanded="true" aria-controls="code-panel">Code</button>
      <div id="__primerPortalRoot__"><div id="code-panel"><button>Copy</button></div></div>
    `);

    expect(describeRegions(collectPopupRegions(document))).toEqual([
      { root: "code-panel", trigger: "code-btn" },
    ]);
  });

  it("links every id in a whitespace-separated aria-owns list, skipping ids that don't resolve", () => {
    render(`
      <button id="trigger" aria-haspopup="listbox">Pick</button>
      <div id="lb-1" role="listbox"><button>one</button></div>
      <div id="lb-2"><button>two</button></div>
      <div id="lb-3" role="listbox"><button>not owned</button></div>
    `);
    byId("trigger").setAttribute("aria-owns", "  lb-1\n\tmissing   lb-2 ");

    expect(describeRegions(collectPopupRegions(document))).toEqual([
      { root: "lb-1", trigger: "trigger" },
      { root: "lb-2", trigger: "trigger" },
    ]);
  });

  it("de-duplicates roots: the first trigger wins and a later rule upgrades a null trigger", () => {
    render(`
      <button id="first" aria-haspopup="menu" aria-controls="menu">A</button>
      <button id="second" aria-haspopup="menu" aria-controls="menu">B</button>
      <div id="menu" role="menu"><button>item</button></div>
      <button id="cmd" commandfor="popover-dialog" command="show-modal">C</button>
      <dialog id="popover-dialog" popover><button>inside</button></dialog>
    `);

    // popover-dialog: the [popover] rule finds no trigger, the <dialog> rule
    // then finds the commandfor one.
    expect(describeRegions(collectPopupRegions(document))).toEqual([
      { root: "menu", trigger: "first" },
      { root: "popover-dialog", trigger: "cmd" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// collectPopupRegions: negatives
// ---------------------------------------------------------------------------

describe("collectPopupRegions: look-alikes that are not Popup_Regions", () => {
  it("ignores a disclosure panel (aria-expanded + aria-controls to a plain region)", () => {
    render(`
      <button id="toggle" aria-expanded="true" aria-controls="details">More</button>
      <div id="details" role="region"><a href="#">link</a><button>inside</button></div>
    `);
    expectNoRegions();
  });

  it("ignores tab/tabpanel pairs", () => {
    render(`
      <div role="tablist">
        <button role="tab" id="tab-1" aria-selected="true" aria-controls="panel-1">One</button>
        <button role="tab" id="tab-2" aria-selected="false" aria-controls="panel-2" tabindex="-1">Two</button>
      </div>
      <div role="tabpanel" id="panel-1"><button>inside 1</button></div>
      <div role="tabpanel" id="panel-2"><button>inside 2</button></div>
    `);
    expectNoRegions();
  });

  it.each(POPUP_ROLES)(
    "ignores an unlinked role=%s container outside an overlay container",
    (role) => {
      render(`<div id="main"><a href="#">link</a><button>button</button></div>`);
      byId("main").setAttribute("role", role);
      expectNoRegions();
    },
  );

  it.each([
    [
      "aria-haspopup + aria-controls",
      `<div id="self" role="listbox" tabindex="0" aria-haspopup="listbox" aria-controls="self"><button>x</button></div>`,
    ],
    [
      "aria-expanded + aria-owns",
      `<div id="self" role="menu" tabindex="0" aria-expanded="true" aria-owns="self"><button>x</button></div>`,
    ],
  ])("ignores a self-reference (T is R) via %s", (_via, html) => {
    render(html);
    expectNoRegions();
  });

  it("ignores a root that contains its own trigger (R contains T)", () => {
    render(`
      <button id="page">page</button>
      <div id="menu" role="menu">
        <button aria-haspopup="menu" aria-expanded="true" aria-controls="menu">toggle</button>
        <button>item</button>
      </div>
    `);
    expectNoRegions();
  });

  it.each(["false", "FALSE", " False ", "", "   "])(
    'ignores aria-haspopup="%s" (ARIA\'s false) linking a plain element',
    (value) => {
      render(`
        <button id="trigger" aria-controls="panel">Open</button>
        <div id="panel"><button>inside</button></div>
      `);
      byId("trigger").setAttribute("aria-haspopup", value);
      expectNoRegions();
    },
  );
});

// ---------------------------------------------------------------------------
// regionContaining
// ---------------------------------------------------------------------------

describe("regionContaining", () => {
  it("returns the innermost region containing an element, whatever the region order", () => {
    render(`
      <button id="page">page</button>
      <dialog id="outer" open>
        <button id="outer-btn">outer</button>
        <div id="inner" popover><button id="inner-btn">inner</button></div>
      </dialog>
    `);
    const regions = collectPopupRegions(document);
    expect(describeRegions(regions)).toEqual([
      { root: "inner", trigger: null },
      { root: "outer", trigger: null },
    ]);

    for (const list of [regions, [...regions].reverse()]) {
      expect(regionContaining(list, byId("inner-btn"))?.root.id).toBe("inner");
      // `contains` is inclusive: a root is a member of its own region.
      expect(regionContaining(list, byId("inner"))?.root.id).toBe("inner");
      expect(regionContaining(list, byId("outer-btn"))?.root.id).toBe("outer");
      expect(regionContaining(list, byId("page"))).toBeNull();
      expect(regionContaining(list, null)).toBeNull();
    }
  });

  it("treats a trigger inside an outer region as a member of that region, so O' drops it", () => {
    render(NESTED_FIXTURE);
    const regions = collectPopupRegions(document);
    expect(describeRegions(regions)).toEqual([
      { root: "menu", trigger: "inner-trigger" },
      { root: "outer", trigger: "outer-trigger" },
    ]);

    expect(regionContaining(regions, byId("inner-trigger"))?.root.id).toBe("outer");
    expect(ids(orderPrime(regions))).toEqual(["a1", "outer-trigger", "a2"]);
  });
});

// ---------------------------------------------------------------------------
// resolveStartPosition
// ---------------------------------------------------------------------------

describe("resolveStartPosition", () => {
  it("counts from the focused element when focus is outside every region, else none", () => {
    render(CODE_FIXTURE);

    expect(resolve(byId("a3")).start).toEqual({ kind: "at", index: 3 });
    expect(resolve(byId("code-btn")).start).toEqual({ kind: "at", index: 2 });
    expect(resolve(document.body).start).toEqual({ kind: "none" });
    expect(resolve(null).start).toEqual({ kind: "none" });
  });

  it("maps focus inside a region to its trigger's index in O'", () => {
    render(CODE_FIXTURE);
    const { order, start } = resolve(byId("copy-btn"));

    expect(ids(order)).toEqual(["a1", "a2", "code-btn", "a3"]);
    expect(start).toEqual({ kind: "at", index: 2 });
    for (const id of ["download", "code-panel"]) {
      expect(resolve(byId(id)).start).toEqual({ kind: "at", index: 2 });
    }
    // Counted from the trigger, a move exits the panel in either direction.
    expect(order[resolveNavigationTarget("forward", start, 5, order.length)].id).toBe("a3");
    expect(order[resolveNavigationTarget("backward", start, 5, order.length)].id).toBe("a1");
  });

  it("climbs nested triggers to the outermost trigger outside every region", () => {
    render(NESTED_FIXTURE);
    const { order, start } = resolve(byId("menu-item"));

    expect(ids(order)).toEqual(["a1", "outer-trigger", "a2"]);
    expect(start).toEqual({ kind: "at", index: 1 });
  });

  it("anchors on the outer region's root when the climb reaches a region without a trigger", () => {
    render(`
      <a id="a1" href="#">a1</a>
      <dialog id="outer" open>
        <button id="inner-trigger" aria-haspopup="menu" aria-controls="menu">More</button>
      </dialog>
      <a id="a2" href="#">a2</a>
      <a id="a3" href="#">a3</a>
      <div id="__primerPortalRoot__">
        <div id="menu" role="menu"><button id="menu-item">Item</button></div>
      </div>
    `);
    const { order, start } = resolve(byId("menu-item"));

    expect(ids(order)).toEqual(["a1", "a2", "a3"]);
    // a1 precedes the orphan dialog; a3 (the last element before the portal menu) isn't used.
    expect(start).toEqual({ kind: "at", index: 0 });
  });

  it.each([
    ["display:none", `style="display: none"`],
    ["tabindex=-1", `tabindex="-1"`],
    ["disabled", "disabled"],
    ["zero-size", "data-zero-size"],
  ])(
    "falls back to the last O' element before the root when the trigger is not in O' (%s)",
    (_how, triggerAttrs) => {
      render(`
        <a id="a1" href="#">a1</a>
        <a id="a2" href="#">a2</a>
        <button id="trigger" aria-haspopup="menu" aria-controls="menu" ${triggerAttrs}>More</button>
        <div id="menu" role="menu"><button id="menu-item">Item</button></div>
        <a id="a3" href="#">a3</a>
      `);
      const { order, start } = resolve(byId("menu-item"));

      expect(describeRegions(collectPopupRegions(document))).toEqual([
        { root: "menu", trigger: "trigger" },
      ]);
      expect(ids(order)).toEqual(["a1", "a2", "a3"]);
      expect(start).toEqual({ kind: "at", index: 1 });
    },
  );

  it("uses the largest O' index preceding the root, even when positive tabindex puts a later element first", () => {
    render(`
      <a id="a1" href="#">a1</a>
      <dialog id="orphan" open><button id="orphan-btn">inside</button></dialog>
      <a id="a2" href="#">a2</a>
      <button id="skip-link" tabindex="1">Skip</button>
    `);
    const { order, start } = resolve(byId("orphan-btn"));

    // skip-link is ordered first but follows the dialog in the document.
    expect(ids(order)).toEqual(["skip-link", "a1", "a2"]);
    expect(start).toEqual({ kind: "at", index: 1 });
  });

  it("returns before-first when no O' element precedes the region root", () => {
    render(`
      <dialog id="orphan" open><button id="orphan-btn">inside</button></dialog>
      <a id="a1" href="#">a1</a>
      <a id="a2" href="#">a2</a>
      <a id="a3" href="#">a3</a>
    `);
    const { order, start } = resolve(byId("orphan-btn"));

    expect(start).toEqual({ kind: "before-first" });
    expect(order[resolveNavigationTarget("forward", start, 2, order.length)].id).toBe("a2");
    expect(order[resolveNavigationTarget("backward", start, 2, order.length)].id).toBe("a1");
  });

  it("terminates on cyclic aria-controls links and anchors on the active element's own region", () => {
    // menu-a and menu-b each hold the other's trigger; menu-c's trigger sits in menu-a.
    render(`
      <a id="p1" href="#">p1</a>
      <div id="menu-a" role="menu">
        <button id="opens-b" aria-haspopup="menu" aria-controls="menu-b">B</button>
        <button id="opens-c" aria-haspopup="menu" aria-controls="menu-c">C</button>
      </div>
      <a id="p2" href="#">p2</a>
      <div id="menu-b" role="menu">
        <button id="opens-a" aria-haspopup="menu" aria-controls="menu-a">A</button>
      </div>
      <a id="p3" href="#">p3</a>
      <div id="__primerPortalRoot__">
        <div id="menu-c" role="menu"><button id="item-c">item C</button></div>
      </div>
    `);
    const regions = collectPopupRegions(document);
    expect(describeRegions(regions)).toEqual([
      { root: "menu-a", trigger: "opens-a" },
      { root: "menu-b", trigger: "opens-b" },
      { root: "menu-c", trigger: "opens-c" },
    ]);
    const order = orderPrime(regions);
    expect(ids(order)).toEqual(["p1", "p2", "p3"]);

    // Each start is the last O' element before the focused element's own region root.
    expect(resolveStartPosition(order, byId("opens-b"), regions)).toEqual({ kind: "at", index: 0 });
    expect(resolveStartPosition(order, byId("opens-a"), regions)).toEqual({ kind: "at", index: 1 });
    expect(resolveStartPosition(order, byId("item-c"), regions)).toEqual({ kind: "at", index: 2 });
  });
});

// ---------------------------------------------------------------------------
// resolveNavigationTarget
// ---------------------------------------------------------------------------

describe("resolveNavigationTarget", () => {
  const BEFORE_FIRST: StartPosition = { kind: "before-first" };

  it.each([
    [1, 5, 0],
    [3, 5, 2],
    [5, 5, 4],
    [6, 5, 4],
    [100, 1, 0],
  ])(
    "before-first forward with c=%i, n=%i lands on index %i (position c, clamped to the last)",
    (chunkSize, length, expected) => {
      expect(resolveNavigationTarget("forward", BEFORE_FIRST, chunkSize, length)).toBe(expected);
    },
  );

  it.each([
    [1, 5],
    [3, 5],
    [100, 5],
    [1, 1],
  ])("before-first backward with c=%i, n=%i clamps to index 0", (chunkSize, length) => {
    expect(resolveNavigationTarget("backward", BEFORE_FIRST, chunkSize, length)).toBe(0);
  });

  const directions: Direction[] = ["forward", "backward"];
  const starts: StartPosition[] = [BEFORE_FIRST, { kind: "none" }, { kind: "at", index: 0 }];
  const emptyOrderCases = directions.flatMap((direction) =>
    starts.map((start): [Direction, string, StartPosition] => [direction, start.kind, start]),
  );

  it.each(emptyOrderCases)(
    "returns NO_TARGET for an empty order (%s from %s)",
    (direction, _kind, start) => {
      expect(resolveNavigationTarget(direction, start, 5, 0)).toBe(NO_TARGET);
    },
  );
});
