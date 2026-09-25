// The five screens, walked through the real app.
//
// Deliberately small: three journeys and one shell check. Each screen is exercised as a person
// meets it, with the API stubbed and nothing asserted about markup or class names. The
// accessibility properties of the same screens live in a11y.test.tsx, and the logic behind them
// in logic.test.ts.

import { act, fireEvent, render, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { api, type VerifyStep } from "./api";
import * as jobs from "./api/jobs";
import { setFiles } from "./test/setup";
import { analysisExtras } from "./test/analysisFixture";

const IMAGE_INFO = {
  kind: "image" as const, format: "PNG", output_format: "PNG", descriptor: "RGB PNG 640x480",
  n_slots: 921600, lossy_source: false, width: 640, height: 480, mode: "RGB", file_size: 325000,
  header: { slot: 1673455, text: "pixel (466, 479), blue", x: 466, y: 479 },
  capacity: Array.from({ length: 8 }, (_, i) => ({ n_lsb: i + 1, max_package_bytes: 115134 * (i + 1) })),
};

const RECORD = {
  protocol: "stegloc/2", media_id: "3f2a91c4", timestamp: "2026-09-21 06:07:11 UTC", nonce: "9c1e77b0",
  team: "P1-4", signer_fingerprint: "c482b0ea7d1f4a90b5c6e83217d904af",
  cover: { type: "image", descriptor: "RGB PNG 640x480", filename: "harbour.png", sha256: "a".repeat(64) },
  payload: { filename: "message.txt", media_type: "text/plain", size: 132, sha256: "b".repeat(64) },
  embedding: { method: "LSB replacement", lsb_bits: 1, start_slot: "1673455", header_slot: "921080" },
  algorithms: { cipher: "AES-256-GCM" },
};

const VERIFY_STEPS: VerifyStep[] = [
  { id: "load", title: "Read stego file and public key", status: "passed", detail: "PNG, 1280 × 960" },
  { id: "header", title: "Find hidden header (1 LSB, end of cover)", status: "passed", detail: "Last 520 values" },
  { id: "unlock", title: "Decrypt start location with passphrase", status: "passed", detail: "The password is correct" },
  { id: "extract", title: "Extract payload bits (LSB decoding)", status: "passed", detail: "Read from start from header" },
  { id: "decrypt", title: "Decrypt and authenticate payload (AES-GCM)", status: "passed", detail: "Authenticated" },
  { id: "signature", title: "Verify RSA signature with public key", status: "passed", detail: "Signature matches" },
  { id: "payload_hash", title: "Recompute payload SHA-256", status: "passed", detail: "Matches the record" },
  { id: "cover_hash", title: "Recompute cover SHA-256", status: "passed", detail: "Matches the record" },
] satisfies VerifyStep[];

beforeEach(() => {
  // jsdom keeps window.location between tests, and navigate() ignores a path that is already
  // current, so start from a known URL or the first navigation silently does nothing.
  window.history.replaceState(null, "", "/keys");
  vi.spyOn(api, "inspect").mockResolvedValue(IMAGE_INFO);
  vi.spyOn(api, "estimate").mockResolvedValue({ package_bytes: 916 });
  vi.spyOn(api, "inspectKey").mockResolvedValue({ type: "private", encrypted: false, bits: 2048, fingerprint: "c482b0ea" });
  vi.spyOn(api, "generateKeys").mockResolvedValue({
    private_key: "-----BEGIN PRIVATE KEY-----\nk\n-----END PRIVATE KEY-----",
    public_key: "-----BEGIN PUBLIC KEY-----\nk\n-----END PUBLIC KEY-----",
    fingerprint: "c482b0ea7d1f4a90b5c6e83217d904af",
    bits: 2048,
  });
  vi.spyOn(api, "hide").mockResolvedValue({
    stego: { id: "s1", filename: "stego_harbour.png", media_type: "image/png", size: 1_204_200 },
    report: {
      cover: { ...IMAGE_INFO, filename: "harbour.png", file_size: 1_200_000 },
      stego_size: 1_204_200, size_unchanged: false, n_lsb: 1, start_mode: "auto",
      start: { slot: 1_673_455, text: "pixel (466, 479) channel B" },
      header: { slot: 921_080, text: "pixel (639, 479) channel B" },
      span_slots: 7328, package_bytes: 916, capacity_bytes: 115_134, capacity_used_percent: 0.8,
      bits_changed: 3664, slots_changed: 3664, psnr_db: 58.95, mse: 0.0008,
      record: RECORD, record_sha256: "c".repeat(64), signature_hex: "d".repeat(64),
      signer_fingerprint: RECORD.signer_fingerprint, salt_hex: "e".repeat(32),
      lecture_rows: [{ slot: 1_673_455, location: "pixel (466, 479) B", before: 104, after: 105, before_bin: "01101000", after_bin: "01101001", payload_bits: "1" }],
      steps: [{ title: "Read the cover" }],
    },
  });
  vi.spyOn(api, "verify").mockResolvedValue({
    verdict: "Authentic", summary: "All eight checks passed.",
    steps: VERIFY_STEPS,
    info: {}, record: RECORD, record_trusted: true,
    content: { id: "file-1", filename: "message.txt", media_type: "text/plain", size: 132, text: "Meet at the north gate at 19:00." },
  });
  vi.spyOn(api, "analyse").mockResolvedValue({
    ...analysisExtras,
    info: IMAGE_INFO, channel: 0, channel_names: ["Red", "Green", "Blue"], stride: 2,
    bit_planes: Array.from({ length: 8 }, (_, bit) => `data:image/png;base64,plane${bit}`),
    chi_square: Array.from({ length: 64 }, () => 0.99), chi_square_overall: 1,
    histograms: [Array.from({ length: 256 }, () => 1)], lsb_composite: "data:image/png;base64,x",
    compare: { slots_changed: 5204, bits_changed: 5204, max_difference: 1, psnr_db: 51.14, mse: 0.0012, changed_map: "data:image/png;base64,m", amplified: "data:image/png;base64,a" },
  });
  vi.spyOn(api, "attacks").mockResolvedValue({
    scenarios: [
      { id: "baseline", title: "Nothing changed", change: "The untouched file.", expected: ["Authentic"], verdict: "Authentic", summary: "Signature valid.", as_expected: true, file: null },
      { id: "flip_cover_bit", title: "One bit changed outside the hidden data", change: "Flip the lowest bit.", expected: ["Tampered"], verdict: "Tampered", summary: "Hashes differ.", as_expected: true, file: { id: "f1", filename: "harbour_flip.png", media_type: "image/png", size: 1200 } },
    ],
  });
});

/** The screen on show. Four of the five are mounted but hidden, so queries are scoped to this. */
function view(): HTMLElement {
  return document.querySelector<HTMLElement>(".main > div:not([hidden])")!;
}

/**
 * Clicks a sidebar link and waits for the screen to change.
 *
 * `linkName` matches the link, whose accessible name also carries the role subtitle, so a plain
 * string will not do. `heading` is the exact text of the screen's own heading.
 */
async function goTo(linkName: RegExp, heading: string) {
  const current = document.querySelector(".topbar h1")?.textContent ?? "";
  if (current === heading) return;
  const nav = document.querySelector<HTMLElement>("#rail-nav")!;
  fireEvent.click(within(nav).getByRole("link", { name: linkName }));
  await waitFor(() => expect(document.querySelector(".topbar h1")).toHaveTextContent(heading));
}

const SCREENS: [RegExp, string][] = [
  [/^Keys/, "Keys"],
  [/Embed & Sign/, "Embed & Sign"],
  [/Extract & Verify/, "Extract & Verify"],
  [/Text Steganography/, "Text Steganography"],
  [/Inspect a file/, "Inspect a file"],
  [/Tamper tests/, "Tamper tests"],
];

/** Waits for the named screen via its sidebar entry. */
function screenNamed(heading: string) {
  const match = SCREENS.find(([, name]) => name === heading);
  return goTo(match![0], match![1]);
}

/** Puts a file in the slot with the given label, the way the drop zone receives one. */
function pick(label: string, name: string, type = "image/png") {
  const slot = within(view()).getByText(label).closest(".slot") as HTMLElement;
  const input = slot.querySelector<HTMLInputElement>('input[type="file"]')!;
  setFiles(input, new File([new Uint8Array(64)], name, { type }));
  fireEvent.change(input);
}

/**
 * Renders the app with a key pair already in the vault.
 *
 * The sender screen needs a signing key and blocks the action until one exists, so a test of
 * embedding has to go through Keys first — which is the journey the plan describes anyway.
 */
async function appWithKeys() {
  render(<App />);
  fireEvent.click(within(view()).getByRole("button", { name: /Generate key pair/ }));
  await waitFor(() => expect(within(view()).getByRole("button", { name: /Save both keys/ })).toBeInTheDocument());
}

it("offers the six active destinations, each with its own heading", async () => {
  render(<App />);
  for (const [linkName, heading] of SCREENS) {
    await goTo(linkName, heading);
    expect(document.querySelector(".topbar h1")).toHaveTextContent(heading);
  }
  // Screens stay mounted so a file and a password survive the walk between them.
  expect(document.querySelectorAll(".main > div")).toHaveLength(6);
  expect(document.querySelector('#rail-nav a[href="/v2"]')).toBeNull();
});

it("keys: generates a pair, then guards replacing it", async () => {
  render(<App />);
  fireEvent.click(within(view()).getByRole("button", { name: /Generate key pair/ }));
  await waitFor(() => expect(within(view()).getByRole("button", { name: /Save both keys/ })).toBeInTheDocument());

  vi.mocked(api.generateKeys).mockClear();
  fireEvent.click(within(view()).getByRole("button", { name: /Replace key pair/ }));
  // The consequence is spelled out before anything is thrown away.
  expect(within(view()).getByRole("dialog")).toHaveTextContent(/stop passing the check/i);
  fireEvent.click(within(view()).getByRole("button", { name: /Keep the current pair/ }));
  expect(api.generateKeys).not.toHaveBeenCalled();
});

it("sender: blocks until it has what it needs, then embeds and offers the download", async () => {
  await appWithKeys();
  await screenNamed("Embed & Sign");
  // It asks for the cover first, and would still ask for the signing key it now has.
  expect(view().querySelector(".action-why")).toHaveTextContent("a picture or WAV to hide it in");

  pick("Cover file", "harbour.png");
  await waitFor(() => expect(within(view()).getByText("places to hide bits")).toBeInTheDocument());
  fireEvent.change(within(view()).getByLabelText("Message"), { target: { value: "Meet at the north gate." } });
  fireEvent.change(within(view()).getByLabelText("Shared password"), { target: { value: "hunter2hunter2" } });

  fireEvent.click(within(view()).getByRole("button", { name: /Embed & sign/ }));

  // The result replaces the form, and its one primary button is the download.
  await waitFor(() => expect(within(view()).getByRole("heading", { name: "File protected" })).toBeInTheDocument());
  expect(view().querySelector(".action-bar")).toBeNull();
  const primaries = view().querySelectorAll(".btn.primary");
  expect(primaries).toHaveLength(1);
  expect(primaries[0]).toHaveAttribute("download", "stego_harbour.png");
});

it("keeps the embedded file across receiving, inspection and tamper screens until cleared", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(new Blob([new Uint8Array(64)], {type: "image/png"}), {status: 200}));
  await appWithKeys();
  await screenNamed("Embed & Sign");
  pick("Cover file", "harbour.png");
  await waitFor(() => expect(within(view()).getByText("places to hide bits")).toBeInTheDocument());
  fireEvent.change(within(view()).getByLabelText("Message"), {target: {value: "Exact message"}});
  fireEvent.change(within(view()).getByLabelText("Shared password"), {target: {value: "session password"}});
  fireEvent.click(within(view()).getByRole("button", {name: /Embed & sign/}));
  await waitFor(() => expect(document.querySelector(".working-strip")).toHaveTextContent("stego_harbour.png"));
  await screenNamed("Extract & Verify");
  expect(within(view()).getByText("stego_harbour.png")).toBeInTheDocument();
  await waitFor(() => expect(within(view()).getByLabelText("Shared password")).toHaveValue("session password"));
  await screenNamed("Inspect a file");
  expect(within(view()).getByText("stego_harbour.png")).toBeInTheDocument();
  await screenNamed("Tamper tests");
  expect(within(view()).getByText("stego_harbour.png")).toBeInTheDocument();
  fireEvent.click(within(document.querySelector(".working-strip") as HTMLElement).getByRole("button", {name: "Clear workspace"}));
  await waitFor(() => expect(document.querySelector(".working-strip")).toBeNull());
  expect(within(view()).queryByText("stego_harbour.png")).toBeNull();
});

