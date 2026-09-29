import { useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import * as jobs from "../api/jobs";
import * as util from "../util";
import { setFiles } from "../test/setup";
import { VideoEmbed, VideoVerify } from "./VideoWorkflow";

it("uses the uploaded MP4 as the carrier without offering AVI and lets the user clear it", () => {
  const source = new File(["mp4"], "source.mp4", {type: "video/mp4"});
  const clear = vi.fn();
  render(<VideoEmbed cover={source} source={source} onHandoff={() => undefined} goTo={() => undefined}
    showResult={false} onShowResult={() => undefined} onCoverFile={clear} />);
  expect(screen.getByRole("heading", {name: "Original video carrier"})).toBeInTheDocument();
  expect(screen.getAllByText("source.mp4").length).toBeGreaterThan(0);
  expect(screen.queryByRole("button", {name: /Prepare.*AVI/})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", {name: "Remove source.mp4"}));
  expect(clear).toHaveBeenCalledWith(null);
});

it("uses the image cover's accessible bit picker for video", () => {
  render(<VideoEmbed cover={new File(["mp4"], "source.mp4")} source={null} onHandoff={() => undefined} goTo={() => undefined}
    showResult={false} onShowResult={() => undefined} />);
  const choices = screen.getAllByRole("radio", {name: /^[1-8]$/});
  expect(choices).toHaveLength(8);
  expect(choices[2]).toHaveAttribute("aria-checked", "true");
  expect(screen.getByLabelText("Lowest 3 bits replaced")).toBeInTheDocument();
  fireEvent.click(choices[4]);
  expect(choices[4]).toHaveAttribute("aria-checked", "true");
  expect(screen.getByLabelText("Lowest 5 bits replaced")).toBeInTheDocument();
  expect(screen.getByText(/past 3 changes to the video frames can become visible/)).toBeInTheDocument();
  fireEvent.keyDown(choices[4], {key: "ArrowLeft"});
  expect(choices[3]).toHaveFocus();
  expect(choices[3]).toHaveAttribute("aria-checked", "true");
});

it("can clear a prepared AVI without clearing its source video", () => {
  const source = new File(["mp4"], "source.mp4");
  const prepared = new File(["avi"], "prepared.avi");
  const clearPrepared = vi.fn();
  render(<VideoEmbed cover={prepared} source={source} onHandoff={() => undefined} goTo={() => undefined}
    showResult={false} onShowResult={() => undefined} onCoverFile={() => undefined}
    onChooseAvi={clearPrepared} />);
  fireEvent.click(screen.getByRole("button", {name: "Clear prepared AVI"}));
  expect(clearPrepared).toHaveBeenCalledOnce();
});

it("offers AVI preparation if a native container cannot be decoded", async () => {
  vi.spyOn(jobs, "requestJson").mockRejectedValue(new Error("Decoded video exceeds 512 MiB"));
  const prepareAvi = vi.fn();
  render(<VideoEmbed cover={new File(["webm"], "source.webm")} source={null} onHandoff={() => undefined} goTo={() => undefined}
    showResult={false} onShowResult={() => undefined} onChooseAvi={prepareAvi} />);
  const input = screen.getByText("File to hide").closest(".slot")!.querySelector<HTMLInputElement>('input[type="file"]')!;
  setFiles(input, new File(["message"], "message.txt"));
  fireEvent.change(input);
  fireEvent.click(await screen.findByRole("button", {name: "Prepare AVI for this video"}));
  expect(prepareAvi).toHaveBeenCalledOnce();
});

it("shows the AVI result separately and downloads its recovery code", async () => {
  const recoveryCode = "separate-recovery-code";
  vi.spyOn(jobs, "requestJson").mockImplementation(async (path) => {
    if (path === "/api/v2/estimate") return {total_bytes: 200, maximum_message_bytes: 1000, fits_at_selected_start: true} as never;
    if (path === "/api/v2/keys/generate") return {private_key: "private", public_key: "public"} as never;
    if (path === "/api/v2/jobs/protect") return {id: "job"} as never;
    return {} as never;
  });
  vi.spyOn(jobs, "pollJob").mockResolvedValue({
    carrier: {id: "avi", filename: "protected.avi", size: 1000},
    recovery: {id: "recovery", filename: "recovery.stegloc", size: 100},
    recovery_code: recoveryCode,
    payload_hash: {algorithm: "SHA-256", scope: "payload", expected: "a", computed: "a", status: "match", expected_trusted: true},
    record: {content: {sha256: "a"}},
  } as never);
  const download = vi.spyOn(util, "downloadText");
  vi.spyOn(globalThis, "fetch").mockResolvedValue({ok: true, blob: async () => new Blob(["data"])} as Response);
  const cover = new File(["avi"], "cover.avi");
  const handoff = vi.fn();
  const goTo = vi.fn();
  function Page() {
    const [showResult, setShowResult] = useState(false);
    return <VideoEmbed cover={cover} source={null} onHandoff={handoff} goTo={goTo}
      showResult={showResult} onShowResult={setShowResult} />;
  }
  render(<Page />);

  const input = screen.getByText("File to hide").closest(".slot")!.querySelector<HTMLInputElement>('input[type="file"]')!;
  setFiles(input, new File(["payload"], "message.txt"));
  fireEvent.change(input);
  await waitFor(() => expect(screen.getByText(/Fits/)).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText("Key password"), {target: {value: "secret"}});
  fireEvent.click(screen.getByRole("button", {name: "Generate video key pair"}));
  await waitFor(() => expect(screen.getByLabelText("Private key")).toHaveValue("private"));
  fireEvent.click(screen.getByRole("button", {name: "Embed in AVI"}));
  await waitFor(() => expect(screen.getByRole("heading", {name: "Video protected"})).toBeInTheDocument());
  expect(handoff).toHaveBeenCalledWith(expect.objectContaining({
    protocol: "v2-video", recoveryCode, publicPem: "public",
    stego: expect.objectContaining({name: "protected.avi"}),
    recovery: expect.objectContaining({name: "recovery.stegloc"}),
  }));
  expect(screen.queryByRole("heading", {name: "Choose what to hide"})).toBeNull();
  expect(screen.getByRole("link", {name: /Download protected AVI/})).toHaveAttribute("download", "protected.avi");
  fireEvent.click(screen.getByRole("button", {name: "Download recovery code"}));
  expect(download).toHaveBeenCalledWith("stegloc-recovery-code.txt", recoveryCode);
  expect(screen.getByLabelText("Recovery code (share separately)").closest(".field")).toBeInTheDocument();
  for (const [label, page] of [["Verify it as the receiver would", "verify"], ["Inspect it for traces", "analyse"], ["Run the tamper tests", "attacks"]] as const) {
    fireEvent.click(screen.getByRole("button", {name: label}));
    expect(goTo).toHaveBeenLastCalledWith(page);
  }
  fireEvent.click(screen.getByRole("button", {name: "Edit and run again"}));
  expect(screen.getByRole("heading", {name: "Choose what to hide"})).toBeInTheDocument();
});

it("clears an AVI verification when its recovery code changes mid-request", async () => {
  let finish!: (value: never) => void;
  const pending = new Promise<never>((resolve) => { finish = resolve; });
  vi.spyOn(jobs, "requestJson").mockImplementation((path) => path === "/api/v2/session"
    ? Promise.resolve({status: "ready"} as never) : pending);
  render(<VideoVerify showResult={false} onShowResult={() => undefined} handoff={{id: "1", protocol: "v2-video", stego: new File(["avi"], "protected.avi"), cover: null,
    recovery: new File(["recovery"], "recovery.stegloc"), recoveryCode: "first",
    publicPem: "public key", passphrase: "", serial: 1}} />);

  fireEvent.click(screen.getByRole("button", {name: "Extract and verify"}));
  await waitFor(() => expect(jobs.requestJson).toHaveBeenCalledWith("/api/v4/video/verify", expect.anything()));
  fireEvent.change(screen.getByLabelText("Recovery code"), {target: {value: "second"}});
  expect(screen.queryByText("Verifying video")).toBeNull();
  expect(screen.getByRole("button", {name: "Extract and verify"})).toBeEnabled();

  await act(async () => {finish({verdict: "Authentic", stages: {}, content: null, payload_hash: {}} as never);});
  expect(screen.queryByRole("heading", {name: "This file is genuine"})).toBeNull();
});

it("loads a recovery code file and verifies the AVI with its contents", async () => {
  vi.spyOn(jobs, "requestJson").mockImplementation(async (path) => path === "/api/v4/video/verify"
    ? {verdict: "Authentic", stages: {signature: {status: "passed", evidence: "valid", reason: ""}},
      content: null, payload_hash: {algorithm: "SHA-256", scope: "payload", expected: "a", computed: "a", status: "match", expected_trusted: true}} as never
    : {} as never);
  const handoff = {id: "file", protocol: "v2-video" as const, stego: new File(["avi"], "protected.avi"), cover: null,
    recovery: new File(["recovery"], "recovery.stegloc"), recoveryCode: "",
    publicPem: "public key", passphrase: "", serial: 1};
  function Page() {
    const [showResult, setShowResult] = useState(false);
    return <VideoVerify handoff={handoff} showResult={showResult} onShowResult={setShowResult} />;
  }
  render(<Page />);
  const input = screen.getByText("Recovery code file").closest(".slot")!.querySelector<HTMLInputElement>('input[type="file"]')!;
  setFiles(input, Object.assign(new File([" code from file \n"], "stegloc-recovery-code.txt"), {
    text: async () => " code from file \n",
  }));
  fireEvent.change(input);
  await waitFor(() => expect(screen.getByLabelText("Recovery code")).toHaveValue("code from file"));
  expect(screen.getByLabelText("Recovery code").closest(".field")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", {name: "Extract and verify"}));
  await waitFor(() => expect(screen.getByRole("heading", {name: "This file is genuine"})).toBeInTheDocument());
  const submitted = vi.mocked(jobs.requestJson).mock.calls.find(([path]) => path === "/api/v4/video/verify")?.[1]?.body as FormData;
  expect(submitted.get("recovery_code")).toBe("code from file");
  expect(screen.getByRole("button", {name: /What was checked/})).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", {name: "Change and check again"}));
  expect(screen.getByRole("heading", {name: "What you need to open it"})).toBeInTheDocument();
});

it("keeps a typed code when an earlier recovery-code file finishes reading", async () => {
  let finish!: (value: string) => void;
  render(<VideoVerify showResult={false} onShowResult={() => undefined} handoff={{id: "manual", origin: "manual",
    stego: new File(["avi"], "protected.avi"), cover: null, recoveryCode: "",
    publicPem: "RSA key from Keys", passphrase: "", serial: 1}} />);
  expect(screen.getByLabelText("Sender's Ed25519 public key")).toHaveValue("");
  const input = screen.getByText("Recovery code file").closest(".slot")!.querySelector<HTMLInputElement>('input[type="file"]')!;
  setFiles(input, Object.assign(new File(["old"], "old-code.txt"), {
    text: () => new Promise<string>((resolve) => {finish = resolve;}),
  }));
  fireEvent.change(input);
  fireEvent.change(screen.getByLabelText("Recovery code"), {target: {value: "typed code"}});
  await act(async () => finish("old code"));
  expect(screen.getByLabelText("Recovery code")).toHaveValue("typed code");
  expect(screen.getByText("Drop stegloc-recovery-code.txt")).toBeInTheDocument();
});
