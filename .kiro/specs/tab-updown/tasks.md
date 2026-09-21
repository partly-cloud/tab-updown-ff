# Implementation Plan: Tab-Updown

## Overview

This plan implements the Tab-Updown Firefox WebExtension in TypeScript, bundled to
plain JavaScript for the packaged extension. It follows a bottom-up, test-driven order:
first the project scaffolding (package.json, TypeScript config, bundler config, test
setup, and `manifest.json`), then the DOM-free pure logic modules (`constants.ts`,
`settings.ts`, `hotkeys.ts`, `focus.ts`) with their `fast-check` property tests, then
the thin WebExtension entry points (`background.ts`, `content.ts`, `options.*`) that
wire the pure logic to the `commands`, `storage`, and `tabs` APIs, then integration and
smoke tests, and finally the build/package step via `web-ext`.

Language & tooling (from design): **TypeScript** compiled via a bundler (**esbuild** or
**Vite**) into `dist/*.js`. Test runner **Jest** with **fast-check** (property-based
tests, minimum 100 iterations each) and **jsdom** for DOM tests, emitting a CTRF JSON
report via **jest-ctrf-json-reporter**. Packaging/running via **web-ext**. Manifest V3
for Firefox with a non-persistent background event page and `permissions: ["storage"]`
only.

## Tasks

- [x] 1. Set up project scaffolding, tooling, and manifest
  - [x] 1.1 Initialize the TypeScript project and dependencies
    - Create `package.json` with dev dependencies: `typescript`, the bundler
      (`esbuild` or `vite`), `jest`, `ts-jest`, `@types/jest`, `jest-environment-jsdom`,
      `jest-ctrf-json-reporter`, `fast-check`, `jsdom`, `@types/firefox-webext-browser`, and `web-ext`
    - Add npm scripts: `build` (bundle `src/background.ts`, `src/content.ts`,
      `src/options.ts` → `dist/background.js`, `dist/content.js`, `dist/options.js`),
      `typecheck` (`tsc --noEmit`), `test` (`jest`), `start`/`package` (`web-ext`)
    - Create `tsconfig.json` targeting a modern ES output with strict mode enabled and
      the WebExtension types included
    - Create the bundler config that emits the three entry points to `dist/` with the
      exact filenames referenced by the manifest, and copies `options.html`/`options.css` into `dist/`
    - _Requirements: 7.1_

  - [x] 1.2 Set up the Jest test environment
    - Configure Jest (via `ts-jest`) to use the `jsdom` test environment for DOM tests
      and expose `fast-check`; register `jest-ctrf-json-reporter` so a CTRF JSON report
      is emitted on each run
    - Add a shared WebExtension API mock/stub helper under `tests/` for `browser.storage.local`,
      `browser.commands`, `browser.tabs`, and `browser.runtime` used by later tests
    - Add a placeholder test that imports and runs to confirm the toolchain works
    - _Requirements: 7.1_

  - [x] 1.3 Author `manifest.json`
    - Create `manifest.json` at the repo root with `manifest_version: 3`, metadata
      (name, version, description), `permissions: ["storage"]` only, a non-persistent
      `background.scripts: ["background.js"]` event page, `content_scripts` matching
      `<all_urls>` with `js: ["content.js"]`, `options_ui` referencing `options.html`
      (`open_in_tab: false`)
    - Declare the two `commands`: `tab-updown-forward` (default `Alt+Shift+Down`) and
      `tab-updown-backward` (default `Alt+Shift+Up`) with descriptions
    - _Requirements: 4.1, 4.5, 4.6, 7.1, 7.2, 7.5_

- [x] 2. Implement shared constants
  - [x] 2.1 Create `src/lib/constants.ts`
    - Export `DEFAULT_CHUNK_SIZE = 5`, `CHUNK_SIZE_MIN = 1`, `CHUNK_SIZE_MAX = 100`,
      `DEFAULT_FORWARD_HOTKEY = "Alt+Shift+Down"`, `DEFAULT_BACKWARD_HOTKEY = "Alt+Shift+Up"`,
      `FORWARD_COMMAND_NAME = "tab-updown-forward"`, `BACKWARD_COMMAND_NAME = "tab-updown-backward"`
    - _Requirements: 3.4, 4.1, 4.5, 4.6_