it("restores the latest embed result from the sidebar and keeps its download after Edit", async () => {
  await appWithKeys();
  await screenNamed("Embed & Sign");
  pick("Cover file", "harbour.png");
  await waitFor(() => expect(within(view()).getByText("places to hide bits")).toBeInTheDocument());
  fireEvent.change(within(view()).getByLabelText("Message"), {target: {value: "hello"}});
  fireEvent.change(within(view()).getByLabelText("Shared password"), {target: {value: "password"}});
  fireEvent.click(within(view()).getByRole("button", {name: /Embed & sign/}));
  await waitFor(() => expect(window.location.pathname).toBe("/embed/result"));
  await screenNamed("Keys");
  await screenNamed("Embed & Sign");
  expect(window.location.pathname).toBe("/embed/result");
  expect(within(view()).getByRole("link", {name: /Download stego_harbour.png/})).toHaveAttribute("download", "stego_harbour.png");
  fireEvent.click(within(view()).getByRole("button", {name: /Edit/}));
  await waitFor(() => expect(window.location.pathname).toBe("/embed"));
  expect(within(view()).getByRole("link", {name: /Download stego_harbour.png/})).toBeInTheDocument();
  act(() => { window.history.pushState(null, "", "/embed/result"); window.dispatchEvent(new PopStateEvent("popstate")); });
  await waitFor(() => expect(within(view()).getByRole("heading", {name: "File protected"})).toBeInTheDocument());
  act(() => { window.history.pushState(null, "", "/embed"); window.dispatchEvent(new PopStateEvent("popstate")); });
  await waitFor(() => expect(within(view()).getByLabelText("Message")).toBeInTheDocument());
});

