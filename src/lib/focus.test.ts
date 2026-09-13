/**
 * Property-based tests for focus-index computation (`computeTargetIndex`).
 *
 * Uses fast-check under Jest, per the design's Testing Strategy. See
 * design.md "Correctness Properties" (Properties 1-5) and tasks.md tasks
 * 5.2-5.6. Each property runs a minimum of 100 iterations.
 */
import fc from "fast-check";

import { CHUNK_SIZE_MAX, CHUNK_SIZE_MIN } from "./constants.js";
import {
  buildFocusOrder,
  computeTargetIndex,
  NO_TARGET,
  type Direction,
} from "./focus.js";

/** Chunk_Size arbitrary constrained to the valid range `[1, 100]`. */
const chunkSize = fc.integer({ min: CHUNK_SIZE_MIN, max: CHUNK_SIZE_MAX });

/** Focus_Order length arbitrary for a non-empty order (`n >= 1`). */
const nonEmptyLength = fc.integer({ min: 1, max: 1000 });

describe("computeTargetIndex", () => {
  // Feature: tab-updown, Property 1: Forward move clamps to the last element
  // Validates: Requirements 1.1, 1.4
  it("forward with a current index yields min(i + c, n - 1)", () => {
    fc.assert(
      // Generate n >= 1, then a current index i in [0, n-1], and c in [1, 100].
      fc.property(
        nonEmptyLength.chain((n) =>
          fc.record({
            n: fc.constant(n),
            i: fc.integer({ min: 0, max: n - 1 }),
            c: chunkSize,
          }),
        ),
        ({ n, i, c }) => {
          const target = computeTargetIndex("forward", i, c, n);
          expect(target).toBe(Math.min(i + c, n - 1));
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: tab-updown, Property 2: Backward move clamps to the first element
  // Validates: Requirements 2.1, 2.3
  it("backward with a current index yields max(i - c, 0)", () => {
    fc.assert(
      // Generate n >= 1, then a current index i in [0, n-1], and c in [1, 100].
      fc.property(
        nonEmptyLength.chain((n) =>
          fc.record({
            n: fc.constant(n),
            i: fc.integer({ min: 0, max: n - 1 }),
            c: chunkSize,
          }),
        ),
        ({ n, i, c }) => {
          const target = computeTargetIndex("backward", i, c, n);
          expect(target).toBe(Math.max(i - c, 0));
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: tab-updown, Property 3: Forward move with no current focus starts from the first element
  // Validates: Requirements 1.3
  it("forward with no current focus (currentIndex == -1) yields min(c - 1, n - 1)", () => {
    fc.assert(
      // Generate n >= 1 and c in [1, 100], with currentIndex == -1.
      fc.property(nonEmptyLength, chunkSize, (n, c) => {
        const target = computeTargetIndex("forward", NO_TARGET, c, n);
        expect(target).toBe(Math.min(c - 1, n - 1));
      }),
      { numRuns: 100 },
    );
  });

  // Feature: tab-updown, Property 4: Backward move with no in-order focus lands on the last element
  // Validates: Requirements 2.2, 2.5
  it("backward with no in-order focus (currentIndex == -1) yields n - 1", () => {
    fc.assert(
      // Generate n >= 1 and c in [1, 100], with currentIndex == -1.
      fc.property(nonEmptyLength, chunkSize, (n, c) => {
        const target = computeTargetIndex("backward", NO_TARGET, c, n);
        expect(target).toBe(n - 1);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: tab-updown, Property 5: An empty Focus_Order is a no-op in either direction
  // Validates: Requirements 1.5, 2.4
  it("returns the no-op sentinel when the Focus_Order is empty (length == 0)", () => {
    fc.assert(
      // Generate direction and c in [1, 100], with length == 0. The current
      // index is also arbitrary to confirm it never affects the empty-order case.
      fc.property(
        fc.constantFrom<Direction>("forward", "backward"),
        chunkSize,
        fc.integer({ min: -1, max: 1000 }),
        (direction, c, i) => {
          const target = computeTargetIndex(direction, i, c, 0);
          expect(target).toBe(NO_TARGET);
        },
      ),
      { numRuns: 100 },
    );
  });
});

/**
 * A single generated element descriptor for the Focus_Order property.
 *
 * - `native`     — whether the element is rendered as a natively focusable tag
 *                  (`<button>`) or a plain `<div>` (not natively focusable).
 * - `tabindex`   — the `tabindex` attribute value, or `undefined` when absent.
 * - `visible`    — whether the element should render as visible.
 * - `enabled`    — whether the element should be enabled (not disabled/inert).
 * - `hideMode`   — which mechanism makes an invisible element invisible.
 * - `disableMode`— which mechanism makes a disabled element disabled.
 */
interface ElementDescriptor {
  native: boolean;
  tabindex: number | undefined;
  visible: boolean;
  enabled: boolean;
  hideMode: "display" | "visibility" | "size";
  disableMode: "disabled" | "inert";
}

/**
 * Independent oracle for tab participation, derived from the Focus_Order Model
 * (design.md clause 1): an element is tabbable iff it carries a `tabindex >= 0`,
 * or — with no `tabindex` — it is natively focusable. A `tabindex < 0` excludes
 * it even when natively focusable.
 */
function isTabbable(descriptor: ElementDescriptor): boolean {
  if (descriptor.tabindex !== undefined) {
    return descriptor.tabindex >= 0;
  }
  return descriptor.native;
}

/** True when the descriptor belongs to the positive-`tabindex` group (`> 0`). */
function isPositive(descriptor: ElementDescriptor): boolean {
  return descriptor.tabindex !== undefined && descriptor.tabindex > 0;
}

/**
 * Build a jsdom element from a descriptor and its DOM position.
 *
 * Visibility in jsdom does not derive from layout (jsdom reports zero
 * `offsetWidth`/`offsetHeight` and no client rects regardless of CSS), so a
 * visible element has its `getClientRects` patched to report a non-empty area —
 * matching what `isVisible` inspects — while an invisible element is hidden via
 * one of the CSS/layout mechanisms `isVisible` rejects.
 */
function makeElement(
  descriptor: ElementDescriptor,
  domIndex: number,
): HTMLElement {
  const element = document.createElement(descriptor.native ? "button" : "div");
  element.dataset.domIndex = String(domIndex);

  if (descriptor.tabindex !== undefined) {
    element.setAttribute("tabindex", String(descriptor.tabindex));
  }

  if (!descriptor.enabled) {
    if (descriptor.disableMode === "disabled" && descriptor.native) {
      // `disabled` only applies to form controls; buttons honor it.
      (element as HTMLButtonElement).disabled = true;
    } else {
      // `inert` removes any element (and subtree) from the tab order.
      element.setAttribute("inert", "");
    }
  }

  if (descriptor.visible) {
    // Make the element pass `isVisible`'s non-zero-dimension check.
    Object.defineProperty(element, "getClientRects", {
      configurable: true,
      value: () =>
        [{ width: 10, height: 10 }] as unknown as DOMRectList,
    });
  } else {
    switch (descriptor.hideMode) {
      case "display":
        element.style.display = "none";
        break;
      case "visibility":
        element.style.visibility = "hidden";
        break;
      case "size":
        // Leave client rects empty (jsdom default) → zero layout dimensions.
        break;
    }
  }

  return element;
}

describe("buildFocusOrder", () => {
  // Feature: tab-updown, Property 6: Focus_Order includes exactly the visible, enabled, tabbable elements in tab order
  // Validates: Requirements 1.2
  it("returns exactly the visible, enabled, tabbable elements in tab order", () => {
    // A descriptor generator spanning the classifying dimensions: native vs.
    // non-native focusability, absent/negative/zero/positive tabindex, and the
    // visible/enabled flags with their respective hide/disable mechanisms.
    const descriptor: fc.Arbitrary<ElementDescriptor> = fc.record({
      native: fc.boolean(),
      // undefined (no attribute), or an integer spanning negative/0/positive.
      tabindex: fc.option(fc.integer({ min: -3, max: 5 }), { nil: undefined }),
      visible: fc.boolean(),
      enabled: fc.boolean(),
      hideMode: fc.constantFrom<ElementDescriptor["hideMode"]>(
        "display",
        "visibility",
        "size",
      ),
      disableMode: fc.constantFrom<ElementDescriptor["disableMode"]>(
        "disabled",
        "inert",
      ),
    });

    fc.assert(
      fc.property(fc.array(descriptor, { maxLength: 25 }), (descriptors) => {
        // Build a fresh DOM from the descriptors in generated (DOM) order.
        document.body.innerHTML = "";
        const elements = descriptors.map((d, i) => {
          const element = makeElement(d, i);
          document.body.appendChild(element);
          return element;
        });

        // Oracle: the elements that are visible AND enabled AND tabbable,
        // paired with their DOM index and tabindex, in generated order.
        const included = descriptors
          .map((d, domIndex) => ({ d, domIndex, element: elements[domIndex] }))
          .filter(
            ({ d }) => d.visible && d.enabled && isTabbable(d),
          );

        // Expected ordering: positive-tabindex group first (ascending by
        // tabindex, ties broken by DOM order), then the normal group in DOM
        // order. `included` is already in DOM order, so a stable sort that
        // ranks positives ahead of normals — and orders positives by tabindex —
        // preserves DOM order for ties and within the normal group.
        const expected = [...included]
          .sort((a, b) => {
            const aPos = isPositive(a.d);
            const bPos = isPositive(b.d);
            if (aPos && bPos) {
              // Both positive: ascending tabindex, ties by DOM order.
              if (a.d.tabindex !== b.d.tabindex) {
                return (a.d.tabindex as number) - (b.d.tabindex as number);
              }
              return a.domIndex - b.domIndex;
            }
            if (aPos !== bPos) {
              // Positive precedes normal.
              return aPos ? -1 : 1;
            }
            // Both normal: DOM order.
            return a.domIndex - b.domIndex;
          })
          .map(({ element }) => element);

        const actual = buildFocusOrder(document);

        // Same elements, same order (identity comparison).
        expect(actual).toEqual(expected);
      }),
      { numRuns: 100 },
    );
  });
});
