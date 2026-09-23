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
  /** Sections above the 0.95 presentation heuristic, never a detector verdict. */
  flagged: number;
  total: number;
  overall: number | null;
}

export function chiCounts(analysis: Analysis): ChiCounts {
  const values = analysis.chi_square;
  return {
    flagged: values.filter((p) => p !== null && p >= analysis.chi_square_details.presentation_heuristic).length,
    total: values.length,
    overall: analysis.chi_square_overall,
  };
}

const fmt = (value: number) => value.toLocaleString();

/**
 * Describe measured differences and pair counts without making a stego or authenticity verdict.
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
        tone: "flat",
        needsOriginal: true,
        headline: "No differences in the analysed values",
        summary: `The ${fmt(analysis.info.n_slots)} analysed ${noun}s match the supplied original. This does not establish the file's history or authenticity.`,
      };
    }
    if (max <= 1) {
      return {
        tone: "flat",
        needsOriginal: true,
        headline: "One-bit changes compared with the original",
        summary: `Comparing it with the original shows ${fmt(compare.slots_changed)} ${noun}s changed by no more than ±1. `
          + "This pattern is consistent with one-bit replacement, but does not establish its cause. "
          + (flaggedShare >= 0.5
            ? "Some pair counts also meet the statistical display heuristic."
            : "The statistical display heuristic was not met in most sections."),
      };
    }
    return {
      tone: "flat",
      needsOriginal: true,
      headline: "Differences compared with the original",
      summary: `${fmt(compare.slots_changed)} ${noun}s differ from the original by up to ±${max}. A change larger than ±1 `
        + "is not explained by single-bit LSB replacement alone. Other changes or embedding methods may also be present.",
    };
  }

  // No original supplied, so the statistical test is the only evidence there is.
  if (chi.flagged > 0 && flaggedShare >= 0.5) {
    return {
      tone: "flat",
      needsOriginal: false,
      headline: "Pair counts resemble LSB replacement in many sections",
      summary: `${chi.flagged} of ${chi.total} sections scored 0.95 or above. Very flat or very noisy files score like `
        + "that whether or not anything is hidden in them. Supplying the original would allow a direct comparison, "
        + "not an embedding verdict.",
    };
  }
  if (chi.flagged > 0) {
    return {
      tone: "flat",
      needsOriginal: false,
      headline: "Pair counts resemble LSB replacement in some sections",
      summary: `${chi.flagged} of ${chi.total} sections scored 0.95 or above while the rest did not. A partial result is `
        + "consistent with several causes, including natural texture or processing. Supplying the original would allow "
        + "a direct comparison, not an embedding verdict.",
    };
  }
  return {
    tone: "flat",
    needsOriginal: false,
    headline: "No pair equalisation at the display threshold",
    summary: `No section scored 0.95 or above. This does not establish that the file is clean and cannot rule out embedding. `
      + "Supplying the original would allow a direct comparison of the analysed values.",
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
      histogramAxis: "low-byte sample value",
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

/** The backend histograms uint8 RGB values or the low byte of each audio sample. */
export function valueRange(_info: CoverInfo): { min: number; max: number } {
  return { min: 0, max: 255 };
}

/** "Channel 1" rather than "Channel 1 channel", and the stride note only when it applies. */
export function channelLabel(analysis: Analysis): string {
  return analysis.channel_names[analysis.channel] ?? `Channel ${analysis.channel + 1}`;
}
