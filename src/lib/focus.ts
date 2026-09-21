/**
 * Focus-index computation for the Tab-Updown extension.
 *
 * DOM-free pure arithmetic used by the Content_Script to decide which element in
 * the Focus_Order should receive focus for a chunked forward/backward move. The
 * Focus_Order construction (`buildFocusOrder`, `indexOfCurrentFocus`) that reads
 * the live DOM lives alongside this in a later task; `computeTargetIndex` is kept
 * pure so it can be property-tested without a DOM. See design.md
 * "Correctness Properties" (Properties 1-5) and "Content_Script".
 */

/**
 * Navigation direction carried by the background → content `NavigateMessage`
 * (see design.md "Messaging Protocol").
 */
export type Direction = "forward" | "backward";

/**
 * Sentinel returned when there is no target to focus — either because the
 * Focus_Order is empty (`length == 0`) or, as an input convention, to signal
 * "no Currently_Focused_Element is present in the Focus_Order" for
 * `currentIndex`.
 */
export const NO_TARGET = -1;

/**
 * Compute the target index for a chunked focus move (Requirements 1.1, 1.3, 1.4,
 * 1.5, 2.1, 2.2, 2.3, 2.4, 2.5).
 *
 * Index convention: `currentIndex == -1` means "no Currently_Focused_Element is
 * present in the Focus_Order". When `length == 0` the Focus_Order is empty and
 * the function returns the no-op sentinel {@link NO_TARGET} so the caller leaves
 * focus unchanged.
 *
 * Given a non-empty Focus_Order of length `n`, a current index `i`, and a
 * Chunk_Size `c`:
 * - forward with `i >= 0` → `min(i + c, n - 1)` (Property 1: clamp to last),
 * - forward with `i == -1` → `min(c - 1, n - 1)` (Property 3: position `c` from
 *   the first element, clamped to last),
 * - backward with `i >= 0` → `max(i - c, 0)` (Property 2: clamp to first),
 * - backward with `i == -1` → `n - 1` (Property 4: land on the last element).
 *
 * @param direction   The navigation direction (`"forward"` or `"backward"`).
 * @param currentIndex Index of the Currently_Focused_Element in the Focus_Order,
 *                     or `-1` when none is present in the order.
 * @param chunkSize    The number of elements to move by (a positive integer,
 *                     expected in `[1, 100]`).
 * @param length       The length `n` of the Focus_Order.
 * @returns The target index in `[0, n-1]`, or {@link NO_TARGET} when the
 *          Focus_Order is empty.
 */
export function computeTargetIndex(
  direction: Direction,
  currentIndex: number,
  chunkSize: number,
  length: number,
): number {
  // Empty Focus_Order: no-op in either direction (Requirements 1.5, 2.4).
  if (length === 0) {
    return NO_TARGET;
  }

  const lastIndex = length - 1;

  if (direction === "forward") {
    if (currentIndex === NO_TARGET) {
      // No current focus: move to position `chunkSize` from the first element,
      // clamped to the last (Requirement 1.3).
      return Math.min(chunkSize - 1, lastIndex);
    }
    // Advance by the chunk, clamped to the last element (Requirements 1.1, 1.4).
    return Math.min(currentIndex + chunkSize, lastIndex);
  }

  // Backward.
  if (currentIndex === NO_TARGET) {
    // No in-order focus: land on the last element (Requirements 2.2, 2.5).
    return lastIndex;
  }
  // Reverse by the chunk, clamped to the first element (Requirements 2.1, 2.3).
  return Math.max(currentIndex - chunkSize, 0);
}

/**
 * CSS selector matching elements that are focusable by default (without a
 * `tabindex`), per design.md "Focus_Order Model" clause 1. Elements matched here
 * belong to the "normal" tab-order group unless they carry a positive `tabindex`.
 *
 * Note: `[tabindex]` is intentionally NOT part of this selector — tabindex-based
 * inclusion/exclusion is decided per element in {@link isTabbable} so that
 * `tabindex="-1"` can be excluded and positive values can be grouped separately.
 */
const NATIVELY_FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button",
  "input",
  "select",
  "textarea",
  "[contenteditable]",
  "iframe",
  "embed",
  "object",
].join(",");

/**
 * Read an element's `tabindex` as an integer, or `undefined` when the attribute
 * is absent or does not parse to an integer.
 *
 * Uses the raw attribute (not the `tabIndex` IDL property) so that the *absence*
 * of the attribute is distinguishable from an explicit `tabindex="0"` — the IDL
 * property reports `0` for many natively focusable elements even when no
 * attribute is set, which would collapse that distinction.
 */
function readTabIndex(element: Element): number | undefined {
  const raw = element.getAttribute("tabindex");
  if (raw === null) {
    return undefined;
  }
  const trimmed = raw.trim();
  if (!/^[+-]?\d+$/.test(trimmed)) {
    return undefined;
  }
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) ? parsed : undefined;
}

/**
 * True when `element` participates in the tab order (Requirement 1.2,
 * design.md "Focus_Order Model" clause 1):
 * - a `tabindex >= 0` makes any element tabbable;
 * - a `tabindex < 0` excludes the element even if it is natively focusable;
 * - with no (or an unparseable) `tabindex`, the element is tabbable iff it is
 *   natively focusable.
 */
function isTabbable(element: Element): boolean {
  const tabIndex = readTabIndex(element);
  if (tabIndex !== undefined) {
    return tabIndex >= 0;
  }
  return element.matches(NATIVELY_FOCUSABLE_SELECTOR);
}

