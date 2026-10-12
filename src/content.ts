/**
 * Content_Script for the Tab-Updown extension.
 *
 * Injected into web pages (see manifest `content_scripts`). Listens for
 * navigation messages relayed by the Background_Script and moves keyboard focus
 * through the page's Focus_Order in chunks. All focus computation happens here,
 * where the live DOM and `document.activeElement` are available. The pure
 * arithmetic (`computeTargetIndex`) and Focus_Order construction
 * (`buildFocusOrder`, `indexOfCurrentFocus`) live in `src/lib/focus.ts`; the
 * Popup_Region detection and start/target resolution live in
 * `src/lib/popup.ts`; the Chunk_Size normalization lives in
 * `src/lib/settings.ts`.
 *
 * It also keeps the extension's own hotkeys away from the page (see
 * {@link installHotkeyGuard}): Firefox hands a shortcut's `keydown` to the page
 * before it runs the command, and some popup triggers open on it.
 *
 * See design.md "Content_Script" and "Messaging Protocol", and the
 * expanded-popup-focus-trap-fix design.md "Fix Implementation".
 */

import { buildFocusOrder, type Direction } from "./lib/focus";
import { detectIsMac, shortcutMatchesKeyEvent } from "./lib/hotkeys";
import {
  collectPopupRegions,
  excludePopupRegions,
  regionContaining,
  resolveNavigationTarget,
  resolveStartPosition,
} from "./lib/popup";
import { normalizeChunkSize } from "./lib/settings";
import {
  DEFAULT_SHORTCUTS,
  parseStoredShortcuts,
  SHORTCUTS_KEY,
  type NavigationShortcuts,
} from "./lib/shortcut-sync";

/**
 * The single message type relayed from the Background_Script to the
 * Content_Script (design.md "Messaging Protocol"). A `type` of `"navigate"`
 * with a `direction` requests a chunked forward/backward focus move.
 */
interface NavigateMessage {
  type: "navigate";
  direction: Direction;
}

/** Storage key under which the Chunk_Size is persisted in `storage.local`. */
const CHUNK_SIZE_KEY = "chunkSize";

/**
 * Type guard for the navigation message. Anything whose `type` is not exactly
 * `"navigate"` (or that is not an object) is ignored (design.md Error Handling:
 * "Unexpected message type received by content script").
 */
function isNavigateMessage(message: unknown): message is NavigateMessage {
  if (typeof message !== "object" || message === null) {
    return false;
  }
  const candidate = message as { type?: unknown; direction?: unknown };
  return (
    candidate.type === "navigate" &&
    (candidate.direction === "forward" || candidate.direction === "backward")
  );
}

/**
 * Read the stored Chunk_Size from `storage.local` (Requirement 5.3). Returns the
 * raw stored value (possibly absent/corrupt); normalization is applied by the
 * caller via {@link normalizeChunkSize}.
 */
async function readStoredChunkSize(): Promise<unknown> {
  const result = await browser.storage.local.get(CHUNK_SIZE_KEY);
  return result[CHUNK_SIZE_KEY];
}

/**
 * Handle a navigation message: read and normalize the Chunk_Size, build the
 * Focus_Order, drop every Popup_Region member from it, resolve where the move
 * is counted from, compute the target index, and move focus (tab-updown
 * Requirements 5.3, 1.1, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 3.6).
 *
 * Popup_Regions (expanded-popup-focus-trap-fix, GitHub issue #18): native Tab
 * never enters a popup, dialog, or overlay from the page sequence, so region
 * members are removed from the Focus_Order, giving the filtered order O'
 * (bugfix Requirement 2.1). Focus outside every region counts from its own
 * index in O' (3.6); focus inside a region counts from the region's
 * Popup_Trigger (2.4). The target is always an O' element, so focus never
 * lands inside a region (2.2, 2.3, 2.5). On a page without regions, O' equals
 * the full Focus_Order and the start is `indexOfCurrentFocus`, so targets are
 * identical to before (3.8).
 *
 * When O' is empty, `resolveNavigationTarget` returns the no-op sentinel and no
 * focus change is performed (Requirements 1.5, 2.4; bugfix 3.4).
 */
