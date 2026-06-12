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

const shared = {
  entryPoints: ["src/datanet-p5.js"],
  bundle: true,
  format: "iife",
  globalName: "_DataNetP5Exports",
  // p5 is a peer dep loaded separately — don't bundle it.
  // Reference to `p5` global is resolved at runtime.
  external: ["p5"],
  banner: { js: banner },
  logLevel: "warning",
};

mkdirSync("dist", { recursive: true });

buildSync({ ...shared, outfile: "dist/datanet-p5.js",     minify: false });
buildSync({ ...shared, outfile: "dist/datanet-p5.min.js", minify: true  });

console.log(`built dist/datanet-p5.js and dist/datanet-p5.min.js (v${version})`);
