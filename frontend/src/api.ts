// Typed calls to the FastAPI backend (backend/app/main.py).

export type VerdictName =
  | "Authentic"
  | "Tampered"
  | "Signature Invalid"
  | "Payload Missing"
  | "Wrong Start Location"
  | "Cannot Verify";

export interface Location {
  slot: number;
  text: string;
  x?: number;
  y?: number;
  channel?: string | number;
  frame?: number;
  seconds?: number;
}

export interface CoverInfo {
  kind: "image" | "audio";
  format: string;
  output_format: string;
  descriptor: string;
  n_slots: number;
  lossy_source: boolean;
  width?: number;
  height?: number;
  mode?: string;
  channels?: number;
  sample_rate?: number;
  bits?: number;
  frames?: number;
  duration?: number;
  file_size?: number;
  filename?: string;
  header?: Location;
  capacity?: { n_lsb: number; max_package_bytes: number }[];
}

export interface StoredFile {
  id: string;
  filename: string;
  media_type: string;
  size: number;
  text?: string;
  text_truncated?: boolean;
}

export interface SignedRecord {
  protocol: string;
  media_id: string;
  timestamp: string;
  nonce: string;
  team: string;
  signer_fingerprint: string;
  cover: { type: string; descriptor: string; filename: string; sha256: string };
  payload: { filename: string; media_type: string; size: number; sha256: string };
  embedding: { method: string; lsb_bits: number; start_slot: string; header_slot: string };
  algorithms: Record<string, string>;
}

export interface LectureRow {
  slot: number;
  location: string;
  before: number;
  after: number;
  before_bin: string;
  after_bin: string;
  payload_bits: string;
}

export interface HideStep {
  title: string;
  detail?: string;
  value?: string;
}

export interface HideReport {
  cover: CoverInfo;
  stego_size: number;
  size_unchanged: boolean;
  n_lsb: number;
  start_mode: "auto" | "manual";
  start: Location;
  header: Location;
  span_slots: number;
  package_bytes: number;
  capacity_bytes: number;
  capacity_used_percent: number;
  bits_changed: number;
  slots_changed: number;
  psnr_db: number | null;
  mse: number;
  record: SignedRecord;
  record_sha256: string;
  signature_hex: string;
  signer_fingerprint: string;
  salt_hex: string;
  lecture_rows: LectureRow[];
  steps: HideStep[];
}

export interface HideResponse {
  stego: StoredFile;
  report: HideReport;
}

export interface VerifyStep {
  id: string;
  title: string;
  status: "passed" | "failed" | "skipped";
  detail: string;
}

export interface VerifyResponse {
  verdict: VerdictName;
  summary: string;
  steps: VerifyStep[];
  info: { cover?: CoverInfo; header?: Location; start?: Location; n_lsb?: number; package_bytes?: number; span_slots?: number };
  record: SignedRecord | null;
  record_trusted: boolean;
  content: StoredFile | null;
}

export interface Analysis {
  info: CoverInfo;
  channel: number;
  channel_names: string[];
  stride: number;
  bit_planes: string[];
  chi_square: (number | null)[];
  chi_square_overall: number | null;
  histograms: number[][];
  lsb_composite: string | null;
  compare: {
    slots_changed: number;
    bits_changed: number;
    max_difference: number;
    psnr_db: number | null;
    mse: number;
    changed_map: string;
    amplified: string | null;
  } | null;
}

export interface Scenario {
  id: string;
  title: string;
  change: string;
  expected: VerdictName[];
  verdict: VerdictName;
  summary: string;
  as_expected: boolean;
  file: StoredFile | null;
}

export interface KeyInfo {
  type: "private" | "public";
  encrypted: boolean;
  bits: number | null;
  fingerprint: string | null;
}

export class ApiError extends Error {}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new ApiError("Cannot reach the Stegloc server. Is the backend running on port 8000?");
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
