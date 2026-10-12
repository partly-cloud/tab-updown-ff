/**
 * Popup_Region handling for the Tab-Updown extension (GitHub issue #18).
 *
 * Native Tab never enters a popup, dialog, or overlay region (a Popup_Region)
 * from the normal page sequence; it moves from the region's Popup_Trigger
 * straight to the next page control. This module lets the Content_Script do the
 * same: region members are removed from the Focus_Order (giving the filtered
 * order O'), and a focus position inside a region is mapped back to its
 * trigger's index in O' before the chunk move is computed.
 *
 * The pure helpers (`excludePopupRegions`, `mapStartPosition`,
 * `resolveNavigationTarget`) are DOM-free so they can be property-tested
 * without a DOM. The DOM helpers (`collectPopupRegions`, `regionContaining`,
 * `resolveStartPosition`) detect regions from conservative DOM signals and feed
 * the pure core. Everything reuses {@link NO_TARGET}, {@link computeTargetIndex}
 * and {@link indexOfCurrentFocus} from `./focus` unchanged. See the
 * expanded-popup-focus-trap-fix design.md "Fix Implementation" and
 * "Correctness Properties" (Properties 3 and 4).
 */

import {
  NO_TARGET,
  computeTargetIndex,
  indexOfCurrentFocus,
  type Direction,
} from "./focus";

/**
 * A Popup_Region: the DOM subtree rooted at `root` whose focusable descendants
 * native Tab does not reach, together with the Popup_Trigger that opens or is
 * associated with it (`null` when no trigger can be discovered, for example an
 * orphan `<dialog>`). The trigger itself stays in the Focus_Order.
 */
export interface PopupRegion {
  root: Element;
  trigger: HTMLElement | null;
}

/**
 * Where a chunk move is counted from in the filtered order O':
 * - `at`: count from `O'[index]` (the focused element, or the trigger / the
 *   preceding element when focus is inside a region);
 * - `none`: no in-order focus, matching the existing `-1` semantics of
 *   {@link computeTargetIndex};
 * - `before-first`: focus is inside a region that precedes every O' element,
 *   so the move is counted from an anchor just before `O'[0]`.
 */
export type StartPosition =
  | { kind: "at"; index: number }
  | { kind: "none" }
  | { kind: "before-first" };

/**
 * Remove every Popup_Region member from a Focus_Order (Requirement 2.1; design
 * Property 3).
 *
 * Returns exactly the elements `e` of `order` with `isInRegion(e) === false`, in
 * their original relative order. Elements outside every region, including
 * Popup_Triggers, are kept (Requirement 3.7). When `isInRegion` is always false
 * the result has the same contents as `order`, so region-free pages keep their
 * Focus_Order unchanged (Requirements 3.5, 3.8).
 *
 * Generic over the element type so it can be property-tested without a DOM.
 *
 * @param order      The full Focus_Order O.
 * @param isInRegion Membership predicate: true when an element is inside any
 *                   Popup_Region.
 * @returns The filtered order O'.
 */
export function excludePopupRegions<T>(
  order: readonly T[],
  isInRegion: (element: T) => boolean,
): T[] {
  return order.filter((element) => !isInRegion(element));
}

/**
 * Inputs to {@link mapStartPosition}. All indices are into the filtered order
 * O', with `-1` ({@link NO_TARGET}) meaning "absent".
 */
export interface StartPositionArgs {
  /** Index of the Currently_Focused_Element in O', or `-1` if not present. */
  focusedIndex: number;
  /** True when the Currently_Focused_Element is inside some Popup_Region. */
  focusInRegion: boolean;
  /** Index in O' of the (outermost resolvable) Popup_Trigger, or `-1`. */
  triggerIndex: number;
  /**
   * Largest index `k` such that `O'[k]` precedes the region root in document
   * order, or `-1` when no O' element precedes it.
   */
  precedingIndex: number;
}

