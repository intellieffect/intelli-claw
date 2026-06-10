// electron-builder needs native deps (node-pty) under apps/desktop/node_modules
// so they end up inside Contents/Resources/app.asar.unpacked. pnpm's default
// layout keeps them in the workspace root's .pnpm store and only symlinks
// them at the root, which electron-builder doesn't walk. Create the symlink
// ourselves before packaging.

import { existsSync, mkdirSync, symlinkSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(__dirname, "..");
const monorepoRoot = resolve(desktopRoot, "..", "..");

const NATIVE_DEPS = ["node-pty"];

for (const name of NATIVE_DEPS) {
  const target = join(desktopRoot, "node_modules", name);
  const source = join(monorepoRoot, "node_modules", name);

  if (!existsSync(source)) {
    console.error(`[link-native] source missing: ${source}`);
    process.exit(1);
  }

  // Remove any stale file/dir/symlink at the target.
  try {
    rmSync(target, { recursive: true, force: true });
  } catch {
    // ignore
  }
  mkdirSync(dirname(target), { recursive: true });

  // symlink the package directory so electron-builder resolves and rebuilds it.
  symlinkSync(source, target, "dir");
  const resolved = statSync(target);
  console.log(
    `[link-native] ${name} -> ${source} (${resolved.isDirectory() ? "dir" : "file"})`,
  );
}