it("finishing an embed while another screen is active does not change that screen", async () => {
  let finish!: (value: Awaited<ReturnType<typeof api.hide>>) => void;
  const original = await vi.mocked(api.hide).getMockImplementation()?.(new FormData());
  if (!original) throw new Error("missing hide mock");
  vi.mocked(api.hide).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  await appWithKeys();
  await screenNamed("Embed & Sign");
  pick("Cover file", "harbour.png");
  await waitFor(() => expect(within(view()).getByText("places to hide bits")).toBeInTheDocument());
  fireEvent.change(within(view()).getByLabelText("Message"), {target: {value: "hello"}});
  fireEvent.change(within(view()).getByLabelText("Shared password"), {target: {value: "password"}});
  fireEvent.click(within(view()).getByRole("button", {name: /Embed & sign/}));
  await screenNamed("Keys");
  finish(original);
  await waitFor(() => expect(api.hide).toHaveBeenCalled());
  expect(window.location.pathname).toBe("/keys");
  await screenNamed("Embed & Sign");
  await waitFor(() => expect(window.location.pathname).toBe("/embed/result"));
});

it("sends DCT selection and shows the method-specific PNG result", async () => {
  vi.mocked(api.inspect).mockResolvedValue({...IMAGE_INFO, dct: {n_slots: 14_400, max_package_bytes: 1671}});
  const response = await vi.mocked(api.hide).getMockImplementation()?.(new FormData());
  if (!response) throw new Error("missing hide mock");
  vi.mocked(api.hide).mockResolvedValue({...response, report: {...response.report, method: "dct",
    coverage: {protected_rgb_values: 1000, total_rgb_values: 3000, alpha_values: 0, description: "non-embedding pixels"}}});
  await appWithKeys();
  await screenNamed("Embed & Sign");
  pick("Cover file", "harbour.png");
  await waitFor(() => expect(within(view()).getByRole("button", {name: "DCT · lossless PNG"})).toBeInTheDocument());
  fireEvent.click(within(view()).getByRole("button", {name: "DCT · lossless PNG"}));
  fireEvent.change(within(view()).getByLabelText("Message"), {target: {value: "hello"}});
  fireEvent.change(within(view()).getByLabelText("Shared password"), {target: {value: "password"}});
  await waitFor(() => expect(api.estimate).toHaveBeenCalledWith(expect.objectContaining({method: "dct"})));
  expect(within(view()).queryByText(/Bits per/)).not.toBeInTheDocument();
  fireEvent.click(within(view()).getByRole("button", {name: /Embed & sign/}));
  await waitFor(() => expect(within(view()).getByRole("heading", {name: "DCT image protected"})).toBeInTheDocument());
  expect(vi.mocked(api.hide).mock.calls.at(-1)?.[0].get("method")).toBe("dct");
  expect(within(view()).getByRole("link", {name: "Download protected PNG"})).toHaveAttribute("download", "stego_harbour.png");
});

