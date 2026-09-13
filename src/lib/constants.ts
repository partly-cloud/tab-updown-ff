/**
 * Shared constants for the Tab-Updown extension.
 *
 * DOM-free pure values imported by the settings, hotkeys, focus, background,
 * content, and options modules. See design.md "Constants".
 */

/** Chunk_Size used when the user has not configured one (Requirement 3.4). */
export const DEFAULT_CHUNK_SIZE = 5;

/** Minimum valid Chunk_Size, inclusive. */
export const CHUNK_SIZE_MIN = 1;

/** Maximum valid Chunk_Size, inclusive. */
export const CHUNK_SIZE_MAX = 100;

/** Forward_Hotkey used when the user has not configured one (Requirement 4.1, 4.5). */
export const DEFAULT_FORWARD_HOTKEY = "Alt+Shift+Down" as const;

/** Backward_Hotkey used when the user has not configured one (Requirement 4.1, 4.6). */
export const DEFAULT_BACKWARD_HOTKEY = "Alt+Shift+Up" as const;

/** `commands` manifest key / API name for the forward navigation command. */
export const FORWARD_COMMAND_NAME = "tab-updown-forward" as const;

/** `commands` manifest key / API name for the backward navigation command. */
export const BACKWARD_COMMAND_NAME = "tab-updown-backward" as const;
