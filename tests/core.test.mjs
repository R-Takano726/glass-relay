import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRelay,
  hash,
  validAlias,
  usageFromObservation,
  verifyAnchor,
  authorizeRequest,
} from "../server/core.mjs";
const source = {
  id: "local:codex:a",
  provider: "codex",
  host: "local",
  title: "Source",
};
const target = {
  id: "wsl:claude:b",
  provider: "claude",
  host: "wsl",
  title: "Target",
};
const messages = [
  { id: "1", role: "user", text: "原文を保持。", hash: hash("原文を保持。") },
  {
    id: "2",
    role: "assistant",
    text: "回答\n二行目。",
    hash: hash("回答\n二行目。"),
  },
  { id: "3", role: "user", text: "次の質問", hash: hash("次の質問") },
];
const build = (overrides) =>
  buildRelay({
    source,
    target,
    messages,
    messageIds: ["1", "2"],
    note: "レビューして",
    ...overrides,
  });
test("原文と話者ラベルを保持し補足指示を引用の外へ置く", () => {
  const r = build();
  assert.ok(r.text.includes("[User]\n原文を保持。"));
  assert.ok(r.text.includes("[codex]\n回答\n二行目。"));
  assert.ok(r.text.indexOf("レビューして") < r.text.indexOf("<relay-quote>"));
  assert.equal(r.count, 2);
  assert.equal(r.status, "prepared");
});
test("同一セッションへの送信を拒否", () =>
  assert.throws(() => build({ target: source })));
test("選択中に消えたメッセージを拒否", () =>
  assert.throws(() => build({ messageIds: ["missing"] }), { status: 409 }));
test("順番の逆転と非連続の選択を拒否", () => {
  assert.throws(() => build({ messageIds: ["2", "1"] }));
  assert.throws(() => build({ messageIds: ["1", "3"] }));
});
test("重複した選択を拒否", () =>
  assert.throws(() => build({ messageIds: ["1", "1"] })));
test("本文なし・補足指示のみを許容し空送信を拒否", () => {
  assert.equal(build({ messageIds: [], note: "追加確認" }).count, 0);
  assert.throws(() => build({ messageIds: [], note: " " }));
});
test("マーカー付きの往復引用を除外", () =>
  assert.throws(() =>
    build({
      messages: [{ id: "r", role: "user", text: "[Relay:1234-abcd]\nquote" }],
      messageIds: ["r"],
    }),
  ));
test("台帳の本文ハッシュでも往復引用を除外", () =>
  assert.throws(() =>
    build({
      messageIds: ["1"],
      history: [{ target: source.id, textHash: hash(messages[0].text) }],
    }),
  ));
test("送信内容と終端をスナップショット化", () => {
  const r = build();
  const old = r.text;
  const copy = structuredClone(messages);
  copy[1].text = "modified";
  assert.equal(r.text, old);
  assert.equal(r.endId, "2");
  assert.equal(r.endHash, messages[1].hash);
});
test("圧縮・巻き戻し後の消えたアンカーと本文変更を検出", () => {
  const r = build();
  assert.equal(verifyAnchor(r, messages), true);
  assert.equal(verifyAnchor(r, messages.slice(0, 1)), false);
  assert.equal(verifyAnchor(r, [{ id: "2", hash: "changed" }]), false);
});
test("SSHホスト名へのコマンド注入を拒否", () => {
  for (const alias of [
    "-oProxyCommand=x",
    "host;id",
    "host\ncommand",
    "a b",
    "$(id)",
    "../x",
    "",
  ])
    assert.equal(validAlias(alias), false);
  assert.equal(validAlias("dev-wsl"), true);
});
test("消費率から残量へ変換し週間を正しく表示", () => {
  const u = usageFromObservation(
    {
      provider: "codex",
      data: {
        primary: {
          used_percent: 32,
          window_minutes: 10080,
          resets_at: 1800000000,
        },
      },
      observedAt: "now",
    },
    "local",
  );
  assert.equal(u.windows[0].remaining, 68);
  assert.equal(u.windows[0].label, "週間");
});
test("未知の利用枠をゼロ残量として扱わない", () =>
  assert.equal(
    usageFromObservation(
      {
        provider: "codex",
        data: { primary: { used_percent: null, resets_at: null } },
      },
      "local",
    ).windows.length,
    0,
  ));
const request = (headers = {}, method = "GET") => ({
  method,
  headers: {
    host: "127.0.0.1:4318",
    cookie: "relay_session_4318=secret",
    ...headers,
  },
});
test("HostとOriginの偽装を拒否", () => {
  assert.throws(() =>
    authorizeRequest(request({ host: "evil.example:4318" }), 4318, "secret"),
  );
  assert.throws(() =>
    authorizeRequest(
      request({ origin: "https://evil.example" }),
      4318,
      "secret",
    ),
  );
});
test("APIは起動時セッションCookieを必須にする", () =>
  assert.throws(
    () => authorizeRequest(request({ cookie: "" }), 4318, "secret"),
    { status: 401 },
  ));
test("変更操作には同一Originと独自ヘッダを必須にする", () => {
  assert.throws(() => authorizeRequest(request({}, "POST"), 4318, "secret"));
  assert.throws(() =>
    authorizeRequest(
      request({ "x-relay-request": "1" }, "POST"),
      4318,
      "secret",
    ),
  );
  assert.doesNotThrow(() =>
    authorizeRequest(
      request(
        { origin: "http://127.0.0.1:4318", "x-relay-request": "1" },
        "POST",
      ),
      4318,
      "secret",
    ),
  );
});
