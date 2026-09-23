import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { CarrierForm } from "./pages/text/CarrierForm";
import { Disclosure, Reveal } from "./components";

it("opens optional settings with a linked button and keeps collapsed controls out of the tab order", () => {
  render(<Disclosure title="Optional settings" value="off"><button type="button">Hidden action</button></Disclosure>);
  const trigger = screen.getByRole("button", { name: /Optional settings/ });
  const body = document.getElementById(trigger.getAttribute("aria-controls")!);
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  expect(body).toHaveAttribute("hidden");
  expect(screen.queryByRole("button", { name: "Hidden action" })).not.toBeInTheDocument();
  fireEvent.click(trigger);
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("button", { name: "Hidden action" })).toBeInTheDocument();
  fireEvent.click(trigger);
  expect(body).toHaveAttribute("hidden");
});

it("keeps revealed results in the DOM immediately and hides inactive views semantically", () => {
  const { rerender } = render(<Reveal hidden><button type="button">Result action</button></Reveal>);
  expect(screen.queryByRole("button", { name: "Result action" })).not.toBeInTheDocument();
  rerender(<Reveal><button type="button">Result action</button></Reveal>);
  expect(screen.getByRole("button", { name: "Result action" })).toBeInTheDocument();
});

it("keeps text-carrier controls connected to the page callbacks", () => {
  const onMethod = vi.fn();
  const onEstimate = vi.fn();
  render(<CarrierForm method="acrostic" onMethod={onMethod} message="hello" onMessage={vi.fn()}
    visible="" onVisible={vi.fn()} onImport={vi.fn()} onEstimate={onEstimate} estimate={null} />);
  fireEvent.change(screen.getByLabelText("Method"), { target: { value: "whitespace" } });
  fireEvent.click(screen.getByRole("button", { name: "Estimate carrier length" }));
  expect(onMethod).toHaveBeenCalledWith("whitespace");
  expect(onEstimate).toHaveBeenCalledOnce();
});
