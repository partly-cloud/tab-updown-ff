/**
 * DOM integration test for `buildFocusOrder` (Requirement 1.2).
 *
 * This is a concrete, example-based integration test (NOT property-based; the
 * property-based coverage lives separately). It exercises `buildFocusOrder`
 * against real jsdom fixtures to confirm the documented Focus_Order behavior:
 *
 *   - `display:none`, `visibility:hidden`, zero-size, and `disabled` elements
 *     are excluded from the Focus_Order.
 *   - Tab ordering is respected: positive `tabindex` elements come first sorted
 *     ascending (ties by DOM order), then the normal group in DOM order.
 *
 * See design.md "Focus_Order Model" / "Integration Tests" and tasks.md 6.3.
 *
 * jsdom does not compute real layout, so `offsetWidth`/`offsetHeight` are `0`
 * for every element and `getClientRects()` is empty. `buildFocusOrder`'s
 * visibility check treats zero-size elements as hidden, which would exclude
 * *everything* under a naive jsdom run. To simulate real layout we stub each
 * element's `offsetWidth`/`offsetHeight` (and a matching client rect): visible
 * elements get non-zero dimensions, zero-size elements are left at `0`. This
 * lets the test reliably assert the documented exclusion behavior.
 */

/** Give an element non-zero layout dimensions so `isVisible` sees it as laid out. */
function makeLaidOut(element: HTMLElement): void {
  setDimensions(element, 10, 10);
}

/** Force an element to report zero layout dimensions (a "zero-size" element). */
function makeZeroSize(element: HTMLElement): void {
  setDimensions(element, 0, 0);
}

/**
 * Stub the layout signals `buildFocusOrder`'s visibility check reads:
 * `offsetWidth`, `offsetHeight`, and `getClientRects()`. jsdom leaves these at
 * `0`/empty because it performs no layout, so tests must supply them.
 */
function setDimensions(
  element: HTMLElement,
  width: number,
  height: number,
): void {
  Object.defineProperty(element, "offsetWidth", {
    configurable: true,
    value: width,
  });
  Object.defineProperty(element, "offsetHeight", {
    configurable: true,
    value: height,
  });
  Object.defineProperty(element, "getClientRects", {
    configurable: true,
    value: () =>
      width > 0 && height > 0
        ? [{ width, height, top: 0, left: 0, right: width, bottom: height }]
        : [],
  });
}

describe("buildFocusOrder (jsdom integration)", () => {
  let buildFocusOrder: typeof import("../src/lib/focus.js").buildFocusOrder;

  beforeEach(async () => {
    // Import inside the test lifecycle so the jsdom `document` global is ready.
    ({ buildFocusOrder } = await import("../src/lib/focus.js"));
    document.body.innerHTML = "";
  });

  describe("exclusion rules", () => {
    it("excludes display:none, visibility:hidden, zero-size, and disabled elements", () => {
      document.body.innerHTML = `
        <button id="visible">visible</button>
        <button id="display-none" style="display: none">display:none</button>
        <button id="visibility-hidden" style="visibility: hidden">visibility:hidden</button>
        <button id="zero-size">zero-size</button>
        <button id="disabled" disabled>disabled</button>
        <input id="disabled-input" disabled />
        <a id="visible-link" href="#">link</a>
      `;

      // Lay out the elements that should be considered visible.
      makeLaidOut(document.getElementById("visible") as HTMLElement);
      makeLaidOut(document.getElementById("visible-link") as HTMLElement);
      // The hidden ones still get laid out where relevant, so the exclusion is
      // driven by the CSS / disabled state rather than by missing dimensions.
      makeLaidOut(document.getElementById("display-none") as HTMLElement);
      makeLaidOut(document.getElementById("visibility-hidden") as HTMLElement);
      makeLaidOut(document.getElementById("disabled") as HTMLElement);
      makeLaidOut(document.getElementById("disabled-input") as HTMLElement);
      // The zero-size element explicitly reports no layout box.
      makeZeroSize(document.getElementById("zero-size") as HTMLElement);

      const order = buildFocusOrder(document);
      const ids = order.map((el) => el.id);

      expect(ids).toEqual(["visible", "visible-link"]);

      // Explicit negative assertions for each exclusion reason.
      expect(ids).not.toContain("display-none");
      expect(ids).not.toContain("visibility-hidden");
      expect(ids).not.toContain("zero-size");
      expect(ids).not.toContain("disabled");
      expect(ids).not.toContain("disabled-input");
    });

    it("excludes elements with a negative tabindex", () => {
      document.body.innerHTML = `
        <button id="normal">normal</button>
        <div id="focusable-div" tabindex="0">tabindex 0</div>
        <div id="not-tabbable" tabindex="-1">tabindex -1</div>
      `;
      for (const id of ["normal", "focusable-div", "not-tabbable"]) {
        makeLaidOut(document.getElementById(id) as HTMLElement);
      }

      const ids = buildFocusOrder(document).map((el) => el.id);

      expect(ids).toEqual(["normal", "focusable-div"]);
      expect(ids).not.toContain("not-tabbable");
    });
  });

  describe("ordering rules", () => {
    it("places positive tabindex first (ascending), then the normal group in DOM order", () => {
      document.body.innerHTML = `
        <button id="normal-1">normal 1</button>
        <button id="positive-3" tabindex="3">tabindex 3</button>
        <a id="normal-2" href="#">normal 2</a>
        <button id="positive-1" tabindex="1">tabindex 1</button>
        <input id="tabindex-0" tabindex="0" />
        <button id="positive-2" tabindex="2">tabindex 2</button>
      `;
      for (const id of [
        "normal-1",
        "positive-3",
        "normal-2",
        "positive-1",
        "tabindex-0",
        "positive-2",
      ]) {
        makeLaidOut(document.getElementById(id) as HTMLElement);
      }

      const ids = buildFocusOrder(document).map((el) => el.id);

      // Positive tabindex ascending (1, 2, 3), then the normal group
      // (native + tabindex="0") in DOM document order.
      expect(ids).toEqual([
        "positive-1",
        "positive-2",
        "positive-3",
        "normal-1",
        "normal-2",
        "tabindex-0",
      ]);
    });

    it("breaks ties between equal positive tabindex values by DOM order", () => {
      document.body.innerHTML = `
        <button id="first-two" tabindex="2">first tabindex 2</button>
        <button id="only-one" tabindex="1">tabindex 1</button>
        <button id="second-two" tabindex="2">second tabindex 2</button>
      `;
      for (const id of ["first-two", "only-one", "second-two"]) {
        makeLaidOut(document.getElementById(id) as HTMLElement);
      }

      const ids = buildFocusOrder(document).map((el) => el.id);

      // tabindex 1 first; then the two tabindex-2 elements in DOM order.
      expect(ids).toEqual(["only-one", "first-two", "second-two"]);
    });
  });
});