it("keeps text work independent of the media working file", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(new Blob([new Uint8Array(64)], {type: "image/png"}), {status: 200}));
  await appWithKeys();
  await screenNamed("Embed & Sign");
  pick("Cover file", "harbour.png");
  await waitFor(() => expect(within(view()).getByText("places to hide bits")).toBeInTheDocument());
  fireEvent.change(within(view()).getByLabelText("Message"), {target: {value: "hello"}});
  fireEvent.change(within(view()).getByLabelText("Shared password"), {target: {value: "password"}});
  fireEvent.click(within(view()).getByRole("button", {name: /Embed & sign/}));
  await waitFor(() => expect(document.querySelector(".working-strip")).toHaveTextContent("stego_harbour.png"));
  await screenNamed("Text Steganography");
  await waitFor(() => expect(document.querySelector(".working-strip")).toBeNull());
  fireEvent.change(within(view()).getByLabelText("Message to hide"), {target: {value: "text stays"}});
  await screenNamed("Embed & Sign");
  fireEvent.click(within(document.querySelector(".working-strip") as HTMLElement).getByRole("button", {name: "Clear workspace"}));
  await screenNamed("Text Steganography");
  expect(within(view()).getByLabelText("Message to hide")).toHaveValue("text stays");
});

it("keeps the video inline workflow on an embed result URL without an RSA result", async () => {
  await appWithKeys();
  await screenNamed("Embed & Sign");
  const bytes = new Uint8Array(16);
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  bytes.set(new TextEncoder().encode("AVI "), 8);
  const slot = within(view()).getByText("Cover file").closest(".slot") as HTMLElement;
  const input = slot.querySelector<HTMLInputElement>('input[type="file"]')!;
  setFiles(input, new File([bytes], "clip.avi", {type: "video/x-msvideo"}));
  fireEvent.change(input);
  await waitFor(() => expect(within(view()).getByRole("heading", {name: "Lossless video carrier"})).toBeInTheDocument());
  act(() => { window.history.pushState(null, "", "/embed/result"); window.dispatchEvent(new PopStateEvent("popstate")); });
  await waitFor(() => expect(window.location.pathname).toBe("/embed/result"));
  expect(within(view()).getByRole("heading", {name: "Lossless video carrier"})).toBeInTheDocument();
});

