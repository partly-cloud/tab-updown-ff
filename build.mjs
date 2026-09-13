// Build script for the Tab-Updown WebExtension.
//
// Bundles the three TypeScript entry points (background, content, options) into
// plain JavaScript in dist/ using the exact filenames referenced by manifest.json,
// and copies the static options page assets (options.html, options.css) into dist/.
import { build } from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const srcDir = join(root, "src");
const distDir = join(root, "dist");

const watch = process.argv.includes("--watch");

/** Map of source entry points to their exact output filenames (per manifest.json). */
const entryPoints = {
  background: join(srcDir, "background.ts"),
  content: join(srcDir, "content.ts"),
  options: join(srcDir, "options.ts"),
};

async function copyStaticAssets() {
  await mkdir(distDir, { recursive: true });
  await Promise.all([
    copyFile(join(srcDir, "options.html"), join(distDir, "options.html")),
    copyFile(join(srcDir, "options.css"), join(distDir, "options.css")),
    // web-ext packages from dist/, so the manifest must live alongside the
    // built output for its references (background.js, content.js, options.html)
    // to resolve against the package root.
    copyFile(join(root, "manifest.json"), join(distDir, "manifest.json")),
  ]);
}

async function run() {
  await mkdir(distDir, { recursive: true });

  await build({
    entryPoints,
    outdir: distDir,
    entryNames: "[name]",
    bundle: true,
    format: "iife",
    target: ["firefox115"],
    platform: "browser",
    sourcemap: true,
    logLevel: "info",
  });

  await copyStaticAssets();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

void watch;
