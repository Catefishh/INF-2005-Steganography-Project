import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { CarrierForm } from "./pages/text/CarrierForm";
import { KeysForm } from "./pages/v2/KeysForm";
import { ProtectedSummary } from "./pages/v2/Results";

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

it("keeps V2 key entry and protected-file handoff actions usable", () => {
  const onPublicPem = vi.fn();
  const onUse = vi.fn();
  render(<><KeysForm password="secret" onPassword={vi.fn()} privatePem="" onPrivatePem={vi.fn()}
    publicPem="" onPublicPem={onPublicPem} fingerprint="" onGenerate={vi.fn()} onInspect={vi.fn()} />
    <ProtectedSummary result={{ carrier: { id: "carrier", filename: "stego.png", size: 5 },
      recovery: { id: "sidecar", filename: "recovery.stegloc", size: 8 }, recovery_code: "separate code",
      media_kind: "image", record: {} }} onUse={onUse} /></>);
  fireEvent.change(screen.getByLabelText("Public PEM"), { target: { value: "public key" } });
  fireEvent.click(screen.getByRole("button", { name: "Use generated files below" }));
  expect(onPublicPem).toHaveBeenCalledWith("public key");
  expect(onUse).toHaveBeenCalledOnce();
  expect(screen.getByDisplayValue("separate code")).toBeTruthy();
});
