import type { Config } from "jest";

/**
 * Jest configuration for the tab-updown WebExtension.
 *
 * - Uses `ts-jest` to run TypeScript sources directly.
 * - Uses the `jsdom` test environment so DOM-dependent logic (Focus_Order,
 *   content script, options page) can be tested.
 * - `fast-check` is available as a normal import in test files (property-based
 *   tests); no special configuration is required beyond the dependency.
 * - Emits a CTRF JSON report on every run via `jest-ctrf-json-reporter`.
 *
 * The project is ESM (`"type": "module"` in package.json), so `ts-jest` is
 * configured with `useESM` and TypeScript files are treated as ES modules.
 *
 * NOTE: This file uses ESM syntax (`import type` / `export default`) to stay
 * valid under the project's `verbatimModuleSyntax` setting; Jest loads the
 * default-exported config object.
 */
const config: Config = {
  testEnvironment: "jsdom",
  roots: ["<rootDir>/src", "<rootDir>/tests"],
  testMatch: ["**/*.test.ts"],
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    // Allow ESM-style relative imports that include a `.js` extension to
    // resolve to the corresponding `.ts` source during testing.
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        useESM: true,
        // Keep transforms self-contained; the shared tsconfig uses
        // verbatimModuleSyntax which ts-jest does not need for test files.
        tsconfig: {
          verbatimModuleSyntax: false,
        },
      },
    ],
  },
  reporters: [
    "default",
    [
      "jest-ctrf-json-reporter",
      {
        outputDir: "ctrf",
        outputFile: "ctrf-report.json",
      },
    ],
  ],
};

export default config;