- [x] 3. Implement the Chunk_Size settings logic (`src/lib/settings.ts`)
  - [x] 3.1 Implement `validateChunkSize` and `normalizeChunkSize`
    - `validateChunkSize(raw)` returns `{ ok: true, value }` only when `raw` parses to
      an integer in `[1, 100]`; otherwise `{ ok: false, invalidValue: raw }` (rejects
      non-numeric, non-integer, and out-of-range input)
    - `normalizeChunkSize(stored)` returns `stored` when it is an integer in `[1, 100]`,
      otherwise returns `DEFAULT_CHUNK_SIZE` (defensive fallback for absent/corrupt values)
    - _Requirements: 3.1, 3.3, 3.4, 3.5, 3.6_

  - [x] 3.2 Write property test for Chunk_Size normalization
    - **Feature: tab-updown, Property 7: Chunk_Size normalization is a total function into the valid range**
    - Generate arbitrary values (ints, floats, strings, undefined, out-of-range);
      assert output is always an integer in `[1, 100]`, unchanged for valid integers and
      `DEFAULT_CHUNK_SIZE` (5) otherwise; minimum 100 iterations
    - **Validates: Requirements 3.3, 3.4, 3.6**

  - [x] 3.3 Write property test for Chunk_Size validation
    - **Feature: tab-updown, Property 8: Chunk_Size validation accepts exactly the valid range and echoes invalid input**
    - Generate arbitrary submitted values; assert `{ ok: true, value }` with the parsed
      integer iff the input is an integer in `[1, 100]`, otherwise `{ ok: false }`
      carrying the original invalid value; minimum 100 iterations
    - **Validates: Requirements 3.2, 3.5**

- [x] 4. Implement the hotkey conflict predicate (`src/lib/hotkeys.ts`)
  - [x] 4.1 Implement the conflict predicate
    - Export a predicate that normalizes two key-combination strings and reports a
      conflict if and only if their normalized forms are equal
    - _Requirements: 4.8_

  - [x] 4.2 Write property test for hotkey conflict detection
    - **Feature: tab-updown, Property 9: Hotkey conflict is detected exactly when the two combinations coincide**
    - Generate pairs of key-combination strings; assert a conflict is reported iff the
      normalized forms are equal; minimum 100 iterations
    - **Validates: Requirements 4.8**

- [x] 5. Implement focus-index computation (`src/lib/focus.ts`)
  - [x] 5.1 Implement `computeTargetIndex`
    - Signature `computeTargetIndex(direction, currentIndex, chunkSize, length)`; treat
      `currentIndex == -1` as "no current focus in order" and return a no-op sentinel
      (`-1`) when `length == 0`
    - Forward with `currentIndex >= 0` → `min(i + c, n - 1)`; forward with
      `currentIndex == -1` → `min(c - 1, n - 1)`
    - Backward with `currentIndex >= 0` → `max(i - c, 0)`; backward with
      `currentIndex == -1` → `n - 1`
    - _Requirements: 1.1, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 5.2 Write property test for forward clamp
    - **Feature: tab-updown, Property 1: Forward move clamps to the last element**
    - Generate `n >= 1`, `i` in `[0, n-1]`, `c` in `[1, 100]`; assert forward target is
      `min(i + c, n - 1)`; minimum 100 iterations
    - **Validates: Requirements 1.1, 1.4**

  - [x] 5.3 Write property test for backward clamp
    - **Feature: tab-updown, Property 2: Backward move clamps to the first element**
    - Generate `n >= 1`, `i` in `[0, n-1]`, `c` in `[1, 100]`; assert backward target is
      `max(i - c, 0)`; minimum 100 iterations
    - **Validates: Requirements 2.1, 2.3**

  - [x] 5.4 Write property test for forward move with no current focus
    - **Feature: tab-updown, Property 3: Forward move with no current focus starts from the first element**
    - Generate `n >= 1`, `c` in `[1, 100]` with `currentIndex == -1`; assert target is
      `min(c - 1, n - 1)`; minimum 100 iterations
    - **Validates: Requirements 1.3**

  - [x] 5.5 Write property test for backward move with no in-order focus
    - **Feature: tab-updown, Property 4: Backward move with no in-order focus lands on the last element**
    - Generate `n >= 1`, `c` in `[1, 100]` with `currentIndex == -1`; assert target is
      `n - 1`; minimum 100 iterations
    - **Validates: Requirements 2.2, 2.5**

  - [x] 5.6 Write property test for empty-order no-op
    - **Feature: tab-updown, Property 5: An empty Focus_Order is a no-op in either direction**
    - Generate direction and `c` in `[1, 100]` with `length == 0`; assert the no-op
      sentinel is returned; minimum 100 iterations
    - **Validates: Requirements 1.5, 2.4**

