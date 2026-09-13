# Requirements Document

## Introduction

Tab-Updown is a Firefox browser extension (WebExtension) that augments keyboard-based
navigation on web pages. Analogous to how the Page Up and Page Down keys move the
viewport in larger increments than the arrow keys, Tab-Updown lets a user advance
focus through a page's focusable elements in configurable chunks — jumping over
multiple elements per keypress instead of one at a time via the standard Tab key.

The extension exposes two user-configurable settings: the chunk size (how many
focusable elements to skip per activation) and the activation hotkey. Both settings
have sensible defaults and persist across browser sessions. The extension is built
following the Mozilla WebExtensions guidelines, using the `commands` manifest key and
API for the hotkey, the `storage` API for settings persistence, an `options_ui`
settings page, and a content script to move focus within the page.

## Glossary

- **Extension**: The Tab-Updown Firefox WebExtension as a whole, comprising the
  manifest, background script, content script, and options page.
- **Content_Script**: The component injected into web pages that reads the document's
  focusable elements and moves focus.
- **Background_Script**: The extension's background/event component that listens for
  command events and coordinates with the Content_Script via messaging.
- **Options_Page**: The `options_ui` settings page where the user views and changes
  the chunk size and hotkey.
- **Settings_Store**: The persistent storage (WebExtensions `storage` API) that holds
  the user's configured settings.
- **Focusable_Element**: A DOM element that can receive keyboard focus in the current
  document, in the browser's normal tab order (for example links, buttons, form
  fields, and elements with a non-negative `tabindex`).
- **Focus_Order**: The ordered sequence of Focusable_Elements as the browser would
  visit them using the Tab key, from first to last.
- **Chunk_Size**: The number of Focusable_Elements the Extension advances focus by on
  a single forward activation, and reverses focus by on a single backward activation.
  The Chunk_Size is a configurable integer in the range 1 to 100 inclusive.
- **Forward_Hotkey**: The user-configurable keyboard shortcut that advances focus
  forward by one Chunk_Size.
- **Backward_Hotkey**: The user-configurable keyboard shortcut that moves focus
  backward by one Chunk_Size.
- **Default_Chunk_Size**: The Chunk_Size value used when the user has not configured
  one; defined as 5. The valid configurable Chunk_Size range is an integer from 1 to
  100 inclusive.
- **Default_Forward_Hotkey**: The Forward_Hotkey used when the user has not configured
  one; defined as `Alt+Shift+Down`.
- **Default_Backward_Hotkey**: The Backward_Hotkey used when the user has not
  configured one; defined as `Alt+Shift+Up`.
- **Currently_Focused_Element**: The Focusable_Element that holds focus at the moment a
  hotkey activation is processed, or none if no Focusable_Element holds focus.
- **Hotkey_Recorder**: The Options_Page mechanism that captures a physical key
  combination the user presses while a hotkey field is focused and translates it into a
  Firefox command shortcut string, rather than requiring the user to type the string by
  hand.
- **Shortcut_String**: A key-combination string in Firefox's `commands` shortcut
  grammar — a main modifier (one of Ctrl, Alt, Command, MacCtrl) with an optional
  differing secondary modifier and a key (A-Z, 0-9, F1-F12, or one of Comma, Period,
  Home, End, PageUp, PageDown, Space, Insert, Delete, Up, Down, Left, Right); function
  keys (F1-F12) may stand alone without a modifier.
- **Valid_Combination**: A pressed key combination that maps to a well-formed
  Shortcut_String — that is, a mappable key together with the modifiers Firefox
  requires (a main modifier, unless the key is a function key).

## Requirements

### Requirement 1: Chunked Forward Focus Navigation

**User Story:** As a keyboard user, I want to move focus forward by several focusable
elements at once, so that I can navigate a page faster than pressing Tab repeatedly.

#### Acceptance Criteria

1. WHEN the Forward_Hotkey is activated on a web page and a Currently_Focused_Element exists in the Focus_Order, THE Content_Script SHALL move focus forward along the Focus_Order by a number of Focusable_Elements equal to the Chunk_Size.
2. THE Content_Script SHALL include in the Focus_Order only Focusable_Elements that are both visible (not hidden via display, visibility, or zero dimensions) and enabled (not disabled), ordered by their tab order.
3. WHEN the Forward_Hotkey is activated and no Focusable_Element in the Focus_Order holds focus, THE Content_Script SHALL move focus to the Focusable_Element at the position equal to the Chunk_Size counted from the first element in the Focus_Order.
4. IF advancing forward by the Chunk_Size would move past the last Focusable_Element in the Focus_Order, THEN THE Content_Script SHALL move focus to the last Focusable_Element in the Focus_Order.
5. IF the current document contains no Focusable_Element, THEN THE Content_Script SHALL leave the current focus state unchanged and take no further action.

