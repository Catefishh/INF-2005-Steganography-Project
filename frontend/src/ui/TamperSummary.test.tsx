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
  expect(table).toHaveTextContent("Unexpected");
  expect(table).toHaveTextContent("Verification: Rejected");
  expect(screen.getByText("Unexpected")).toHaveClass("attack-bad");
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
  expect(screen.getByText("4 applicable cases completed · 3 as expected · 1 unexpected")).toBeInTheDocument();
  expect(screen.getByText("Verification: 2 accepted · 2 rejected")).toBeInTheDocument();
  const table = screen.getByRole("table", {name: "Verification results by test case"});
  const unchanged = within(table).getByRole("rowheader", {name: /Unmodified stego file/}).closest("tr")!;
  expect(unchanged).toHaveTextContent("As expected");
  expect(unchanged).toHaveTextContent("Verification: Accepted");
  expect(unchanged).not.toHaveClass("mismatch");
  expect(table).not.toHaveTextContent("Not applicable");
  const rejected = within(table).getByRole("rowheader", {name: /Cover edited/}).closest("tr")!;
  expect(rejected).toHaveTextContent("Carrier SHA-256");
  expect(rejected).toHaveTextContent("As expected");
  expect(rejected).toHaveTextContent("Verification: Rejected");
  expect(rejected).not.toHaveClass("mismatch");
  expect(within(rejected).getByText("As expected")).toHaveClass("attack-ok");
  expect(rejected).toHaveTextContent("The observed verdict matches this scenario's expected outcome.");
  const missed = within(table).getByRole("rowheader", {name: /Missed edit/}).closest("tr")!;
  expect(missed).toHaveTextContent("None — verification passed");
  expect(missed).toHaveTextContent("Unexpected");
  expect(missed).toHaveTextContent("Verification: Accepted");
  expect(missed).toHaveClass("mismatch");
  expect(within(missed).getByText("Unexpected")).toHaveClass("attack-bad");
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
  expect(screen.getByText(/1 applicable case completed · 1 as expected · 0 unexpected/)).toBeInTheDocument();
  expect(screen.getByText("Verification: 1 accepted · 0 rejected")).toBeInTheDocument();
  expect(screen.getByRole("table", {name: "Verification results by test case"})).toHaveTextContent("As expected");
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
  expect(workspace).toHaveTextContent("Verification: Accepted");
  expect(keyCase).toHaveTextContent("Verification: Rejected");
  expect(keyCase).toHaveTextContent("As expected");
  expect(reference).toHaveTextContent("Unexpected");
  fireEvent.click(within(keyCase).getByRole("button", {name: "Reasoning"}));
  expect(keyCase).toHaveTextContent("instead of using your selected sender key");
  expect(keyCase).toHaveTextContent("Verification rejected these test inputs as intended");
  fireEvent.click(within(reference).getByRole("button", {name: "Reasoning"}));
  expect(reference).toHaveTextContent("separately supplied original cover");
  expect(reference).toHaveTextContent("Payload Missing is expected only for an unsigned original");
  expect(reference).toHaveTextContent("does not describe the current stego file");
  expect(reference).toHaveTextContent("does not match this scenario's expected outcome");
});

it.each(["Signature Invalid", "Tampered", "Payload Missing", "Cannot Verify", "Wrong Start Location"] as const)(
  "%s is an expected rejection when the controlled scenario behaved as expected", (verdict) => {
    render(<TamperSummary cases={[{...baseline, id: "negative", expected: [verdict], verdict, as_expected: true}]} busy={false} />);
    const table = screen.getByRole("table", {name: "Verification results by test case"});
    expect(table).toHaveTextContent("As expected");
    expect(table).toHaveTextContent("Verification: Rejected");
    expect(table).not.toHaveTextContent("Test failed");
    expect(table).not.toHaveTextContent("Test passed");
    expect(screen.getByText(/1 applicable case completed · 1 as expected · 0 unexpected/)).toBeInTheDocument();
    expect(screen.getByText("Verification: 0 accepted · 1 rejected")).toBeInTheDocument();
  });


it("judges attacker goals separately and excludes baseline and unsupported cases", () => {
  render(<TamperSummary suite="attack" busy={false} cases={[
    {...baseline, verdict: "Authentic", as_expected: true, attack_outcome: "Baseline verified"},
    {...baseline, id: "lsb_noise", attack_outcome: "Attack succeeded", attack: {goal: "Block recovery", assumption: "No secret", succeeded: true}},
    {...baseline, id: "forged_payload", attack_outcome: "Attack failed", attack: {goal: "Forge content", assumption: "Leaked password", succeeded: false}},
    {...baseline, id: "skip", verdict: "Unsupported", attack_outcome: "Not applicable"},
  ]} />);
  expect(screen.getByText("2 attacks completed · 1 succeeded · 1 failed")).toBeInTheDocument();
  expect(screen.getByText("Attack succeeded")).toHaveClass("attack-bad");
  expect(screen.getByText("Attack failed")).toHaveClass("attack-ok");
  expect(screen.getByText("Baseline verified")).toBeInTheDocument();
  expect(screen.queryByText("Test failed")).toBeNull();
  expect(screen.queryByText("As expected")).toBeNull();
  expect(screen.queryByText(/^Verification:/)).toBeNull();
});