- [x] 6. Implement Focus_Order construction (`src/lib/focus.ts`)
  - [x] 6.1 Implement `buildFocusOrder` and `indexOfCurrentFocus`
    - `buildFocusOrder(document)` returns visible AND enabled AND tabbable elements
      (natively focusable or `tabindex >= 0`, excluding `tabindex < 0`); positive
      `tabindex` elements first sorted ascending (ties by DOM order), then the normal
      group in DOM order
    - `indexOfCurrentFocus(order, activeElement)` returns the index of `activeElement`
      in `order`, or `-1` when there is no current focus or it is not present in the order
    - _Requirements: 1.2_

  - [x] 6.2 Write property test for Focus_Order filtering and ordering
    - **Feature: tab-updown, Property 6: Focus_Order includes exactly the visible, enabled, tabbable elements in tab order**
    - Generate arrays of element descriptors `{ domIndex, tabindex, visible, enabled }`;
      assert the filtered, ordered output matches the ordering rule; minimum 100 iterations
    - **Validates: Requirements 1.2**

  - [x] 6.3 Write DOM integration test for Focus_Order exclusion and ordering
    - Use a jsdom fixture; assert `display:none`, `visibility:hidden`, zero-size, and
      `disabled` elements are excluded and `tabindex` ordering is respected
    - _Requirements: 1.2_

- [x] 7. Checkpoint - pure logic complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implement the Background_Script (`src/background.ts`)
  - [x] 8.1 Implement the command listener and message relay
    - Register `browser.commands.onCommand` at the top level (event page can wake)
    - Map `tab-updown-forward`/`tab-updown-backward` → `direction`; ignore other commands
    - Resolve the active tab via `tabs.query({ active: true, currentWindow: true })`; if
      absent or `tab.id` missing, no-op; otherwise `tabs.sendMessage(tab.id, { type: "navigate", direction })`
    - Catch a rejected send (no receiver / restricted page) and no-op, leaving focus unchanged
    - _Requirements: 5.1, 5.2, 5.4_

  - [x] 8.2 Write integration tests for command dispatch and no-op
    - With mocked WebExtension APIs, assert firing each command sends a `navigate`
      message with the correct `direction` to the active tab, and that no message is sent
      (no focus change) when no active tab exists or `tabs.sendMessage` rejects
    - _Requirements: 5.1, 5.2, 5.4_

- [x] 9. Implement the Content_Script (`src/content.ts`)
  - [x] 9.1 Implement the navigation message handler
    - Register `browser.runtime.onMessage`; ignore messages whose `type !== "navigate"`
    - On a `navigate` message: read Chunk_Size from `storage.local`, pass through
      `normalizeChunkSize`, build the Focus_Order, compute the target index via
      `computeTargetIndex`, and call `.focus()` on the target (no-op when order is empty)
    - _Requirements: 5.3, 1.1, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 3.6_

  - [x] 9.2 Write tests for the content-script message handling
    - With mocked `storage.local` and jsdom, assert the handler reads Chunk_Size before
      moving focus, ignores non-`navigate` messages, and moves focus to the computed target
    - _Requirements: 5.3_

- [x] 10. Implement the Options_Page (`src/options.html`, `src/options.css`, `src/options.ts`)
  - [x] 10.1 Author the options page markup and styling
    - `options.html` with a numeric Chunk_Size control (`min=1`, `max=100`), a
      Forward_Hotkey control, a Backward_Hotkey control, a save action, and a
      message/status region; `options.css` for basic, accessible styling
    - _Requirements: 3.1, 4.2_

  - [x] 10.2 Implement options page load and display
    - On open, read `chunkSize` from `storage.local` (display `DEFAULT_CHUNK_SIZE` when
      absent) and read hotkeys via `commands.getAll()` (display defaults when absent)
    - _Requirements: 6.2, 6.3, 4.5, 4.6_

  - [x] 10.3 Implement Chunk_Size save with validation and error handling
    - Validate via `validateChunkSize`; on failure show a validation message identifying
      the invalid value and retain the stored value; on success `storage.local.set` and
      show a save confirmation; catch a `storage.local.set` rejection, retain the previous
      value, and show a storage-error message
    - _Requirements: 3.2, 3.5, 6.1, 7.3, 7.4_

  - [x] 10.4 Implement hotkey save with conflict and validation handling
    - Reject and show a conflict message when the two combinations coincide (via the
      conflict predicate) without calling `commands.update()`; otherwise call
      `commands.update()` for each command; catch a rejected `commands.update()`, revert
      the displayed value to the previously active shortcut, and show a validation message
    - _Requirements: 4.3, 4.4, 4.7, 4.8_

  - [x] 10.5 Write example/unit tests for the options page
    - Assert the page renders the Chunk_Size control (`min=1`/`max=100`) and two hotkey
      controls; a valid Chunk_Size calls `storage.local.set` and shows confirmation; a
      valid hotkey calls `commands.update()`; opening displays persisted values and the
      defaults (5, `Alt+Shift+Down`, `Alt+Shift+Up`) when unconfigured; a `commands.update()`
      rejection reverts and messages; a `storage.local.set` rejection retains and messages
    - _Requirements: 3.1, 3.2, 4.2, 4.3, 4.4, 4.7, 6.2, 6.3, 7.4_

