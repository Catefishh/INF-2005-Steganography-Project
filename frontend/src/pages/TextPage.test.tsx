import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { TextPage } from "./TextPage";
import { TextShowcase } from "./TextShowcase";
import { requestJson, runTextJob } from "../api/jobs";
import { generatedText, recoveryFile } from "../api/text";
import { CharacterChanges } from "./text/CharacterChanges";
import type { Scenario } from "../api";

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
  expect(screen.getByRole("button", { name: "Download recovery code" })).toBeInTheDocument();
});

it("keeps text test inputs separated and supports a public PEM upload", async () => {
  render(<TextShowcase back={() => undefined} />);
  expect(screen.getByText("Protected text file")).toBeInTheDocument();
  expect(screen.getByText("Recovery file")).toBeInTheDocument();
  expect(screen.getByRole("button", {name: "Load .pem"})).toBeInTheDocument();
  expect(screen.getByText("Recovery code")).toBeInTheDocument();
  expect(screen.getByText("Recovery code file")).toBeInTheDocument();
  expect(screen.getByText("Protected text file").closest(".slot")).toBeInTheDocument();
  expect(screen.getByText("Recovery file").closest(".slot")).toBeInTheDocument();
  const keyFile = new File(["-----BEGIN PUBLIC KEY-----\npublic\n-----END PUBLIC KEY-----"], "sender.pem");
  const keyInput = screen.getByLabelText("Ed25519 public key").closest(".field")!.querySelector("input[type=file]")!;
  fireEvent.change(keyInput, {target: {files: [keyFile]}});
  await waitFor(() => expect(screen.getByLabelText("Ed25519 public key")).toHaveValue("-----BEGIN PUBLIC KEY-----\npublic\n-----END PUBLIC KEY-----"));
});

it("loads a downloaded recovery code file into text tamper tests", async () => {
  render(<TextShowcase back={() => undefined} />);
  const codeFile = new File(["recovery-code"], "stegloc-recovery-code.txt", { type: "text/plain" });
  const codeInput = screen.getByText("Recovery code file").closest(".slot")!.querySelector("input[type=file]")!;
  fireEvent.change(codeInput, { target: { files: [codeFile] } });
  await waitFor(() => expect(screen.getByLabelText("Recovery code")).toHaveValue("recovery-code"));
});

it("renders in-depth tamper evidence when a result is returned", async () => {
  const scenario: Scenario = { id: "baseline", title: "Nothing changed", change: "The carrier was not edited.", expected: ["Authentic"], verdict: "Authentic", summary: "Signature and payload checks passed.", as_expected: true, file: null, elapsed_ms: 18, stages: [{ id: "extract", status: "passed" }, { id: "signature", status: "passed" }], payload_hash: { status: "match" } };
  const { requestJson } = await import("../api/jobs");
  vi.mocked(requestJson).mockImplementation(async (path) => path === "/api/v4/jobs/text-showcase" ? { id: "job" } as never : { status: "succeeded", phase: "complete", completed: 1, total: 1, cases: [scenario], result: { cases: [scenario] } } as never);
  render(<TextShowcase back={() => undefined} initialCarrier={new File(["carrier"], "carrier.txt")} initialRecovery={new File(["recovery"], "recovery.stegloc-text")} initialCode="code" initialPublicKey="public" />);
  fireEvent.click(screen.getByRole("button", { name: "Run text tamper tests" }));
  await waitFor(() => expect(screen.getByText("Verification explanation")).toBeInTheDocument());
  expect(screen.getByText("Verification stages")).toBeInTheDocument();
  expect(screen.getByText("Payload hash: match")).toBeInTheDocument();
});

it("opens character evidence and marks hidden carrier characters", () => {
  render(<CharacterChanges before="A line" after={"A line \u200b\t"} method="zero-width" />);
  fireEvent.click(screen.getByRole("button", { name: /Character changes/ }));
  fireEvent.click(screen.getByRole("tab", { name: "Encoded carrier" }));
  expect(screen.getByLabelText("Encoded carrier")).toHaveTextContent("ZWSP");
  expect(screen.getByText("1 lines with trailing tabs")).toBeInTheDocument();
});
