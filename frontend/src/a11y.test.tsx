import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { api, type Analysis, type CoverInfo, type HideResponse, type Scenario, type VerifyResponse } from "./api";
import { setFiles } from "./test/setup";
import { AnalysePage } from "./pages/AnalysePage";
import { AttackPage } from "./pages/AttackPage";
import { HidePage } from "./pages/HidePage";
import { VerifyPage } from "./pages/VerifyPage";
import type { Vault } from "./util";

const VAULT: Vault = {
  privatePem: "-----BEGIN PRIVATE KEY-----\nk\n-----END PRIVATE KEY-----",
  publicPem: "-----BEGIN PUBLIC KEY-----\nk\n-----END PUBLIC KEY-----",
  privateFingerprint: "c482b0ea7d1f4a90b5c6e83217d904af",
  publicFingerprint: "c482b0ea7d1f4a90b5c6e83217d904af",
  bits: 2048,
};

const IMAGE_INFO: CoverInfo = {
  kind: "image", format: "PNG", output_format: "PNG", descriptor: "RGB PNG 640x480",
  n_slots: 921600, lossy_source: false, width: 640, height: 480, mode: "RGB", file_size: 325000,
  header: { slot: 1673455, text: "pixel (466, 479), blue", x: 466, y: 479 },
  capacity: Array.from({ length: 8 }, (_, i) => ({ n_lsb: i + 1, max_package_bytes: 115134 * (i + 1) })),
};

const ANALYSIS: Analysis = {
  info: IMAGE_INFO, channel: 0, channel_names: ["Red", "Green", "Blue"], stride: 2,
  bit_planes: Array.from({ length: 8 }, () => "data:image/png;base64,x"),
  chi_square: Array.from({ length: 8 }, () => 0.2), chi_square_overall: 0.01,
  histograms: [Array.from({ length: 256 }, () => 1)], lsb_composite: null,
  compare: { slots_changed: 10, bits_changed: 10, max_difference: 1, psnr_db: 50, mse: 0.001,
    changed_map: "data:image/png;base64,x", amplified: "data:image/png;base64,y" },
};

const VERIFY: VerifyResponse = {
  verdict: "Authentic", summary: "ok",
  steps: [{ id: "load", title: "Read stego file and public key", status: "passed", detail: "PNG" }],
  info: {}, record: null, record_trusted: false, content: null,
};

const HIDE: HideResponse = {
  stego: { id: "s1", filename: "stego.png", media_type: "image/png", size: 400 },
  report: {
    cover: IMAGE_INFO, stego_size: 400, size_unchanged: false, n_lsb: 1, start_mode: "auto",
    start: { slot: 10, text: "pixel (1, 1)" }, header: { slot: 20, text: "last 520 values" },
    span_slots: 100, package_bytes: 300, capacity_bytes: 1000, capacity_used_percent: 30,
    bits_changed: 100, slots_changed: 100, psnr_db: 51, mse: 0.001,
    record: {
      protocol: "stegloc/2", media_id: "m1", timestamp: "now", nonce: "n1", team: "", signer_fingerprint: "f1",
      cover: { type: "image", descriptor: "PNG", filename: "cover.png", sha256: "a" },
      payload: { filename: "message.txt", media_type: "text/plain", size: 10, sha256: "b" },
      embedding: { method: "LSB", lsb_bits: 1, start_slot: "10", header_slot: "20" }, algorithms: {},
    },
    record_sha256: "c", signature_hex: "d", signer_fingerprint: "f1", salt_hex: "e",
    lecture_rows: [], steps: [{ title: "Read the cover" }],
  },
};

const SCENARIOS: Scenario[] = [{
  id: "baseline", title: "Nothing changed", change: "The untouched file.", expected: ["Authentic"],
  verdict: "Authentic", summary: "reason", as_expected: true, file: null,
}];

/** Every heading on screen, in document order, from the visible page only. */
function headingLevels(root: ParentNode): number[] {
  return Array.from(root.querySelectorAll("h1, h2, h3, h4, h5, h6"))
    .filter((node) => !node.closest("[hidden]"))
    .map((node) => Number(node.tagName.slice(1)));
}