export async function handleNavigate(direction: Direction): Promise<void> {
  // Read the freshest Chunk_Size on each navigation (Requirement 5.3), falling
  // back to the default for absent/corrupt values (Requirement 3.6).
  const chunkSize = normalizeChunkSize(await readStoredChunkSize());

  // Build the region-free order O': the full Focus_Order minus every element
  // inside a Popup_Region (Popup_Triggers outside regions are kept).
  const regions = collectPopupRegions(document);
  const order = excludePopupRegions(
    buildFocusOrder(document),
    (element) => regionContaining(regions, element) !== null,
  );
  const start = resolveStartPosition(order, document.activeElement, regions);
  const target = resolveNavigationTarget(direction, start, chunkSize, order.length);

  // `target === -1` is the no-op sentinel for an empty Focus_Order; guarding on
  // a valid in-range index leaves focus unchanged when there is nothing to focus.
  if (target >= 0 && target < order.length) {
    order[target].focus();
  }
}

/**
 * The `runtime.onMessage` listener. Ignores any message that is not a
 * `"navigate"` message; otherwise runs {@link handleNavigate}. The send is
 * fire-and-forget, so no response is returned.
 */
export function onMessage(message: unknown): void {
  if (!isNavigateMessage(message)) {
    return;
  }
  // Fire-and-forget: the background does not await a response. Any rejection
  // from storage/focus is swallowed so it does not surface as an unhandled
  // rejection in the page.
  void handleNavigate(message.direction);
}

/** The active navigation shortcuts, kept in step with `storage.local`. */
let shortcuts: NavigationShortcuts = { ...DEFAULT_SHORTCUTS };

/** Platform flag for shortcut matching (`Ctrl` means Command on macOS). */
const isMac = detectIsMac();

/**
 * Capture-phase `keydown` listener on `window`: when the key event is one of
 * the extension's navigation shortcuts, stop it before any page handler sees
 * it (expanded-popup-focus-trap-fix, GitHub issue #18).
 *
 * Firefox dispatches an extension shortcut's `keydown` to the page first and
 * only runs the command afterwards. Primer's menu buttons (GitHub's branch
 * picker, "Code" button, and others) open on any ArrowDown/ArrowUp keydown,
 * modifiers or not, then move focus into the menu and trap it there. Native
 * Tab never sends an ArrowDown, so it never opens them; without this guard,
 * Alt+Shift+Down on such a button would.
 *
 * Only propagation is stopped. The default action is left alone, because a
 * cancelled `keydown` would also stop Firefox from running the command.
 */
export function onShortcutKeydown(event: KeyboardEvent): void {
  const pressed = {
    ctrl: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
    meta: event.metaKey,
    key: event.key,
    code: event.code,
    isMac,
  };
  if (
    shortcutMatchesKeyEvent(shortcuts.forward, pressed) ||
    shortcutMatchesKeyEvent(shortcuts.backward, pressed)
  ) {
    event.stopImmediatePropagation();
  }
}

/** Follow shortcut changes written by the Background_Script or Options_Page. */
function onStorageChanged(
  changes: Record<string, browser.storage.StorageChange>,
  areaName: string,
): void {
  if (areaName === "local" && SHORTCUTS_KEY in changes) {
    shortcuts = parseStoredShortcuts(changes[SHORTCUTS_KEY].newValue);
  }
}

/**
 * Register the hotkey guard. The manifest injects this script at
 * `document_start`, so the window capture listener is in place before page
 * scripts add theirs, and it runs before any listener on the document or an
 * element.
 */
function installHotkeyGuard(): void {
  window.addEventListener("keydown", onShortcutKeydown, { capture: true });
  browser.storage.onChanged.addListener(onStorageChanged);
  browser.storage.local.get(SHORTCUTS_KEY).then(
    (result) => {
      shortcuts = parseStoredShortcuts(result[SHORTCUTS_KEY]);
    },
    () => {
      // Keep the defaults when storage can't be read.
    },
  );
}

// Register the listeners at module load so the injected content script starts
// handling navigation messages and guarding hotkeys immediately.
browser.runtime.onMessage.addListener(onMessage);
installHotkeyGuard();
