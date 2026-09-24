import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { TextPage } from "./TextPage";
import { requestJson, runTextJob } from "../api/jobs";
import { generatedText, recoveryFile } from "../api/text";

vi.mock("../api/jobs", () => ({
  requestJson: vi.fn(), runTextJob: vi.fn(), artifactUrl: (id: string) => `/api/v2/artifacts/${id}`,
}));
vi.mock("../api/text", () => ({ generatedText: vi.fn(), recoveryFile: vi.fn() }));

it("shows the generated acrostic in the visible cover field after protection", async () => {
  vi.mocked(requestJson).mockImplementation(async (path) => path.includes("keys/generate")
    ? { private_key: "private", public_key: "public" } as never : {} as never);
  vi.mocked(runTextJob).mockResolvedValue({
    carrier: { id: "carrier", filename: "cover.txt", size: 20 },
    recovery: { id: "recovery", filename: "recovery.stegloc-text", size: 8 },
    recovery_code: "code", frame_bytes: 2, required_lines_or_symbols: 4,
  } as never);
  vi.mocked(generatedText).mockResolvedValue("A bright line\nB clear line");
  vi.mocked(recoveryFile).mockResolvedValue(null);

  render(<TextPage />);
  fireEvent.change(screen.getByLabelText("Message to hide"), { target: { value: "Hello" } });
  fireEvent.change(screen.getByLabelText("Key password"), { target: { value: "secret" } });
  fireEvent.click(screen.getByRole("button", { name: "Generate Ed25519 keys" }));
  await waitFor(() => expect(screen.getByLabelText("Encrypted private key PEM")).toHaveValue("private"));
  fireEvent.click(screen.getByRole("button", { name: "Encrypt, sign and hide" }));
  await waitFor(() => expect(screen.getByLabelText(/Visible cover text/)).toHaveValue("A bright line\nB clear line"));
  expect(screen.getByLabelText("Carrier text")).toHaveValue("A bright line\nB clear line");
});