it("sender: says so when the payload will not fit, and offers the ways out", async () => {
  vi.spyOn(api, "estimate").mockResolvedValue({ package_bytes: 922757 });
  await appWithKeys();
  await screenNamed("Embed & Sign");
  pick("Cover file", "harbour.png");
  await waitFor(() => expect(within(view()).getByText("places to hide bits")).toBeInTheDocument());
  fireEvent.click(within(view()).getByRole("button", { name: "long" }));

  await waitFor(() => expect(within(view()).getByText(/It needs 922,757 bytes and this cover holds 115,134 bytes/)).toBeInTheDocument());
  expect(view().querySelector(".action-why")).toHaveTextContent("something small enough to fit in this cover");
  for (const label of ["Choose a larger cover", "Choose something smaller", "Use more bits per value"]) {
    expect(within(view()).getByRole("button", { name: label })).toBeInTheDocument();
  }
});

it("receiver: reads the message, and reading the override panel does not arm it", async () => {
  await appWithKeys();
  await screenNamed("Extract & Verify");
  pick("File to check", "stego_harbour.png");
  await waitFor(() => expect(within(view()).getByText("places to look in")).toBeInTheDocument());

  fireEvent.change(within(view()).getByLabelText("Shared password"), { target: { value: "hunter2hunter2" } });

  // Opening the panel must not turn the override on: this was the worst trap in the audit.
  const summary = within(view()).getByRole("button", { name: /Look in a specific place instead/ });
  fireEvent.click(summary);
  expect(summary).toHaveTextContent("off");

  fireEvent.click(within(view()).getByRole("button", { name: /Check file/ }));
  await waitFor(() => expect(api.verify).toHaveBeenCalled());
  expect(vi.mocked(api.verify).mock.calls[0][0].get("start_x")).toBeNull();

  await waitFor(() => expect(view().querySelector(".extracted-text")).toHaveTextContent("Meet at the north gate at 19:00."));
  expect(within(view()).getByText(/matches your key/)).toBeInTheDocument();
});

