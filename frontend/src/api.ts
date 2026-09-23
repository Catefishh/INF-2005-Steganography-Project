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
  chi_square_details: ChiSquareDetails;
  histograms: number[][];
  lsb_composite: string | null;
  compare: AnalysisComparison | null;
  bpcs: BpcsResult;
  durations_ms: AnalysisDurations;
}

export interface ChiSquareMeasurement {
  sample_count: number;
  valid_category_count: number;
  degrees_of_freedom: number | null;
  statistic: number | null;
  p_value: number | null;
  interpretable: boolean;
  reason: string | null;
}

export interface ChiSquareSegment extends ChiSquareMeasurement {
  index: number;
  start: number;
  end: number;
}

export interface ChiSquareDetails {
  method: "westfeld-pfitzmann-pairs-of-values";
  pair_count: number;
  minimum_expected_count: number;
  segment_count: number;
  presentation_heuristic: number;
  descriptive_only: true;
  explanation: { high_p_value: string; limitations: string[] };
  overall: ChiSquareMeasurement;
  segments: ChiSquareSegment[];
}

export interface BpcsConfig {
  channel: number;
  block_size: number;
  bit_plane_start: number;
  bit_plane_end: number;
  complexity_threshold: number;
  partial_block_policy: "include-valid-adjacencies";
}

export interface BpcsMetrics {
  block_count: number;
  complex_blocks: number;
  non_complex_blocks: number;
  complex_percent: number;
  transition_count: number;
  possible_transition_count: number;
  transition_ratio: number;
  mean_complexity: number;
  minimum_complexity: number;
  maximum_complexity: number;
  capacity_bits: number;
  capacity_bytes_floor: number;
  capacity_remainder_bits: number;
}

export interface BpcsPlane extends BpcsMetrics {
  bit_plane: number;
  block_rows: number;
  block_columns: number;
  complexity_map: string;
  classification_map: string;
  map_rows: number;
  map_columns: number;
  map_block_stride: number;
}

export interface BpcsSummary extends BpcsMetrics { selected_plane_count: number }
export interface BpcsComparisonMetrics {
  changed_blocks: number;
  classification_flips: number;
  flips_to_complex: number;
  flips_to_non_complex: number;
  mean_complexity_delta: number;
  mean_absolute_complexity_delta: number;
  capacity_bits_delta: number;
  capacity_bytes_floor_delta: number;
}
export interface BpcsComparisonPlane extends BpcsComparisonMetrics { bit_plane: number }
export interface BpcsComparison { summary: BpcsComparisonMetrics; planes: BpcsComparisonPlane[] }
export type BpcsResult =
  | { supported: true; reason: null; config: BpcsConfig; image: { width: number; height: number }; planes: BpcsPlane[]; summary: BpcsSummary; comparison: BpcsComparison | null }
  | { supported: false; reason: string; config: BpcsConfig; image: null; planes: []; summary: null; comparison: null };

export interface AnalysisDurations {
  load: number; bit_planes: number; histogram: number; chi_square: number; bpcs: number; difference: number; total: number;
}
export interface AnalysisComparison {
  slots_changed: number; bits_changed: number; max_difference: number; psnr_db: number | null; mse: number; changed_map: string; amplified: string | null;
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