- [x] 11. Checkpoint - entry points wired
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Integration and smoke tests
  - [x] 12.1 Write integration tests for empty-document no-op and persistence round-trip
    - Empty-document jsdom fixture leaves `activeElement` unchanged on both directions;
      a saved Chunk_Size is readable from `storage.local` after a simulated reload
    - _Requirements: 1.5, 2.4, 6.1, 7.3_

  - [x] 12.2 Write static smoke tests over `manifest.json`
    - Assert the manifest declares metadata, `content_scripts`, `background`, `commands`,
      and `options_ui`; that `permissions` is exactly `["storage"]` with no host
      permissions; and that both commands are declared with their default keys
    - _Requirements: 7.1, 7.2, 7.5, 4.1_

- [x] 13. Build and package
  - [x] 13.1 Produce the distributable build
    - Run the bundler to emit `dist/background.js`, `dist/content.js`, `dist/options.js`
      and copy `options.html`/`options.css`; verify `manifest.json` references resolve
      against the build output; wire the `web-ext` package script to produce the
      distributable artifact from the built output
    - _Requirements: 7.1_

- [x] 14. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 15. Implement hotkey recording helpers (`src/lib/hotkeys.ts`)
  - [x] 15.1 Implement `keyEventToShortcut`
    - Add a DOM-free `keyEventToShortcut(descriptor)` taking a plain
      `{ ctrl, alt, shift, meta, key, isMac }` descriptor and returning a grammar-valid
      Shortcut_String or `null`
    - Map keys per the design table: `ArrowUp/Down/Left/Right` → `Up/Down/Left/Right`,
      `" "` → `Space`, `","` → `Comma`, `"."` → `Period`, letters uppercased, digits and
      `F1`–`F12` as-is, named keys (Home, End, PageUp, PageDown, Insert, Delete) as-is;
      unmapped keys → `null`
    - Map modifiers per the design: `alt` → `Alt`, `shift` → `Shift`; on non-Mac `ctrl`
      → `Ctrl`; on Mac `meta` → `Command` and `ctrl` → `MacCtrl`; order tokens main
      modifier → secondary modifier → key
    - Return `null` for a modifier-only press or a non-function key with no main
      modifier; allow a lone `F1`–`F12`
    - _Requirements: 8.1, 8.2, 8.4_

  - [x] 15.2 Write property test for `keyEventToShortcut`
    - **Feature: tab-updown, Property 10: keyEventToShortcut maps valid combinations to grammar-valid strings and everything else to null**
    - Generate arbitrary `{ ctrl, alt, shift, meta, key, isMac }` descriptors spanning
      arrow/space/comma/period/letter/digit/function/named/unmapped keys, modifier-only
      presses, and both platforms; assert a non-null grammar-valid string exactly for
      Valid_Combinations and `null` otherwise, and the Mac Command/MacCtrl mapping;
      minimum 100 iterations
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4**

  - [x] 15.3 Implement `isValidShortcut`
    - Add a DOM-free `isValidShortcut(str)` that returns `true` iff `str` matches
      Firefox's `commands` shortcut grammar: main modifier (Ctrl/Alt/Command/MacCtrl) +
      optional differing secondary modifier + key (A-Z, 0-9, F1-F12, or a named key), or
      a lone `F1`–`F12`
    - _Requirements: 8.8_

  - [x] 15.4 Write property test for `isValidShortcut`
    - **Feature: tab-updown, Property 11: isValidShortcut accepts exactly the strings matching the Firefox grammar**
    - Generate both grammar-conforming and malformed strings; assert acceptance matches
      the Firefox grammar exactly (rejecting modifier-only, missing main modifier,
      duplicate main/secondary modifier, and unmapped keys); minimum 100 iterations
    - **Validates: Requirements 8.8**

