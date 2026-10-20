import test from "node:test";
import { execFileSync } from "node:child_process";
test("WebSocket: existing idle receipt, active rejection, uncertain acknowledgement", () => {
  execFileSync("python3", ["-I", "tests/rpc_test.py"], {
    stdio: "pipe",
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
  });
});
