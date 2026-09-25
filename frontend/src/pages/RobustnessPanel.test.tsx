import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi, expect, test } from "vitest";
import { setFiles } from "../test/setup";
import { runRobustness } from "../api/robustness";
import { RobustnessPanel } from "./RobustnessPanel";

vi.mock("../api/robustness", () => ({ runRobustness: vi.fn() }));

test("loads a saved PEM and sends its content to the robustness job", async () => {
  vi.mocked(runRobustness).mockResolvedValue(null);
  render(<RobustnessPanel />);

  const image = new File(["image"], "protected.png", { type: "image/png" });
  const imageInput = screen.getByLabelText("Protected image") as HTMLInputElement;
  setFiles(imageInput, image);
  fireEvent.change(imageInput);

  const pem = "-----BEGIN PUBLIC KEY-----\nexample\n-----END PUBLIC KEY-----\n";
  const key = new File([pem], "saved.pem", { type: "application/x-pem-file" });
  Object.defineProperty(key, "text", { value: async () => pem });
  const keyInput = screen.getByLabelText("Upload public key PEM") as HTMLInputElement;
  setFiles(keyInput, key);
  fireEvent.change(keyInput);

  await waitFor(() => expect(screen.getByLabelText("Public key PEM")).toHaveValue(pem));
  fireEvent.click(screen.getByRole("button", { name: "Run image transformations" }));
  await waitFor(() => expect(runRobustness).toHaveBeenCalledOnce());
  const sent = vi.mocked(runRobustness).mock.calls[0][0];
  expect(sent.get("public_key")).toBe(pem);
  expect(sent.get("stego")).toBe(image);
});

test("shows transformations and verification without image-quality output", async () => {
  const row = { value: 0.75, verdict: "Cannot Verify", file: { id: "1", filename: "resize.png", size: 10 },
    preview: null, original_dimensions: [128, 128] as [number, number],
    result_dimensions: [96, 96] as [number, number],
    metrics: { mse: 12.345, psnr_db: 37.21, ssim: 0.9123,
      basis: "Resized result restored to original dimensions", retained_area_percent: null } };
  vi.mocked(runRobustness).mockResolvedValue({ baseline_verdict: "Authentic", note: "Baseline note",
    scenarios: [
      { ...row, operation: "resize" },
      { ...row, operation: "crop", value: 0.9, result_dimensions: [115, 115],
        metrics: { mse: 0, psnr_db: null, ssim: 1,
          basis: "Retained center region only; missing area excluded", retained_area_percent: 80.7 } },
    ] });
  render(<RobustnessPanel />);
  const imageInput = screen.getByLabelText("Protected image") as HTMLInputElement;
  setFiles(imageInput, new File(["image"], "protected.png", { type: "image/png" }));
  fireEvent.change(imageInput);
  fireEvent.change(screen.getByLabelText("Public key PEM"), { target: { value: "public key" } });
  fireEvent.click(screen.getByRole("button", { name: "Run image transformations" }));

  expect(await screen.findByText("Size: 128 × 128 → 96 × 96")).toBeInTheDocument();
  expect(screen.getAllByText("Verification: Cannot Verify")).toHaveLength(2);
  expect(screen.getAllByText("Download transformed PNG")).toHaveLength(2);
  expect(screen.queryByText(/MSE|PSNR|SSIM|Comparison:/)).not.toBeInTheDocument();
});
