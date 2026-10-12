/**
 * Region detection for popups linked to their trigger without `aria-controls`
 * (expanded-popup-focus-trap-fix, GitHub issue #18).
 *
 * Primer's AnchoredOverlay (GitHub's branch picker, ActionMenu, SelectPanel)
 * renders its menu button with `aria-haspopup="true"` and `aria-expanded`, but
 * no `aria-controls`. With CSS anchor positioning the button carries an inline
 * `anchor-name` and the overlay an inline `position-anchor` naming it. These
 * tests cover:
 *
 * - anchor-linked roots (detection rule 5), inside or outside a portal;
 * - a portal child picking up its trigger from an anchored descendant;
 * - the fallback to the single expanded popup button for portal children;
 * - look-alikes that must stay out (tooltips anchored to plain buttons, a
 *   trigger inside its own overlay, ambiguous expanded buttons).
 */

import { buildFocusOrder } from "../src/lib/focus.js";
import {
  collectPopupRegions,
  excludePopupRegions,
  regionContaining,
  resolveNavigationTarget,
  resolveStartPosition,
  type PopupRegion,
} from "../src/lib/popup.js";

/** Give an element non-zero layout dimensions so `isVisible` sees it as laid out. */
function layOut(element: Element): void {
  Object.defineProperty(element, "offsetWidth", { configurable: true, value: 10 });
  Object.defineProperty(element, "offsetHeight", { configurable: true, value: 10 });
  Object.defineProperty(element, "getClientRects", {
    configurable: true,
    value: () => [{ width: 10, height: 10, top: 0, left: 0, right: 10, bottom: 10 }],
  });
}

function render(html: string): void {
  document.body.innerHTML = html;
  for (const element of Array.from(document.body.querySelectorAll("*"))) {
    layOut(element);
  }
}

function byId(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`fixture has no #${id}`);
  }
  return element;
}

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

function orderPrime(regions: readonly PopupRegion[]): string[] {
  return excludePopupRegions(
    buildFocusOrder(document),
    (element) => regionContaining(regions, element) !== null,
  ).map((element) => element.id);
}

const ANCHOR = "--anchored-overlay-anchor-_R_dladahlik5H1_";

/** The branch button from github.com, trimmed to the attributes that matter. */
const BRANCH_BUTTON = `<button id="branch-btn" type="button" aria-haspopup="true" aria-expanded="true" tabindex="0" style="min-width: 0px; anchor-name: ${ANCHOR};" aria-label="main branch">main</button>`;

/** The open picker, as Primer renders it: portal wrapper > anchored overlay. */
const BRANCH_OVERLAY = `
  <div id="portal-wrapper" style="position: relative; z-index: 1;">
    <div id="overlay" role="none" data-component="AnchoredOverlay" style="position-anchor: ${ANCHOR};">
      <input id="filter" aria-label="Filter branches">
      <a id="br-main" href="#">main</a>
      <a id="br-dev" href="#">dev</a>
      <a id="view-all" href="#">View all branches</a>
    </div>
  </div>
`;

afterEach(() => {
  document.body.innerHTML = "";
});

