// "Inspect a file" reads its own figures.
//
// Everything here is derived from values the backend already computed. Nothing new is measured,
// and nothing is certain: the panel says what the figures are consistent with, not what is true.

import type { Analysis, CoverInfo } from "./api";

export type ReadingTone = "good" | "warn" | "flat";

export interface EvidenceReading {
  tone: ReadingTone;
  headline: string;
  summary: string;
  /** True when the conclusion rests on having the original file to compare against. */
  needsOriginal: boolean;
}

export interface ChiCounts {
  /** Sections that scored 0.95 or above, the threshold the legend calls "looks embedded". */
  flagged: number;
  total: number;
  overall: number | null;
}

export function chiCounts(analysis: Analysis): ChiCounts {
  const values = analysis.chi_square;
  return {
    flagged: values.filter((p) => p !== null && p >= 0.95).length,
    total: values.length,
    overall: analysis.chi_square_overall,
  };
}

const fmt = (value: number) => value.toLocaleString();

/**
 * What the page's own numbers are consistent with.
 *
 * The four inputs are the exact difference (when an original was supplied), the number of values
 * that moved, the largest single move, and the per-section statistical test. The strongest
 * evidence available is used first: an exact difference beats a statistical one.
 */
export function evidenceReading(analysis: Analysis): EvidenceReading {
  const compare = analysis.compare;
  const chi = chiCounts(analysis);
  const noun = analysis.info.kind === "audio" ? "sample" : "colour value";
  const flaggedShare = chi.total > 0 ? chi.flagged / chi.total : 0;

  if (compare) {
    const max = compare.max_difference;
    if (compare.slots_changed === 0) {
      return {
        tone: "good",
        needsOriginal: true,
        headline: "This file has not been changed",
        summary: `Every one of the ${fmt(analysis.info.n_slots)} ${noun}s is identical to the original, so nothing was `
          + "written into it. That is what a file that was never used to carry hidden data looks like.",
      };
    }
    if (max <= 1) {
      return {
        tone: "warn",
        needsOriginal: true,
        headline: "Something is hidden in this file",
        summary: `Comparing it with the original shows ${fmt(compare.slots_changed)} ${noun}s changed by no more than ±1. `
          + "That is what replacing the lowest bit looks like, and it is the strongest evidence on this page. "
          + (flaggedShare >= 0.5
            ? "The statistical test agrees, though on its own it would not be reliable here."
            : "The statistical test does not agree, which is normal when very little of the file was used."),
      };
    }
    return {
      tone: "warn",
      needsOriginal: true,
      headline: "This file has been edited since the original",
      summary: `${fmt(compare.slots_changed)} ${noun}s differ from the original by up to ±${max}. A change larger than ±1 `
        + "is too big for one bit per value, so this looks like editing or re-saving rather than data hidden in the "
        + "lowest bit.",
    };
  }

  // No original supplied, so the statistical test is the only evidence there is.
  if (chi.flagged > 0 && flaggedShare >= 0.5) {
    return {
      tone: "flat",
      needsOriginal: false,
      headline: "The statistical test flags this file, but cannot settle it",
      summary: `${chi.flagged} of ${chi.total} sections scored 0.95 or above. Very flat or very noisy files score like `
        + "that whether or not anything is hidden in them, so this is a hint rather than a finding. Supplying the "
        + "original would turn it into an exact answer.",
    };
  }
  if (chi.flagged > 0) {
    return {
      tone: "flat",
      needsOriginal: false,
      headline: "Part of this file looks like it carries data",
      summary: `${chi.flagged} of ${chi.total} sections scored 0.95 or above while the rest did not. A partial result is `
        + "what hiding data in one region looks like, but a busy or unusually even region produces the same reading. "
        + "Supplying the original would turn it into an exact answer.",
    };
  }
  return {
    tone: "good",
    needsOriginal: false,
    headline: "Nothing here points to hidden data",
    summary: `No section of the file scored 0.95 or above on the statistical test. Hidden data usually pushes sections `
      + "over that line, but this test cannot prove a file is clean. Supplying the original would turn it into an exact "
      + "answer.",
  };
}

/** True when the file carries text or data whose difference a warning should name. */
export function needsOriginalNote(analysis: Analysis): boolean {
  return analysis.compare === null;
}

export interface InspectCopy {
  /** What one unit of the file is called in prose. */
  unit: string;
  /** The card heading for the exact difference. */
  differenceTitle: string;
  /** The label on the axis under the histogram. */
  histogramAxis: string;
  /** Where the channel selector's stride note points. */
  strideNote: (stride: number) => string;
  /** One line explaining what the top and bottom bit layers show. */
  planesNote: string;
}

export function inspectCopy(kind: CoverInfo["kind"]): InspectCopy {
  if (kind === "audio") {
    return {
      unit: "sample",
      differenceTitle: "Exactly what changed",
      histogramAxis: "sample value",
      strideNote: (stride) => `every ${ordinal(stride)} sample shown`,
      planesNote: "The top bits carry the sound; the bottom bits look like static. Hidden data turns a region of the "
        + "bottom layers into even static.",
    };
  }
  return {
    unit: "colour value",
    differenceTitle: "Exactly what changed",
    histogramAxis: "colour value",
    strideNote: (stride) => `every ${ordinal(stride)} pixel shown`,
    planesNote: "The top bits carry the picture; the bottom bits look like static. Hidden data turns a region of the "
      + "bottom layers into even static.",
  };
}

export function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th";
  return `${n}${suffix}`;
}

/**
 * The range the histogram's x-axis really covers. Images are 0 to 255. Audio samples are wider,
 * so labelling them 0 to 255 would be wrong.
 */
export function valueRange(info: CoverInfo): { min: number; max: number } {
  if (info.kind === "audio" && info.bits) return { min: 0, max: (1 << info.bits) - 1 };
  return { min: 0, max: 255 };
}

/** "Channel 1" rather than "Channel 1 channel", and the stride note only when it applies. */
export function channelLabel(analysis: Analysis): string {
  return analysis.channel_names[analysis.channel] ?? `Channel ${analysis.channel + 1}`;
}
