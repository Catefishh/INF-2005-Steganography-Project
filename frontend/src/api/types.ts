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
  reference_bit_planes?: string[] | null;
  reference_histograms?: number[][] | null;
  rs?: { groups: number; positive: { regular: number; singular: number; unchanged: number };
    negative: { regular: number; singular: number; unchanged: number };
    estimated_rate: number | null; reason: string | null; method: string } | null;
  chi_square: (number | null)[];
  chi_square_overall: number | null;
  chi_square_details?: {
    overall: { sample_count: number; valid_categories: number; statistic: number | null; p_value: number | null; interpretable: boolean; threshold_kind: string };
    segments: { sample_count: number; valid_categories: number; statistic: number | null; p_value: number | null }[];
    method: string;
  };
  bpcs?: {
    supported: boolean;
    reason?: string;
    configuration: { block_size: number; first_plane: number; last_plane: number; threshold: number };
    edge_policy?: string;
    estimated_capacity_bits?: number;
    planes?: {
      bit_plane: number; blocks: number; complex_blocks: number; non_complex_blocks: number;
      complex_percent: number; mean_complexity: number; transitions: number; estimated_capacity_bits: number;
      complexity_map: string; classification_map: string;
      comparison: { mean_complexity_delta: number; changed_blocks: number; classification_flips: number; capacity_difference_bits: number } | null;
    }[];
  };
  duration_ms?: { bit_planes: number; histogram: number; chi_square: number; difference: number; bpcs: number; total: number };
  histograms: number[][];
  lsb_composite: string | null;
  compare: {
    slots_changed: number;
    bits_changed: number;
    max_difference: number;
    psnr_db: number | null;
    mse: number;
    pixels_changed?: number;
    ssim?: number | null;
    original_preview?: string;
    stego_preview?: string;
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

