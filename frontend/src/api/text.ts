/** V3 text result shapes and artifact retrieval. */
import { artifactUrl } from "./jobs";

export type Stored = { id: string; filename: string; size: number };
export type Protected = { carrier: Stored; recovery: Stored; recovery_code: string; frame_bytes: number; required_lines_or_symbols: number; record: {message_sha256: string} };
export type Verified = { verdict: string; message: string; visible_text_authenticated: boolean; content: Stored;
  payload_hash?: import("../ui/hashEvidence").HashEvidenceData };

export async function generatedText(id: string): Promise<string> {
  const response = await fetch(artifactUrl(id));
  if (!response.ok) throw new Error("Generated text expired");
  return response.text();
}

export async function recoveryFile(file: Stored): Promise<File | null> {
  const response = await fetch(artifactUrl(file.id));
  return response.ok ? new File([await response.blob()], file.filename) : null;
}
