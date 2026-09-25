import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { BitPlaneViewer } from "./BitPlaneViewer";

test("labels the sampled image, zooms, and returns focus after Escape", () => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  const origin = document.createElement("button");
  document.body.append(origin);
  origin.focus();
  const close = vi.fn();
  const view = render(<BitPlaneViewer src="data:image/png;base64,AA==" label="Original Red bit 0"
    sampling="Sampled: every 4th pixel" origin={origin} onClose={close} />);
  expect(screen.getByRole("dialog", { name: "Original Red bit 0" })).toBeInTheDocument();
  expect(screen.getByText("Sampled: every 4th pixel")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", {name: "Zoom in"}));
  expect(screen.getByRole("img", {name: "Original Red bit 0"})).toBeInTheDocument();
  fireEvent(screen.getByRole("dialog"), new Event("cancel", {bubbles: true, cancelable: true}));
  expect(close).toHaveBeenCalledOnce();
  view.unmount();
  expect(document.activeElement).toBe(origin);
  origin.remove();
});
