import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { createServer } from "node:http";

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

test(
  "native preferred port falls back safely when another app owns it",
  { timeout: 10000 },
  async () => {
    const blocker = createServer();
    await new Promise((resolve) => blocker.listen(0, "127.0.0.1", resolve));
    const occupied = blocker.address().port;
    const dir = await mkdtemp(path.join(tmpdir(), "relay-native-port-"));
    let child;
    try {
      child = spawn(process.execPath, ["server/index.mjs"], {
        env: {
          ...process.env,
          RELAY_DEMO: "1",
          RELAY_NATIVE: "1",
          RELAY_PORT: String(occupied),
          RELAY_DATA_DIR: dir,
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
      const exited = once(child, "exit");
      const [chunk] = await once(child.stdout, "data");
      const match = String(chunk).match(/127\.0\.0\.1:(\d+)/);
      assert.ok(match);
      assert.notEqual(Number(match[1]), occupied);
      const base = `http://127.0.0.1:${match[1]}`;
      const bootstrap = await fetch(base);
      assert.equal(bootstrap.status, 200);
      const cookie = bootstrap.headers.get("set-cookie").split(";")[0];
      assert.match(cookie, new RegExp(`^relay_session_${match[1]}=`));
      await bootstrap.text();
      const refreshed = await fetch(base + "/api/refresh", {
        method: "POST",
        headers: {
          Cookie: cookie,
          Origin: base,
          "X-Relay-Request": "1",
          "Content-Type": "application/json",
        },
        body: "{}",
      });
      assert.equal(refreshed.status, 200);
      assert.equal((await refreshed.json()).mode, "demo");
      child.stdin.end();
      const [code] = await exited;
      assert.equal(code, 0);
    } finally {
      if (child?.exitCode === null) child.kill("SIGKILL");
      await new Promise((resolve) => blocker.close(resolve));
      await rm(dir, { recursive: true, force: true });
    }
  },
);
