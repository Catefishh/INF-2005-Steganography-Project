import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import * as jobs from "../api/jobs";
import { setFiles } from "../test/setup";
import { AnalysePage } from "./AnalysePage";

it("offers a lowest-bit map for an uploaded video and a difference heatmap after adding its original", async () => {
  const compare = vi.spyOn(jobs, "requestJson").mockImplementation(async (_path, options) => {
    const original = (options?.body as FormData).get("reference");
    return {width: 64, height: 48, frame_count: 2, fps: 24, frame: 0,
      stego_preview: "data:image/png;base64,a", lsb_preview: "data:image/png;base64,b",
      original_preview: original ? "data:image/png;base64,c" : null,
      heatmap: original ? "data:image/png;base64,d" : null,
      timeline: original ? [0, 2] : null, pixels_changed: original ? 0 : null, bits_changed: original ? 0 : null} as never;
  });
  render(<AnalysePage handoff={null} />);
  const upload = screen.getByText("File to inspect").closest(".slot")!.querySelector<HTMLInputElement>('input[type="file"]')!;
  setFiles(upload, new File(["video"], "protected.mp4", {type: "video/mp4"}));
  fireEvent.change(upload);
  expect(await screen.findByRole("heading", {name: "Frame evidence"})).toBeInTheDocument();
  expect(screen.getByText("Lowest-bit RGB map")).toBeInTheDocument();
  expect(screen.queryByText("Difference heatmap")).not.toBeInTheDocument();

  const reference = screen.getByText("Original video (optional)").closest(".slot")!.querySelector<HTMLInputElement>('input[type="file"]')!;
  setFiles(reference, new File(["original"], "original.mp4", {type: "video/mp4"}));
  fireEvent.change(reference);
  await waitFor(() => expect(screen.getByText("Difference heatmap")).toBeInTheDocument());
  expect(screen.getByRole("button", {name: "Enlarge Video changes amplified in a heatmap"})).toBeInTheDocument();
  expect((vi.mocked(compare).mock.lastCall?.[1]?.body as FormData).get("reference")).toBeInstanceOf(File);
});