describe("anchor-linked Popup_Regions", () => {
  it("links GitHub's branch picker overlay to its button through the CSS anchor", () => {
    render(`
      <a id="a1" href="#">a1</a>
      ${BRANCH_BUTTON}<div class="d-none"></div>
      <a id="a2" href="#">a2</a>
      <a id="a3" href="#">a3</a>
      <div id="__primerPortalRoot__">${BRANCH_OVERLAY}</div>
    `);
    const regions = collectPopupRegions(document);

    // The portal wrapper and the overlay inside it are both regions, and both
    // report the branch button as their trigger.
    expect(describeRegions(regions)).toEqual([
      { root: "overlay", trigger: "branch-btn" },
      { root: "portal-wrapper", trigger: "branch-btn" },
    ]);
    const order = excludePopupRegions(
      buildFocusOrder(document),
      (element) => regionContaining(regions, element) !== null,
    );
    expect(order.map((element) => element.id)).toEqual(["a1", "branch-btn", "a2", "a3"]);

    // Focus inside the picker counts from the button, not from the end of the
    // page (the portal is the last child of <body>).
    const start = resolveStartPosition(order, byId("filter"), regions);
    expect(start).toEqual({ kind: "at", index: 1 });
    expect(order[resolveNavigationTarget("forward", start, 1, order.length)].id).toBe("a2");
    expect(order[resolveNavigationTarget("backward", start, 1, order.length)].id).toBe("a1");
  });

  it("detects an anchored overlay outside any known portal container", () => {
    render(`
      <a id="a1" href="#">a1</a>
      ${BRANCH_BUTTON}
      <a id="a2" href="#">a2</a>
      <div id="custom-portal">${BRANCH_OVERLAY}</div>
    `);
    const regions = collectPopupRegions(document);

    expect(describeRegions(regions)).toEqual([{ root: "overlay", trigger: "branch-btn" }]);
    expect(orderPrime(regions)).toEqual(["a1", "branch-btn", "a2"]);
  });

  it("matches one name out of an anchor-name list and ignores !important", () => {
    render(`
      <button id="menu-btn" aria-haspopup="menu" style="anchor-name: --tooltip, --menu-anchor">Menu</button>
      <div id="menu" style="position-anchor: --menu-anchor !important"><button>item</button></div>
    `);

    expect(describeRegions(collectPopupRegions(document))).toEqual([
      { root: "menu", trigger: "menu-btn" },
    ]);
  });

  it("ignores an element anchored to a plain button (a tooltip, not a popup)", () => {
    render(`
      <button id="plain" style="anchor-name: --tip">Save</button>
      <div id="tip" style="position-anchor: --tip"><a href="#">help</a></div>
    `);

    expect(describeRegions(collectPopupRegions(document))).toEqual([]);
  });

  it("ignores an anchor that sits inside the anchored element", () => {
    render(`
      <div id="toolbar" style="position-anchor: --self">
        <button aria-haspopup="true" style="anchor-name: --self">More</button>
      </div>
    `);

    expect(describeRegions(collectPopupRegions(document))).toEqual([]);
  });
});

describe("expanded-button fallback for portal children", () => {
  /** A portal overlay with no anchor link back to its button. */
  const UNANCHORED_OVERLAY = `<div id="__primerPortalRoot__"><div id="overlay"><button id="item">item</button></div></div>`;

  it("uses the one expanded popup button as the trigger", () => {
    render(`
      <button id="other" aria-haspopup="true" aria-expanded="false">Other</button>
      <button id="open-btn" aria-haspopup="true" aria-expanded="true">Open</button>
      ${UNANCHORED_OVERLAY}
    `);

    expect(describeRegions(collectPopupRegions(document))).toEqual([
      { root: "overlay", trigger: "open-btn" },
    ]);
  });

  it("skips buttons that already trigger another region", () => {
    render(`
      <button id="linked" aria-haspopup="menu" aria-expanded="true" aria-controls="menu">Linked</button>
      <div id="menu" role="menu"><button>menu item</button></div>
      <button id="open-btn" aria-haspopup="true" aria-expanded="true">Open</button>
      ${UNANCHORED_OVERLAY}
    `);

    expect(describeRegions(collectPopupRegions(document))).toEqual([
      { root: "menu", trigger: "linked" },
      { root: "overlay", trigger: "open-btn" },
    ]);
  });

  it("leaves the trigger null when several expanded buttons could own it", () => {
    render(`
      <button aria-haspopup="true" aria-expanded="true">One</button>
      <button aria-haspopup="true" aria-expanded="true">Two</button>
      ${UNANCHORED_OVERLAY}
    `);

    expect(describeRegions(collectPopupRegions(document))).toEqual([
      { root: "overlay", trigger: null },
    ]);
  });

  it('ignores aria-haspopup="false" and collapsed buttons', () => {
    render(`
      <button aria-haspopup="false" aria-expanded="true">Disclosure</button>
      <button aria-haspopup="true" aria-expanded="false">Closed</button>
      ${UNANCHORED_OVERLAY}
    `);

    expect(describeRegions(collectPopupRegions(document))).toEqual([
      { root: "overlay", trigger: null },
    ]);
  });

  it("doesn't apply to an orphan dialog", () => {
    render(`
      <button id="open-btn" aria-haspopup="true" aria-expanded="true">Open</button>
      <dialog id="orphan" open><button>inside</button></dialog>
    `);

    expect(describeRegions(collectPopupRegions(document))).toEqual([
      { root: "orphan", trigger: null },
    ]);
  });
});
