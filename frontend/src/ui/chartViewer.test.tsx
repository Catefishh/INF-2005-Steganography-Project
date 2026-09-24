import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ChartViewer } from "./chartViewer";
import { registerGraph, unregisterGraph } from "./graphHandoff";

vi.mock("./graphHandoff", () => ({ registerGraph: vi.fn(() => "dc912f0d-7498-4d50-acb0-444395fd772d"),
  updateGraph: vi.fn(), unregisterGraph: vi.fn() }));

const snapshot = { kind: "histogram" as const, title: "Test histogram", series: [[1, 2, 3]],
  colors: ["#006194"], min: "0", max: "255", axis: "Channel value", notes: ["Descriptive only."] };

afterEach(() => { delete window.pywebview; vi.restoreAllMocks(); });

it("opens a separate browser graph tab while preserving source zoom", () => {
  const popup = vi.spyOn(window, "open").mockReturnValue({ closed: false } as Window);
  render(<ChartViewer title="Test histogram" snapshot={snapshot}><svg role="img" aria-label="Test data" /></ChartViewer>);
  fireEvent.click(screen.getByRole("button", { name: "Zoom in Test histogram" }));
  fireEvent.click(screen.getByRole("button", { name: "Pop out Test histogram" }));
  expect(registerGraph).toHaveBeenCalledWith(snapshot);
  expect(popup).toHaveBeenCalledWith("/graph/dc912f0d-7498-4d50-acb0-444395fd772d", "_blank", expect.any(String));
  expect(screen.getByLabelText("Test histogram zoom level")).toHaveTextContent("150%");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("calls the desktop window bridge and reports a blocked popup", async () => {
  window.pywebview = { api: { open_graph: vi.fn().mockResolvedValue(true), close_graph: vi.fn() } };
  const view = render(<ChartViewer title="Test histogram" snapshot={snapshot}><svg role="img" /></ChartViewer>);
  const trigger = screen.getByRole("button", { name: "Pop out Test histogram" });
  fireEvent.click(trigger);
  expect(window.pywebview.api.open_graph).toHaveBeenCalledWith(expect.any(String), "Test histogram");
  trigger.blur();
  window.dispatchEvent(new CustomEvent("stegloc-graph-closed", { detail: "dc912f0d-7498-4d50-acb0-444395fd772d" }));
  expect(trigger).toHaveFocus();
  view.unmount();
  expect(unregisterGraph).not.toHaveBeenCalled();
  delete window.pywebview;
  vi.spyOn(window, "open").mockReturnValue(null);
  render(<ChartViewer title="Test histogram" snapshot={snapshot}><svg role="img" /></ChartViewer>);
  fireEvent.click(screen.getByRole("button", { name: "Pop out Test histogram" }));
  expect(screen.getByRole("alert")).toHaveTextContent(/could not open/i);
});
