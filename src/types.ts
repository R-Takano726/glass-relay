export type Provider = "claude" | "codex";
export type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp: string;
  hash: string;
};
export type Session = {
  id: string;
  host: string;
  provider: Provider;
  title: string;
  cwd: string;
  updatedAt: string;
  model: string;
  contextPercent: number | null;
  messageCount: number;
  transport: "demo" | "copy" | "codex-proxy";
  messages?: Message[];
};
export type UsageWindow = {
  label: string;
  remaining: number;
  resetsAt: string;
};
export type Usage = {
  provider: Provider;
  host: string;
  windows: UsageWindow[];
  observedAt: string | null;
  source: string;
  error?: string;
};
export type Environment = {
  id: string;
  label: string;
  status: "connected" | "offline";
  error?: string;
};
export type Relay = {
  contentKey?: string;
  id: string;
  source: string;
  target: string;
  sourceTitle: string;
  targetTitle: string;
  provider: Provider;
  count: number;
  note: string;
  text: string;
  status: "prepared" | "copied" | "confirmed" | "unknown" | "failed" | "sending";
  createdAt: string;
  endId: string;
  endHash: string;
};
export type Data = {
  revision?: number;
  selectionRequest?: {
    id: string;
    host: string;
    provider: Provider | null;
    sessionId: string | null;
    cwd: string;
    note: string;
  } | null;
  mode: "demo" | "live";
  sessions: Session[];
  environments: Environment[];
  usage: Usage[];
  history: Relay[];
};
export const providerName = (p: Provider) =>
  p === "claude" ? "Claude" : "Codex";
