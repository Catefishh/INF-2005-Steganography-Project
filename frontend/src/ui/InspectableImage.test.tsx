import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { InspectableImage } from "./InspectableImage";

test("opens an analysis image in the drag-zoom viewer", () => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  render(<InspectableImage src="map.png" alt="Bit 0 complexity map" />);
  const trigger = screen.getByRole("button", {name: "Enlarge Bit 0 complexity map"});
  fireEvent.click(trigger);
  const dialog = screen.getByRole("dialog", {name: "Bit 0 complexity map"});
  expect(dialog.querySelector("img")).toHaveAttribute("src", "map.png");
  expect(dialog).toHaveTextContent("Drag over the image to zoom into a region.");
  fireEvent.click(screen.getByRole("button", {name: "Close"}));
  expect(trigger).toHaveFocus();
});
