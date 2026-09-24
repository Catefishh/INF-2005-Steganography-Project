import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { GraphWindow } from "./GraphWindow";
import { requestGraph, watchGraph } from "./graphHandoff";

vi.mock("./graphHandoff", () => ({ requestGraph: vi.fn(), watchGraph: vi.fn(() => () => undefined), closeGraphWindow: vi.fn() }));

it("uses the whole graph window for measured data, zoom and close", async () => {
  vi.mocked(requestGraph).mockResolvedValue({ kind: "histogram", title: "Inspected value histogram",
    series: [[2, 4, 8]], colors: ["#006194"], min: "0", max: "255", axis: "Channel value",
    notes: ["Measured distribution, not proof of embedding."] });
  const close = vi.fn();
  render(<GraphWindow id="graph-1" onClose={close} />);
  expect(await screen.findByRole("heading", { name: "Inspected value histogram" })).toBeInTheDocument();
  expect(screen.getByRole("img", { name: "Value histogram" })).toBeInTheDocument();
  expect(screen.getByRole("table", { name: "Inspected value histogram data" })).toHaveTextContent("Bin 28");
  expect(screen.getByText("Measured distribution, not proof of embedding.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
  expect(screen.getByLabelText("Graph zoom level")).toHaveTextContent("150%");
  fireEvent.click(screen.getByRole("button", { name: "Close graph window" }));
  expect(close).toHaveBeenCalledOnce();
});

it("explains when the source analysis is unavailable", async () => {
  vi.mocked(requestGraph).mockResolvedValue(null);
  render(<GraphWindow id="missing" onClose={() => undefined} />);
  await waitFor(() => expect(screen.getByText(/source analysis is no longer available/i)).toBeInTheDocument());
  expect(watchGraph).toHaveBeenCalled();
});

it("presents a full-size bar chart with its measured values", async () => {
  vi.mocked(requestGraph).mockResolvedValue({ kind: "bar", title: "Complex blocks by plane", unit: "%", max: 100,
    points: [{ label: "Bit 0", value: 52 }, { label: "Bit 1", value: null }],
    notes: ["Descriptive complexity only."] });
  render(<GraphWindow id="bar-1" onClose={() => undefined} />);
  expect(await screen.findByRole("heading", { name: "Complex blocks by plane" })).toBeInTheDocument();
  expect(screen.getByRole("table", { name: "Complex blocks by plane data" })).toHaveTextContent("Bit 1Unavailable");
});

it("does not restore stale data after the source was invalidated", async () => {
  let complete!: (value: Awaited<ReturnType<typeof requestGraph>>) => void;
  vi.mocked(requestGraph).mockReturnValue(new Promise((resolve) => { complete = resolve; }));
  let notify!: (value: null) => void;
  vi.mocked(watchGraph).mockImplementation((_id, callback) => { notify = callback; return () => undefined; });
  render(<GraphWindow id="graph-1" onClose={() => undefined} />);
  await act(async () => {
    notify(null);
    complete({ kind: "histogram", title: "Old histogram", series: [[1]], colors: ["#006194"],
      min: "0", max: "255", axis: "Value", notes: [] });
  });
  await waitFor(() => expect(screen.getByText(/source analysis is no longer available/i)).toBeInTheDocument());
  expect(screen.queryByRole("heading", { name: "Old histogram" })).not.toBeInTheDocument();
});
