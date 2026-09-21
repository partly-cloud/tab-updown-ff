/**
 * Static smoke tests over the packaged `manifest.json` (Task 12.2).
 *
 * These tests parse the manifest at the repo root and assert its structural
 * WebExtensions compliance without loading the extension: the required top-level
 * keys are present (metadata, content_scripts, background, commands, options_ui),
 * the extension requests only the `storage` permission with no host permissions,
 * and both navigation commands are declared with their default key combinations.
 *
 * _Requirements: 7.1, 7.2, 7.5, 4.1_
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  BACKWARD_COMMAND_NAME,
  DEFAULT_BACKWARD_HOTKEY,
  DEFAULT_FORWARD_HOTKEY,
  FORWARD_COMMAND_NAME,
} from "../src/lib/constants.js";

// Jest runs with the repo root as the working directory, so the packaged
// `manifest.json` lives directly under it. Resolving from `process.cwd()`
// avoids depending on `import.meta.url`, keeping the test parseable under
// both the CommonJS and ESM Jest runners.
const manifestPath = join(process.cwd(), "manifest.json");

interface CommandEntry {
  suggested_key?: { default?: string };
  description?: string;
}

interface Manifest {
  manifest_version?: number;
  name?: string;
  version?: string;
  description?: string;
  permissions?: unknown;
  background?: { scripts?: string[] };
  content_scripts?: Array<{ matches?: string[]; js?: string[] }>;
  options_ui?: { page?: string; open_in_tab?: boolean };
  commands?: Record<string, CommandEntry>;
  // Host-permission keys that must be absent.
  host_permissions?: unknown;
  optional_permissions?: unknown;
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;

describe("manifest.json smoke tests", () => {
  it("declares extension metadata (Requirement 7.1)", () => {
    expect(manifest.manifest_version).toBe(3);
    expect(typeof manifest.name).toBe("string");
    expect(manifest.name).toBeTruthy();
    expect(typeof manifest.version).toBe("string");
    expect(manifest.version).toBeTruthy();
    expect(typeof manifest.description).toBe("string");
    expect(manifest.description).toBeTruthy();
  });

  it("declares the content script (Requirement 7.1)", () => {
    expect(Array.isArray(manifest.content_scripts)).toBe(true);
    expect(manifest.content_scripts?.length).toBeGreaterThan(0);
    const entry = manifest.content_scripts?.[0];
    expect(entry?.matches).toEqual(["<all_urls>"]);
    expect(entry?.js).toContain("content.js");
  });

  it("declares the background script (Requirement 7.1)", () => {
    expect(manifest.background).toBeDefined();
    expect(manifest.background?.scripts).toContain("background.js");
  });

  it("declares the options page (Requirement 7.1)", () => {
    expect(manifest.options_ui).toBeDefined();
    expect(typeof manifest.options_ui?.page).toBe("string");
    expect(manifest.options_ui?.page).toBeTruthy();
  });

  it("requests exactly the storage permission and no host permissions (Requirement 7.2)", () => {
    expect(manifest.permissions).toEqual(["storage"]);
    // No broad host-permission declarations of any kind.
    expect(manifest.host_permissions).toBeUndefined();
    expect(manifest.optional_permissions).toBeUndefined();
  });

  it("declares both commands with their default keys (Requirements 7.5, 4.1)", () => {
    expect(manifest.commands).toBeDefined();
    const commands = manifest.commands ?? {};

    expect(commands[FORWARD_COMMAND_NAME]).toBeDefined();
    expect(commands[FORWARD_COMMAND_NAME]?.suggested_key?.default).toBe(
      DEFAULT_FORWARD_HOTKEY,
    );

    expect(commands[BACKWARD_COMMAND_NAME]).toBeDefined();
    expect(commands[BACKWARD_COMMAND_NAME]?.suggested_key?.default).toBe(
      DEFAULT_BACKWARD_HOTKEY,
    );
  });
});
