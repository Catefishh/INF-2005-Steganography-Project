/** V2 session and artifact requests; the page owns form state. */
import { artifactUrl } from "./jobs";

export type Stored = { id: string; filename: string; size: number; media_type?: string };
export type ProtectResult = { carrier: Stored; recovery: Stored; recovery_code: string; media_kind: string; record: Record<string, unknown> };
export type VerifyResult = { verdict: string; stages: Record<string, { status: string; evidence: string; reason: string }>;
  record: Record<string, unknown> | null; content: Stored | null };

export function fetchArtifact(id: string): Promise<Response> {
  return fetch(artifactUrl(id));
}

export async function generatedFiles(result: ProtectResult): Promise<[File, File]> {
  const [carrier, recovery] = await Promise.all([
    fetchArtifact(result.carrier.id), fetchArtifact(result.recovery.id),
  ]);
  if (!carrier.ok || !recovery.ok) throw new Error("Generated files have expired");
  return [new File([await carrier.blob()], result.carrier.filename),
    new File([await recovery.blob()], result.recovery.filename)];
}

export function closeSession(): Promise<Response> {
  return fetch("/api/v2/session", { method: "DELETE" });
}

export function cancelJob(id: string): Promise<Response> {
  return fetch(`/api/v2/jobs/${encodeURIComponent(id)}`, { method: "DELETE" });
}
