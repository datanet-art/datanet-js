import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};

const banner = `/*! @datanet/core v${version} | MIT | https://datanet.art */`;

export default defineConfig([
  // ESM build — for npm / bundler usage
  {
    entry: { datanet: "src/index.ts" },
    format: ["esm"],
    dts: true,
    clean: true,
    outDir: "dist",
    banner: { js: banner },
  },
  // Browser IIFE builds — for <script> / CDN usage (window.DataNet)
  {
    entry: { "datanet.browser": "src/browser.ts" },
    format: ["iife"],
    platform: "browser",
    outDir: "dist",
    outExtension: () => ({ js: ".js" }),
    banner: { js: banner },
  },
  {
    entry: { "datanet.browser.min": "src/browser.ts" },
    format: ["iife"],
    platform: "browser",
    minify: true,
    outDir: "dist",
    outExtension: () => ({ js: ".js" }),
    banner: { js: banner },
  },
]);
