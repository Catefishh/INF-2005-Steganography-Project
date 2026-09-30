import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { TextPage } from "./TextPage";
import { TextShowcase } from "./TextShowcase";
import { requestJson, runTextJob } from "../api/jobs";
import { generatedText, recoveryFile } from "../api/text";
import { CharacterChanges } from "./text/CharacterChanges";
import type { Scenario } from "../api";

vi.mock("../api/jobs", () => ({
  requestJson: vi.fn(), runTextJob: vi.fn(), artifactUrl: (id: string) => `/api/artifacts/${id}`,
}));
vi.mock("../api/text", () => ({ generatedText: vi.fn(), recoveryFile: vi.fn() }));

it("text imports and recovery material keep valid values when a raw picker receives the wrong type", async () => {
  vi.mocked(requestJson).mockResolvedValue({} as never);
  vi.mocked(runTextJob).mockClear().mockResolvedValue({verdict: "Authentic", message: "Verified",
    content: {id: "message", filename: "message.txt", size: 8}} as never);
  render(<TextPage />);
  fireEvent.change(screen.getByLabelText("Method"), {target: {value: "whitespace"}});
  fireEvent.change(screen.getByLabelText(/Visible cover text/), {target: {value: "visible original"}});
  fireEvent.change(screen.getByLabelText("Carrier text"), {target: {value: "carrier original"}});
  const wrong = Object.assign(new File(["wrong"], "image.png", {type: "text/plain"}), {text: vi.fn(async () => "wrong")});
  for (const label of ["Import visible text", "Import carrier text"]) {
    fireEvent.change(screen.getByLabelText(label), {target: {files: [wrong]}});
  }
  expect(wrong.text).not.toHaveBeenCalled();
  expect(screen.getByLabelText(/Visible cover text/)).toHaveValue("visible original");
  expect(screen.getByLabelText("Carrier text")).toHaveValue("carrier original");
  const carrier = new File(["carrier imported"], "carrier.TXT");
  fireEvent.change(screen.getByLabelText("Import carrier text"), {target: {files: [carrier]}});
  await waitFor(() => expect(screen.getByLabelText("Carrier text")).toHaveValue("carrier imported"));
  const recovery = new File(["recovery"], "recovery.STEGLOC-TEXT");
  fireEvent.change(screen.getByLabelText("Recovery material"), {target: {files: [recovery]}});
  fireEvent.change(screen.getByLabelText("Recovery material"), {target: {files: [new File(["bad"], "recovery.txt")]}});
  fireEvent.change(screen.getByLabelText("Public key PEM"), {target: {value: "public"}});
  fireEvent.change(screen.getByLabelText("Recovery code"), {target: {value: "code"}});
  fireEvent.click(screen.getByRole("button", {name: "Extract and verify"}));
  await waitFor(() => expect(runTextJob).toHaveBeenCalledOnce());
  expect(vi.mocked(runTextJob).mock.calls[0][1].get("recovery")).toBe(recovery);
});

it("drops a stale carrier estimate after message or visible text changes", async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(requestJson).mockImplementation(() => new Promise((resolve) => { finish = resolve; }) as never);
  render(<TextPage />);
  fireEvent.change(screen.getByLabelText("Message to hide"), {target: {value: "first"}});
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  fireEvent.change(screen.getByLabelText("Message to hide"), {target: {value: "second"}});
  await act(async () => { finish({frame_bytes: 12, required_lines_or_symbols: 5,
    estimated_carrier_bytes: 400, max_carrier_bytes: 2_097_152}); });
  expect(screen.queryByText(/Encrypted frame:/)).toBeNull();

  vi.mocked(requestJson).mockResolvedValue({frame_bytes: 14, required_lines_or_symbols: 6,
    estimated_carrier_bytes: 400, max_carrier_bytes: 2_097_152} as never);
  fireEvent.change(screen.getByLabelText("Method"), {target: {value: "whitespace"}});
  await waitFor(() => expect(screen.getByText(/Encrypted frame: 14 bytes/)).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText(/Visible cover text/), {target: {value: "new cover"}});
  expect(screen.queryByText(/Encrypted frame:/)).toBeNull();
});