/**
 * Resolve the start position for a chunk move (Requirement 2.4; design
 * Property 4).
 *
 * Precedence:
 * 1. Focus outside every region → `at(focusedIndex)`, or `none` when the
 *    focused element is not in O' (identical to today's `indexOfCurrentFocus`
 *    semantics, Requirements 3.1-3.3).
 * 2. Focus inside a region with a trigger in O' → `at(triggerIndex)`.
 * 3. Otherwise, with an O' element preceding the region root →
 *    `at(precedingIndex)`.
 * 4. Otherwise → `before-first`.
 *
 * @param args Indices into O' and the in-region flag; see {@link StartPositionArgs}.
 * @returns The {@link StartPosition} to count the chunk move from.
 */
export function mapStartPosition(args: StartPositionArgs): StartPosition {
  const { focusedIndex, focusInRegion, triggerIndex, precedingIndex } = args;

  if (!focusInRegion) {
    // Focus outside all regions: count from the focused element itself, or
    // fall back to the existing "no current focus" rule.
    return focusedIndex >= 0 ? { kind: "at", index: focusedIndex } : { kind: "none" };
  }

  // Focus inside a region: count from the trigger, as native Tab would after
  // leaving the region (Requirement 2.4).
  if (triggerIndex >= 0) {
    return { kind: "at", index: triggerIndex };
  }

  // No usable trigger: count from the last O' element before the region root.
  if (precedingIndex >= 0) {
    return { kind: "at", index: precedingIndex };
  }

  // The region precedes every O' element.
  return { kind: "before-first" };
}

/**
 * Compute the target index in O' for a chunk move from a {@link StartPosition}
 * (Requirements 2.1, 2.4, 3.1-3.4; design Property 4).
 *
 * - `at(i)` → `computeTargetIndex(direction, i, chunkSize, length)`;
 * - `none` → `computeTargetIndex(direction, NO_TARGET, chunkSize, length)`;
 * - `before-first` → `min(chunkSize - 1, length - 1)` forward and `0` backward
 *   (the anchor sits just before `O'[0]`, so a backward move clamps to the
 *   first element).
 *
 * Every case returns {@link NO_TARGET} when `length == 0` so the caller leaves
 * focus unchanged (Requirement 3.4).
 *
 * @param direction The navigation direction (`"forward"` or `"backward"`).
 * @param start     The resolved start position in O'.
 * @param chunkSize The number of elements to move by (a positive integer,
 *                  expected in `[1, 100]`).
 * @param length    The length `n` of O'.
 * @returns The target index in `[0, n-1]`, or {@link NO_TARGET} when O' is empty.
 */
export function resolveNavigationTarget(
  direction: Direction,
  start: StartPosition,
  chunkSize: number,
  length: number,
): number {
  switch (start.kind) {
    case "at":
      return computeTargetIndex(direction, start.index, chunkSize, length);
    case "none":
      return computeTargetIndex(direction, NO_TARGET, chunkSize, length);
    case "before-first":
      // Empty O': no-op in either direction (Requirement 3.4).
      if (length === 0) {
        return NO_TARGET;
      }
      return direction === "forward" ? Math.min(chunkSize - 1, length - 1) : 0;
  }
}

// ---------------------------------------------------------------------------
// DOM region detection and start resolution
// ---------------------------------------------------------------------------

/**
 * Allowlist of overlay containers: portal roots that frameworks render popups
 * into, typically as the last child of `<body>`. Every child of a matching
 * element is a Popup_Region root. Primer React uses `#__primerPortalRoot__`;
 * `[data-portal-root]` covers Primer's configurable portals. Extend here.
 */
export const OVERLAY_CONTAINER_SELECTOR = "#__primerPortalRoot__, [data-portal-root]";

/**
 * ARIA roles that mark an element as a popup container. On their own they do
 * NOT make a Popup_Region (a page may wrap its main content in `role=dialog`);
 * they only qualify an `aria-expanded` trigger link.
 */
const POPUP_CONTAINER_ROLES: ReadonlySet<string> = new Set([
  "dialog",
  "alertdialog",
  "menu",
  "listbox",
  "tree",
  "grid",
]);

