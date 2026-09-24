#!/usr/bin/env node
/**
 * Fails the publish if the package is not actually publishable.
 *
 * The known blocker at 0.2.0: `@designlasagna/schemas` is still declared as a
 * local `file:` dependency until the 0.4.0 schemas release is published to
 * npm. Once it is, switch the dependency to `"^0.4.0"` (and regenerate the
 * lockfile) and this check passes.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));

const problems = [];

const runtimeDeps = pkg.dependencies ?? {};
for (const [name, spec] of Object.entries(runtimeDeps)) {
  if (/^(file|link):/i.test(spec)) {
    problems.push(
      `runtime dependency "${name}" uses a local reference (${spec}); publish it to npm first`
    );
  }
}

const binEntries = typeof pkg.bin === "string" ? [pkg.bin] : Object.values(pkg.bin ?? {});
for (const binPath of binEntries) {
  if (!existsSync(path.join(root, binPath))) {
    problems.push(`bin entry "${binPath}" is missing (run npm run build)`);
  }
}

if (problems.length > 0) {
  console.error("Package is not publishable:");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log("check-publishable: OK");
