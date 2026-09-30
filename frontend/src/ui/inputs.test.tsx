import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import { DropZone, FilePicker, KeyField } from "./inputs";
import { uploadError } from "../upload";

function drop(target: HTMLElement, file: File) {
  fireEvent.drop(target, {dataTransfer: {files: {item: () => file}}});
}

it.each(["picker", "drop"])("%s rejects text disguised as media and preserves the previous file", (method) => {
  const onFile = vi.fn();
  const current = new File(["image"], "current.PNG");
  render(<DropZone title="Cover" hint="Choose media" accept="image/*,audio/*,video/*,.mp4" file={current} onFile={onFile} />);
  const slot = screen.getByRole("button", {name: "Replace current.PNG"});
  const wrong = new File(["text"], "demo.stegloc-text.txt", {type: "video/mp4"});
  if (method === "drop") drop(slot, wrong);
  else fireEvent.change(slot.querySelector("input")!, {target: {files: [wrong]}});
  expect(onFile).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toHaveTextContent("accepted types");
  expect(slot).toHaveTextContent("current.PNG");
  expect(slot).toHaveAttribute("aria-describedby", screen.getByRole("alert").id);
  const good = new File(["video"], "clip.MP4");
  drop(slot, good);
  expect(onFile).toHaveBeenCalledWith(good);
  expect(screen.queryByRole("alert")).toBeNull();
});

it.each([
  ["PHOTO.PNG", "image/*"], ["PHOTO.JPEG", "image/*"], ["music.WAV", "audio/*"],
  ["scan.PPM", "image/*"], ["music.AIFC", "audio/*"], ["music.AMR", "audio/*"],
  ["movie.MP4", ".mp4,video/*"], ["backup.STEGLOC", ".stegloc"],
  ["backup.STEGLOC-TEXT", ".stegloc-text"], ["code.TXT", ".txt,text/plain"],
])("accepts %s with an empty browser MIME type", (name, accept) => {
  expect(uploadError(new File(["contents"], name), accept)).toBe("");
});

it("rejects suffixless media names even with a media MIME type", () => {
  expect(uploadError(new File(["text"], "wav", {type: "audio/wav"}), "audio/*")).toContain("accepted types");
});

it.each([".stegloc", ".stegloc-text", ".txt,text/plain", ".pem,.key,.pub,.txt", ".avi,video/*"])(
  "picker and drop enforce %s even when MIME looks valid", (accept) => {
    const onFile = vi.fn();
    render(<DropZone title="Upload" hint="Choose file" accept={accept} file={null} onFile={onFile} />);
    const slot = screen.getByRole("button", {name: "Upload"});
    const wrong = new File(["wrong"], "wrong.exe", {type: "text/plain"});
    fireEvent.change(slot.querySelector("input")!, {target: {files: [wrong]}});
    drop(slot, wrong);
    expect(onFile).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(accept);
  },
);

it("allows arbitrary payloads from both picker and drop", () => {
  const onFile = vi.fn();
  render(<DropZone title="Payload" hint="Any file" file={null} onFile={onFile} />);
  const slot = screen.getByRole("button", {name: "Payload"});
  for (const name of ["message.txt", "program.exe"]) {
    const file = new File(["payload"], name);
    fireEvent.change(slot.querySelector("input")!, {target: {files: [file]}});
    drop(slot, file);
  }
  expect(onFile).toHaveBeenCalledTimes(4);
  expect(screen.queryByRole("alert")).toBeNull();
});

it("native picker rejects a replacement without invoking its workflow and resets for another pick", () => {
  const onFile = vi.fn();
  render(<FilePicker accept=".stegloc-text" label="Recovery" onFile={onFile} />);
  const input = screen.getByLabelText("Recovery");
  fireEvent.change(input, {target: {files: [new File(["text"], "recovery.txt")]}});
  expect(onFile).not.toHaveBeenCalled();
  expect(input).toHaveAttribute("aria-invalid", "true");
  const valid = new File(["recovery"], "recovery.STEGLOC-TEXT");
  fireEvent.change(input, {target: {files: [valid]}});
  expect(onFile).toHaveBeenCalledWith(valid);
  expect(input).toHaveValue("");
  expect(screen.queryByRole("alert")).toBeNull();
});

const PEM = "-----BEGIN PUBLIC KEY-----\na2V5\n-----END PUBLIC KEY-----";

it.each(["picker", "drop"])("key %s checks extension, size and PEM before replacing a valid value", async (method) => {
  const onChange = vi.fn();
  render(<KeyField label="Public key" value={PEM} onChange={onChange} placeholder="PEM" />);
  const field = screen.getByLabelText("Public key");
  const input = field.closest(".field")!.querySelector("input")!;
  for (const file of [new File([PEM], "key.exe"), new File(["ordinary text"], "key.txt"), new File(["x".repeat(65537)], "key.pem")]) {
    if (method === "drop") drop(field, file);
    else fireEvent.change(input, {target: {files: [file]}});
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(onChange).not.toHaveBeenCalled();
    expect(field).toHaveValue(PEM);
  }
  const file = new File([PEM], "sender.PEM");
  drop(field, file);
  await waitFor(() => expect(onChange).toHaveBeenCalledWith(PEM));
  expect(screen.queryByRole("alert")).toBeNull();
});

it("key editing and newer uploads prevent a pending read from overwriting current text", async () => {
  function Form() {
    const [value, setValue] = useState(PEM);
    return <KeyField label="Public key" value={value} onChange={setValue} placeholder="PEM" />;
  }
  render(<Form />);
  const field = screen.getByLabelText("Public key");
  let finish!: (text: string) => void;
  const slow = Object.assign(new File(["key"], "slow.pem"), {text: () => new Promise<string>((resolve) => { finish = resolve; })});
  drop(field, slow);
  fireEvent.change(field, {target: {value: "edited key"}});
  await act(async () => { finish(PEM); });
  expect(field).toHaveValue("edited key");
  drop(field, slow);
  drop(field, new File([PEM], "new.PEM"));
  await waitFor(() => expect(field).toHaveValue(PEM));
  await act(async () => { finish("-----BEGIN PUBLIC KEY-----\nb2xk\n-----END PUBLIC KEY-----"); });
  expect(field).toHaveValue(PEM);
});