/** A page must never jump from one heading level to a level two or more deeper. */
function expectNoSkippedLevels(levels: number[]) {
  for (let i = 1; i < levels.length; i++) {
    expect(levels[i] - levels[i - 1], `heading level jumped from h${levels[i - 1]} to h${levels[i]}`)
      .toBeLessThanOrEqual(1);
  }
}

beforeEach(() => {
  vi.spyOn(api, "inspect").mockResolvedValue(IMAGE_INFO);
  vi.spyOn(api, "estimate").mockResolvedValue({ package_bytes: 916 });
  vi.spyOn(api, "inspectKey").mockResolvedValue({ type: "private", encrypted: false, bits: 2048, fingerprint: "f" });
  vi.spyOn(api, "verify").mockResolvedValue(VERIFY);
  vi.spyOn(api, "analyse").mockResolvedValue(ANALYSIS);
  vi.spyOn(api, "attacks").mockResolvedValue({ scenarios: SCENARIOS });
  vi.spyOn(api, "hide").mockResolvedValue(HIDE);
});

describe("application shell", () => {
  it("marks exactly one nav item current, and marks it on the screen on show", () => {
    render(<App />);
    const current = document.querySelectorAll('#rail-nav a[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0].textContent).toContain("Keys");
  });

  it("keeps the shell's headings in order", () => {
    render(<App />);
    expectNoSkippedLevels(headingLevels(document.body));
    expect(headingLevels(document.body)[0]).toBe(1);
  });

  it("never leaves a stray text node directly inside main", () => {
    // The audit reported a bare "⇆" inside <main>. It comes from .compare-handle span::before,
    // which is a pseudo-element and creates no node. This asserts that: any direct text child of
    // main would be found here, and there are none.
    render(<App />);
    const main = document.querySelector(".main")!;
    const bare = Array.from(main.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim() !== "");
    expect(bare.map((node) => node.textContent)).toEqual([]);
  });

  it("keeps the ⇆ glyph out of the DOM even with the compare slider on screen", () => {
    render(<App />);
    // The glyph is drawn by CSS content only. If it ever became real text it would show up here.
    expect(document.body.textContent).not.toContain("⇆");
  });
});

describe("every screen — labels, busy state and heading order", () => {
  it("Keys", () => {
    render(<App />);
    expectNoSkippedLevels(headingLevels(document.body));
    for (const input of Array.from(document.querySelectorAll<HTMLInputElement>(".main input:not([type=file]):not([hidden])"))) {
      if (input.closest("[hidden]")) continue;
      const labelled = input.id && document.querySelector(`label[for="${input.id}"]`);
      expect(labelled, `input ${input.id || "(no id)"} has no label`).toBeTruthy();
    }
  });

  it("Embed & Sign, including the result", async () => {
    function Harness() {
      const [showResult, setShowResult] = [false, () => undefined] as const;
      return <HidePage vault={VAULT} onHandoff={() => undefined} goTo={() => undefined} showResult={showResult} onShowResult={() => undefined} />;
    }
    render(<Harness />);
    expectNoSkippedLevels(headingLevels(document.body));

    const input = document.querySelectorAll<HTMLInputElement>('input[type="file"]')[0];
    setFiles(input, new File([new Uint8Array(8)], "cover.png", { type: "image/png" }));
    fireEvent.change(input);
    await waitFor(() => expect(screen.getByText("places to hide bits")).toBeInTheDocument());
    expectNoSkippedLevels(headingLevels(document.body));
  });

  it("Extract & Verify, including the result", async () => {
    function Harness() {
      const [showResult, setShowResult] = [false, () => undefined] as const;
      return <VerifyPage vault={VAULT} handoff={null} goTo={() => undefined} showResult={showResult} onShowResult={() => undefined} />;
    }
    render(<Harness />);
    expectNoSkippedLevels(headingLevels(document.body));

    const input = document.querySelectorAll<HTMLInputElement>('input[type="file"]')[0];
    setFiles(input, new File([new Uint8Array(8)], "stego.png", { type: "image/png" }));
    fireEvent.change(input);
    await waitFor(() => expect(screen.getByText("places to look in")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Shared password"), { target: { value: "pw" } });
    expectNoSkippedLevels(headingLevels(document.body));
  });

  it("Inspect a file, including the result", async () => {
    render(<AnalysePage handoff={null} />);
    expectNoSkippedLevels(headingLevels(document.body));

    const input = document.querySelectorAll<HTMLInputElement>('input[type="file"]')[0];
    setFiles(input, new File([new Uint8Array(8)], "suspect.png", { type: "image/png" }));
    fireEvent.change(input);
    fireEvent.click(screen.getByRole("button", { name: /Inspect file/ }));
    await waitFor(() => expect(document.querySelector(".outcome")).toBeInTheDocument());
    expectNoSkippedLevels(headingLevels(document.body));
  });

  it("Tamper tests, including the result", async () => {
    render(<AttackPage vault={VAULT} handoff={null} goTo={() => undefined} />);
    expectNoSkippedLevels(headingLevels(document.body));

    const input = document.querySelectorAll<HTMLInputElement>('input[type="file"]')[0];
    setFiles(input, new File([new Uint8Array(8)], "stego.png", { type: "image/png" }));
    fireEvent.change(input);
    fireEvent.change(screen.getByLabelText("Shared password"), { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("button", { name: /Run tamper tests/ }));
    await waitFor(() => expect(document.querySelector(".outcome")).toBeInTheDocument());
    expectNoSkippedLevels(headingLevels(document.body));
  });

  it("gives every input on every screen a programmatic label", async () => {
    render(<App />);
    const unlabelled = Array.from(document.querySelectorAll<HTMLElement>(".main input, .main textarea, .main select"))
      .filter((field) => !(field as HTMLInputElement).hidden && field.getAttribute("type") !== "file")
      .filter((field) => {
        const id = field.id;
        if (id && document.querySelector(`label[for="${id}"]`)) return false;
        return !field.closest("label") && !field.getAttribute("aria-label") && !field.getAttribute("aria-labelledby");
      });
    expect(unlabelled.map((field) => field.outerHTML.slice(0, 120))).toEqual([]);
  });
});

describe("the bit-depth radio group", () => {
  it("is one stop in the tab order and moves with the arrow keys", async () => {
    function Harness() {
      return <HidePage vault={VAULT} onHandoff={() => undefined} goTo={() => undefined} showResult={false} onShowResult={() => undefined} />;
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /Embedding options/ }));
    const radios = Array.from(document.querySelectorAll<HTMLButtonElement>(".lsb-picker button"));
    expect(radios).toHaveLength(8);
    expect(radios.filter((radio) => radio.tabIndex === 0)).toHaveLength(1);
    expect(radios[0].tabIndex).toBe(0);

    radios[0].focus();
    fireEvent.keyDown(radios[0], { key: "ArrowRight" });
    expect(document.querySelectorAll(".lsb-picker button")[1]).toHaveFocus();
    expect(document.querySelectorAll(".lsb-picker button")[1].getAttribute("aria-checked")).toBe("true");
    expect(Array.from(document.querySelectorAll<HTMLButtonElement>(".lsb-picker button")).filter((r) => r.tabIndex === 0)).toHaveLength(1);

    fireEvent.keyDown(document.querySelectorAll(".lsb-picker button")[1], { key: "ArrowLeft" });
    expect(document.querySelectorAll(".lsb-picker button")[0]).toHaveFocus();
  });

  it("does not run off either end", async () => {
    function Harness() {
      return <HidePage vault={VAULT} onHandoff={() => undefined} goTo={() => undefined} showResult={false} onShowResult={() => undefined} />;
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /Embedding options/ }));
    const first = document.querySelectorAll<HTMLButtonElement>(".lsb-picker button")[0];
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowLeft" });
    expect(document.querySelectorAll(".lsb-picker button")[0]).toHaveFocus();
  });
});
