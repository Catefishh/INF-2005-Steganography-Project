/** Session jobs used by text and robustness workflows. */
export type Job<T> = {
  id: string;
  status: string;
  phase: string;
  result: T | null;
  error: { message: string } | null;
};

export async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { detail?: string };
    throw new Error(body.detail || `Request failed (${response.status})`);
  }
  return await response.json() as T;
}

export function artifactUrl(id: string): string {
  return `/api/v2/artifacts/${encodeURIComponent(id)}`;
}

export async function pollJob<T>(id: string, options: {
  attempts: number;
  onUpdate: (phase: string, id: string) => void;
  failed: string | ((state: Job<T>) => string);
  cancelled: string | ((state: Job<T>) => string);
  timeout?: string;
}): Promise<T | null> {
  for (let attempt = 0; attempt < options.attempts; attempt++) {
    const state = await requestJson<Job<T>>(`/api/v2/jobs/${encodeURIComponent(id)}`);
    options.onUpdate(state.phase, state.id);
    if (state.status === "succeeded" && state.result) return state.result;
    if (state.status === "failed") {
      const fallback = typeof options.failed === "string" ? options.failed : options.failed(state);
      throw new Error(state.error?.message || fallback);
    }
    if (state.status === "cancelled") {
      const fallback = typeof options.cancelled === "string" ? options.cancelled : options.cancelled(state);
      throw new Error(typeof options.cancelled === "string" ? fallback : state.error?.message || fallback);
    }
    await new Promise((resolve) => window.setTimeout(resolve, 250));
  }
  if (options.timeout) throw new Error(options.timeout);
  return null;
}

export async function runTextJob<T>(path: string, form: FormData,
  update: (phase: string) => void): Promise<T> {
  const started = await requestJson<Job<T>>(path, { method: "POST", body: form });
  return (await pollJob(started.id, { attempts: 1200, onUpdate: update,
    failed: (state) => state.status, cancelled: (state) => state.status,
    timeout: "Text operation timed out" }))!;
}