### Requirement 2: Chunked Backward Focus Navigation

**User Story:** As a keyboard user, I want to move focus backward by several focusable
elements at once, so that I can return to earlier controls quickly.

#### Acceptance Criteria

1. WHEN the Backward_Hotkey is activated on a web page and a Currently_Focused_Element exists in the Focus_Order, THE Content_Script SHALL move focus backward along the Focus_Order by a number of Focusable_Elements equal to the Chunk_Size.
2. WHEN the Backward_Hotkey is activated AND no Focusable_Element holds focus, THE Content_Script SHALL move focus to the last Focusable_Element in the Focus_Order.
3. IF moving backward by the Chunk_Size would move before the first Focusable_Element in the Focus_Order, THEN THE Content_Script SHALL move focus to the first Focusable_Element in the Focus_Order.
4. IF the current document contains no Focusable_Element, THEN THE Content_Script SHALL leave focus unchanged and take no focus-changing action.
5. IF the Backward_Hotkey is activated AND the Currently_Focused_Element is not present in the Focus_Order, THEN THE Content_Script SHALL move focus to the last Focusable_Element in the Focus_Order.

### Requirement 3: Configurable Chunk Size

**User Story:** As a user, I want to set how many elements each jump skips, so that I
can tune navigation to my preference.

#### Acceptance Criteria

1. THE Options_Page SHALL present a control for the user to set the Chunk_Size to an integer from 1 to 100 inclusive.
2. WHEN the user submits a Chunk_Size that is an integer from 1 to 100 inclusive, THE Options_Page SHALL save the value to the Settings_Store and display a save confirmation.
3. WHEN a Chunk_Size value exists in the Settings_Store, THE Content_Script SHALL use the stored value as the Chunk_Size for navigation.
4. WHILE no Chunk_Size value exists in the Settings_Store, THE Content_Script SHALL use the Default_Chunk_Size (5) as the Chunk_Size for navigation.
5. IF the user submits a Chunk_Size that is non-numeric or outside the range 1 to 100 inclusive, THEN THE Options_Page SHALL reject the value, retain the previously stored value, and display a validation message identifying the invalid value.
6. IF the Chunk_Size read from the Settings_Store is absent or outside the range 1 to 100 inclusive, THEN THE Content_Script SHALL apply the Default_Chunk_Size (5) before moving focus.

### Requirement 4: Configurable Hotkeys

**User Story:** As a user, I want to choose the keys that trigger chunked tabbing, so
that the shortcut does not conflict with other tools I use.

#### Acceptance Criteria

1. THE Extension SHALL declare the Forward_Hotkey and the Backward_Hotkey as commands in the manifest, with the Default_Forward_Hotkey and Default_Backward_Hotkey as their respective default key combinations.
2. THE Options_Page SHALL present a control for the user to set the key combination for the Forward_Hotkey and a control to set the key combination for the Backward_Hotkey.
3. WHEN the user submits a valid key combination for the Forward_Hotkey, THE Extension SHALL update the Forward_Hotkey command to that key combination.
4. WHEN the user submits a valid key combination for the Backward_Hotkey, THE Extension SHALL update the Backward_Hotkey command to that key combination.
5. WHILE the user has not configured the Forward_Hotkey, THE Extension SHALL use the Default_Forward_Hotkey.
6. WHILE the user has not configured the Backward_Hotkey, THE Extension SHALL use the Default_Backward_Hotkey.
7. IF the user submits a key combination that Firefox rejects as invalid for a command, THEN THE Options_Page SHALL retain the previously active key combination and display a validation message.
8. IF the user submits the same key combination for both the Forward_Hotkey and the Backward_Hotkey, THEN THE Options_Page SHALL reject the submission and display a conflict message.

### Requirement 5: Command Handling and Coordination

**User Story:** As a user, I want the shortcut to act on the page I am viewing, so that
focus moves within the content I am interacting with.

#### Acceptance Criteria

