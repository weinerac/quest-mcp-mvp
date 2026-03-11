import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "vite";

const rootDir = path.dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const outDir = await mkdtemp(path.join(tmpdir(), "quest-widget-"));

function inlineAssets(html, css, js) {
  return html
    .replace(
      /<script type="module" crossorigin src="[^"]+"><\/script>/,
      () => `<script type="module">\n${js}\n</script>`
    )
    .replace(
      /<link rel="stylesheet" crossorigin href="[^"]+">/,
      () => `<style>\n${css}\n</style>`
    );
}

try {
  await build({
    configFile: path.join(rootDir, "vite.config.ts"),
    build: {
      outDir,
    },
  });

  const html = await readFile(path.join(outDir, "index.html"), "utf8");
  const assetDir = path.join(outDir, "assets");
  const assetFiles = await readdir(assetDir);

  const cssFile = assetFiles.find((file) => file.endsWith(".css"));
  const jsFile = assetFiles.find((file) => file.endsWith(".js"));

  if (!cssFile || !jsFile) {
    throw new Error("Widget build did not emit both CSS and JS assets.");
  }

  const [css, js] = await Promise.all([
    readFile(path.join(assetDir, cssFile), "utf8"),
    readFile(path.join(assetDir, jsFile), "utf8"),
  ]);

  await writeFile(
    path.join(rootDir, "public/quest-search-results.html"),
    inlineAssets(html, css, js),
    "utf8"
  );
} finally {
  await rm(outDir, { recursive: true, force: true });
}
