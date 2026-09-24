import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { EvidenceAreaChart, EvidenceBarChart } from "./evidenceChart";

it("keeps uninterpretable chi-square sections unavailable rather than plotting zero", () => {
  render(<EvidenceAreaChart label="Chi-square p-values" unit="p" points={[
    { label: "Section 1", value: 0.8 },
    { label: "Section 2", value: null },
    { label: "Section 3", value: 0 },
  ]} />);
  expect(screen.getByRole("table", { name: "Chi-square p-values data" })).toHaveTextContent("Section 2Unavailable");
  expect(screen.getByRole("table", { name: "Chi-square p-values data" })).toHaveTextContent("Section 30");
});

it("provides an explicit empty state when no evidence can be charted", () => {
  render(<EvidenceBarChart label="Complex blocks by plane" unit="%" points={[]} />);
  expect(screen.getByText("No measured values available.")).toBeInTheDocument();
});