1. WHEN the Forward_Hotkey command is fired, THE Background_Script SHALL send a forward-navigation message to the Content_Script in the active tab within 100 milliseconds.
2. WHEN the Backward_Hotkey command is fired, THE Background_Script SHALL send a backward-navigation message to the Content_Script in the active tab within 100 milliseconds.
3. WHEN the Content_Script receives a navigation message, THE Content_Script SHALL read the current Chunk_Size from the Settings_Store before moving focus.
4. IF a Forward_Hotkey or Backward_Hotkey command is fired while no active tab exists or the active tab cannot receive messages, THEN THE Background_Script SHALL take no navigation action and SHALL leave focus unchanged.

### Requirement 6: Settings Persistence

**User Story:** As a user, I want my settings to be remembered, so that I do not have
to reconfigure the extension every session.

#### Acceptance Criteria

1. WHEN the user saves a Chunk_Size within the range 1 to 100 inclusive on the Options_Page, THE Settings_Store SHALL persist the value and retain it across browser restarts.
2. WHEN the Options_Page is opened, THE Options_Page SHALL display the Chunk_Size, Forward_Hotkey, and Backward_Hotkey values currently persisted in the Settings_Store.
3. WHERE no user-configured value exists in the Settings_Store for a setting, THE Options_Page SHALL display the corresponding default value.

### Requirement 7: WebExtensions Compliance

**User Story:** As a user, I want the extension to install and run as a standard Firefox
add-on, so that it works reliably and can be distributed through Firefox.

#### Acceptance Criteria

1. WHEN the Extension is loaded by Firefox, THE Extension SHALL provide a WebExtensions `manifest.json` that declares the extension metadata, the content script, the background script, the commands, and the options page.
2. THE Extension SHALL request only the permissions required to move focus on web pages and to persist settings, and SHALL request no additional host or API permissions beyond those needed.
3. WHEN a setting is changed by the user, THE Extension SHALL persist the setting using the WebExtensions `storage` API within 1 second of the change.
4. IF a storage API write fails, THEN THE Extension SHALL retain the previously persisted setting value and display an error indicating the setting could not be saved.
5. THE Extension SHALL define each configurable hotkey using the WebExtensions `commands` manifest key and the `commands` API.

### Requirement 8: Hotkey Recording on the Options Page

**User Story:** As a user, I want to set a hotkey by pressing the keys I want rather
than hand-typing a shortcut string, so that configuring the Forward_Hotkey and
Backward_Hotkey is fast and free of formatting mistakes.

This requirement refines how the user supplies the key combinations that Requirement 4
(Configurable Hotkeys) applies via the `commands` API; it changes the input mechanism
of the Forward_Hotkey and Backward_Hotkey controls without changing how a valid
combination is saved (Requirement 4.3, 4.4) or how a conflict is rejected (Requirement
4.8).

#### Acceptance Criteria

1. WHILE a hotkey field on the Options_Page holds keyboard focus, WHEN the user presses a key combination that forms a Valid_Combination, THE Hotkey_Recorder SHALL capture the combination and display the corresponding Shortcut_String in that field.
2. WHEN the Hotkey_Recorder captures a Valid_Combination, THE Hotkey_Recorder SHALL format the combination into Firefox's `commands` shortcut grammar, mapping the arrow keys to Up, Down, Left, and Right, the space key to Space, the comma key to Comma, the period key to Period, letters to their uppercase form, and each held modifier to its main or secondary modifier token.
3. IF the user presses a combination that is not a Valid_Combination, including a key with no required modifier or a press consisting only of modifier keys, THEN THE Hotkey_Recorder SHALL reject the combination, display a validation message, and retain the previously displayed Shortcut_String.
4. WHILE the Hotkey_Recorder is running on a Mac, WHERE the user holds the physical Control key, THE Hotkey_Recorder SHALL emit the MacCtrl token, and WHERE the user holds the Command key, THE Hotkey_Recorder SHALL emit the Command token.
5. THE Options_Page SHALL present, for each hotkey field, a reset control that restores that field's hotkey to the Default_Forward_Hotkey or the Default_Backward_Hotkey respectively.
6. WHEN the user activates a hotkey field's reset control, THE Options_Page SHALL restore the corresponding command to its default key combination and display the restored Shortcut_String in that field.
7. THE Options_Page SHALL allow the user to enter a Shortcut_String by typing into a hotkey field as an alternative to recording, so that a user who cannot press the key combination can still configure the hotkey.
8. WHEN the user submits a typed Shortcut_String, THE Options_Page SHALL accept the string only when it matches Firefox's `commands` shortcut grammar and SHALL otherwise reject it with a validation message and retain the previously active shortcut.