/** Split an IDREF list attribute (`aria-controls`, `aria-owns`) on whitespace. */
function splitIdList(value: string | null): string[] {
  if (value === null) {
    return [];
  }
  return value.split(/\s+/).filter((id) => id !== "");
}

/**
 * True when `trigger` declares a popup via `aria-haspopup`. Any value other than
 * `"false"` counts; an empty value is ARIA's default (`false`) and doesn't.
 */
function hasPopupSignal(trigger: Element): boolean {
  const value = trigger.getAttribute("aria-haspopup");
  if (value === null) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized !== "" && normalized !== "false";
}

/**
 * True when `element` is a popup container: a popup `role`, a `[popover]`, a
 * `<dialog>`, or anything inside an overlay container. Used only to qualify an
 * `aria-expanded` trigger link, so disclosure panels (plain regions) stay out.
 */
function isPopupContainer(element: Element): boolean {
  const roles = splitIdList(element.getAttribute("role")).map((role) =>
    role.toLowerCase(),
  );
  if (roles.some((role) => POPUP_CONTAINER_ROLES.has(role))) {
    return true;
  }
  if (element.hasAttribute("popover") || element.localName === "dialog") {
    return true;
  }
  return element.parentElement?.closest(OVERLAY_CONTAINER_SELECTOR) != null;
}

/**
 * True when `trigger` may be paired with `root`: a trigger can't be the region
 * root itself, and can't sit inside it (for example a popover's own close
 * button carrying `popovertarget`).
 */
function isOutsideRoot(trigger: Element, root: Element): boolean {
  return trigger !== root && !root.contains(trigger);
}

/**
 * Index the elements carrying an id-reference attribute by referenced id, in
 * document order. `list` splits the value on whitespace (IDREF lists such as
 * `aria-controls`); otherwise the whole value is one id (`popovertarget`,
 * `commandfor`).
 */
function indexIdReferences(
  document: Document,
  attribute: string,
  list: boolean,
): Map<string, HTMLElement[]> {
  const index = new Map<string, HTMLElement[]>();
  const referrers = document.querySelectorAll<HTMLElement>(`[${attribute}]`);
  for (const referrer of Array.from(referrers)) {
    const value = referrer.getAttribute(attribute);
    const ids = list ? splitIdList(value) : value ? [value] : [];
    for (const id of ids) {
      const existing = index.get(id);
      if (existing === undefined) {
        index.set(id, [referrer]);
      } else {
        existing.push(referrer);
      }
    }
  }
  return index;
}

/**
 * Find the first element, trying each index in turn, that references `root` by
 * id and sits outside it. Returns `null` when `root` has no id or no such
 * element exists.
 */
function findReferringTrigger(
  root: Element,
  indexes: readonly Map<string, HTMLElement[]>[],
): HTMLElement | null {
  if (root.id === "") {
    return null;
  }
  for (const index of indexes) {
    const trigger = index
      .get(root.id)
      ?.find((candidate) => isOutsideRoot(candidate, root));
    if (trigger !== undefined) {
      return trigger;
    }
  }
  return null;
}

/** True when `element` can act as a Popup_Trigger: a popup or expanded state. */
function isPopupTrigger(element: Element): boolean {
  return hasPopupSignal(element) || element.hasAttribute("aria-expanded");
}

/**
 * The value of a declaration in an element's inline `style` attribute, or
 * `null` when absent (the last declaration wins). Read from the attribute
 * rather than `element.style` so newer properties such as `anchor-name` and
 * `position-anchor` are found even where the CSSOM doesn't know them.
 */
function inlineStyleValue(element: Element, property: string): string | null {
  const style = element.getAttribute("style");
  if (style === null) {
    return null;
  }
  let value: string | null = null;
  for (const declaration of style.split(";")) {
    const colon = declaration.indexOf(":");
    if (colon !== -1 && declaration.slice(0, colon).trim().toLowerCase() === property) {
      value = declaration
        .slice(colon + 1)
        .replace(/!important\s*$/i, "")
        .trim();
    }
  }
  return value;
}

