import test from "node:test";
import { execFileSync } from "node:child_process";
test("11 independent raw-transcript parser fixtures", () => {
  execFileSync("python3", ["-I", "tests/parser_test.py"], {
    stdio: "pipe",
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
  });
});
