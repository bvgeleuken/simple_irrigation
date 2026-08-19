import { nodeResolve } from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import replace from "@rollup/plugin-replace";
import { readFileSync } from "fs";
import { resolve } from "path";

// Read version from VERSION file in project root
const versionPath = resolve("../../../VERSION");
const version = readFileSync(versionPath, "utf-8").trim();

const plugins = () => [
  replace({
    preventAssignment: true,
    values: {
      // Replace __VERSION__ placeholder with actual version
      "__VERSION__": `"${version}"`,
    },
  }),
  nodeResolve({ extensions: [".ts", ".js"] }),
  typescript({ tsconfig: "./tsconfig.json" }),
];

// Two independent bundles: the sidebar panel (admin configuration) and the
// Lovelace card (dashboard). They share nothing at runtime on purpose — a
// dashboard must not pull in the whole editor to draw a status tile.
export default [
  {
    input: "src/simple-irrigation-panel.ts",
    output: {
      file: "dist/simple-irrigation-panel.js",
      format: "es",
      sourcemap: true,
    },
    plugins: plugins(),
  },
  {
    input: "src/card/simple-irrigation-card.ts",
    output: {
      file: "dist/simple-irrigation-card.js",
      format: "es",
      sourcemap: true,
    },
    plugins: plugins(),
  },
];
