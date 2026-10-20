import test from "node:test";
import { execFileSync } from "node:child_process";
test("Claude statusline: documented fields only, absent and invalid data rejected", () =>
  execFileSync("python3", ["-I", "tests/statusline_test.py"], {
    stdio: "pipe",
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
  }));
