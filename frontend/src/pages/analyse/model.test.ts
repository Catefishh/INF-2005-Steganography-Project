import { describe, expect, it } from "vitest";
import { appendBpcsForm, DEFAULT_BPCS_FORM, validateBpcsForm } from "./model";

describe("BPCS form model", () => {
  it("uses reproducible defaults and exact request names", () => {
    expect(validateBpcsForm({ ...DEFAULT_BPCS_FORM })).toBe("");
    const data = new FormData();
    appendBpcsForm(data, { ...DEFAULT_BPCS_FORM });
    expect([...data.keys()]).toEqual(["bpcs_channel", "bpcs_block_size", "bpcs_bit_plane_start", "bpcs_bit_plane_end", "bpcs_complexity_threshold"]);
  });

  it("rejects reversed planes without weakening the backend wording", () => {
    expect(validateBpcsForm({ ...DEFAULT_BPCS_FORM, bitPlaneStart: "7", bitPlaneEnd: "2" })).toBe("BPCS first bit plane must not exceed the last bit plane.");
  });
});
