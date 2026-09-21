/**
 * Background_Script for the Tab-Updown extension.
 *
 * A thin, non-persistent event page (see design.md "Background_Script"). Its
 * only job is to translate `commands` API events into a navigation message sent
 * to the Content_Script in the active tab (Requirements 5.1, 5.2). Focus
 * computation and movement live entirely in the Content_Script.
 *
 * The `browser.commands.onCommand` listener is registered at the top level of
 * the module so Firefox can wake the event page when a command fires.
 */

import {
  FORWARD_COMMAND_NAME,
  BACKWARD_COMMAND_NAME,
} from "./lib/constants.js";
import type { Direction } from "./lib/focus.js";

/**
 * The message relayed from the Background_Script to the Content_Script
 * (design.md "Messaging Protocol"). A single `type` flows background → content;
 * the content script filters on `type === "navigate"` and ignores anything else.
 */
export interface NavigateMessage {
  type: "navigate";
  direction: Direction;
}

/**
 * Map a fired command name to a navigation {@link Direction}, or `null` for any
 * command this extension does not handle (Requirement 5.1, 5.2).
 */
function directionForCommand(commandName: string): Direction | null {
  switch (commandName) {
    case FORWARD_COMMAND_NAME:
      return "forward";
    case BACKWARD_COMMAND_NAME:
      return "backward";
    default:
      return null;
  }
}

/**
 * Handle a fired command: resolve the active tab and relay a `navigate` message
 * to its Content_Script.
 *
 * No-op paths (leave focus unchanged, Requirement 5.4):
 * - the command is not one of ours,
 * - there is no active tab in the current window, or the tab has no `id`,
 * - `tabs.sendMessage` rejects (no receiver / restricted page).
 */
export async function handleCommand(commandName: string): Promise<void> {
  const direction = directionForCommand(commandName);
  if (direction === null) {
    return;
  }

  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (tab === undefined || tab.id === undefined) {
    // No active tab to receive the message (Requirement 5.4).
    return;
  }

  const message: NavigateMessage = { type: "navigate", direction };
  try {
    await browser.tabs.sendMessage(tab.id, message);
  } catch {
    // No content script in the target tab (e.g. a privileged page) — take no
    // action and leave focus unchanged (Requirement 5.4).
  }
}

// Register at the top level so Firefox can wake this event page when a command
// fires (Requirement 5.1, 5.2).
browser.commands.onCommand.addListener((commandName: string) => {
  // Fire-and-forget: the send is initiated synchronously on receiving the
  // command; any rejection is handled inside `handleCommand`.
  void handleCommand(commandName);
});