/** The dashed-ident names (`--name`) in an `anchor-name` / `position-anchor` value. */
function anchorNames(value: string | null): string[] {
  if (value === null) {
    return [];
  }
  return value
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.startsWith("--"));
}

/** Index the elements declaring an inline `anchor-name`, by anchor name. */
function indexAnchorNames(document: Document): Map<string, HTMLElement[]> {
  const index = new Map<string, HTMLElement[]>();
  const anchors = document.querySelectorAll<HTMLElement>('[style*="anchor-name"]');
  for (const anchor of Array.from(anchors)) {
    for (const name of anchorNames(inlineStyleValue(anchor, "anchor-name"))) {
      const existing = index.get(name);
      if (existing === undefined) {
        index.set(name, [anchor]);
      } else {
        existing.push(anchor);
      }
    }
  }
  return index;
}

/**
 * The Popup_Trigger that `element` is positioned against with CSS anchor
 * positioning (`position-anchor: --x` matching a trigger's `anchor-name: --x`),
 * or `null`. The trigger must sit outside `root` and carry a popup or expanded
 * state, so tooltips anchored to plain buttons don't count.
 */
function anchoredTrigger(
  element: Element,
  root: Element,
  anchors: ReadonlyMap<string, readonly HTMLElement[]>,
): HTMLElement | null {
  for (const name of anchorNames(inlineStyleValue(element, "position-anchor"))) {
    const trigger = anchors
      .get(name)
      ?.find((candidate) => isOutsideRoot(candidate, root) && isPopupTrigger(candidate));
    if (trigger !== undefined) {
      return trigger;
    }
  }
  return null;
}

/**
 * Detect every Popup_Region in `document` (Requirements 2.1, 3.7, 3.8; design
 * "Region detection").
 *
 * Roots are recognised only through a trigger link or an unambiguous overlay
 * primitive:
 *
 * 1. Trigger-linked: for each element T with `aria-controls` / `aria-owns`, each
 *    referenced element R (looked up with `getElementById`) is a root with
 *    trigger T when T has `aria-haspopup` (not `"false"`), or T has
 *    `aria-expanded` and R is a popup container. R is rejected when it is T or
 *    contains T.
 * 2. `[popover]` elements (any state), with trigger from `popovertarget`, then
 *    `aria-controls`, else `null`.
 * 3. `<dialog>` elements (open or closed), with trigger from `popovertarget`,
 *    `commandfor`, then `aria-controls`, else `null`.
 * 4. Every child of an {@link OVERLAY_CONTAINER_SELECTOR} match, trigger `null`
 *    unless a link above already paired it.
 * 5. Anchor-linked: an element R whose inline `position-anchor` names the
 *    inline `anchor-name` of a trigger T outside R, when T has `aria-haspopup`
 *    (not `"false"`) or `aria-expanded`. Primer's AnchoredOverlay links its
 *    menu button to the overlay this way, with no `aria-controls`.
 *
 * A region still without a trigger after these rules gets one from, in order:
 * the `position-anchor` of its root or a descendant (the overlay inside a
 * portal wrapper); then, for an overlay-container child only, the one element
 * on the page with `aria-haspopup` and `aria-expanded="true"` that isn't
 * already a trigger, when exactly one exists.
 *
 * Unlinked `role=dialog` / `menu` / `listbox` containers outside an overlay
 * container are not regions, and neither are disclosure panels or tab panels,
 * so pages without popups get `[]` and keep today's Focus_Order.
 *
 * Roots are de-duplicated (the first discovered trigger wins; a `null` trigger
 * is upgraded when a later rule finds one). A root nested inside another root
 * stays a separate entry, so {@link regionContaining} can pick the innermost.
 *
 * @param document The document to scan.
 * @returns The detected regions, in discovery order.
 */
