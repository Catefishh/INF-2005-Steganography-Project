import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import type { Scenario } from "../api";
import { TamperSummary } from "./TamperSummary";

const baseline: Scenario = {id: "baseline", title: "Unmodified stego file", change: "Nothing changed",
  expected: ["Authentic"], verdict: "Tampered", as_expected: false, file: null,
  summary: "Payload digest differs from the signed value.", stages: [
    {id: "signature", status: "passed"}, {id: "payload_hash", status: "failed"}, {id: "cover_hash", status: "skipped"},
  ]};

it("reports the actual baseline failure, excluding passed and skipped checks", () => {
  const {rerender} = render(<TamperSummary cases={[baseline]} busy />);
  const table = screen.getByRole("table", {name: "Verification results by test case"});
  expect(table).toHaveTextContent("Payload SHA-256");
  expect(table).not.toHaveTextContent("Signature");
  expect(table).not.toHaveTextContent("Cover SHA-256");
  expect(table).toHaveTextContent("Tampered; expected Authentic");
  expect(table).toHaveTextContent("Test failed");
  const reason = screen.getByText(baseline.summary);
  const toggle = within(table).getByRole("button", {name: "Reasoning"});
  expect(reason.closest(".disclose-body")).toHaveAttribute("hidden");
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(reason.closest(".disclose-body")).not.toHaveAttribute("hidden");
  expect(screen.getByText("Expected verdict: Authentic").closest(".disclose-body")).not.toHaveAttribute("hidden");
  fireEvent.click(toggle);
  expect(reason.closest(".disclose-body")).toHaveAttribute("hidden");
  expect(screen.queryByText(/Remaining tamper cases were not run/)).toBeNull();
  rerender(<TamperSummary cases={[baseline]} busy={false} />);
  expect(screen.getByText(/Remaining tamper cases were not run/)).toBeInTheDocument();
});

it("separates expected rejections from missed tampering and ignores unsupported cases", () => {
  render(<TamperSummary busy={false} cases={[
    {...baseline, verdict: "Authentic", as_expected: true, stages: [{id: "payload_hash", status: "passed"}]},
    {...baseline, id: "cover_flip", title: "Cover edited", expected: ["Tampered"], as_expected: true,
      stages: [{id: "carrier_hash", status: "failed"}]},
    {...baseline, id: "missed", title: "Missed edit", expected: ["Tampered"], verdict: "Authentic", stages: []},
    {...baseline, id: "wrong_code", title: "Wrong code", expected: ["Cannot Verify"], verdict: "Cannot Verify",
      as_expected: true, stages: undefined, summary: "Invalid recovery code"},
    {...baseline, id: "unsupported", title: "Not applicable", verdict: "Unsupported"},
  ]} />);
  expect(screen.getByText("4 applicable cases completed · Tests: 3 passed · 1 failed")).toBeInTheDocument();
  const table = screen.getByRole("table", {name: "Verification results by test case"});
  const unchanged = within(table).getByRole("rowheader", {name: /Unmodified stego file/}).closest("tr")!;
  expect(unchanged).toHaveTextContent("Test passed");
  expect(table).not.toHaveTextContent("Not applicable");
  const rejected = within(table).getByRole("rowheader", {name: /Cover edited/}).closest("tr")!;
  expect(rejected).toHaveTextContent("Carrier SHA-256");
  expect(rejected).toHaveTextContent("Test passed");
  expect(rejected).not.toHaveClass("mismatch");
  expect(rejected).toHaveTextContent("The observed verdict matches this scenario's expected outcome.");
  const missed = within(table).getByRole("rowheader", {name: /Missed edit/}).closest("tr")!;
  expect(missed).toHaveTextContent("None — the change was not detected");
  expect(missed).toHaveTextContent("Test failed");
  expect(missed).toHaveClass("mismatch");
  expect(missed).toHaveTextContent("The observed verdict does not match this scenario's expected outcome.");
  expect(within(missed).getByRole("button", {name: "Reasoning"})).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(within(rejected).getByRole("button", {name: "Reasoning"}));
  expect(within(rejected).getByRole("button", {name: "Reasoning"})).toHaveAttribute("aria-expanded", "true");
  expect(within(missed).getByRole("button", {name: "Reasoning"})).toHaveAttribute("aria-expanded", "false");
  expect(missed).toHaveTextContent("Authentic; expected Tampered");
  expect(table).toHaveTextContent("Check details unavailable");
  expect(table).toHaveTextContent("Invalid recovery code");
});

