import test from "node:test";
import { execFileSync } from "node:child_process";
test("Claude read-only CLI quota: explicit percentages, unavailable and malformed data", () =>
  execFileSync("python3", ["-I", "tests/claude_usage_test.py"], {
    stdio: "pipe",
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
  }));
