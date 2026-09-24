import { afterEach, expect, it, vi } from "vitest";
import { pollJob, runTextJob, type Job } from "./jobs";

afterEach(() => vi.restoreAllMocks());

function response<T>(value: Job<T>) {
  return { ok: true, json: async () => value } as Response;
}

it("reports a text job's phase and returns its result", async () => {
  const fetch = vi.spyOn(globalThis, "fetch");
  fetch.mockResolvedValueOnce(response({ id: "a/b", status: "queued", phase: "queued", result: null, error: null }));
  fetch.mockResolvedValueOnce(response({ id: "a/b", status: "succeeded", phase: "complete", result: { file: "ready" }, error: null }));
  const phases: string[] = [];
  const result = await runTextJob<{ file: string }>("/api/v3/jobs/text/protect", new FormData(),
    (phase) => phases.push(phase));
  expect(result.file).toBe("ready");
  expect(phases).toEqual(["complete"]);
  expect(fetch.mock.calls[1][0]).toBe("/api/v2/jobs/a%2Fb");
});

it("reports cancellation and text job failure reasons", async () => {
  const fetch = vi.spyOn(globalThis, "fetch");
  fetch.mockResolvedValueOnce(response({ id: "cancel", status: "cancelled", phase: "cancelled", result: null,
    error: { message: "internal detail" } }));
  await expect(pollJob("cancel", { attempts: 1, onUpdate: () => undefined,
    failed: "Processing failed", cancelled: "Processing was cancelled" }))
    .rejects.toThrow("Processing was cancelled");

  fetch.mockResolvedValueOnce(response({ id: "text", status: "queued", phase: "queued", result: null, error: null }));
  fetch.mockResolvedValueOnce(response({ id: "text", status: "failed", phase: "failed", result: null,
    error: { message: "invalid recovery" } }));
  await expect(runTextJob("/api/v3/jobs/text/verify", new FormData(), () => undefined))
    .rejects.toThrow("invalid recovery");
});

it("stops polling at the configured limit", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(response({ id: "pending", status: "running",
    phase: "running", result: null, error: null }));
  vi.spyOn(window, "setTimeout").mockImplementation((callback) => {
    (callback as () => void)();
    return 0;
  });
  await expect(pollJob("pending", { attempts: 1, onUpdate: () => undefined,
    failed: "failed", cancelled: "cancelled", timeout: "Text operation timed out" }))
    .rejects.toThrow("Text operation timed out");
});