export function collectPopupRegions(document: Document): PopupRegion[] {
  const regions = new Map<Element, PopupRegion>();

  const addRegion = (root: Element, trigger: HTMLElement | null): void => {
    const existing = regions.get(root);
    if (existing === undefined) {
      regions.set(root, { root, trigger });
    } else if (existing.trigger === null && trigger !== null) {
      existing.trigger = trigger;
    }
  };

  // 1. Trigger-linked roots (primary signal).
  const linkers = document.querySelectorAll<HTMLElement>("[aria-controls], [aria-owns]");
  for (const trigger of Array.from(linkers)) {
    const hasPopup = hasPopupSignal(trigger);
    if (!hasPopup && !trigger.hasAttribute("aria-expanded")) {
      continue;
    }
    const ids = [
      ...splitIdList(trigger.getAttribute("aria-controls")),
      ...splitIdList(trigger.getAttribute("aria-owns")),
    ];
    for (const id of ids) {
      const root = document.getElementById(id);
      if (root === null || !isOutsideRoot(trigger, root)) {
        continue;
      }
      if (hasPopup || isPopupContainer(root)) {
        addRegion(root, trigger);
      }
    }
  }

  // Referrer indexes for the popover / dialog trigger lookups.
  const byPopoverTarget = indexIdReferences(document, "popovertarget", false);
  const byCommandFor = indexIdReferences(document, "commandfor", false);
  const byAriaControls = indexIdReferences(document, "aria-controls", true);

  // 2. `[popover]` roots.
  for (const root of Array.from(document.querySelectorAll("[popover]"))) {
    addRegion(root, findReferringTrigger(root, [byPopoverTarget, byAriaControls]));
  }

  // 3. `<dialog>` roots, open or closed.
  for (const root of Array.from(document.querySelectorAll("dialog"))) {
    addRegion(
      root,
      findReferringTrigger(root, [byPopoverTarget, byCommandFor, byAriaControls]),
    );
  }

  // 4. Children of overlay containers.
  const overlayChildren = new Set<Element>();
  const containers = document.querySelectorAll(OVERLAY_CONTAINER_SELECTOR);
  for (const container of Array.from(containers)) {
    for (const root of Array.from(container.children)) {
      overlayChildren.add(root);
      addRegion(root, null);
    }
  }

  // 5. Anchor-linked roots (CSS anchor positioning).
  const anchors = indexAnchorNames(document);
  const anchored = document.querySelectorAll('[style*="position-anchor"]');
  for (const root of Array.from(anchored)) {
    const trigger = anchoredTrigger(root, root, anchors);
    if (trigger !== null) {
      addRegion(root, trigger);
    }
  }

  // Triggers for regions that still have none.
  for (const region of regions.values()) {
    if (region.trigger !== null) {
      continue;
    }
    const positioned = [
      region.root,
      ...Array.from(region.root.querySelectorAll('[style*="position-anchor"]')),
    ];
    for (const element of positioned) {
      region.trigger = anchoredTrigger(element, region.root, anchors);
      if (region.trigger !== null) {
        break;
      }
    }
  }
  const expandedTrigger = soleExpandedTrigger(document, regions.values());
  if (expandedTrigger !== null) {
    for (const region of regions.values()) {
      if (
        region.trigger === null &&
        overlayChildren.has(region.root) &&
        isOutsideRoot(expandedTrigger, region.root)
      ) {
        region.trigger = expandedTrigger;
      }
    }
  }

  return Array.from(regions.values());
}

/**
 * The only element with `aria-haspopup` (not `"false"`) and
 * `aria-expanded="true"` that isn't already some region's trigger, or `null`
 * when there are none or several. An open popup whose trigger has no other link
 * to it (no `aria-controls`, no anchor) is almost always the one popup whose
 * trigger reports it as expanded.
 */
function soleExpandedTrigger(
  document: Document,
  regions: Iterable<PopupRegion>,
): HTMLElement | null {
  const used = new Set<Element>();
  for (const region of regions) {
    if (region.trigger !== null) {
      used.add(region.trigger);
    }
  }
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>("[aria-haspopup][aria-expanded]"),
  ).filter(
    (element) =>
      !used.has(element) &&
      hasPopupSignal(element) &&
      element.getAttribute("aria-expanded")?.trim().toLowerCase() === "true",
  );
  return candidates.length === 1 ? candidates[0] : null;
}

