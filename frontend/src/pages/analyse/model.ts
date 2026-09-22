import type { BpcsConfig } from "../../api";

export const DEFAULT_BPCS_FORM = {
  channel: "0", blockSize: "8", bitPlaneStart: "0", bitPlaneEnd: "7", complexityThreshold: "0.3",
} as const;
export type BpcsForm = { channel: string; blockSize: string; bitPlaneStart: string; bitPlaneEnd: string; complexityThreshold: string };

const whole = (value: string) => /^\d+$/.test(value);
const values = (form: BpcsForm) => ({
  channel: Number(form.channel), blockSize: Number(form.blockSize), start: Number(form.bitPlaneStart), end: Number(form.bitPlaneEnd), threshold: Number(form.complexityThreshold),
});

export function validateBpcsForm(form: BpcsForm): string {
  const value = values(form);
  if (!whole(form.channel) || value.channel > 2) return "BPCS channel must be a whole number from 0 through 2.";
  if (!whole(form.blockSize) || ![2, 4, 8, 16, 32, 64].includes(value.blockSize)) return "BPCS block size must be one of 2, 4, 8, 16, 32, or 64.";
  if (!whole(form.bitPlaneStart) || !whole(form.bitPlaneEnd) || value.start > 7 || value.end > 7) return "BPCS bit planes must be whole numbers from 0 through 7.";
  if (value.start > value.end) return "BPCS first bit plane must not exceed the last bit plane.";
  if (!form.complexityThreshold.trim() || !Number.isFinite(value.threshold) || value.threshold < 0 || value.threshold > 1) return "BPCS complexity threshold must be a number from 0 through 1.";
  return "";
}

export function appendBpcsForm(data: FormData, form: BpcsForm): void {
  data.append("bpcs_channel", form.channel);
  data.append("bpcs_block_size", form.blockSize);
  data.append("bpcs_bit_plane_start", form.bitPlaneStart);
  data.append("bpcs_bit_plane_end", form.bitPlaneEnd);
  data.append("bpcs_complexity_threshold", form.complexityThreshold);
}

export function bpcsFormFromConfig(config: BpcsConfig): BpcsForm {
  return { channel: String(config.channel), blockSize: String(config.block_size), bitPlaneStart: String(config.bit_plane_start), bitPlaneEnd: String(config.bit_plane_end), complexityThreshold: String(config.complexity_threshold) };
}
