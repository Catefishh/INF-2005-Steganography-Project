/** Image transformation job lifecycle and its result shape. */
import { pollJob, type Job } from "./jobs";

export type Stored = { id: string; filename: string; size: number };
export type Row = { operation: string; value: number; verdict: string; file: Stored; preview: string | null;
  original_dimensions: [number, number]; result_dimensions: [number, number];
  metrics: { mse: number; psnr_db: number | null; ssim: number | null; basis: string;
    retained_area_percent: number | null } };
export type Result = { baseline_verdict: string; scenarios: Row[]; note: string };

export async function runRobustness(form: FormData, update: (phase: string) => void): Promise<Result | null> {
  const session = await fetch("/api/v2/session", { method: "POST" });
  if (!session.ok) throw new Error("Could not start a session");
  const response = await fetch("/api/v3/jobs/robustness", { method: "POST", body: form });
  if (!response.ok) {
    const body = await response.json() as { detail?: string };
    throw new Error(body.detail || "Could not start attacks");
  }
  const started = await response.json() as Job<Result>;
  return pollJob(started.id, { attempts: 1200, onUpdate: (phase) => update(phase),
    failed: (state) => state.status, cancelled: (state) => state.status });
}