/**
 * The innermost region containing `element` (Requirement 2.1; design
 * "Membership"), or `null` when `element` is outside every region (or `null`).
 *
 * `root.contains` is inclusive, so a region root is a member of its own
 * region. A trigger that sits inside another region is a member of that outer
 * region and is excluded from O' along with it.
 *
 * @param regions The regions from {@link collectPopupRegions}.
 * @param element The element to locate, typically a Focus_Order entry or
 *                `document.activeElement`.
 * @returns The innermost containing region, or `null`.
 */
export function regionContaining(
  regions: readonly PopupRegion[],
  element: Element | null,
): PopupRegion | null {
  if (element === null) {
    return null;
  }
  let innermost: PopupRegion | null = null;
  for (const region of regions) {
    if (!region.root.contains(element)) {
      continue;
    }
    // Both roots contain `element`, so one contains the other; keep the deeper.
    if (innermost === null || innermost.root.contains(region.root)) {
      innermost = region;
    }
  }
  return innermost;
}

/**
 * Largest index `k` such that `orderPrime[k]` precedes `root` in document
 * order, or {@link NO_TARGET} when none does. O' may not be in document order
 * (positive tabindex first), so this scans from the end.
 */
function lastIndexPreceding(orderPrime: readonly HTMLElement[], root: Element): number {
  for (let k = orderPrime.length - 1; k >= 0; k -= 1) {
    if (root.compareDocumentPosition(orderPrime[k]) & Node.DOCUMENT_POSITION_PRECEDING) {
      return k;
    }
  }
  return NO_TARGET;
}

/**
 * Resolve where a chunk move is counted from in O' (Requirement 2.4; design
 * Property 4), delegating the precedence rules to {@link mapStartPosition}.
 *
 * - Focus outside every region: the focused element's index in O'
 *   ({@link indexOfCurrentFocus}), so region-free pages behave as today.
 * - Focus inside a region: climb trigger → region → trigger while the trigger is
 *   itself inside a region (capped at `regions.length` steps so cyclic links
 *   terminate), then use the outermost trigger's index in O'.
 * - No usable trigger (none discovered, not in O', or a cycle): the last O'
 *   element preceding the region root, where the root is the region the climb
 *   stopped at (the active element's own region after a cycle), or
 *   `before-first` when nothing precedes it.
 *
 * @param orderPrime The filtered order O' (no region members).
 * @param active     The Currently_Focused_Element (`document.activeElement`).
 * @param regions    The regions from {@link collectPopupRegions}.
 * @returns The {@link StartPosition} to pass to {@link resolveNavigationTarget}.
 */
export function resolveStartPosition(
  orderPrime: readonly HTMLElement[],
  active: Element | null,
  regions: readonly PopupRegion[],
): StartPosition {
  const focusedIndex = indexOfCurrentFocus(orderPrime, active);
  const activeRegion = regionContaining(regions, active);

  if (activeRegion === null) {
    return mapStartPosition({
      focusedIndex,
      focusInRegion: false,
      triggerIndex: NO_TARGET,
      precedingIndex: NO_TARGET,
    });
  }

  // Climb to the outermost trigger that sits outside every region.
  let region = activeRegion;
  let trigger = region.trigger;
  for (let steps = 0; trigger !== null; steps += 1) {
    const outer = regionContaining(regions, trigger);
    if (outer === null) {
      break;
    }
    if (steps >= regions.length) {
      // Cyclic trigger links: give up on the trigger and anchor on the
      // active element's own region.
      trigger = null;
      region = activeRegion;
      break;
    }
    region = outer;
    trigger = outer.trigger;
  }

  const triggerIndex = trigger === null ? NO_TARGET : orderPrime.indexOf(trigger);
  // Only scan for a preceding element when the trigger can't be used.
  const precedingIndex =
    triggerIndex >= 0 ? NO_TARGET : lastIndexPreceding(orderPrime, region.root);

  return mapStartPosition({
    focusedIndex,
    focusInRegion: true,
    triggerIndex,
    precedingIndex,
  });
}