it("updates the text capacity bar when the carrier method changes", async () => {
  vi.mocked(requestJson).mockImplementation(async (_path, options) => {
    const method = (options?.body as FormData).get("method");
    return {frame_bytes: 324, required_lines_or_symbols: method === "acrostic" ? 648 : 2592,
      estimated_carrier_bytes: method === "acrostic" ? 25_000 : 8_000,
      max_carrier_bytes: 2_097_152} as never;
  });
  render(<TextPage />);
  fireEvent.change(screen.getByLabelText("Message to hide"), {target: {value: "test"}});
  await waitFor(() => expect(screen.getByText(/Upper-bound estimate: 24.4 KB/)).toBeInTheDocument());
  expect(screen.getByText(/At least .* left/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Method"), {target: {value: "zero-width"}});
  await waitFor(() => expect(screen.getByText(/Estimated size: 7.8 KB/)).toBeInTheDocument());
  expect(screen.getByText(/2,592 lines or hidden characters required/)).toBeInTheDocument();
});

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
  vi.mocked(requestJson).mockImplementation(async (path) => path === "/api/jobs/text-tamper-tests" ? { id: "job" } as never : { status: "succeeded", phase: "complete", completed: 1, total: 1, cases: [scenario], result: { cases: [scenario] } } as never);
  render(<TextShowcase back={() => undefined} initialCarrier={new File(["carrier"], "carrier.txt")} initialRecovery={new File(["recovery"], "recovery.stegloc-text")} initialCode="code" initialPublicKey="public" />);
  fireEvent.click(screen.getByRole("button", { name: "Run text tamper tests" }));
  await waitFor(() => expect(screen.getByText("Verification explanation")).toBeInTheDocument());
  expect(screen.getByText("Verification stages")).toBeInTheDocument();
  expect(screen.getByText("Payload hash: match")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Ed25519 public key"), {target: {value: "different key"}});
  expect(screen.queryByText("Test results")).toBeNull();
  expect(screen.queryByRole("link", {name: "Download evidence ZIP"})).toBeNull();
});

it("ignores text tamper results returned after recovery inputs change", async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(requestJson).mockImplementation(async (path) => {
    if (path === "/api/session") return {} as never;
    if (path === "/api/jobs/text-tamper-tests") return {id: "job"} as never;
    return await new Promise((resolve) => { finish = resolve; });
  });
  render(<TextShowcase back={() => undefined} initialCarrier={new File(["carrier"], "carrier.txt")}
    initialRecovery={new File(["recovery"], "recovery.stegloc-text")} initialCode="old" initialPublicKey="public" />);
  fireEvent.click(screen.getByRole("button", {name: "Run text tamper tests"}));
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  fireEvent.change(screen.getByLabelText("Recovery code"), {target: {value: "new"}});
  await act(async () => { finish({status: "succeeded", phase: "complete", completed: 1, total: 1,
    cases: [], result: {cases: []}}); });
  expect(screen.queryByText("Test results")).toBeNull();
  expect(screen.getByRole("button", {name: "Run text tamper tests"})).toBeEnabled();
});

it("opens character evidence and marks hidden carrier characters", () => {
  render(<CharacterChanges before="A line" after={"A line \u200b\t"} method="zero-width" />);
  fireEvent.click(screen.getByRole("button", { name: /Character changes/ }));
  fireEvent.click(screen.getByRole("tab", { name: "Encoded carrier" }));
  expect(screen.getByLabelText("Encoded carrier")).toHaveTextContent("ZWSP");
  expect(screen.getByText("1 lines with trailing tabs")).toBeInTheDocument();
});
