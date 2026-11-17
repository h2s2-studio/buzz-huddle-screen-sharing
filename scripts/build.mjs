import { readFile } from "node:fs/promises";
import { build } from "esbuild";

const notices = await readFile("THIRD_PARTY_NOTICES", "utf8");
const result = await build({
  entryPoints: ["src/index.tsx"],
  bundle: true,
  platform: "browser",
  format: "esm",
  target: "es2022",
  minify: true,
  legalComments: "eof",
  banner: { js: "// Generated from TypeScript by npm run build. See THIRD_PARTY_NOTICES." },
  footer: { js: `/*!\n${notices.trim().replaceAll("*/", "* /")}\n*/` },
  outfile: "plugin.js",
  metafile: true,
  write: !process.argv.includes("--check"),
});

if (result.metafile.outputs["plugin.js"].imports.length) {
  throw new Error("Buzz requires a self-contained module");
}
if (process.argv.includes("--check")) {
  const committed = await readFile("plugin.js");
  if (!committed.equals(result.outputFiles[0].contents)) {
    throw new Error("plugin.js is stale. Run npm run build and commit it.");
  }
}
