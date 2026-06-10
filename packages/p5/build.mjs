/**
 * Build for @datanet/p5.
 *
 * The source is a single UMD file that must not be re-wrapped by a bundler,
 * so the "build" is: copy it verbatim to dist/, plus a minified copy for CDN
 * usage. esbuild runs in minify-only mode (no bundling, no format change).
 */
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { buildSync } from "esbuild";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const banner = `/*! @datanet/p5 v${version} | MIT | https://datanet.art */`;

mkdirSync("dist", { recursive: true });
copyFileSync("src/datanet-p5.js", "dist/datanet-p5.js");

buildSync({
  entryPoints: ["src/datanet-p5.js"],
  outfile: "dist/datanet-p5.min.js",
  minify: true,
  bundle: false,
  banner: { js: banner },
  logLevel: "warning",
});

console.log(`built dist/datanet-p5.js and dist/datanet-p5.min.js (v${version})`);
