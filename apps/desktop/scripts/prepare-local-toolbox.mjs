import { build } from "esbuild";
import { copyFile, cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(scriptRoot, "..");
const repositoryRoot = path.resolve(desktopRoot, "..", "..");
const outputRoot = path.join(desktopRoot, "resources", "local-toolbox");
const require = createRequire(import.meta.url);
const sevenZipPackageRoot = path.dirname(require.resolve("7zip-bin/package.json"));
const sevenZipSource = path.join(
  sevenZipPackageRoot,
  "win",
  process.arch,
  "7za.exe",
);

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

await build({
  entryPoints: [
    path.join(repositoryRoot, "tools", "local-toolbox", "archive-helper.ts"),
  ],
  outfile: path.join(outputRoot, "helper.mjs"),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  sourcemap: false,
});

await copyFile(process.execPath, path.join(outputRoot, "node.exe"));
await copyFile(sevenZipSource, path.join(outputRoot, "7za.exe"));
await cp(
  path.join(repositoryRoot, "tools", "local-toolbox", "public"),
  path.join(outputRoot, "public"),
  { recursive: true },
);
