import type { EvidencePoint } from "./evidenceChart";

declare global {
  interface Window {
    pywebview?: { api: { open_graph(id: string, title: string): Promise<boolean>;
      close_graph(id: string): Promise<boolean> } };
  }
}

export type GraphSnapshot =
  | { kind: "histogram"; title: string; series: number[][]; colors: string[];
      min: string; max: string; axis: string; notes: string[] }
  | { kind: "chi-square"; title: string; points: EvidencePoint[];
      threshold: number; notes: string[] }
  | { kind: "bar"; title: string; points: EvidencePoint[];
      unit: string; max?: number; notes: string[] };

type GraphMessage =
  | { type: "request"; id: string; requestId: string }
  | { type: "response"; id: string; requestId: string; snapshot: GraphSnapshot }
  | { type: "update"; id: string; snapshot: GraphSnapshot }
  | { type: "removed"; id: string }
  | { type: "closed"; id: string };

const CHANNEL = "stegloc-graph-windows";
const graphs = new Map<string, GraphSnapshot>();
let sourceChannel: BroadcastChannel | null = null;

function source() {
  if (!sourceChannel) {
    sourceChannel = new BroadcastChannel(CHANNEL);
    sourceChannel.onmessage = (event: MessageEvent<GraphMessage>) => {
      const message = event.data;
      if (message?.type === "closed") {
        if (graphs.delete(message.id)) {
          window.dispatchEvent(new CustomEvent("stegloc-graph-closed", { detail: message.id }));
          if (graphs.size === 0) { sourceChannel?.close(); sourceChannel = null; }
        }
        return;
      }
      if (message?.type !== "request") return;
      const snapshot = graphs.get(message.id);
      if (snapshot) sourceChannel?.postMessage({ type: "response", id: message.id,
        requestId: message.requestId, snapshot } satisfies GraphMessage);
    };
  }
  return sourceChannel;
}

export function registerGraph(snapshot: GraphSnapshot): string {
  const id = crypto.randomUUID();
  source();
  graphs.set(id, snapshot);
  return id;
}

export function updateGraph(id: string, snapshot: GraphSnapshot) {
  if (!graphs.has(id)) return;
  graphs.set(id, snapshot);
  source().postMessage({ type: "update", id, snapshot } satisfies GraphMessage);
}

export function unregisterGraph(id: string) {
  if (!graphs.delete(id)) return;
  source().postMessage({ type: "removed", id } satisfies GraphMessage);
  if (graphs.size === 0) { sourceChannel?.close(); sourceChannel = null; }
}

/** A child window signals that its source no longer needs to hold its measurements. */
export function closeGraphWindow(id: string) {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(CHANNEL);
  channel.postMessage({ type: "closed", id } satisfies GraphMessage);
  channel.close();
}

export function requestGraph(id: string, timeoutMs = 1500): Promise<GraphSnapshot | null> {
  if (typeof BroadcastChannel === "undefined") return Promise.resolve(null);
  const channel = new BroadcastChannel(CHANNEL);
  const requestId = crypto.randomUUID();
  return new Promise((resolve) => {
    const done = (snapshot: GraphSnapshot | null) => { clearTimeout(timer); channel.close(); resolve(snapshot); };
    const timer = setTimeout(() => done(null), timeoutMs);
    channel.onmessage = (event: MessageEvent<GraphMessage>) => {
      const message = event.data;
      if (message?.type === "response" && message.id === id && message.requestId === requestId) done(message.snapshot);
    };
    channel.postMessage({ type: "request", id, requestId } satisfies GraphMessage);
  });
}

export function watchGraph(id: string, onChange: (snapshot: GraphSnapshot | null) => void): () => void {
  if (typeof BroadcastChannel === "undefined") return () => undefined;
  const channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = (event: MessageEvent<GraphMessage>) => {
    const message = event.data;
    if (message?.id !== id) return;
    if (message.type === "update") onChange(message.snapshot);
    if (message.type === "removed") onChange(null);
  };
  return () => channel.close();
}