it("receiver: a failure names the check, and editing an input marks the verdict out of date", async () => {
  vi.mocked(api.verify).mockResolvedValue({
    verdict: "Cannot Verify", summary: "AES-256-GCM rejected the data.",
    steps: [
      ...VERIFY_STEPS.slice(0, 2),
      { id: "unlock", title: "Decrypt start location with passphrase", status: "failed", detail: "AES-256-GCM rejected the data." },
      ...VERIFY_STEPS.slice(3).map((s) => ({ ...s, status: "skipped" as const, detail: "" })),
    ],
    info: {}, record: null, record_trusted: false, content: null,
  });
  await appWithKeys();
  await screenNamed("Extract & Verify");
  pick("File to check", "stego_harbour.png");
  await waitFor(() => expect(within(view()).getByText("places to look in")).toBeInTheDocument());
  fireEvent.change(within(view()).getByLabelText("Shared password"), { target: { value: "hunter2hunter2" } });
  fireEvent.click(within(view()).getByRole("button", { name: /Check file/ }));

  await waitFor(() => expect(view().querySelector(".outcome")).toHaveTextContent("Cannot check this file"));
  expect(within(view()).getByText(/The check that stopped it was/)).toBeInTheDocument();

  // The field to retype is in the failure card, and changing it marks the verdict stale rather
  // than silently keeping or clearing it.
  const card = view().querySelector(".panel.recovery") as HTMLElement;
  expect(card.querySelector("input[type='password']")).not.toBeNull();
  fireEvent.change(within(card).getByLabelText("Shared password"), { target: { value: "different" } });
  expect(within(view()).getByText(/This result is out of date/)).toBeInTheDocument();
});

