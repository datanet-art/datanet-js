/**
 * Build for @datanet/p5.
 *
 * Bundles @datanet/core into a single self-contained IIFE so the output works
 * as a plain <script> tag with no separate core import required. p5 is a peer
 * dependency and is NOT bundled — it must be loaded separately.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { buildSync } from "esbuild";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const banner = `/*! @datanet/p5 v${version} | MIT | https://datanet.art */`;

// IIFE — self-contained for <script> tag use; bundles @datanet/core so there
// is no external dependency at runtime.
const iife = {
  entryPoints: ["src/datanet-p5.js"],
  bundle: true,
  format: "iife",
  globalName: "_DataNetP5Exports",
  external: ["p5"],
  banner: { js: banner },
  logLevel: "warning",
};

// ESM — for bundlers (webpack, Vite, etc.) and npm consumers. @datanet/core
// is left as an external so bundlers can deduplicate it.
const esm = {
  entryPoints: ["src/datanet-p5.js"],
  bundle: false,
  format: "esm",
  banner: { js: banner },
  logLevel: "warning",
};

mkdirSync("dist", { recursive: true });

buildSync({ ...iife, outfile: "dist/datanet-p5.js",     minify: false });
buildSync({ ...iife, outfile: "dist/datanet-p5.min.js", minify: true  });
buildSync({ ...esm,  outfile: "dist/datanet-p5.esm.js", minify: false });

console.log(`built IIFE + ESM dist files (v${version})`);
