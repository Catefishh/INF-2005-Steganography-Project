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

test("dragging a region zooms and centers it; a tiny drag is ignored", () => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  const view = render(<BitPlaneViewer src="image.png" label="RGB lowest bits" sampling="" origin={null} onClose={vi.fn()} />);
  const image = screen.getByRole("img", {name: "RGB lowest bits"});
  const viewport = image.closest(".bit-viewer-scroll") as HTMLElement;
  Object.defineProperties(image, {naturalWidth: {value: 1000}, naturalHeight: {value: 800}});
  Object.defineProperties(viewport, {clientWidth: {value: 500}, clientHeight: {value: 400}});
  vi.spyOn(image, "getBoundingClientRect").mockReturnValue({left: 0, top: 0, width: 1000, height: 800} as DOMRect);
  fireEvent.load(image);
  fireEvent.pointerDown(image, {button: 0, pointerId: 1, clientX: 100, clientY: 100});
  fireEvent.pointerMove(image, {pointerId: 1, clientX: 300, clientY: 300});
  expect(view.container.querySelector(".bit-viewer-selection")).toBeInTheDocument();
  fireEvent.pointerUp(image, {pointerId: 1, clientX: 300, clientY: 300});
  expect(image).toHaveStyle({width: "2000px", height: "1600px"});
  expect(viewport.scrollLeft).toBe(150);
  expect(viewport.scrollTop).toBe(200);
  expect(view.container.querySelector(".bit-viewer-selection")).toBeNull();
  fireEvent.pointerDown(image, {button: 0, pointerId: 2, clientX: 100, clientY: 100});
  fireEvent.pointerUp(image, {pointerId: 2, clientX: 103, clientY: 103});
  expect(image).toHaveStyle({width: "2000px"});
  fireEvent.click(screen.getByRole("button", {name: "Reset zoom"}));
  expect(image).toHaveStyle({width: "1000px"});
  expect(viewport.scrollLeft).toBe(0);
  expect(viewport.scrollTop).toBe(0);
  view.unmount();
});