it("detects an independently uploaded DCT PNG and reports its partial integrity scope", async () => {
  vi.mocked(api.inspect).mockResolvedValue({...IMAGE_INFO, embedding_method: "dct",
    dct: {n_slots: 14_400, max_package_bytes: 1671}});
  vi.mocked(api.verify).mockResolvedValue({
    verdict: "Authentic", summary: "Signature and payload authentication valid; non-embedding pixels match.",
    steps: VERIFY_STEPS,
    info: {method: "dct", coverage: {protected_rgb_values: 1000, total_rgb_values: 3000,
      alpha_values: 0, description: "non-embedding pixels"}},
    record: {...RECORD, embedding: {...RECORD.embedding, method: "DCT", version: 1}},
    record_trusted: true,
    content: {id: "file-1", filename: "message.txt", media_type: "text/plain", size: 5, text: "hello"},
  });
  await appWithKeys();
  await screenNamed("Extract & Verify");
  pick("File to check", "received.png");
  await waitFor(() => expect(within(view()).getByText("places to look in")).toBeInTheDocument());
  expect(within(view()).queryByRole("button", {name: /Look in a specific place/})).toBeNull();
  fireEvent.change(within(view()).getByLabelText("Shared password"), {target: {value: "password"}});
  fireEvent.click(within(view()).getByRole("button", {name: /Check file/}));
  await waitFor(() => expect(within(view()).getByRole("heading", {name: "DCT integrity scope"})).toBeInTheDocument());
  expect(within(view()).getByText(/Pixel edits inside embedding blocks can go undetected/)).toBeInTheDocument();
  expect(vi.mocked(api.verify).mock.calls.at(-1)?.[0].get("start_slot")).toBeNull();
});

it("analyst: reports a reading, not a certainty, and re-runs on a channel change", async () => {
  render(<App />);
  await screenNamed("Inspect a file");
  expect(view().querySelector(".action-why")).toHaveTextContent("a file to inspect");

  pick("File to inspect", "suspect.png");
  fireEvent.click(within(view()).getByRole("button", { name: /Inspect file/ }));
  await waitFor(() => expect(view().querySelector(".outcome")).toBeInTheDocument());
  expect(view().querySelector(".outcome")).toHaveTextContent("Reading of the evidence");
  expect(within(view()).getByText(/cannot establish embedding or authenticity/)).toBeInTheDocument();

  vi.mocked(api.analyse).mockClear();
  fireEvent.click(within(view()).getByRole("button", { name: "Green" }));
  await waitFor(() => expect(api.analyse).toHaveBeenCalled());
  expect(vi.mocked(api.analyse).mock.calls[0][0].get("channel")).toBe("1");
});

it("tester: leads with the count and keeps every damaged file downloadable", async () => {
  const cases = (await vi.mocked(api.attacks)(new FormData())).scenarios;
  vi.spyOn(jobs, "requestJson").mockImplementation(async (path) => {
    if (path === "/api/v2/session") return {status: "ready"} as never;
    if (path === "/api/v4/jobs/showcase") return {id: "job1"} as never;
    return {status: "succeeded", phase: "complete", total: cases.length, cases, result: {cases}} as never;
  });
  await appWithKeys();
  await screenNamed("Tamper tests");
  pick("Protected file", "stego_harbour.png");
  fireEvent.change(within(view()).getByLabelText("Shared password"), { target: { value: "hunter2hunter2" } });
  fireEvent.click(within(view()).getByRole("button", { name: /Run tamper tests/ }));

  await waitFor(() => expect(view().querySelector(".outcome")).toHaveTextContent("2 of 2 applicable cases behaved correctly"));
  expect(within(view()).getAllByText("as expected")).toHaveLength(2);
  expect(within(view()).getByRole("link", { name: /Save harbour_flip.png/ })).toBeInTheDocument();
  expect(within(view()).getByText("file unchanged")).toBeInTheDocument();
  expect(within(view()).getAllByText(/Expected:/)).toHaveLength(2);
});