- [x] 16. Add hotkey recording to the Options_Page (`src/options.html`, `src/options.ts`)
  - [x] 16.1 Add reset controls to the options markup
    - Add a per-field reset control next to each hotkey field
      (`#forward-hotkey-reset`, `#backward-hotkey-reset`) in `options.html`, keeping the
      hotkey fields as accessible text inputs for the manual-typing fallback
    - _Requirements: 8.5, 8.7_

  - [x] 16.2 Wire keydown recording on the hotkey fields
    - In `options.ts`, attach a `keydown` listener to each hotkey field that ignores
      pure-modifier keydowns, builds a `KeyDescriptor` (with an `isMac` platform flag),
      calls `keyEventToShortcut`, and `preventDefault()`s
    - On a non-null result write the Shortcut_String into the field; on `null` show a
      validation message and retain the field's previous value
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

  - [x] 16.3 Wire the reset-to-default controls
    - On reset activation call `browser.commands.reset()` for the matching command, then
      re-read `commands.getAll()` and display the restored Shortcut_String (falling back
      to `DEFAULT_FORWARD_HOTKEY` / `DEFAULT_BACKWARD_HOTKEY`)
    - _Requirements: 8.5, 8.6_

  - [x] 16.4 Validate typed shortcuts on save (manual-typing fallback)
    - In `saveHotkeys`, guard each field's value with `isValidShortcut` before calling
      `commands.update()`; on a non-matching typed value show a validation message and
      retain the previously active shortcut (reusing the existing revert path)
    - _Requirements: 8.7, 8.8_

  - [x] 16.5 Write example/unit tests for the recording UI
    - Against a jsdom fixture: dispatching a `keydown` for a Valid_Combination writes the
      expected Shortcut_String; a modifier-only or unmapped press retains the previous
      value and shows a validation message; activating a reset control calls
      `commands.reset()` and displays the default; a typed invalid shortcut is rejected
      with a validation message while the previous shortcut is retained
    - _Requirements: 8.1, 8.2, 8.3, 8.5, 8.6, 8.7, 8.8_

- [x] 17. Checkpoint - hotkey recording complete
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test tasks and can be skipped for a faster MVP;
  core implementation tasks are never optional.
- Each of the 11 correctness properties from the design is implemented by a single
  property-based test (tasks 3.2, 3.3, 4.2, 5.2, 5.3, 5.4, 5.5, 5.6, 6.2, 15.2, 15.4),
  each running a minimum of 100 iterations and tagged with its property number.
- Tasks 15–16 extend the already-implemented feature with hotkey recording on the
  Options_Page (Requirement 8): the pure `keyEventToShortcut` / `isValidShortcut`
  helpers in `src/lib/hotkeys.ts` and the `options.html` / `options.ts` recording UI,
  reset controls, and manual-typing fallback.
- Property tests are placed immediately after the module they validate to catch errors
  early; example, integration, and smoke tests cover DOM behavior, command dispatch,
  storage persistence, UI wiring, and manifest structure.
- Each task references the specific requirement clauses (and, for test tasks, the design
  property) it implements for traceability.
- Hotkeys are persisted by Firefox via the `commands` API (not the Settings_Store), so
  only `chunkSize` is written to `storage.local`.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "3.1", "4.1", "5.1", "6.1"] },
    { "id": 2, "tasks": ["3.2", "3.3", "4.2", "5.2", "5.3", "5.4", "5.5", "5.6", "6.2", "6.3", "8.1", "9.1", "10.1"] },
    { "id": 3, "tasks": ["8.2", "9.2", "10.2", "10.3", "10.4", "12.1", "12.2"] },
    { "id": 4, "tasks": ["10.5", "13.1"] },
    { "id": 5, "tasks": ["15.1", "16.1"] },
    { "id": 6, "tasks": ["15.2", "15.3", "16.2"] },
    { "id": 7, "tasks": ["15.4", "16.3"] },
    { "id": 8, "tasks": ["16.4"] },
    { "id": 9, "tasks": ["16.5"] }
  ]
}
```
