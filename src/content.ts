/**
 * Content_Script for the Tab-Updown extension.
 *
 * Injected into web pages (see manifest `content_scripts`). Listens for
 * navigation messages relayed by the Background_Script and moves keyboard focus
 * through the page's Focus_Order in chunks. All focus computation happens here,
 * where the live DOM and `document.activeElement` are available. The pure
 * arithmetic (`computeTargetIndex`) and Focus_Order construction
 * (`buildFocusOrder`, `indexOfCurrentFocus`) live in `src/lib/focus.ts`; the
 * Chunk_Size normalization lives in `src/lib/settings.ts`.
 *
 * See design.md "Content_Script" and "Messaging Protocol".
 */

import {
  buildFocusOrder,
  computeTargetIndex,
  indexOfCurrentFocus,
  type Direction,
} from "./lib/focus";
import { normalizeChunkSize } from "./lib/settings";

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
 * Focus_Order, locate the current focus, compute the target index, and move
 * focus (Requirements 5.3, 1.1, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 3.6).
 *
 * When the Focus_Order is empty, `computeTargetIndex` returns the no-op sentinel
 * and no focus change is performed (Requirements 1.5, 2.4).
 */
export async function handleNavigate(direction: Direction): Promise<void> {
  // Read the freshest Chunk_Size on each navigation (Requirement 5.3), falling
  // back to the default for absent/corrupt values (Requirement 3.6).
  const chunkSize = normalizeChunkSize(await readStoredChunkSize());

  const order = buildFocusOrder(document);
  const currentIndex = indexOfCurrentFocus(order, document.activeElement);
  const target = computeTargetIndex(
    direction,
    currentIndex,
    chunkSize,
    order.length,
  );

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

// Register the listener at module load so the injected content script starts
// handling navigation messages immediately.
browser.runtime.onMessage.addListener(onMessage);
