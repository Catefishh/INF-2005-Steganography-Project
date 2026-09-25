// One source of truth for "why is the primary action disabled".
//
// Each screen has a pure function returning the ordered list of things still missing.
// An empty list means the action is available. The ActionBar prints the list next to the
// blocked button so a disabled action always states its own prerequisites.

export interface EmbedInputs {
  hasCover: boolean;
  /** /api/inspect has come back, so capacity and media kind are known. */
  hasCoverDetails: boolean;
  hasPayload: boolean;
  hasPassphrase: boolean;
  hasPrivateKey: boolean;
  overCapacity: boolean;
}

export function embedMissing(inputs: EmbedInputs): string[] {
  const missing: string[] = [];
  if (!inputs.hasCover) missing.push("a picture or WAV to hide it in");
  else if (!inputs.hasCoverDetails) missing.push("the cover file to finish loading");
  if (!inputs.hasPayload) missing.push("a message or a file to hide");
  if (!inputs.hasPassphrase) missing.push("a shared password");
  if (!inputs.hasPrivateKey) missing.push("a signing key");
  if (inputs.overCapacity) missing.push("something small enough to fit in this cover");
  return missing;
}

export interface VerifyInputs {
  hasFile: boolean;
  hasPassphrase: boolean;
  hasPublicKey: boolean;
}

export function verifyMissing(inputs: VerifyInputs): string[] {
  const missing: string[] = [];
  if (!inputs.hasFile) missing.push("the file you received");
  if (!inputs.hasPassphrase) missing.push("the shared password");
  if (!inputs.hasPublicKey) missing.push("the sender's public key");
  return missing;
}

export function inspectMissing(inputs: { hasFile: boolean }): string[] {
  return inputs.hasFile ? [] : ["a file to inspect"];
}

export interface TamperInputs {
  hasFile: boolean;
  hasPassphrase: boolean;
  hasPublicKey: boolean;
}

export function tamperMissing(inputs: TamperInputs): string[] {
  const missing: string[] = [];
  if (!inputs.hasFile) missing.push("a protected file to attack");
  if (!inputs.hasPassphrase) missing.push("the shared password");
  if (!inputs.hasPublicKey) missing.push("the sender's public key");
  return missing;
}

/** "One thing still needed" / "3 things still needed". */
export function missingHeading(missing: string[]): string {
  if (missing.length === 0) return "Ready";
  return missing.length === 1 ? "One thing still needed" : `${missing.length} things still needed`;
}

export function missingDetail(missing: string[]): string {
  return missing.join(" · ");
}