/**
 * True when `element` is disabled and therefore excluded from the Focus_Order
 * (Requirement 1.2, design.md "Focus_Order Model" clause 2).
 *
 * Covers the `:disabled` state of form controls (via the `disabled` IDL
 * property / attribute) and the `inert` state, which removes an element and its
 * subtree from the tab order.
 */
function isDisabled(element: Element): boolean {
  // `disabled` applies to form controls (button, input, select, textarea,
  // optgroup, option, fieldset). Reading it off a generic Element requires a
  // narrowing cast because the property is not on the base type.
  const maybeDisabled = (element as { disabled?: unknown }).disabled;
  if (maybeDisabled === true) {
    return true;
  }
  // `inert` removes the element (and its subtree) from the tab order. The
  // `closest` walk catches elements nested inside an inert ancestor.
  if (element.closest("[inert]") !== null) {
    return true;
  }
  return false;
}

/**
 * True when `element` is visible (Requirement 1.2, design.md "Focus_Order Model"
 * clause 3): `display` is not `none`, `visibility` is not `hidden`/`collapse`,
 * computed opacity does not fully hide it, and it has non-zero layout dimensions
 * (`offsetWidth`/`offsetHeight`, or a client rect with area).
 *
 * A `display: none` element (or a descendant of one) reports `offsetWidth`/
 * `offsetHeight` of `0` and an empty client-rect list, so the dimension check
 * also covers detached / rendered-away subtrees.
 */
function isVisible(element: Element): boolean {
  const htmlElement = element as HTMLElement;
  const view = element.ownerDocument.defaultView;

  if (view) {
    const style = view.getComputedStyle(htmlElement);
    if (style.display === "none") {
      return false;
    }
    if (style.visibility === "hidden" || style.visibility === "collapse") {
      return false;
    }
    const opacity = Number.parseFloat(style.opacity);
    if (!Number.isNaN(opacity) && opacity <= 0) {
      return false;
    }
  }

  // Non-zero layout dimensions. `offsetWidth`/`offsetHeight` are the primary
  // signal; fall back to a client rect with area for inline/wrapped elements.
  if (htmlElement.offsetWidth > 0 && htmlElement.offsetHeight > 0) {
    return true;
  }
  const rects = htmlElement.getClientRects();
  for (const rect of Array.from(rects)) {
    if (rect.width > 0 && rect.height > 0) {
      return true;
    }
  }
  return false;
}

/**
 * Build the Focus_Order for a document (Requirement 1.2).
 *
 * Returns the elements that are visible AND enabled AND tabbable — natively
 * focusable or carrying `tabindex >= 0`, with `tabindex < 0` excluded — ordered
 * as the Tab key would visit them:
 *
 * 1. Elements with a positive `tabindex` (`> 0`) come first, sorted ascending by
 *    tabindex value; ties are broken by DOM document order.
 * 2. Then the "normal" group — natively focusable elements and elements with
 *    `tabindex="0"` — in DOM document order.
 *
 * @param document The document (or document-like root) whose Focus_Order to build.
 * @returns The ordered array of live, visible, enabled, tabbable elements.
 */
export function buildFocusOrder(document: Document): HTMLElement[] {
  // A superset selector: natively focusable elements plus anything carrying a
  // `tabindex`. Per-element predicates below refine this to the true tab set.
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>(
      `${NATIVELY_FOCUSABLE_SELECTOR},[tabindex]`,
    ),
  );

  const positiveGroup: { element: HTMLElement; tabIndex: number; domIndex: number }[] =
    [];
  const normalGroup: HTMLElement[] = [];

  candidates.forEach((element, domIndex) => {
    if (!isTabbable(element) || isDisabled(element) || !isVisible(element)) {
      return;
    }
    const tabIndex = readTabIndex(element);
    if (tabIndex !== undefined && tabIndex > 0) {
      positiveGroup.push({ element, tabIndex, domIndex });
    } else {
      normalGroup.push(element);
    }
  });

  // Positive-tabindex elements sorted ascending by tabindex; ties broken by DOM
  // document order (captured via `domIndex`).
  positiveGroup.sort((a, b) => {
    if (a.tabIndex !== b.tabIndex) {
      return a.tabIndex - b.tabIndex;
    }
    return a.domIndex - b.domIndex;
  });

  return [...positiveGroup.map((entry) => entry.element), ...normalGroup];
}

/**
 * Locate the Currently_Focused_Element within a Focus_Order (Requirement 1.2;
 * see design.md "Focus_Order Model").
 *
 * Returns the index of `activeElement` in `order`, or {@link NO_TARGET} (`-1`)
 * when there is no current focus (`activeElement` is `null`, or the document's
 * `<body>`) or the focused element is not present in the order (e.g. detached,
 * hidden, or otherwise excluded). The `-1` sentinel drives the "no current focus
 * in order" behavior of `computeTargetIndex` (Requirements 1.3, 2.2, 2.5).
 *
 * @param order         The Focus_Order produced by {@link buildFocusOrder}.
 * @param activeElement The document's `activeElement`, or `null`.
 * @returns The index of `activeElement` in `order`, or {@link NO_TARGET}.
 */
export function indexOfCurrentFocus(
  order: readonly HTMLElement[],
  activeElement: Element | null,
): number {
  if (activeElement === null) {
    return NO_TARGET;
  }
  // `<body>` is the default `activeElement` when nothing is focused; treat it as
  // "no current focus" rather than a real focus target.
  if (activeElement === activeElement.ownerDocument.body) {
    return NO_TARGET;
  }
  const index = order.indexOf(activeElement as HTMLElement);
  return index === -1 ? NO_TARGET : index;
}
