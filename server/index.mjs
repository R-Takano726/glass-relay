import http from "node:http";
import { homedir } from "node:os";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import { Store } from "./store.mjs";
import {
  RelayError,
  authorizeRequest,
  buildRelay,
  verifyAnchor,
} from "./core.mjs";
import {
  collectHost,
  readMessages,
  sanitizeSession,
  codexRPC,
  assertHost,
  readSelectionRequest,
} from "./adapters.mjs";
const defaultDataDir = path.join(
  homedir(),
  ...(process.platform === "darwin"
    ? ["Library", "Application Support", "GlassRelay"]
    : [".local", "state", "glass-relay", "service"]),
);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export async function createRelayServer({
  demo = false,
  port = 4318,
  dataDir = defaultDataDir,
  testMode = false,
} = {}) {
  const store = new Store(dataDir);
  const token = randomBytes(32).toString("hex");
  const fixture = JSON.parse(
    fs.readFileSync(path.join(root, "src/demo-data.json"), "utf8"),
  );
  let cache = {
    mode: demo ? "demo" : "live",
    sessions: [],
    usage: [],
    environments: [],
  };
  let refreshing = null;
  let selectionRequest = null;
  let revision = 0;
  const sendingTargets = new Set();
  const getHistory = () => store.data.history;
  function assertCursor(relay) {
    if (!relay.useCursor) return;
    const latest = getHistory().find(
      (r) =>
        r.source === relay.source &&
        r.target === relay.target &&
        r.status === "confirmed" &&
        r.endId,
    );
    if ((latest?.id || null) !== relay.anchorId)
      throw new RelayError("別の画面で引き継ぎ済みです。更新してください", 409);
    const unresolved = getHistory().find(
      (r) =>
        r.id !== relay.id &&
        r.source === relay.source &&
        r.target === relay.target &&
        r.useCursor &&
        r.anchorId === relay.anchorId &&
        ["copied", "sending", "unknown"].includes(r.status),
    );
    if (unresolved)
      throw new RelayError(
        "先のリレーが送信未確認です。先に送信先を確認してください",
        409,
      );
  }
  const state = () => ({
    ...cache,
    revision,
    selectionRequest,
    sessions: cache.sessions.map(sanitizeSession),
    history: getHistory().map(({ text, demoResponse, ...summary }) => summary),
  });
  async function refresh() {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      if (demo) {
        cache = { ...structuredClone(fixture), history: undefined };
        for (const r of getHistory().filter(
          (r) => r.status === "confirmed" && r.demoResponse,
        )) {
          const target = cache.sessions.find((s) => s.id === r.target);
          if (
            target &&
            !target.messages.some((m) => m.id === r.demoResponse.id)
          ) {
            target.messages.push(r.demoResponse);
            target.messageCount = target.messages.length;
          }
        }
      } else {
        const hosts = ["local", ...store.data.hosts];
        const results = await Promise.all(
          hosts.map(async (host) => {
            try {
              return await collectHost(host);
            } catch (e) {
              return {
                sessions: [],
                usage: [],
                environment: {
                  id: host,
                  label: host === "local" ? "Mac" : `WSL · ${host}`,
                  status: "offline",
                  error: e.message,
                },
              };
            }
          }),
        );
        cache = {
          mode: "live",
          sessions: results
            .flatMap((r) => r.sessions)
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
          usage: results.flatMap((r) => r.usage),
          environments: results.map((r) => r.environment),
        };
      }
      revision++;
      return state();
    })().finally(() => (refreshing = null));
    return refreshing;
  }
  async function messages(session) {
    return demo ? session.messages || [] : readMessages(session);
  }
  const sessionById = (id) => {
    const s = cache.sessions.find((s) => s.id === id);
    if (!s) throw new RelayError("セッションが見つかりません", 404);
    return s;
  };
  let server;
  const handler = async (req, res) => {
    const actualPort = server.address().port;
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    function json(value, status = 200) {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
      });
      res.end(JSON.stringify(value));
    }
    try {
      const url = new URL(req.url, `http://127.0.0.1:${actualPort}`);
      const api = url.pathname.startsWith("/api/");
      authorizeRequest(req, actualPort, token, { bootstrap: !api });
      if (!api) {
        if (!["GET", "HEAD"].includes(req.method))
          throw new RelayError("Method not allowed", 405);
        res.setHeader(
          "Set-Cookie",
          `relay_session_${actualPort}=${token}; HttpOnly; SameSite=Strict; Path=/`,
        );
        const relative =
          url.pathname === "/"
            ? "index.html"
            : decodeURIComponent(url.pathname.slice(1));
        const file = path.resolve(root, "dist", relative);
        if (!file.startsWith(path.join(root, "dist") + path.sep))
          throw new RelayError("Not found", 404);
        if (!fs.existsSync(file) || fs.statSync(file).isDirectory())
          throw new RelayError("Not found", 404);
        const ext = path.extname(file);
        const types = {
          ".html": "text/html; charset=utf-8",
          ".js": "text/javascript; charset=utf-8",
          ".css": "text/css; charset=utf-8",
          ".svg": "image/svg+xml",
          ".png": "image/png",
        };
        res.writeHead(200, {
          "Content-Type": types[ext] || "application/octet-stream",
        });
        res.end(req.method === "HEAD" ? undefined : fs.readFileSync(file));
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/state")
        return json(state());
      if (req.method === "GET" && url.pathname === "/api/messages")
        return json(await messages(sessionById(url.searchParams.get("id"))));
      if (req.method === "GET" && url.pathname === "/api/history") {
        const relay = getHistory().find(
          (r) => r.id === url.searchParams.get("id"),
        );
        if (!relay) throw new RelayError("リレーが見つかりません", 404);
        return json(relay);
      }
      if (req.method !== "POST") throw new RelayError("Not found", 404);
      let raw = "";
      for await (const chunk of req) {
        raw += chunk;
        if (Buffer.byteLength(raw) > 600000)
          throw new RelayError("Request too large", 413);
      }
      let body;
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        throw new RelayError("Invalid JSON");
      }
      if (url.pathname === "/api/refresh") return json(await refresh());
      if (url.pathname === "/api/connect") {
        if (demo) throw new RelayError("デモではSSH接続を変更できません");
        assertHost(body.alias);
        if (body.alias === "local") throw new RelayError("Macは接続済みです");
        await collectHost(body.alias);
        if (!store.data.hosts.includes(body.alias))
          store.data.hosts.push(body.alias);
        store.save();
        return json(await refresh());
      }
      if (url.pathname === "/api/prepare") {
        const source = sessionById(body.source),
          target = sessionById(body.target);
        const all = await messages(source);
        if (
          body.messageHashes &&
          (!Array.isArray(body.messageHashes) ||
            body.messageHashes.some(
              (expected) =>
                !all.some(
                  (m) => m.id === expected.id && m.hash === expected.hash,
                ),
            ))
        )
          throw new RelayError(
            "会話が変更されています。再読み込みしてください",
            409,
          );
        const anchor = getHistory().find(
          (r) =>
            r.source === source.id &&
            r.target === target.id &&
            r.status === "confirmed" &&
            r.endId,
        );
        if (body.useCursor && (body.anchorId || null) !== (anchor?.id || null))
          throw new RelayError(
            "別の画面で引き継ぎ済みです。更新してください",
            409,
          );
        // Explicit range selection is allowed, but a missing anchor cannot silently choose "new".
        if (body.useCursor && anchor && !verifyAnchor(anchor, all))
          throw new RelayError(
            "前回の位置が見つかりません。範囲を選び直してください",
            409,
          );
        const relay = buildRelay({
          source,
          target,
          messages: all,
          messageIds: body.messageIds,
          note: body.note,
          history: getHistory(),
        });
        relay.useCursor = !!body.useCursor;
        relay.anchorId = body.anchorId || null;
        relay.contentKey +=
          "|cursor:" + (body.useCursor ? body.anchorId || "start" : "explicit");
        const existing = getHistory().find(
          (r) =>
            r.contentKey === relay.contentKey &&
            ["prepared", "copied", "unknown", "sending"].includes(r.status),
        );
        if (existing) {
          assertCursor(existing);
          return json(existing);
        }
        assertCursor(relay);
        store.data.history.unshift(relay);
        store.save();
        revision++;
        return json(relay);
      }
      if (url.pathname === "/api/deliver") {
        const relay = getHistory().find((r) => r.id === body.id);
        if (!relay) throw new RelayError("リレーが見つかりません", 404);
        if (!["send", "copied", "confirm"].includes(body.action))
          throw new RelayError("Invalid action");
        if (relay.status === "confirmed") return json(relay);
        if (["send", "copied"].includes(body.action)) assertCursor(relay);
        if (body.action === "confirm") {
          if (!["copied", "unknown"].includes(relay.status))
            throw new RelayError(
              "コピー済みまたは送信未確認の内容だけ確認できます",
              409,
            );
          relay.status = "confirmed";
          relay.confirmation = "manual";
          store.save();
          revision++;
          return json(relay);
        }
        if (["sending", "unknown"].includes(relay.status))
          throw new RelayError(
            "送信状態が未確認です。自動再送はできません",
            409,
          );
        if (body.action === "copied") {
          relay.status = "copied";
          store.save();
          revision++;
          return json(relay);
        }
        if (relay.status !== "prepared")
          throw new RelayError(
            relay.status === "failed"
              ? "送信に失敗したリレーです。内容を確認して新しく作成してください"
              : "コピー済みのリレーは直接送信できません。送信先を確認してください",
            409,
          );
        const target = sessionById(relay.target);
        if (demo) {
          relay.status = "confirmed";
          relay.confirmation = "demo";
          relay.demoResponse = {
            id: `reply-${relay.id}`,
            hash: relay.id,
            role: "assistant",
            text: "引用した会話を確認しました。タブ間の同時更新について、Web Locks APIの適用とタイムアウト時の状態遷移を確認する必要があります。",
            timestamp: new Date().toISOString(),
          };
          store.save();
          await refresh();
          return json(relay);
        }
        if (target.transport !== "codex-proxy")
          throw new RelayError(
            "このセッションは直接送信に未対応です。「コピー」で引き継いでください。",
            409,
          );
        if (sendingTargets.has(target.id))
          throw new RelayError("送信先への別のリレーを処理中です", 409);
        sendingTargets.add(target.id);
        try {
          await codexRPC(target.host, {
            action: "status",
            sessionId: target.key,
          });
          // Mark before transport. Any crash or post-start uncertainty prevents automatic retry.
          if (relay.status === "confirmed") return json(relay);
          if (relay.status !== "prepared")
            throw new RelayError("送信処理中または未確認です", 409);
          assertCursor(relay);
          relay.status = "sending";
          store.save();
          try {
            const result = await codexRPC(target.host, {
              action: "send",
              sessionId: target.key,
              text: relay.text,
            });
            relay.status = result.confirmed ? "confirmed" : "unknown";
            relay.confirmation = result.confirmed ? "observed" : undefined;
            store.save();
            revision++;
            return json(relay);
          } catch (e) {
            relay.status = e.result?.unknown === false ? "failed" : "unknown";
            store.save();
            revision++;
            throw new RelayError(
              "送信を確認できません。履歴を確認してください。",
              502,
            );
          }
        } finally {
          sendingTargets.delete(target.id);
        }
      }
      throw new RelayError("Not found", 404);
    } catch (e) {
      json(
        { error: e instanceof RelayError ? e.message : "処理に失敗しました" },
        e.status || 500,
      );
    }
  };
  server = http.createServer(handler);
  server.requestTimeout = 60000;
  server.headersTimeout = 10000;
  await refresh();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  let pollInFlight = false;
  const polling = !demo
    ? setInterval(async () => {
        if (pollInFlight) return;
        pollInFlight = true;
        try {
          for (const host of ["local", ...store.data.hosts]) {
            try {
              const request = await readSelectionRequest(host);
              if (
                !request ||
                !/^[-0-9a-f]{36}$/.test(request.id) ||
                !Number.isFinite(Date.parse(request.createdAt)) ||
                Date.now() - Date.parse(request.createdAt) > 600000 ||
                Date.now() < Date.parse(request.createdAt) ||
                store.data.processedRequests?.includes(request.id)
              )
                continue;
              if (
                request.provider &&
                !["claude", "codex"].includes(request.provider)
              )
                continue;
              await refresh();
              selectionRequest = { ...request, host };
              store.data.processedRequests = [
                ...(store.data.processedRequests || []),
                request.id,
              ].slice(-100);
              store.save();
              revision++;
              console.log("RelayOpen");
            } catch {}
          }
        } finally {
          pollInFlight = false;
        }
      }, 5000)
    : null;
  polling?.unref();
  const quotaRefresh = !demo
    ? setInterval(() => {
        refresh().catch(() => {});
      }, 60000)
    : null;
  quotaRefresh?.unref();
  const close = () => {
    if (quotaRefresh) clearInterval(quotaRefresh);
    if (polling) clearInterval(polling);
    return new Promise((resolve) =>
      server.close(() => {
        store.close();
        resolve();
      }),
    );
  };
  return { server, close, store, refresh };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const demo = process.env.RELAY_DEMO === "1";
  const service = await createRelayServer({
    demo,
    port: Number(process.env.RELAY_PORT || 4318),
    dataDir:
      process.env.RELAY_DATA_DIR ||
      (demo ? path.join(root, ".local/demo") : defaultDataDir),
  });
  console.log(
    `Relay: http://127.0.0.1:${service.server.address().port} (${demo ? "demo" : "live"})`,
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, async () => {
      await service.close();
      process.exit(0);
    });
}
