import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { ChartViewer } from "./chartViewer";

const originalShowModal = HTMLDialogElement.prototype.showModal;
const originalClose = HTMLDialogElement.prototype.close;

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
});

afterEach(() => {
  HTMLDialogElement.prototype.showModal = originalShowModal;
  HTMLDialogElement.prototype.close = originalClose;
});

it("zooms a graph, opens it in a larger view, and returns focus on close", async () => {
  render(<ChartViewer title="Test histogram"><svg role="img" aria-label="Test data" /></ChartViewer>);

  const zoomIn = screen.getByRole("button", { name: "Zoom in Test histogram" });
  const popOut = screen.getByRole("button", { name: "Pop out Test histogram" });
  fireEvent.click(zoomIn);
  expect(screen.getByLabelText("Test histogram zoom level")).toHaveTextContent("150%");

  fireEvent.click(popOut);
  const dialog = await screen.findByRole("dialog", { name: "Test histogram" });
  expect(within(dialog).getByRole("img", { name: "Test data" })).toBeInTheDocument();
  expect(within(dialog).getByLabelText("Test histogram zoom level")).toHaveTextContent("150%");
  fireEvent.click(within(dialog).getByRole("button", { name: "Zoom in Test histogram" }));
  expect(within(dialog).getByLabelText("Test histogram zoom level")).toHaveTextContent("200%");

  fireEvent.click(within(dialog).getByRole("button", { name: "Close enlarged graph" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(popOut).toHaveFocus();
  expect(screen.getByLabelText("Test histogram zoom level")).toHaveTextContent("200%");
});
