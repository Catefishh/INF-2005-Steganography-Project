// How a verdict is allowed to present itself.
//
// One place decides the tone, the icon and the words for each verdict, so colour, icon and
// text can never disagree. The backend names stay the source of truth for the *meaning*; the
// headline is how that meaning is said to a person.

import type { IconName } from "./components";
import type { VerdictName, VerifyStep } from "./api";

export type Tone = "good" | "bad" | "warn" | "flat";

export interface VerdictReading {
  /** The name the backend uses. Kept on screen as the technical label. */
  verdict: VerdictName;
  tone: Tone;
  icon: IconName;
  /** Plain-language headline. */
  headline: string;
  /** What this particular run found, one sentence, plus anything the receiver must do next. */
  summary: string;
}

const TONE: Record<VerdictName, Tone> = {
  Authentic: "good",
  Tampered: "bad",
  "Signature Invalid": "bad",
  "Payload Missing": "warn",
  "Wrong Start Location": "warn",
  "Cannot Verify": "flat",
};

const HEADLINE: Record<VerdictName, string> = {
  Authentic: "This file is genuine",
  Tampered: "Something in this file has been changed",
  "Signature Invalid": "This file was not signed by the key you supplied",
  "Payload Missing": "No readable hidden payload was found",
  "Wrong Start Location": "Looked in the wrong place",
  "Cannot Verify": "Cannot check this file",
};

/** The icon has to agree with the tone, and with the specific situation. */
const ICON: Record<VerdictName, IconName> = {
  Authentic: "shield",
  Tampered: "x",
  "Signature Invalid": "key",
  "Payload Missing": "alert",
  "Wrong Start Location": "target",
  "Cannot Verify": "alert",
};

const SUMMARY: Record<VerdictName, string> = {
  Authentic: "The signature matches the public key you supplied, and every value in the file is "
    + "still what the signature covers. All eight checks passed.",
  Tampered: "The file was signed by the key you supplied, so it came from the sender, but part of "
    + "it changed after it was signed. The failing check above names what changed.",
  "Signature Invalid": "The file carries a signature that does not match the public key you "
    + "supplied. Either it was signed with a different key, or the signed record was replaced.",
  "Payload Missing": "No recognizable hidden header was found in this copy. It may never have carried "
    + "a payload, or an edit may have changed the bits needed to find one.",
  "Wrong Start Location": "Nothing was found at the place you chose. The password was accepted, so "
    + "the file itself is intact. Turn the override off to read from the place the file records.",
  "Cannot Verify": "Nothing could be read out of it. The most likely reason is a wrong password, "
    + "because the password is what finds where the hidden data starts. It is also possible that this "
    + "file carries nothing from this tool, or that it was edited or re-saved after it was protected.",
};

export function verdictReading(verdict: VerdictName): VerdictReading {
  return { verdict, tone: TONE[verdict], icon: ICON[verdict], headline: HEADLINE[verdict], summary: SUMMARY[verdict] };
}

export type StepTone = "passed" | "failed" | "skipped" | "override";

/**
 * Tone for one check in "what was checked".
 *
 * The extract step is special: when the manual override was sent, that step is what caused the
 * outcome, so it must not carry a success tick. It reads as `override` in amber instead. The
 * runtime check is on the step's own detail rather than on the form, because the form can have
 * moved on since the run.
 */
export function stepTone(step: VerifyStep): StepTone {
  if (step.id === "extract" && step.status === "passed" && step.detail.toLowerCase().includes("manual")) {
    return "override";
  }
  return step.status;
}

/** "8 of 8 passed" / "stopped at step 3 of 8". */
export function stepsValue(steps: VerifyStep[]): string {
  const passed = steps.filter((step) => step.status === "passed").length;
  return passed === steps.length ? `${passed} of ${steps.length} passed` : `stopped at step ${passed + 1} of ${steps.length}`;
}

/** The steps that were never reached, in order, for the collapsed one-line summary. */
export function skippedSteps(steps: VerifyStep[]): VerifyStep[] {
  return steps.filter((step) => step.status === "skipped");
}

/**
 * The first check that actually failed. This is what the outcome names, so a failure is never
 * reported without saying which check produced it.
 */
export function failedStep(steps: VerifyStep[]): VerifyStep | null {
  return steps.find((step) => step.status === "failed") ?? null;
}