it("does not imply a running or successful baseline completed the full suite", () => {
  render(<TamperSummary cases={[{...baseline, verdict: "Authentic", as_expected: true, stages: []}]} busy />);
  expect(screen.getByText(/1 applicable case completed.*Running/)).toBeInTheDocument();
  expect(screen.getByText(/1 applicable case completed · Tests: 1 passed · 0 failed/)).toBeInTheDocument();
  expect(screen.getByRole("table", {name: "Verification results by test case"})).toHaveTextContent("Test passed");
});

it("explains that substituted keys and the original reference do not invalidate the workspace baseline", () => {
  render(<TamperSummary busy={false} cases={[
    {...baseline, verdict: "Authentic", as_expected: true, stages: [], summary: "Signature and hashes match."},
    {...baseline, id: "wrong_key", title: "Wrong public key", verdict: "Signature Invalid", expected: ["Signature Invalid"],
      as_expected: true, summary: "Unrelated key rejected."},
    {...baseline, id: "clean_cover", title: "Original cover reference", verdict: "Signature Invalid", expected: ["Payload Missing"],
      summary: "Reference carries a signature from a different key."},
  ]} />);
  const table = screen.getByRole("table", {name: "Verification results by test case"});
  const workspace = within(table).getByRole("rowheader", {name: /Unmodified stego file/}).closest("tr")!;
  const keyCase = within(table).getByRole("rowheader", {name: /Wrong public key/}).closest("tr")!;
  const reference = within(table).getByRole("rowheader", {name: /Original cover reference/}).closest("tr")!;
  expect(workspace).toHaveTextContent("Test passed");
  expect(keyCase).toHaveTextContent("Test passed");
  expect(reference).toHaveTextContent("Test failed");
  fireEvent.click(within(keyCase).getByRole("button", {name: "Reasoning"}));
  expect(keyCase).toHaveTextContent("instead of using your selected sender key");
  expect(keyCase).toHaveTextContent("successful detection");
  fireEvent.click(within(reference).getByRole("button", {name: "Reasoning"}));
  expect(reference).toHaveTextContent("separately supplied original cover");
  expect(reference).toHaveTextContent("Payload Missing is expected only for an unsigned original");
  expect(reference).toHaveTextContent("does not describe the current stego file");
  expect(reference).toHaveTextContent("does not match this scenario's expected outcome");
});

it.each(["Signature Invalid", "Tampered", "Payload Missing", "Cannot Verify", "Wrong Start Location"] as const)(
  "a %s verdict is a passed test when the deliberate change was expected to be rejected that way", (verdict) => {
    render(<TamperSummary cases={[{...baseline, id: "negative", expected: [verdict], verdict, as_expected: true}]} busy={false} />);
    const table = screen.getByRole("table", {name: "Verification results by test case"});
    expect(table).toHaveTextContent("Test passed");
    expect(table).not.toHaveTextContent("Test failed");
    expect(screen.getByText(/Tests: 1 passed · 0 failed/)).toBeInTheDocument();
  });

it("shows every test passing for a genuine file whose changes were all caught", () => {
  render(<TamperSummary busy={false} cases={[
    {...baseline, verdict: "Authentic", as_expected: true, stages: []},
    {...baseline, id: "wrong_passphrase", title: "Wrong passphrase", expected: ["Cannot Verify"], verdict: "Cannot Verify", as_expected: true},
    {...baseline, id: "wrong_key", title: "Wrong public key", expected: ["Signature Invalid"], verdict: "Signature Invalid", as_expected: true},
    {...baseline, id: "flip_cover_bit", title: "Cover bit flipped", expected: ["Tampered"], verdict: "Tampered", as_expected: true},
  ]} />);
  const table = screen.getByRole("table", {name: "Verification results by test case"});
  expect(screen.getByText(/Tests: 4 passed · 0 failed/)).toBeInTheDocument();
  expect(table).not.toHaveTextContent("Test failed");
  expect(table.querySelectorAll("tr.mismatch")).toHaveLength(0);
});

it("fails only the cases whose verdict differs from what was expected", () => {
  render(<TamperSummary busy={false} cases={[
    {...baseline, verdict: "Authentic", as_expected: true, stages: []},
    {...baseline, id: "flip_cover_bit", title: "Cover bit flipped", expected: ["Tampered"], verdict: "Authentic", as_expected: false, stages: []},
  ]} />);
  const table = screen.getByRole("table", {name: "Verification results by test case"});
  expect(screen.getByText(/Tests: 1 passed · 1 failed/)).toBeInTheDocument();
  const missed = within(table).getByRole("rowheader", {name: /Cover bit flipped/}).closest("tr")!;
  expect(missed).toHaveTextContent("Test failed");
  expect(missed).toHaveTextContent("Verdict: Authentic; expected Tampered");
  expect(missed).toHaveTextContent("None — the change was not detected");
});
