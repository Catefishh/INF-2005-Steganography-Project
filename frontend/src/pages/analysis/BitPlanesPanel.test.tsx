import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type { Analysis } from "../../api";
import { BitPlanesPanel } from "./BitPlanesPanel";

test("opens the correct original and inspected images and drops a stale viewer", () => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  const analysis = {info: {kind: "image"}, stride: 2, channel_names: ["Red"],
    bit_planes: Array.from({length: 8}, (_, bit) => `inspected-${bit}`),
    reference_bit_planes: Array.from({length: 8}, (_, bit) => `original-${bit}`)} as Analysis;
  const view = render(<BitPlanesPanel analysis={analysis} busy={false} channel={0} planesRef={{current: null}} onChannel={vi.fn()} />);
  const original = screen.getByRole("button", {name: "Enlarge Original Red bit 0"});
  fireEvent.click(original);
  expect(screen.getByRole("dialog", {name: "Original Red bit 0"}).querySelector("img")).toHaveAttribute("src", "original-0");
  expect(screen.getByText(/not a full-resolution carrier map/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", {name: "Close"}));
  expect(document.activeElement).toBe(original);
  fireEvent.click(screen.getByRole("button", {name: "Enlarge Stego Red bit 0"}));
  expect(screen.getByRole("dialog", {name: "Stego Red bit 0"}).querySelector("img")).toHaveAttribute("src", "inspected-0");
  view.rerender(<BitPlanesPanel analysis={{...analysis}} busy={false} channel={0} planesRef={{current: null}} onChannel={vi.fn()} />);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
