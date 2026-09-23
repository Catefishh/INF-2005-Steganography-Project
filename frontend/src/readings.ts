// Turns the numbers the backend reports into a headline plus one line saying whether the
// number is good. The figures themselves are never dropped — they move into the reading.

export interface Reading {
  /** Short headline for the metric tile. */
  value: string;
  /** One line of interpretation, carrying the raw figures. */
  reading: string;
  tone: "" | "good" | "warn";
}

/**
 * Quality: whether saving the protected file lost anything. A PNG cover is re-compressed, so
 * the file size moves even though every pixel written is kept; that is not damage, and it
 * should not be the headline. BMP and WAV come out byte-for-byte the same size.
 */
export function qualityReading(input: {
  sizeUnchanged: boolean;
  coverBytes: number;
  stegoBytes: number;
  outputFormat: string;
  kind: "image" | "audio";
  formatBytes: (bytes: number) => string;
}): Reading {
  const { sizeUnchanged, coverBytes, stegoBytes, outputFormat, kind, formatBytes } = input;
  const lossless = kind === "audio" ? `${outputFormat} is uncompressed.` : `Saved as ${outputFormat}, which is lossless.`;
  if (sizeUnchanged) {
    return {
      value: "Nothing lost",
      reading: `${lossless} The file is exactly the same size as the cover.`,
      tone: "good",
    };
  }
  const delta = stegoBytes - coverBytes;
  const direction = delta >= 0 ? "larger" : "smaller";
  return {
    value: "Nothing lost",
    reading: `${lossless} ${formatBytes(Math.abs(delta))} ${direction} than the cover file, because ${outputFormat} re-compresses.`,
    tone: "good",
  };
}

/** Above ~40 dB PSNR a change stops being noticeable; null means the two files are identical. */
export function differenceReading(input: { psnrDb: number | null; mse: number; kind: "image" | "audio" }): Reading {
  const { psnrDb, mse, kind } = input;
  if (psnrDb === null) {
    return { value: "None", reading: `The two files are identical at every ${kind === "audio" ? "sample" : "pixel"}.`, tone: "good" };
  }
  const detail = `${psnrDb.toFixed(2)} dB PSNR. MSE ${mse.toExponential(2)}.`;
  if (psnrDb >= 40) {
    return {
      value: "None",
      reading: kind === "audio"
        ? `${detail} Well below the noise floor of the recording.`
        : `${detail} Far above the 40 dB at which differences stop being noticeable.`,
      tone: "good",
    };
  }
  if (psnrDb >= 30) {
    return { value: "Slight", reading: `${detail} Below 40 dB, so a close look may spot it.`, tone: "warn" };
  }
  return { value: "Noticeable", reading: `${detail} Under 30 dB, which is usually visible.`, tone: "warn" };
}

/** The tile heading follows the media type, so it is kept separate from the reading. */

export function differenceLabel(kind: "image" | "audio"): string {
  return kind === "audio" ? "Audible change" : "Visible change";
}

/** How much of the carrier was touched. */
export function touchedReading(input: {
  slotsChanged: number;
  bitsChanged: number;
  totalSlots: number;
  kind: "image" | "audio";
}): Reading {
  const { slotsChanged, bitsChanged, totalSlots, kind } = input;
  const percent = totalSlots > 0 ? (slotsChanged / totalSlots) * 100 : 0;
  const noun = kind === "audio" ? "recording" : "picture";
  const perValue = slotsChanged > 0 && bitsChanged === slotsChanged
    ? "One bit per value."
    : `${bitsChanged.toLocaleString()} bits changed.`;
  return {
    value: `${slotsChanged.toLocaleString()}`,
    reading: `${percent < 0.1 ? "Under 0.1" : percent.toFixed(1)}% of the ${noun}. ${perValue}`,
    tone: "",
  };
}

/** How full the carrier is. */
export function roomReading(input: { packageBytes: number; capacityBytes: number; nLsb: number; kind: "image" | "audio" }): Reading {
  const { packageBytes, capacityBytes, nLsb, kind } = input;
  const percent = capacityBytes > 0 ? (packageBytes / capacityBytes) * 100 : 0;
  const unit = kind === "audio" ? "sample" : "colour value";
  return {
    value: `${percent.toFixed(1)}%`,
    reading: `${packageBytes.toLocaleString()} of ${capacityBytes.toLocaleString()} bytes at ${nLsb} bit${nLsb === 1 ? "" : "s"} per ${unit}.`,
    tone: percent > 75 ? "warn" : "",
  };
}
