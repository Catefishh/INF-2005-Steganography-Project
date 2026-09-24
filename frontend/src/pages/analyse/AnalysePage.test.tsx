import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { api, type Analysis } from "../../api";
import { setFiles } from "../../test/setup";
import { analysisExtras } from "../../test/analysisFixture";
import { AnalysePage } from "../AnalysePage";

const picture = new File([new Uint8Array(16)], "suspect.png", { type: "image/png" });
const baseResult: Analysis = {
  ...analysisExtras,
  info: { kind: "image", format: "PNG", output_format: "PNG", descriptor: "RGB", n_slots: 192, lossy_source: false, width: 8, height: 8 },
  channel: 0, channel_names: ["Red", "Green", "Blue"], stride: 1,
  bit_planes: Array.from({ length: 8 }, () => "data:image/png;base64,x"),
  chi_square: [1, null], chi_square_overall: 1,
  histograms: [Array.from({ length: 256 }, () => 1)], lsb_composite: null, compare: null,
};

function selectFile(file: File) {
  const input = document.querySelector<HTMLInputElement>('#inspect-file-slot input[type="file"]')!;
  setFiles(input, file);
  fireEvent.change(input);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => { vi.spyOn(api, "analyse").mockResolvedValue(baseResult); });

it("uses the new Inspect layout to show descriptive BPCS and Chi-Square results", async () => {
  render(<AnalysePage handoff={null} />);
  selectFile(picture);
  fireEvent.click(screen.getByRole("button", { name: "Inspect file" }));
  await waitFor(() => expect(screen.getByText(/Theoretical capacity/)).toBeInTheDocument());
  expect(screen.getByRole("heading", { name: "BPCS complexity segmentation" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Pop out Chi-square p-values by section" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Pop out Inspected value histogram" })).toBeInTheDocument();
  expect(screen.getByText(/does not prove embedding/)).toBeInTheDocument();
  expect(screen.getByText(/presentation heuristic/)).toBeInTheDocument();
  expect(document.querySelector(".outcome")?.textContent).not.toMatch(/Something is hidden|has not been changed|looks embedded/);
});

it("applies BPCS settings separately from channel changes and keeps invalid drafts local", async () => {
  render(<AnalysePage handoff={null} />);
  selectFile(picture);
  fireEvent.click(screen.getByRole("button", { name: "Inspect file" }));
  await screen.findByRole("heading", { name: "BPCS complexity segmentation" });
  fireEvent.click(screen.getByRole("button", { name: /BPCS image settings/ }));
  fireEvent.change(screen.getByLabelText("Complexity threshold"), { target: { value: "0.45" } });
  fireEvent.click(screen.getByRole("button", { name: /Apply BPCS settings/ }));
  await waitFor(() => expect(api.analyse).toHaveBeenCalledTimes(2));
  expect(vi.mocked(api.analyse).mock.calls[1][0].get("bpcs_complexity_threshold")).toBe("0.45");
  fireEvent.change(screen.getByLabelText("First plane"), { target: { value: "7" } });
  fireEvent.change(screen.getByLabelText("Last plane"), { target: { value: "1" } });
  fireEvent.click(screen.getByRole("button", { name: /Apply BPCS settings/ }));
  expect(api.analyse).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("alert")).toHaveTextContent("BPCS first bit plane must not exceed the last bit plane.");
  fireEvent.click(screen.getByRole("button", { name: "Green" }));
  await waitFor(() => expect(api.analyse).toHaveBeenCalledTimes(3));
  expect(vi.mocked(api.analyse).mock.calls[2][0].get("channel")).toBe("1");
  expect(vi.mocked(api.analyse).mock.calls[2][0].get("bpcs_complexity_threshold")).toBe("0.45");
  expect(vi.mocked(api.analyse).mock.calls[2][0].get("bpcs_bit_plane_start")).toBe("0");
});

