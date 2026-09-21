# AMO Submission Guide

Everything needed to submit Tab-Updown to addons.mozilla.org (AMO), plus the
reviewer information Mozilla's Add-on Policies require. Copy the relevant
sections into the AMO submission form.

## Package the extension

```bash
npm ci
npm run build      # esbuild bundles src/ into dist/
npm run lint       # web-ext lint (AMO validator); expect 0 errors, 0 warnings
npm run package    # produces the uploadable zip in web-ext-artifacts/
```

Upload the zip from `web-ext-artifacts/` (manifest.json is at the archive root,
as AMO requires).

## Listing details

**Name:** Tab-Updown

**Summary:**
Move keyboard focus through a page's focusable elements in configurable chunks —
a Page Up / Page Down analogue for the Tab key.

**Description:**
Tab-Updown speeds up keyboard navigation. Instead of pressing Tab repeatedly to
move focus one element at a time, it jumps focus forward or backward by a
configurable number of elements at once.

- Forward hotkey (default Alt+Shift+Down): move focus forward by one chunk.
- Backward hotkey (default Alt+Shift+Up): move focus backward by one chunk.
- Chunk size (default 5): set how many focusable elements each jump moves,
  from 1 to 100, on the options page.
- Both hotkeys are rebindable on the options page, either by recording a key
  combination or by typing one.

All settings are stored locally in your browser. The add-on does not collect,
transmit, or share any data.

**Categories:** Accessibility; and one of Other / Tabs (choose on AMO).

**License:** (select your repository's license on AMO.)

**Privacy policy:** Not required — the add-on transmits no data.

## Permissions justification

- `storage` — persists the one user setting (chunk size) locally via
  `storage.local`. Nothing is sent off-device.
- Content script on `<all_urls>` — the add-on must be able to move keyboard
  focus among the focusable elements of whatever page the user is on, so the
  content script has to run on any page. It only reads the focus order and moves
  focus on the active page in response to the user's hotkey; it does not read
  page content for storage or transmission, and sends nothing off-device.
- `commands` — registers the two rebindable navigation hotkeys.

No host permissions beyond the content-script match are requested. There is no
`nativeMessaging`, no remote code, and no network access.

## Notes for Reviewers

Tab-Updown moves keyboard focus in configurable chunks. To test:

1. Install and open any page with several focusable elements (links, buttons,
   inputs).
2. Press Alt+Shift+Down to jump focus forward by the chunk size (default 5),
   and Alt+Shift+Up to jump backward.
3. Open the add-on's options (about:addons > Tab-Updown > Preferences) to change
   the chunk size (1–100) and to rebind either hotkey (record a combination or
   type one). Settings persist locally.

No account or credentials are required. The add-on transmits no data; the only
stored state is the chunk size in `storage.local`.

### Source code and reproducible build (Policy 3.1)

The uploaded package contains esbuild-bundled JavaScript. To reproduce it from
source:

- Toolchain: Node.js 22 with npm (esbuild via `build.mjs`). All dependencies are
  installed from the public npm registry.
- Build:
  ```bash
  npm ci
  npm run package   # builds dist/ and zips it, excluding sourcemaps
  ```
- `npm run package` produces `web-ext-artifacts/tab-updown-<version>.zip`, the
  uploaded package: `background.js`, `content.js`, `options.js`, plus the copied
  `manifest.json`, `options.html`, `options.css`. (A plain `npm run build` also
  emits `.js.map` sourcemaps, which `npm run package` strips, so use `package`
  to reproduce the uploaded zip exactly.)

To produce the source-code package for the reviewer (tracked files only, no
`node_modules`/`dist`/artifacts):

```bash
git archive --format=zip -o web-ext-artifacts/tab-updown-<version>-source.zip HEAD
```

The code is bundled for format/size only; it is not minified or obfuscated.

## Self-distribution (alternative to listing)

To sign for self-distribution instead of listing on AMO:

```bash
npm run build
npx web-ext sign --source-dir dist \
  --api-key "$AMO_JWT_ISSUER" \
  --api-secret "$AMO_JWT_SECRET" \
  --channel unlisted
```

This returns a signed .xpi you distribute yourself. For self-hosted auto-updates,
add `browser_specific_settings.gecko.update_url` to manifest.json.
