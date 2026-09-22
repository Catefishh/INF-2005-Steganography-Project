// The single stale-result policy.
//
// A result describes the inputs that produced it. When those inputs change, the result is no
// longer a statement about what is on the form. The rule everywhere is the same: mark it, do
// not delete it, and offer the re-run. Never silently kept, never silently cleared.

/** A stable fingerprint of whatever produced a result. */
export function inputFingerprint(parts: unknown[]): string {
  return JSON.stringify(parts);
}

/**
 * What is stale, in the words of somebody looking at the screen. `labels` names each part of
 * the fingerprint; the returned list holds only the ones that moved.
 */
export function changedInputs(labels: string[], stored: string[], current: string[]): string[] {
  return labels.filter((_, index) => stored[index] !== current[index]);
}

/** "The password changed after it was produced." */
export function staleReason(changed: string[]): string {
  if (changed.length === 0) return "The inputs changed after it was produced.";
  if (changed.length === 1) return `The ${changed[0]} changed after it was produced.`;
  if (changed.length === 2) return `The ${changed[0]} and the ${changed[1]} changed after it was produced.`;
  const last = changed[changed.length - 1];
  return `The ${changed.slice(0, -1).join(", the ")} and the ${last} changed after it was produced.`;
}