it("renders audio BPCS as unsupported while retaining statistical analysis", async () => {
  vi.mocked(api.analyse).mockResolvedValue({
    ...baseResult,
    info: { ...baseResult.info, kind: "audio", channels: 2 }, channel_names: ["Channel 1", "Channel 2"],
    bpcs: { supported: false, reason: "BPCS analysis is available only for image inputs.", config: analysisExtras.bpcs.config, image: null, planes: [], summary: null, comparison: null },
  });
  render(<AnalysePage handoff={null} />);
  selectFile(new File([new Uint8Array(16)], "suspect.wav", { type: "audio/wav" }));
  fireEvent.click(screen.getByRole("button", { name: "Inspect file" }));
  await screen.findByText(/BPCS analysis is available only for image inputs/);
  expect(screen.getByRole("heading", { name: /Chi-square/i })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /BPCS image settings/ }));
  expect(screen.getByRole("group", { name: "BPCS image settings" })).toBeDisabled();
  expect(screen.queryByAltText("Bit 0 complexity map")).not.toBeInTheDocument();
});

it("shows directional BPCS comparison and per-plane capacity with a reference", async () => {
  const metrics = {
    changed_blocks: 2, classification_flips: 1, flips_to_complex: 1, flips_to_non_complex: 0,
    mean_complexity_delta: 0.125, mean_absolute_complexity_delta: 0.25,
    capacity_bits_delta: 16, capacity_bytes_floor_delta: 2,
  };
  vi.mocked(api.analyse).mockResolvedValue({
    ...baseResult,
    bpcs: {
      ...analysisExtras.bpcs,
      comparison: { summary: metrics, planes: [{ bit_plane: 0, ...metrics }] },
    } as Analysis["bpcs"],
  });
  render(<AnalysePage handoff={null} />);
  selectFile(picture);
  const input = document.querySelector<HTMLInputElement>('#inspect-reference-slot input[type="file"]')!;
  setFiles(input, new File([new Uint8Array(16)], "original.png", { type: "image/png" }));
  fireEvent.change(input);
  fireEvent.click(screen.getByRole("button", { name: "Inspect file" }));
  await screen.findByRole("heading", { name: "BPCS complexity segmentation" });
  expect(screen.getByText(/16 bits more than the reference/)).toBeInTheDocument();
  expect(screen.getByText(/Bit 0.*64 bits/)).toBeInTheDocument();
  expect(screen.getByText(/Descriptive comparison only/)).toBeInTheDocument();
});

it("ignores an outdated response and releases busy when the file is replaced", async () => {
  const pending = deferred<Analysis>();
  vi.mocked(api.analyse).mockReturnValueOnce(pending.promise);
  render(<AnalysePage handoff={null} />);
  selectFile(picture);
  fireEvent.click(screen.getByRole("button", { name: "Inspect file" }));
  selectFile(new File([new Uint8Array(16)], "replacement.png", { type: "image/png" }));
  expect(screen.getByRole("button", { name: "Inspect file" })).toBeEnabled();
  pending.resolve(baseResult);
  await waitFor(() => expect(screen.queryByRole("heading", { name: "BPCS complexity segmentation" })).not.toBeInTheDocument());
});

it("keeps the selected bit-plane images in view when changing channels", async () => {
  const original = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView");
  const scroll = vi.fn();
  Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: scroll });
  try {
    render(<AnalysePage handoff={null} />);
    selectFile(picture);
    fireEvent.click(screen.getByRole("button", { name: "Inspect file" }));
    const outcome = await screen.findByRole("heading", { name: /Pair counts resemble/ });
    const focus = vi.spyOn(outcome, "focus");
    vi.mocked(api.analyse).mockResolvedValueOnce({ ...baseResult, channel: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Green" }));
    await waitFor(() => expect(scroll).toHaveBeenCalledOnce());
    expect(scroll.mock.instances[0]).toHaveClass("planes");
    expect(focus).not.toHaveBeenCalled();
  } finally {
    if (original) Object.defineProperty(Element.prototype, "scrollIntoView", original);
    else Reflect.deleteProperty(Element.prototype, "scrollIntoView");
  }
});
