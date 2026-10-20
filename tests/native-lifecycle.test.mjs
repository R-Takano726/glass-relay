import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";

test(
  "native service releases its lock when the owning app pipe closes",
  { timeout: 10000 },
  async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "relay-native-lifecycle-"));
    const start = () =>
      spawn(process.execPath, ["server/index.mjs"], {
        env: {
          ...process.env,
          RELAY_DEMO: "1",
          RELAY_NATIVE: "1",
          RELAY_PORT: "0",
          RELAY_DATA_DIR: dir,
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
    let child;
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        child = start();
        let stderr = "";
        child.stderr.on("data", (v) => (stderr += v));
        const exited = once(child, "exit");
        if (attempt === 2) child.stdin.end();
        const [chunk] = await once(child.stdout, "data");
        assert.match(String(chunk), /Relay: http:\/\/127\.0\.0\.1:\d+/);
        if (attempt !== 2) child.stdin.end();
        const [code] = await exited;
        assert.equal(code, 0, stderr);
        await assert.rejects(access(path.join(dir, "service.lock")));
      }
    } finally {
      if (child?.exitCode === null) child.kill("SIGKILL");
      await rm(dir, { recursive: true, force: true });
    }
  },
);
