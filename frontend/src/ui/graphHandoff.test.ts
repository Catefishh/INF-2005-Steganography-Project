import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { closeGraphWindow, registerGraph, requestGraph, unregisterGraph, updateGraph, type GraphSnapshot } from "./graphHandoff";

const histogram: GraphSnapshot = {
  kind: "histogram", title: "Inspected value histogram", series: [[1, 2, 3]],
  colors: ["#006194"], min: "0", max: "255", axis: "Channel value",
  notes: ["Descriptive distribution only."],
};

class TestChannel {
  static peers = new Set<TestChannel>();
  onmessage: ((event: MessageEvent) => void) | null = null;
  constructor(public name: string) { TestChannel.peers.add(this); }
  postMessage(data: unknown) {
    for (const peer of TestChannel.peers) if (peer !== this && peer.name === this.name) {
      queueMicrotask(() => peer.onmessage?.({ data } as MessageEvent));
    }
  }
  close() { TestChannel.peers.delete(this); }
}

beforeEach(() => vi.stubGlobal("BroadcastChannel", TestChannel));
afterEach(() => { vi.unstubAllGlobals(); TestChannel.peers.clear(); });

it("answers only for live graph IDs and keeps null chi-square values", async () => {
  const id = registerGraph(histogram);
  expect(id).toMatch(/^[a-f0-9-]{36}$/i);
  expect(await requestGraph(id, 50)).toEqual(histogram);
  expect(await requestGraph(crypto.randomUUID(), 5)).toBeNull();

  const chi: GraphSnapshot = { kind: "chi-square", title: "Chi-square p-values", threshold: 0.95,
    points: [{ label: "Section 1", value: 0.8 }, { label: "Section 2", value: null }],
    notes: ["Not proof of embedding."] };
  updateGraph(id, chi);
  expect(await requestGraph(id, 50)).toEqual(chi);
  unregisterGraph(id);
  expect(await requestGraph(id, 5)).toBeNull();
});

it("releases a graph when its separate window closes", async () => {
  const id = registerGraph(histogram);
  const closed = vi.fn();
  window.addEventListener("stegloc-graph-closed", closed, { once: true });
  closeGraphWindow(id);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(closed).toHaveBeenCalledOnce();
  expect(await requestGraph(id, 5)).toBeNull();
});
