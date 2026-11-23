#!/usr/bin/env node

const path = require("node:path");
const { spawnSync } = require("node:child_process");

// Run the existing CLI scenarios and the isolated authorization/Git regressions.
for (const args of [
  ["test-reviewctl.js"],
  ["test-optimistic.js"],
  ["--test", "test-authorization.js", "test-staged-guard.js", "test-adjacent-batches.js"],
]) {
  const env = { ...process.env };
  delete env.REVIEWCTL_TEST_FILTER;
  const result = spawnSync(process.execPath, args, {
    cwd: path.resolve(__dirname), env, stdio: "inherit",
  });
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) {
    console.error(`Failed: node ${args.join(" ")} (${result.signal || result.status || "could not start"})`);
    process.exitCode ||= result.status || 1;
  }
}
