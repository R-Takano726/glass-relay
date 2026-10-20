import { useEffect, useRef, useState } from "react";
import {
  AnimatePresence,
  MotionConfig,
  motion,
  useIsPresent,
} from "motion/react";
import {
  ArrowDown,
  ArrowDownUp,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  Command,
  Copy,
  Expand,
  History,
  Layers2,
  Link2,
  LoaderCircle,
  Monitor,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Terminal,
  Wifi,
  X,
  Zap,
  SlidersHorizontal,
  AlertCircle,
} from "lucide-react";
import * as api from "./api";
import type { Data, Message, Provider, Relay, Session, Usage } from "./types";
import { providerName } from "./types";
const spring = {
  type: "spring" as const,
  stiffness: 420,
  damping: 35,
  mass: 0.8,
};
const DRAFT = `relay-draft-${api.isStaticDemo ? "static" : location.port}-v1`;
const PREFS = "relay-prefs-v1";
function read(key: string, fallback: any) {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") || fallback;
  } catch {
    return fallback;
  }
}
function Brand({ provider, size = 26 }: { provider: Provider; size?: number }) {
  return (
    <span
      className={`brand ${provider}`}
      style={{ width: size, height: size }}
      aria-label={providerName(provider)}
    >
      {provider === "claude" ? (
        <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
          {Array.from({ length: 12 }, (_, i) => (
            <path
              key={i}
              d="M16 4v8"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              transform={`rotate(${i * 30} 16 16)`}
            />
          ))}
        </svg>
      ) : (
        <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
          <path
            d="m12 10-6 6 6 6m8-12 6 6-6 6m-2-15-4 18"
            stroke="currentColor"
            strokeWidth="2.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </span>
  );
}
const environment = (host: string) => (host === "local" ? "Mac" : "WSL");
function time(value: string) {
  return new Date(value).toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
function resetTime(value: string) {
  return new Date(value).toLocaleString("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function UsageCard({
  usage,
  provider,
  expanded = false,
}: {
  usage?: Usage;
  provider: Provider;
  expanded?: boolean;
}) {
  const w = usage?.windows[0];
  const stale =
    usage?.observedAt &&
    Date.now() - new Date(usage.observedAt).getTime() > 300000;
  return (
    <motion.section
      layout
      className={`usage-card glass ${expanded ? "expanded-usage" : ""}`}
    >
      <div className="usage-top">
        <div className="provider-label">
          <Brand provider={provider} />
          <span>{providerName(provider)}</span>
        </div>
        <span className={`tiny-label ${w ? "" : "muted"}`}>
          {usage?.source === "デモデータ"
            ? "サンプル"
            : w
              ? "残り利用枠"
              : "取得待ち"}
        </span>
      </div>
      <div className="usage-numbers">
        <span className="usage-value">
          {w ? Math.round(w.remaining) : "—"}
          <small>{w ? "%" : ""}</small>
        </span>
        <span className="usage-period">{w?.label || "未取得"}</span>
        <div className="mini-bars" aria-hidden="true">
          {Array.from({ length: 24 }, (_, i) => (
            <motion.i
              key={i}
              initial={{ scaleY: 0 }}
              animate={{ scaleY: 1 }}
              transition={{ ...spring, delay: i * 0.008 }}
              className={w && i / 24 < w.remaining / 100 ? provider : ""}
            />
          ))}
        </div>
      </div>
      <div className="usage-bottom">
        <span>
          {w
            ? `${resetTime(w.resetsAt)} リセット`
            : "利用枠の観測データがありません"}
        </span>
        {usage && (
          <span className="usage-secondary">
            {usage.windows[1] ? (
              `週間 ${Math.round(usage.windows[1].remaining)}%`
            ) : (
              <Clock3 size={12} />
            )}
          </span>
        )}
      </div>
      {usage?.observedAt && (
        <div className="usage-observation">
          {environment(usage.host)} · {time(usage.observedAt)} 観測
          {stale ? " · 古いデータ" : ""}
        </div>
      )}
      {expanded && (
        <div className="usage-detail">
          {usage?.windows.slice(1).map((window) => (
            <div key={window.label}>
              <span>{window.label}</span>
              <strong>{Math.round(window.remaining)}%</strong>
              <span>{resetTime(window.resetsAt)} リセット</span>
            </div>
          ))}
          <p>取得元：{usage?.source || "未取得"}</p>
          <p>
            観測元：{usage ? environment(usage.host) : "—"}
            {usage?.observedAt
              ? ` · ${resetTime(usage.observedAt)}${stale ? " · 古いデータ" : ""}`
              : ""}
          </p>
        </div>
      )}
    </motion.section>
  );
}
function SessionCard({
  session,
  label,
  onClick,
  open,
}: {
  session?: Session;
  label: string;
  onClick: () => void;
  open: boolean;
}) {
  return (
    <motion.button
      type="button"
      layout
      whileTap={{ scale: 0.98 }}
      className={`session-card glass ${open ? "active" : ""}`}
      onClick={onClick}
      aria-label={`${label}を選択`}
      aria-expanded={open}
    >
      <div className="session-label">
        {label}
        <ChevronDown size={14} className={open ? "rotate" : ""} />
      </div>
      {session ? (
        <>
          <div className="session-identity">
            <Brand provider={session.provider} size={35} />
            <div>
              <strong>{providerName(session.provider)}</strong>
              <span className="host-badge">{environment(session.host)}</span>
            </div>
          </div>
          <div className="session-title">{session.title}</div>
          <div className="session-meta">
            <span>{session.model || "モデル不明"}</span>
            <span>
              {session.contextPercent === null
                ? "—"
                : `${session.contextPercent}%`}
              <span className="context-dot" />
            </span>
          </div>
        </>
      ) : (
        <div className="no-session">セッションを選択</div>
      )}
    </motion.button>
  );
}
function Picker({
  sessions,
  exclude,
  onSelect,
  onClose,
}: {
  sessions: Session[];
  exclude?: string;
  onSelect: (s: Session) => void;
  onClose: () => void;
}) {
  const present = useIsPresent();
  const [query, setQuery] = useState(""),
    [host, setHost] = useState("all");
  const results = sessions.filter(
    (s) =>
      s.id !== exclude &&
      (host === "all" ||
        (host === "local" ? s.host === "local" : s.host !== "local")) &&
      `${s.title} ${s.cwd} ${s.provider}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <motion.div
      className="picker glass"
      style={{ pointerEvents: present ? "auto" : "none" }}
      role="dialog"
      aria-label="セッションを選択"
      initial={{ opacity: 0, y: -8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -4, scale: 0.98 }}
      transition={spring}
    >
      <div className="picker-top">
        <div className="search-field">
          <Search size={15} />
          <input
            autoFocus
            aria-label="セッションを検索"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="セッションを検索"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <button
          className="icon-button"
          aria-label="選択を閉じる"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </div>
      <div className="segmented host-filter">
        {[
          ["all", "すべて"],
          ["local", "Mac"],
          ["remote", "WSL"],
        ].map(([id, name]) => (
          <button
            key={id}
            className={host === id ? "selected" : ""}
            onClick={() => setHost(id)}
          >
            {host === id && (
              <motion.span
                layoutId="host-filter"
                className="segment-bg"
                transition={spring}
              />
            )}
            <span>{name}</span>
          </button>
        ))}
      </div>
      <div className="picker-results">
        {results.length ? (
          results.map((s) => (
            <button
              className="picker-item"
              key={s.id}
              onClick={() => onSelect(s)}
            >
              <Brand provider={s.provider} />
              <div>
                <strong>{s.title}</strong>
                <span>
                  {providerName(s.provider)} · {environment(s.host)} · {s.cwd}
                </span>
              </div>
              <ChevronRight size={15} />
            </button>
          ))
        ) : (
          <div className="empty small">
            <Search size={22} />
            <span>セッションが見つかりません</span>
          </div>
        )}
      </div>
    </motion.div>
  );
}
export default function App() {
  const saved = useRef(read(DRAFT, {})).current;
  const [prefs, setPrefs] = useState(() =>
    read(PREFS, { motion: true, solid: false }),
  );
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [view, setView] = useState("relay"),
    [sourceId, setSourceId] = useState<string>(saved.source || ""),
    [targetId, setTargetId] = useState<string>(saved.target || ""),
    [note, setNote] = useState(saved.note || ""),
    [all, setAll] = useState<Message[]>([]),
    [range, setRange] = useState<"new" | "all" | "custom">(
      saved.range || "new",
    ),
    [start, setStart] = useState<string>(saved.start || ""),
    [picker, setPicker] = useState<"source" | "target" | null>(null),
    [settings, setSettings] = useState(false),
    [compact, setCompact] = useState(
      new URLSearchParams(location.search).has("compact"),
    ),
    [busy, setBusy] = useState(false),
    [toast, setToast] = useState(""),
    [preview, setPreview] = useState<Relay | null>(null),
    [detail, setDetail] = useState<Relay | null>(null),
    [alias, setAlias] = useState(""),
    [sessionLoading, setSessionLoading] = useState(false);
  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 4000);
  };
  const adopt = (next: Data) => {
    setData(next);
    setSourceId((id) =>
      next.sessions.some((s) => s.id === id) ? id : next.sessions[0]?.id || "",
    );
    setTargetId((id) =>
      next.sessions.some((s) => s.id === id)
        ? id
        : next.sessions.find(
            (s) =>
              s.id !== next.sessions[0]?.id &&
              s.provider !== next.sessions[0]?.provider,
          )?.id ||
          next.sessions[1]?.id ||
          "",
    );
  };
  useEffect(() => {
    api
      .load()
      .then(adopt)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  const requestId = useRef<string>(
    localStorage.getItem(`relay-handled-request-${location.port}`) || "",
  );
  useEffect(() => {
    if (api.isStaticDemo) return;
    const timer = window.setInterval(() => {
      api
        .load()
        .then((next) => {
          setData((previous) =>
            previous?.revision === next.revision ? previous : next,
          );
        })
        .catch(() => {});
    }, 3000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const req = data?.selectionRequest;
    if (!req || requestId.current === req.id) return;
    requestId.current = req.id;
    localStorage.setItem(`relay-handled-request-${location.port}`, req.id);
    setRange("new");
    setStart("");
    const matches = data.sessions.filter(
      (s) =>
        s.host === req.host &&
        (!req.provider || s.provider === req.provider) &&
        (req.sessionId
          ? s.id.endsWith(":" + req.sessionId)
          : s.cwd === req.cwd),
    );
    setView("relay");
    if (matches.length === 1) setSourceId(matches[0].id);
    else setPicker("source");
    setNote(req.note || "");
  }, [data?.selectionRequest?.id]);
  useEffect(() => {
    localStorage.setItem(
      DRAFT,
      JSON.stringify({
        source: sourceId,
        target: targetId,
        note,
        range,
        start,
      }),
    );
    setPreview(null);
  }, [sourceId, targetId, note, range, start]);
  useEffect(() => {
    localStorage.setItem(PREFS, JSON.stringify(prefs));
    document.documentElement.classList.toggle("solid", prefs.solid);
  }, [prefs]);
  useEffect(() => {
    if (!data || !sourceId) return;
    let cancelled = false;
    setSessionLoading(true);
    setAll([]);
    api
      .messages(data.sessions.find((s) => s.id === sourceId)!)
      .then((messages) => {
        if (!cancelled) setAll(api.visibleMessages(messages));
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setSessionLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sourceId, data?.sessions]);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (
        e.key === "Escape" &&
        !e.isComposing &&
        e.keyCode !== 229 &&
        (picker || settings || preview || detail)
      ) {
        e.preventDefault();
        e.stopPropagation();
        setPicker(null);
        setSettings(false);
        setPreview(null);
        setDetail(null);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        setSettings((v) => !v);
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [picker, settings, preview, detail]);
  const source = data?.sessions.find((s) => s.id === sourceId),
    target = data?.sessions.find((s) => s.id === targetId),
    anchor = data ? api.confirmedAnchor(data, sourceId, targetId) : undefined;
  const anchorIndex = anchor
    ? all.findIndex((m) => m.id === anchor.endId && m.hash === anchor.endHash)
    : -1;
  const lost =
    !!anchor && !sessionLoading && anchorIndex < 0 && range === "new";
  const startIndex =
    range === "all"
      ? 0
      : range === "custom"
        ? all.findIndex((m) => m.id === start) < 0
          ? all.length
          : all.findIndex((m) => m.id === start)
        : anchor
          ? anchorIndex + 1
          : 0;
  const selected = lost ? [] : all.slice(startIndex);
  const canSend =
    !!source &&
    !!target &&
    source.id !== target.id &&
    (selected.length > 0 || !!note.trim()) &&
    !lost &&
    !sessionLoading;
  async function doRefresh() {
    setLoading(true);
    setError("");
    try {
      adopt(await api.refresh());
      notify("更新しました");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  async function getPrepared() {
    if (!source || !target) throw new Error("セッションを選択してください");
    return (
      preview ||
      api.prepare(source, target, selected, note, {
        useCursor: range === "new",
        anchorId: anchor?.id || null,
      })
    );
  }
  async function showPreview() {
    setBusy(true);
    try {
      setPreview(await getPrepared());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    setBusy(true);
    try {
      const r = await getPrepared();
      await api.copyText(r.text);
      const updated = await api.deliver(r, "copied");
      setPreview(updated);
      adopt(await api.load());
      notify("コピーしました");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function send() {
    setBusy(true);
    let attempted: Relay | null = null;
    try {
      const r = await getPrepared();
      attempted = r;
      const updated = await api.deliver(r, "send");
      adopt(await api.load());
      setPreview(null);
      if (updated.status === "confirmed") {
        notify("送信しました");
        setNote("");
        setRange("new");
      } else {
        setPreview(updated);
        setError("送信を確認できません。送信先を確認してください。");
      }
    } catch (e) {
      setError((e as Error).message);
      if (attempted) {
        try {
          const latest = await api.historyDetail(attempted.id);
          setPreview(latest);
          adopt(await api.load());
        } catch {}
      }
    } finally {
      setBusy(false);
    }
  }
  async function confirm(r: Relay) {
    setBusy(true);
    try {
      const result = await api.deliver(r, "confirm");
      adopt(await api.load());
      setDetail(result);
      setPreview(null);
      notify("送信済みにしました");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!settings && !preview && !detail) return;
    const previous = document.activeElement as HTMLElement | null;
    const modal = document.querySelector<HTMLElement>(".modal");
    if (!modal) return;
    modal.querySelector<HTMLElement>("button,input,textarea")?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const list = Array.from(
        modal.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input,textarea,[tabindex="0"]',
        ),
      );
      const first = list[0],
        last = list.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", trap);
    return () => {
      document.removeEventListener("keydown", trap);
      previous?.focus();
    };
  }, [!!settings, !!preview, !!detail]);
  const nav = [
    ["relay", "Relay", ArrowDownUp],
    ["usage", "利用状況", Layers2],
    ["history", "履歴", History],
  ] as const;
  return (
    <MotionConfig
      transition={spring}
      reducedMotion={prefs.motion ? "user" : "always"}
    >
      <div
        className={`app ${new URLSearchParams(location.search).has("native") ? "native" : ""} ${compact ? "compact" : ""}`}
      >
        <div className="ambient" />
        <div className="shell glass">
          <aside className="sidebar">
            <a
              className="wordmark"
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setView("relay");
              }}
            >
              <span className="logo-mark">
                <ArrowDownUp size={21} />
              </span>
              Relay
            </a>
            <nav>
              {nav.map(([id, label, Icon]) => (
                <button
                  key={id}
                  className={`nav-item ${view === id ? "active" : ""}`}
                  onClick={() => {
                    setView(id);
                    setPicker(null);
                  }}
                >
                  {view === id && (
                    <motion.span
                      layoutId="navigation"
                      className="nav-highlight"
                    />
                  )}
                  <Icon size={18} />
                  <span>{label}</span>
                  {id === "history" && !!data?.history.length && (
                    <span className="nav-count">{data.history.length}</span>
                  )}
                </button>
              ))}
            </nav>
            <div className="sidebar-bottom">
              <span className="section-label">環境</span>
              {(
                data?.environments || [
                  { id: "local", label: "Mac", status: "offline" },
                ]
              ).map((env) => (
                <div className="environment" key={env.id}>
                  {env.id === "local" ? (
                    <Monitor size={15} />
                  ) : (
                    <Terminal size={15} />
                  )}
                  <span>{env.label}</span>
                  <span
                    className={`status-dot ${env.status}`}
                    title={env.error || env.status}
                  />
                </div>
              ))}
              <button
                className="add-environment"
                onClick={() => setSettings(true)}
              >
                <Plus size={14} />
                接続を追加
              </button>
              <div className="sidebar-divider" />
              <button
                className="settings-link"
                onClick={() => setSettings(true)}
              >
                <Settings2 size={17} />
                <span>設定</span>
                <span className="key-hint">⌘ ,</span>
              </button>
              <div className="version">
                v0.1.3{" "}
                <span>
                  <ShieldCheck size={11} /> Local
                </span>
              </div>
            </div>
          </aside>
          <main className="main">
            <header className="toolbar">
              <div className="breadcrumbs">
                <span className="mobile-logo">
                  <ArrowDownUp size={17} />
                </span>
                <span>Workspace</span>
                <ChevronRight size={12} />
                <strong>{nav.find((n) => n[0] === view)?.[1]}</strong>
              </div>
              <div className="toolbar-actions">
                {data?.mode === "demo" && (
                  <span className="demo-badge">デモ</span>
                )}
                <button
                  className="icon-button"
                  aria-label="更新"
                  onClick={doRefresh}
                  disabled={loading}
                >
                  <RefreshCw size={16} className={loading ? "spin" : ""} />
                </button>
                <button
                  className="icon-button expand-button"
                  aria-label={compact ? "通常表示" : "コンパクト表示"}
                  onClick={() => setCompact(!compact)}
                >
                  <Expand size={16} />
                </button>
                <button
                  className="icon-button mobile-settings"
                  aria-label="設定"
                  onClick={() => setSettings(true)}
                >
                  <Settings2 size={16} />
                </button>
              </div>
            </header>
            <div className="content">
              <div className="page-heading">
                <div>
                  <h1>{nav.find((n) => n[0] === view)?.[1]}</h1>
                  <p>
                    {view === "relay"
                      ? `${data?.environments.length || 0} 環境 · ${data?.sessions.length || 0} セッション`
                      : view === "usage"
                        ? "アカウントの利用枠"
                        : `${data?.history.length || 0} 件のリレー`}
                  </p>
                </div>
                <div className="heading-status">
                  <span className="status-dot connected" />
                  {data?.mode === "demo" ? "サンプルデータ" : "ローカル接続"}
                </div>
              </div>
              <AnimatePresence>
                {error && (
                  <motion.div
                    className="error-banner"
                    role="alert"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                  >
                    <AlertCircle size={16} />
                    <span>{error}</span>
                    <button
                      className="icon-button"
                      aria-label="エラーを閉じる"
                      onClick={() => setError("")}
                    >
                      <X size={14} />
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
              <AnimatePresence mode="wait">
                <motion.div
                  key={view}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.18 }}
                >
                  {view === "relay" && (
                    <>
                      <div className="usage-grid">
                        {(["claude", "codex"] as Provider[]).map((p) => (
                          <UsageCard
                            key={p}
                            provider={p}
                            usage={
                              data?.usage.find(
                                (u) =>
                                  u.provider === p &&
                                  u.host ===
                                    (source?.provider === p
                                      ? source.host
                                      : target?.provider === p
                                        ? target.host
                                        : "local"),
                              ) || data?.usage.find((u) => u.provider === p)
                            }
                          />
                        ))}
                      </div>
                      <div className="route-section">
                        <div className="route-cards">
                          <SessionCard
                            session={source}
                            label="送信元"
                            open={picker === "source"}
                            onClick={() =>
                              setPicker(picker === "source" ? null : "source")
                            }
                          />
                          <motion.button
                            whileHover={{ rotate: 180 }}
                            whileTap={{ scale: 0.9 }}
                            className="swap-button glass"
                            aria-label="送信元と送信先を入れ替える"
                            disabled={!source || !target}
                            onClick={() => {
                              setSourceId(targetId);
                              setTargetId(sourceId);
                              setRange("new");
                              setPicker(null);
                            }}
                          >
                            <ArrowDownUp size={17} />
                          </motion.button>
                          <SessionCard
                            session={target}
                            label="送信先"
                            open={picker === "target"}
                            onClick={() =>
                              setPicker(picker === "target" ? null : "target")
                            }
                          />
                        </div>
                        <AnimatePresence>
                          {picker && data && (
                            <Picker
                              key={picker}
                              sessions={data.sessions}
                              exclude={
                                picker === "source" ? targetId : sourceId
                              }
                              onClose={() => setPicker(null)}
                              onSelect={(s) => {
                                picker === "source"
                                  ? setSourceId(s.id)
                                  : setTargetId(s.id);
                                setRange("new");
                                setStart("");
                                setPicker(null);
                              }}
                            />
                          )}
                        </AnimatePresence>
                      </div>
                      <section className="conversation glass">
                        <div className="conversation-toolbar">
                          <div className="conversation-title">
                            <Link2 size={16} />
                            <strong>会話</strong>
                            <span className="count-badge">
                              {selected.length}
                            </span>
                          </div>
                          <button
                            className="text-button"
                            onClick={() =>
                              setRange(range === "custom" ? "new" : "custom")
                            }
                          >
                            <SlidersHorizontal size={13} />
                            範囲を選択
                          </button>
                        </div>
                        <div className="range-bar">
                          <div className="segmented range-segments">
                            {[
                              ["new", "前回以降"],
                              ["all", "すべて"],
                            ].map(([id, label]) => (
                              <button
                                key={id}
                                className={range === id ? "selected" : ""}
                                onClick={() => setRange(id as "new" | "all")}
                              >
                                {range === id && (
                                  <motion.span
                                    layoutId="range"
                                    className="segment-bg"
                                  />
                                )}
                                <span>{label}</span>
                              </button>
                            ))}
                          </div>
                          <span className="range-info">
                            {range === "custom"
                              ? "開始する発言を選択"
                              : `${selected.length} / ${all.length} 件`}
                          </span>
                        </div>
                        {lost ? (
                          <div className="empty">
                            <AlertCircle size={26} />
                            <strong>前回の位置が見つかりません</strong>
                            <button
                              className="secondary-button"
                              onClick={() => setRange("all")}
                            >
                              範囲を選び直す
                            </button>
                          </div>
                        ) : sessionLoading ? (
                          <div className="empty">
                            <LoaderCircle size={24} className="spin" />
                            <span>会話を読み込み中</span>
                          </div>
                        ) : !all.length ? (
                          <div className="empty">
                            <Link2 size={27} />
                            <strong>
                              {source
                                ? "会話はまだありません"
                                : "セッションを選択してください"}
                            </strong>
                          </div>
                        ) : selected.length === 0 && range !== "custom" ? (
                          <div className="empty">
                            <Check size={27} />
                            <strong>すべて引き継ぎ済みです</strong>
                            <button
                              className="text-button"
                              onClick={() => setRange("all")}
                            >
                              すべて表示
                            </button>
                          </div>
                        ) : (
                          <div className="messages">
                            {(range === "custom" ? all : selected).map(
                              (message, index) => {
                                const included =
                                  all.indexOf(message) >= startIndex;
                                return (
                                  <motion.div
                                    layout
                                    key={message.id}
                                    initial={{ opacity: 0, y: 6 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{
                                      ...spring,
                                      delay: Math.min(index, 4) * 0.025,
                                    }}
                                    className={`message ${!included ? "excluded" : ""}`}
                                  >
                                    <div className="message-avatar">
                                      {message.role === "assistant" &&
                                      source ? (
                                        <Brand
                                          provider={source.provider}
                                          size={24}
                                        />
                                      ) : (
                                        <span className="user-avatar">Y</span>
                                      )}
                                    </div>
                                    <div className="message-content">
                                      <div className="message-heading">
                                        <strong>
                                          {message.role === "user"
                                            ? "あなた"
                                            : source
                                              ? providerName(source.provider)
                                              : "AI"}
                                        </strong>
                                        <span>{time(message.timestamp)}</span>
                                        {range === "custom" && (
                                          <button
                                            className={`range-check ${message.id === start ? "checked" : ""}`}
                                            aria-label={`${index + 1}件目から引き継ぐ`}
                                            aria-pressed={message.id === start}
                                            onClick={() => setStart(message.id)}
                                          >
                                            {message.id === start ? (
                                              <Check size={12} />
                                            ) : (
                                              <ArrowDown size={11} />
                                            )}
                                          </button>
                                        )}
                                      </div>
                                      <p>{message.text}</p>
                                    </div>
                                  </motion.div>
                                );
                              },
                            )}
                          </div>
                        )}
                        <div className="compose">
                          <label htmlFor="relay-note">
                            補足指示<span>任意</span>
                          </label>
                          <textarea
                            id="relay-note"
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            placeholder="レビューしてほしい点を入力"
                            rows={2}
                            maxLength={10000}
                          />
                        </div>
                        <div className="send-bar">
                          <span className="send-meta">
                            <ShieldCheck size={13} />
                            原文のまま引き継ぐ
                          </span>
                          <div className="send-actions">
                            <button
                              className="icon-button"
                              aria-label="送信内容を確認"
                              disabled={!canSend || busy}
                              onClick={showPreview}
                            >
                              <Expand size={16} />
                            </button>
                            <button
                              className="secondary-button copy-button"
                              disabled={!canSend || busy}
                              onClick={copy}
                            >
                              <Copy size={14} />
                              <span>コピー</span>
                            </button>
                            <motion.button
                              whileTap={{ scale: 0.96 }}
                              className="primary-button"
                              disabled={!canSend || busy}
                              onClick={
                                target?.transport === "copy" ? copy : send
                              }
                            >
                              {busy ? (
                                <LoaderCircle size={15} className="spin" />
                              ) : (
                                <ArrowUpRight size={16} />
                              )}
                              <span>
                                {target?.transport === "copy"
                                  ? "送信先で貼り付け"
                                  : `${target ? providerName(target.provider) : "AI"}へ送る`}
                              </span>
                            </motion.button>
                          </div>
                        </div>
                      </section>
                      <footer className="page-footer">
                        <span>
                          <span className="status-dot connected" />
                          本人の操作で送信
                        </span>
                        <span>
                          {target?.transport === "demo"
                            ? "デモ内で送信を再現"
                            : target?.transport === "copy"
                              ? "コピーで引き継ぎ"
                              : "選択したセッションへ送信"}
                        </span>
                      </footer>
                    </>
                  )}
                  {view === "usage" && (
                    <>
                      <div className="usage-grid usage-page">
                        {data?.usage.length
                          ? data.usage.map((u, i) => (
                              <UsageCard
                                key={`${u.host}-${u.provider}-${i}`}
                                provider={u.provider}
                                usage={u}
                                expanded
                              />
                            ))
                          : (["claude", "codex"] as Provider[]).map((p) => (
                              <UsageCard key={p} provider={p} expanded />
                            ))}
                      </div>
                      <div className="info-row glass">
                        <Clock3 size={18} />
                        <span>
                          利用枠は観測時点の値です。コンテキスト使用量とは別に表示します。
                        </span>
                      </div>
                    </>
                  )}
                  {view === "history" && (
                    <section className="history-list glass">
                      {data?.history.length ? (
                        data.history.map((r) => (
                          <button
                            key={r.id}
                            className="history-item"
                            onClick={async () => {
                              try {
                                setDetail(await api.historyDetail(r.id));
                              } catch (e) {
                                setError((e as Error).message);
                              }
                            }}
                          >
                            <span className={`history-icon ${r.status}`}>
                              <ArrowUpRight size={18} />
                            </span>
                            <div className="history-item-main">
                              <strong>
                                {r.sourceTitle}
                                <ArrowRight size={12} />
                                {r.targetTitle}
                              </strong>
                              <span>
                                {time(r.createdAt)} · {r.count} 件
                                {r.note ? ` · ${r.note}` : ""}
                              </span>
                            </div>
                            <span className={`status-pill ${r.status}`}>
                              {
                                {
                                  confirmed: "送信済み",
                                  copied: "コピー済み",
                                  prepared: "下書き",
                                  unknown: "未確認",
                                  failed: "失敗",
                                }[r.status]
                              }
                            </span>
                            <ChevronRight size={15} />
                          </button>
                        ))
                      ) : (
                        <div className="empty history-empty">
                          <History size={30} />
                          <strong>履歴はまだありません</strong>
                          <button
                            className="secondary-button"
                            onClick={() => setView("relay")}
                          >
                            Relayを開く
                          </button>
                        </div>
                      )}
                    </section>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
            <div className="mobile-nav">
              {nav.map(([id, label, Icon]) => (
                <button
                  key={id}
                  className={view === id ? "active" : ""}
                  onClick={() => setView(id)}
                >
                  <Icon size={17} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </main>
        </div>
        <AnimatePresence>
          {toast && (
            <motion.div
              role="status"
              className="toast glass"
              initial={{ opacity: 0, y: 20, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10 }}
            >
              <span className="toast-check">
                <Check size={13} />
              </span>
              {toast}
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {(preview || detail) && (
            <motion.div
              className="modal-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, pointerEvents: "none" }}
              onClick={() => {
                setPreview(null);
                setDetail(null);
              }}
            >
              <motion.section
                className="modal preview-modal glass"
                role="dialog"
                aria-modal="true"
                aria-label="送信内容"
                initial={{ opacity: 0, y: 16, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 12, scale: 0.98 }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="modal-header">
                  <h2>送信内容</h2>
                  <button
                    className="icon-button"
                    aria-label="送信内容を閉じる"
                    onClick={() => {
                      setPreview(null);
                      setDetail(null);
                    }}
                  >
                    <X size={18} />
                  </button>
                </div>
                <div className="preview-meta">
                  {(preview || detail)!.count} 件 ·{" "}
                  {(preview || detail)!.sourceTitle}
                  <ArrowRight size={13} />
                  {(preview || detail)!.targetTitle}
                </div>
                <pre className="raw-preview">{(preview || detail)!.text}</pre>
                <div className="modal-footer">
                  <span className="muted">
                    {
                      {
                        prepared: "未送信",
                        copied: "コピー済み・送信未確認",
                        confirmed: "送信済み",
                        failed: "失敗",
                        unknown: "送信未確認",
                      }[(preview || detail)!.status]
                    }
                  </span>
                  {["copied", "unknown"].includes(
                    (preview || detail)!.status,
                  ) && (
                    <button
                      className="secondary-button"
                      disabled={busy}
                      onClick={() => confirm((preview || detail)!)}
                    >
                      <Check size={14} />
                      {(preview || detail)!.status === "unknown"
                        ? "送信先で確認済み"
                        : "貼り付けて送信済み"}
                    </button>
                  )}
                </div>
              </motion.section>
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {settings && (
            <motion.div
              className="modal-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, pointerEvents: "none" }}
              onClick={() => setSettings(false)}
            >
              <motion.section
                className="modal settings-modal glass"
                role="dialog"
                aria-modal="true"
                aria-label="設定"
                initial={{ opacity: 0, y: 16, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 12, scale: 0.98 }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="modal-header">
                  <h2>設定</h2>
                  <button
                    className="icon-button"
                    aria-label="設定を閉じる"
                    onClick={() => setSettings(false)}
                  >
                    <X size={18} />
                  </button>
                </div>
                <div className="settings-body">
                  <span className="section-label">表示</span>
                  <div className="setting-row">
                    <div>
                      <strong>アニメーション</strong>
                      <span>システムの「視差効果を減らす」に対応</span>
                    </div>
                    <button
                      role="switch"
                      aria-label="アニメーション"
                      aria-checked={prefs.motion}
                      className={`switch ${prefs.motion ? "on" : ""}`}
                      onClick={() =>
                        setPrefs({ ...prefs, motion: !prefs.motion })
                      }
                    >
                      <motion.span layout transition={spring} />
                    </button>
                  </div>
                  <div className="setting-row">
                    <div>
                      <strong>透明度を下げる</strong>
                      <span>背景を不透明にする</span>
                    </div>
                    <button
                      role="switch"
                      aria-label="透明度を下げる"
                      aria-checked={prefs.solid}
                      className={`switch ${prefs.solid ? "on" : ""}`}
                      onClick={() =>
                        setPrefs({ ...prefs, solid: !prefs.solid })
                      }
                    >
                      <motion.span layout transition={spring} />
                    </button>
                  </div>
                  <span className="section-label connection-label">接続</span>
                  {data?.environments.map((env) => (
                    <div className="connection-row" key={env.id}>
                      <span className="device-icon">
                        {env.id === "local" ? (
                          <Monitor size={19} />
                        ) : (
                          <Terminal size={19} />
                        )}
                      </span>
                      <div>
                        <strong>{env.label}</strong>
                        <span>{env.id === "local" ? "ローカル" : env.id}</span>
                      </div>
                      <span
                        className={`status-pill ${env.status === "connected" ? "confirmed" : "failed"}`}
                      >
                        {env.status === "connected" ? "接続済み" : "未接続"}
                      </span>
                    </div>
                  ))}
                  <form
                    className="ssh-form"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      setBusy(true);
                      try {
                        await api.connect(alias);
                        adopt(await api.load());
                        setAlias("");
                        notify("接続しました");
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    <label htmlFor="ssh-alias">SSHホスト名</label>
                    <div>
                      <input
                        id="ssh-alias"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        value={alias}
                        onChange={(e) => setAlias(e.target.value)}
                        placeholder="~/.ssh/config の Host"
                        pattern="[A-Za-z0-9][A-Za-z0-9._-]{0,63}"
                        required
                      />
                      <button
                        className="secondary-button"
                        disabled={busy || data?.mode === "demo"}
                        type="submit"
                      >
                        接続
                      </button>
                    </div>
                  </form>
                </div>
                <div className="modal-footer">
                  <span className="muted">Relay v0.1.3</span>
                  <span className="local-label">
                    <ShieldCheck size={13} />
                    ローカル保存
                  </span>
                </div>
              </motion.section>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
}
