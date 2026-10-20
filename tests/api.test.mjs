import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRelayServer } from "../server/index.mjs";
import { Store } from "../server/store.mjs";
test("HTTP API: authorization, snapshots, copy/confirm, idempotency and reverse relay", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-test-"));
  const service = await createRelayServer({
    demo: true,
    port: 0,
    dataDir: dir,
  });
  t.after(async () => {
    await service.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const origin = `http://127.0.0.1:${service.server.address().port}`;
  const page = await fetch(origin);
  assert.equal(page.status, 200);
  const cookie = page.headers.get("set-cookie").split(";")[0];
  const get = (route) =>
    fetch(origin + "/api" + route, { headers: { cookie } });
  const post = (route, body) =>
    fetch(origin + "/api" + route, {
      method: "POST",
      headers: {
        cookie,
        Origin: origin,
        "Content-Type": "application/json",
        "X-Relay-Request": "1",
      },
      body: JSON.stringify(body),
    });
  await t.test("unauthenticated API denied", async () =>
    assert.equal((await fetch(origin + "/api/state")).status, 401),
  );
  await t.test("cross-origin mutation denied", async () =>
    assert.equal(
      (
        await fetch(origin + "/api/refresh", {
          method: "POST",
          headers: {
            cookie,
            Origin: "https://evil.invalid",
            "X-Relay-Request": "1",
          },
        })
      ).status,
      403,
    ),
  );
  await t.test("source registry paths never exposed", async () => {
    const state = await (await get("/state")).json();
    assert.equal(state.sessions.length, 6);
    assert.equal("path" in state.sessions[0], false);
  });
  const state = await (await get("/state")).json();
  const source = state.sessions[0],
    target = state.sessions[1];
  const messages = await (
    await get("/messages?id=" + encodeURIComponent(source.id))
  ).json();
  let relay;
  await t.test("prepare immutable original quote", async () => {
    const response = await post("/prepare", {
      source: source.id,
      target: target.id,
      messageIds: messages.map((m) => m.id),
      note: "競合を確認",
    });
    assert.equal(response.status, 200);
    relay = await response.json();
    assert.ok(relay.text.includes(messages[1].text));
    assert.equal(relay.count, 4);
  });
  await t.test("cannot confirm before copying", async () =>
    assert.equal(
      (await post("/deliver", { id: relay.id, action: "confirm" })).status,
      409,
    ),
  );
  await t.test("copy remains unconfirmed", async () => {
    const r = await (
      await post("/deliver", { id: relay.id, action: "copied" })
    ).json();
    assert.equal(r.status, "copied");
  });
  await t.test("manual acknowledgement advances confirmation", async () => {
    const r = await (
      await post("/deliver", { id: relay.id, action: "confirm" })
    ).json();
    assert.equal(r.status, "confirmed");
    assert.equal(r.confirmation, "manual");
  });
  await t.test("repeat confirmation is idempotent", async () => {
    await post("/deliver", { id: relay.id, action: "confirm" });
    const s = await (await get("/state")).json();
    assert.equal(s.history.length, 1);
  });
  await t.test("demo send and reverse response", async () => {
    const r = await (
      await post("/prepare", {
        source: source.id,
        target: target.id,
        messageIds: [messages[3].id],
        note: "確認",
      })
    ).json();
    const sent = await (
      await post("/deliver", { id: r.id, action: "send" })
    ).json();
    assert.equal(sent.status, "confirmed");
    const back = await (
      await get("/messages?id=" + encodeURIComponent(target.id))
    ).json();
    assert.ok(back.some((m) => m.id === sent.demoResponse.id));
    assert.ok(back.every((m) => !m.text.startsWith("[Relay:")));
  });
  await t.test("body and unknown action validation", async () => {
    assert.equal(
      (
        await post("/prepare", {
          source: source.id,
          target: target.id,
          messageIds: ["missing"],
        })
      ).status,
      409,
    );
    assert.equal(
      (await post("/deliver", { id: relay.id, action: "bogus" })).status,
      400,
    );
  });
  await t.test(
    "copied relay cannot be directly resent and preparation reuses its identity",
    async () => {
      const body = {
        source: source.id,
        target: target.id,
        messageIds: [messages[0].id],
        note: "copy guard",
      };
      const r = await (await post("/prepare", body)).json();
      await post("/deliver", { id: r.id, action: "copied" });
      assert.equal(
        (await post("/deliver", { id: r.id, action: "send" })).status,
        409,
      );
      assert.equal((await (await post("/prepare", body)).json()).id, r.id);
    },
  );
  await t.test(
    "unknown receipt forbids resend but permits explicit human acknowledgement",
    async () => {
      const r = await (
        await post("/prepare", {
          source: source.id,
          target: target.id,
          messageIds: [messages[0].id],
          note: "unknown receipt",
        })
      ).json();
      service.store.data.history.find((item) => item.id === r.id).status =
        "unknown";
      service.store.save();
      assert.equal(
        (await post("/deliver", { id: r.id, action: "send" })).status,
        409,
      );
      const confirmed = await (
        await post("/deliver", { id: r.id, action: "confirm" })
      ).json();
      assert.equal(confirmed.status, "confirmed");
      assert.equal(confirmed.confirmation, "manual");
    },
  );
  await t.test(
    "state summaries exclude private quote bodies; detail endpoint preserves original",
    async () => {
      const state = await (await get("/state")).json();
      assert.ok(
        state.history.every((r) => !("text" in r) && !("demoResponse" in r)),
      );
      const detail = await (await get("/history?id=" + relay.id)).json();
      assert.equal(detail.text, relay.text);
    },
  );
  await t.test(
    "changed message hashes cannot replace previewed text",
    async () => {
      const response = await post("/prepare", {
        source: source.id,
        target: target.id,
        messageIds: [messages[0].id],
        messageHashes: [{ id: messages[0].id, hash: "changed" }],
        note: "hash check",
      });
      assert.equal(response.status, 409);
    },
  );
  await t.test("independent service cookie is namespaced by port", () =>
    assert.ok(
      cookie.startsWith(`relay_session_${service.server.address().port}=`),
    ),
  );
  await t.test(
    "stale windows cannot prepare or deliver the same new range after another window confirms",
    async () => {
      const latest = service.store.data.history.find(
        (r) =>
          r.source === source.id &&
          r.target === target.id &&
          r.status === "confirmed" &&
          r.endId,
      );
      const intent = {
        source: source.id,
        target: target.id,
        messageIds: [messages[0].id],
        note: "cursor concurrent",
        useCursor: true,
        anchorId: latest?.id || null,
      };
      const old = await (await post("/prepare", intent)).json();
      const newer = await (
        await post("/prepare", { ...intent, note: "other window" })
      ).json();
      assert.equal(
        (await post("/deliver", { id: newer.id, action: "send" })).status,
        200,
      );
      assert.equal((await post("/prepare", intent)).status, 409);
      assert.equal(
        (await post("/deliver", { id: old.id, action: "send" })).status,
        409,
      );
    },
  );
  await t.test(
    "unconfirmed cursor blocks a different-note relay until human resolution",
    async () => {
      const pair = {
        source: state.sessions[2].id,
        target: state.sessions[3].id,
        messageIds: [state.sessions[2].messages[0].id],
        useCursor: true,
        anchorId: null,
      };
      const first = await (
        await post("/prepare", { ...pair, note: "pending one" })
      ).json();
      const second = await (
        await post("/prepare", { ...pair, note: "pending two" })
      ).json();
      assert.equal(
        (await post("/deliver", { id: first.id, action: "copied" })).status,
        200,
      );
      assert.equal(
        (await post("/deliver", { id: second.id, action: "send" })).status,
        409,
      );
      assert.equal(
        (await post("/prepare", { ...pair, note: "pending three" })).status,
        409,
      );
      service.store.data.history.find((r) => r.id === first.id).status =
        "unknown";
      service.store.save();
      assert.equal(
        (await post("/prepare", { ...pair, note: "unknown four" })).status,
        409,
      );
      assert.equal(
        (await post("/deliver", { id: first.id, action: "confirm" })).status,
        200,
      );
      assert.equal(
        (await post("/deliver", { id: second.id, action: "send" })).status,
        409,
      );
    },
  );
  await t.test("SSH mutation disabled in demo", async () =>
    assert.equal((await post("/connect", { alias: "dev-wsl" })).status, 400),
  );
  await t.test("state files private and single-writer", async () => {
    assert.equal(fs.statSync(path.join(dir, "state.json")).mode & 0o777, 0o600);
    assert.throws(() => new Store(dir));
  });
});
test("crashed sending state is restored as unknown, preserving original", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-store-"));
  let s = new Store(dir);
  s.data.history = [{ id: "test", status: "sending", text: "original" }];
  s.save();
  s.close();
  s = new Store(dir);
  assert.equal(s.data.history[0].status, "unknown");
  assert.equal(s.data.history[0].text, "original");
  s.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("empty stale lock does not become process-group lock", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-lock-"));
  fs.writeFileSync(path.join(dir, "service.lock"), "");
  const store = new Store(dir);
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
