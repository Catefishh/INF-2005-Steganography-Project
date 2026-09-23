/** Legacy HTTP calls; V2/V3 request helpers live in api/. */
export type { VerdictName, Location, CoverInfo, StoredFile, SignedRecord, LectureRow,
  HideStep, HideReport, HideResponse, VerifyStep, VerifyResponse, Analysis, Scenario,
  KeyInfo, BpcsConfig, BpcsMetrics, BpcsResult, ChiSquareDetails, ChiSquareSegment } from "./api/types";
import type { CoverInfo, HideResponse, VerifyResponse, Analysis, Scenario, KeyInfo, StoredFile } from "./api/types";

export class ApiError extends Error {}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new ApiError("Cannot reach Stegloc. Restart the desktop app, or check that the server is running if using a browser.");
  }
  if (!response.ok) {
    let text = `Request failed (${response.status}).`;
    try {
      const body: unknown = await response.json();
      if (body && typeof body === "object" && "detail" in body) {
        const detail = (body as { detail: unknown }).detail;
        text = typeof detail === "string" ? detail : "Some inputs are missing or invalid.";
      }
    } catch {
      // keep the generic message
    }
    throw new ApiError(text);
  }
  return (await response.json()) as T;
}

function postForm<T>(path: string, form: FormData): Promise<T> {
  return call<T>(path, { method: "POST", body: form });
}

function postJson<T>(path: string, body: unknown): Promise<T> {
  return call<T>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

export function fileUrl(id: string, download = false): string {
  return `/api/files/${encodeURIComponent(id)}${download ? "?download=1" : ""}`;
}

export async function fetchAsFile(stored: StoredFile): Promise<File> {
  const response = await fetch(fileUrl(stored.id));
  if (!response.ok) throw new ApiError("The generated file has expired. Run the operation again.");
  return new File([await response.blob()], stored.filename, { type: stored.media_type });
}

export const api = {
  inspect(file: File) {
    const form = new FormData();
    form.append("file", file, file.name);
    return postForm<CoverInfo>("/api/inspect", form);
  },
  estimate(body: {
    cover_kind: string;
    descriptor: string;
    cover_filename: string;
    payload_filename: string;
    payload_type: string;
    payload_size: number;
    team: string;
    key_bits: number;
  }) {
    return postJson<{ package_bytes: number }>("/api/estimate", body);
  },
  hide: (form: FormData) => postForm<HideResponse>("/api/hide", form),
  verify: (form: FormData) => postForm<VerifyResponse>("/api/verify", form),
  analyse: (form: FormData) => postForm<Analysis>("/api/analyse", form),
  attacks: (form: FormData) => postForm<{ scenarios: Scenario[] }>("/api/attacks", form),
  generateKeys: () =>
    call<{ private_key: string; public_key: string; fingerprint: string; bits: number }>("/api/keys/generate", {
      method: "POST",
    }),
  inspectKey: (pem: string, password?: string) => postJson<KeyInfo>("/api/keys/inspect", { pem, password: password || null }),
};
