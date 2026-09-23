import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

// jsdom has no Web Audio. The Waveform component decodes audio to draw its envelope; without
// this it throws on render and takes the whole page down. Rejecting decodeAudioData drives the
// component into its real "preview unavailable" state instead.
class StubAudioContext {
  decodeAudioData(): Promise<never> {
    return Promise.reject(new Error("no audio decoding in jsdom"));
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
}
Object.defineProperty(globalThis, "AudioContext", { writable: true, value: StubAudioContext });

// jsdom implements neither of these, and the download helpers in util.ts need both.
beforeEach(() => {
  if (!URL.createObjectURL) {
    Object.defineProperty(URL, "createObjectURL", { writable: true, value: () => "blob:test" });
  }
  if (!URL.revokeObjectURL) {
    Object.defineProperty(URL, "revokeObjectURL", { writable: true, value: () => undefined });
  }
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  // Downloads are anchor clicks; jsdom would log "Not implemented: navigation" for each one.
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Attaches a real FileList-shaped object to a file input, which fireEvent cannot build. */
export function setFiles(input: HTMLInputElement, ...files: File[]): void {
  Object.defineProperty(input, "files", {
    configurable: true,
    value: {
      ...files,
      length: files.length,
      item: (index: number) => files[index] ?? null,
      [Symbol.iterator]: function* () { yield* files; },
    },
  });
}
