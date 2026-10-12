/**
 * Mirror of the navigation shortcuts in `storage.local`, for the Content_Script.
 *
 * Firefox delivers an extension shortcut's `keydown` to the page before it
 * runs the command, so the Content_Script needs the active shortcuts to keep
 * them away from page handlers (see `installHotkeyGuard` in src/content.ts).
 * Content scripts can't call `commands.getAll()`, so the Background_Script and
 * the Options_Page copy the shortcuts into `storage.local` under
 * {@link SHORTCUTS_KEY}, and the Content_Script reads that copy and follows
 * `storage.onChanged`.
 */

import {
  BACKWARD_COMMAND_NAME,
  DEFAULT_BACKWARD_HOTKEY,
  DEFAULT_FORWARD_HOTKEY,
  FORWARD_COMMAND_NAME,
} from "./constants";

/** Storage key holding the {@link NavigationShortcuts} copy. */
export const SHORTCUTS_KEY = "shortcuts";

/**
 * The active Shortcut_String for each navigation command. An empty string
 * means the command has no shortcut assigned.
 */
export interface NavigationShortcuts {
  forward: string;
  backward: string;
}

/** The manifest defaults, used until the first copy has been written. */
export const DEFAULT_SHORTCUTS: Readonly<NavigationShortcuts> = {
  forward: DEFAULT_FORWARD_HOTKEY,
  backward: DEFAULT_BACKWARD_HOTKEY,
};

/**
 * Read a stored {@link NavigationShortcuts} value. Absent or malformed fields
 * fall back to {@link DEFAULT_SHORTCUTS}.
 */
export function parseStoredShortcuts(value: unknown): NavigationShortcuts {
  const stored =
    typeof value === "object" && value !== null
      ? (value as { forward?: unknown; backward?: unknown })
      : {};
  return {
    forward: typeof stored.forward === "string" ? stored.forward : DEFAULT_SHORTCUTS.forward,
    backward: typeof stored.backward === "string" ? stored.backward : DEFAULT_SHORTCUTS.backward,
  };
}

/**
 * Copy the active shortcuts from `commands.getAll()` into `storage.local`.
 *
 * A command missing from `getAll()` keeps its default; a command reported with
 * no shortcut is stored as `""`. Skips the write when the stored copy is
 * already current, so waking the Background_Script doesn't fire
 * `storage.onChanged` in every tab.
 */
export async function syncShortcutsToStorage(): Promise<void> {
  const commands = await browser.commands.getAll();
  const shortcutOf = (name: string, fallback: string): string => {
    const command = commands.find((entry) => entry.name === name);
    return command === undefined ? fallback : (command.shortcut ?? "");
  };
  const next: NavigationShortcuts = {
    forward: shortcutOf(FORWARD_COMMAND_NAME, DEFAULT_SHORTCUTS.forward),
    backward: shortcutOf(BACKWARD_COMMAND_NAME, DEFAULT_SHORTCUTS.backward),
  };

  const stored = (await browser.storage.local.get(SHORTCUTS_KEY))[SHORTCUTS_KEY] as
    | Partial<NavigationShortcuts>
    | undefined;
  if (stored?.forward === next.forward && stored?.backward === next.backward) {
    return;
  }
  await browser.storage.local.set({ [SHORTCUTS_KEY]: next });
}
