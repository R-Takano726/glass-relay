import { execFile, spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { promisify } from "node:util";
import { RelayError, validAlias, usageFromObservation } from "./core.mjs";
const exec = promisify(execFile);
const directory = path.dirname(fileURLToPath(import.meta.url));
const reader = readFileSync(path.join(directory, "host.py"), "utf8");
const rpcScript = readFileSync(path.join(directory, "rpc.py"), "utf8");
export const shellQuote = (text) =>
  `'${String(text).replaceAll("'", "'\\''")}'`;
const sshArgs = (host) => [
  "-o",
  "BatchMode=yes",
  "-o",
  "ClearAllForwardings=yes",
  "-o",
  "StrictHostKeyChecking=yes",
  "-o",
  `UserKnownHostsFile=${path.join(homedir(), ".ssh/known_hosts")}`,
  "-o",
  "ConnectTimeout=7",
  "-o",
  "ServerAliveInterval=10",
  "--",
  host,
];
export function configuredAliases() {
  try {
    return [
      ...new Set(
        readFileSync(path.join(homedir(), ".ssh/config"), "utf8")
          .split("\n")
          .filter((l) => /^\s*Host\s+/i.test(l))
          .flatMap((l) => l.trim().split(/\s+/).slice(1))
          .filter(validAlias),
      ),
    ];
  } catch {
    return [];
  }
}
export function assertHost(host) {
  if (
    host !== "local" &&
    (!validAlias(host) || !configuredAliases().includes(host))
  )
    throw new RelayError("~/.ssh/config に登録されたHost名を指定してください");
}
function run(program, args, input, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const p = spawn(program, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "",
      stderr = "",
      closed = false;
    const timer = setTimeout(() => {
      p.kill("SIGTERM");
      reject(new RelayError("接続がタイムアウトしました", 504));
    }, timeout);
    p.stdout.on("data", (c) => {
      stdout += c;
      if (Buffer.byteLength(stdout) > 36 * 1024 * 1024) {
        p.kill();
        reject(new RelayError("取得データが上限を超えました", 413));
      }
    });
    p.stderr.on("data", (c) => {
      if (stderr.length < 2000) stderr += c;
    });
    p.on("error", (e) => {
      clearTimeout(timer);
      reject(new RelayError(`接続できません: ${e.code}`, 503));
    });
    p.on("close", (code) => {
      clearTimeout(timer);
      closed = true;
      try {
        const value = JSON.parse(stdout);
        if (value?.error) {
          const error = new RelayError(value.error, 503);
          error.result = value;
          reject(error);
        } else if (code) reject(new RelayError("接続処理に失敗しました", 503));
        else resolve(value);
      } catch {
        reject(
          new RelayError(
            stderr.includes("Host key")
              ? "SSHホスト鍵を確認してください"
              : stderr.includes("Permission denied")
                ? "SSH認証に失敗しました"
                : "接続先から有効な応答がありません",
            503,
          ),
        );
      }
    });
    p.stdin.on("error", () => {});
    p.stdin.end(input);
  });
}
export async function collectHost(host) {
  assertHost(host);
  const result =
    host === "local"
      ? await run(
          "python3",
          ["-I", "-", JSON.stringify({ action: "list" })],
          reader,
        )
      : await run(
          "ssh",
          [
            ...sshArgs(host),
            `python3 -I - ${shellQuote(JSON.stringify({ action: "list" }))}`,
          ],
          reader,
        );
  const sessions = result.sessions.map((s) => ({
    ...s,
    id: `${host}:${s.provider}:${s.key}`,
    host,
    transport: "copy",
  }));
  const latest = new Map();
  for (const observation of result.usage)
    if (
      !latest.has(observation.provider) ||
      observation.observedAt > latest.get(observation.provider).observedAt
    )
      latest.set(observation.provider, observation);
  const usage = ["claude", "codex"].map((provider) =>
    latest.has(provider)
      ? usageFromObservation(latest.get(provider), host)
      : { provider, host, windows: [], observedAt: null, source: "未取得" },
  );
  try {
    const catalog = await codexRPC(host, { action: "catalog" });
    for (const session of sessions.filter((s) => s.provider === "codex")) {
      const thread = catalog.threads.find((t) => t.id === session.key);
      if (thread?.title) session.title = thread.title;
      if (thread?.state === "idle") session.transport = "codex-proxy";
    }
    if (catalog.usage) {
      const observed =
        catalog.usage.rateLimitsByLimitId?.codex || catalog.usage.rateLimits;
      const convert = (w) =>
        w
          ? {
              used_percent: w.usedPercent,
              window_minutes: w.windowDurationMins,
              resets_at: w.resetsAt,
            }
          : null;
      if (observed) {
        const index = usage.findIndex((u) => u.provider === "codex");
        usage[index] = {
          ...usageFromObservation(
            {
              provider: "codex",
              observedAt: new Date().toISOString(),
              data: {
                primary: convert(observed.primary),
                secondary: convert(observed.secondary),
              },
            },
            host,
          ),
          source: "Codex app-server",
        };
      }
    }
  } catch {
    /* A missing daemon does not prevent read-only transcript access. */
  }
  return {
    sessions,
    usage,
    environment: {
      id: host,
      label: host === "local" ? "Mac" : `WSL · ${host}`,
      status: "connected",
    },
    errors: result.errors,
  };
}
export async function readMessages(session) {
  assertHost(session.host);
  const arg = JSON.stringify({ action: "messages", path: session.path });
  return session.host === "local"
    ? run("python3", ["-I", "-", arg], reader)
    : run(
        "ssh",
        [...sshArgs(session.host), `python3 -I - ${shellQuote(arg)}`],
        reader,
      );
}
export async function codexRPC(host, request) {
  assertHost(host);
  if (host === "local")
    return run(
      "python3",
      ["-I", "-c", rpcScript],
      JSON.stringify(request),
      45000,
    );
  const encoded = Buffer.from(rpcScript).toString("base64");
  return run(
    "ssh",
    [
      ...sshArgs(host),
      `python3 -I -c ${shellQuote(`import base64;exec(base64.b64decode('${encoded}'))`)}`,
    ],
    JSON.stringify(request),
    45000,
  );
}
export function sanitizeSession({ path, key, warnings, ...session }) {
  return session;
}

export async function readSelectionRequest(host) {
  assertHost(host);
  const arg = JSON.stringify({ action: "request" });
  return host === "local"
    ? run("python3", ["-I", "-", arg], reader)
    : run("ssh", [...sshArgs(host), `python3 -I - ${shellQuote(arg)}`], reader);
}
