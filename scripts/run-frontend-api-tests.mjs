import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const testsRoot = path.resolve("dist-frontend-tests", "tests", "frontend-api");

function collectTestFiles(currentDir) {
  const files = [];

  for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
    const fullPath = path.join(currentDir, entry.name);

    if (entry.isDirectory()) {
      files.push(...collectTestFiles(fullPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".test.js")) {
      files.push(fullPath);
    }
  }

  return files;
}

if (!fs.existsSync(testsRoot)) {
  console.error(`Could not find compiled frontend API tests at ${testsRoot}`);
  process.exit(1);
}

const testFiles = collectTestFiles(testsRoot).sort();

if (testFiles.length === 0) {
  console.error(`No compiled frontend API tests found under ${testsRoot}`);
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--test", ...testFiles], {
  stdio: "inherit",
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
