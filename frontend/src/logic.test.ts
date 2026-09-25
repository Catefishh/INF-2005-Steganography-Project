// Pure logic, no DOM and no React. Everything here is a plain function the screens depend on:
// routing, what makes an action available, how a verdict may present itself, the stale-result
// rule, how the Inspect reading is assembled, and the small formatters.
//
// Grouped in one file rather than one file per module. The tests are the documentation of the
// decisions the redesign made, so they are worth keeping; the extra files were not.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { Analysis, CoverInfo, Scenario, VerdictName, VerifyStep } from "./api";
import { channelLabel, chiCounts, evidenceReading, inspectCopy, ordinal, valueRange } from "./analysis";
import { differenceLabel, differenceReading, qualityReading, roomReading, touchedReading } from "./readings";
import { embedMissing, inspectMissing, missingDetail, missingHeading, tamperMissing, verifyMissing, type EmbedInputs } from "./requirements";
import { hasResultView, isPlainLeftClick, navigate, PATHS, pathFor, resolveRoute } from "./router";
import { changedInputs, staleReason } from "./stale";
import { expectation, noFileReason, numberWord } from "./pages/AttackPage";
import { relativeTime } from "./pages/VerifyPage";
import { failedStep, skippedSteps, stepTone, stepsValue, verdictReading } from "./verdict";
import { normalizeColumns, waveformColumns } from "./components";
import { analysisExtras } from "./test/analysisFixture";

/** A minimal Inspect result, with the parts a test cares about overridden. */
function analyseWith(over: Partial<Analysis> = {}): Analysis {
  const info: CoverInfo = {
    kind: "image", format: "PNG", output_format: "PNG", descriptor: "RGB PNG 1280x960",
    n_slots: 3686400, lossy_source: false, width: 1280, height: 960, mode: "RGB",
  };
  return {
    ...analysisExtras,
    info,
    channel: 0,
    channel_names: ["Red", "Green", "Blue"],
    stride: 2,
    bit_planes: Array.from({ length: 8 }, () => "data:image/png;base64,x"),
    chi_square: Array.from({ length: 64 }, () => 0.2),
    chi_square_overall: 0.01,
    histograms: [Array.from({ length: 256 }, () => 1)],
    lsb_composite: "data:image/png;base64,x",
    compare: null,
    ...over,
  };
}

// ---------------------------------------------------------------- routing

describe("routing", () => {
  it("maps every screen to its canonical path, and only two screens have a result view", () => {
    expect(PATHS).toEqual({ keys: "/keys", hide: "/embed", verify: "/verify", analyse: "/inspect", attacks: "/tamper-tests", text: "/text" });
    expect(pathFor("hide", "result")).toBe("/embed/result");
    expect(pathFor("verify", "result")).toBe("/verify/result");
    expect(pathFor("analyse", "result")).toBe("/inspect");
    expect(hasResultView("hide")).toBe(true);
    expect(hasResultView("verify")).toBe(true);
    expect(hasResultView("keys")).toBe(false);
  });

  it("falls back to Keys without a key pair, and to Embed & Sign with one", () => {
    expect(resolveRoute("/", false)).toEqual({ page: "keys", view: "form" });
    expect(resolveRoute("/", true)).toEqual({ page: "hide", view: "form" });
    expect(resolveRoute("/nonsense", false)).toEqual({ page: "keys", view: "form" });
    expect(resolveRoute("/nonsense", true)).toEqual({ page: "hide", view: "form" });
    expect(resolveRoute("/v2", false)).toEqual({ page: "keys", view: "form" });
    expect(resolveRoute("/v2", true)).toEqual({ page: "hide", view: "form" });
    expect(resolveRoute("/demo", false)).toEqual({ page: "keys", view: "form" });
    expect(resolveRoute("/demo", true)).toEqual({ page: "hide", view: "form" });
  });

  it("tolerates trailing and doubled slashes", () => {
    expect(resolveRoute("/embed/", true)).toEqual({ page: "hide", view: "form" });
    expect(resolveRoute("//inspect//", true)).toEqual({ page: "analyse", view: "form" });
    expect(resolveRoute("/verify/result", true)).toEqual({ page: "verify", view: "result" });
  });

  it("treats only a plain left click as its own", () => {
    const base = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };
    expect(isPlainLeftClick(base)).toBe(true);
    expect(isPlainLeftClick({ ...base, button: 1 })).toBe(false);
    expect(isPlainLeftClick({ ...base, metaKey: true })).toBe(false);
    expect(isPlainLeftClick({ ...base, shiftKey: true })).toBe(false);
  });

  describe("navigate and popstate", () => {
    const start = window.location.pathname;
    beforeEach(() => window.history.replaceState(null, "", "/keys"));
    afterEach(() => window.history.replaceState(null, "", start));

    it("pushes a history entry and notifies by popstate, one microtask later", async () => {
      const heard = vi.fn();
      window.addEventListener("popstate", heard);
      navigate("/embed");
      // Deliberately deferred: notifying synchronously re-enters React mid-commit, which is the
      // bug that left the URL stuck on a result route while the form was on screen.
      expect(heard).not.toHaveBeenCalled();
      await Promise.resolve();
      expect(heard).toHaveBeenCalledTimes(1);
      expect(window.location.pathname).toBe("/embed");
      window.removeEventListener("popstate", heard);
    });

    it("replaces instead of pushing when asked, so Back does not stack", () => {
      window.history.replaceState(null, "", "/embed/result");
      const before = window.history.length;
      navigate("/embed", { replace: true });
      expect(window.location.pathname).toBe("/embed");
      expect(window.history.length).toBe(before);
    });

    it("does nothing when the path is already current", async () => {
      const heard = vi.fn();
      window.addEventListener("popstate", heard);
      navigate("/keys");
      await Promise.resolve();
      expect(heard).not.toHaveBeenCalled();
      window.removeEventListener("popstate", heard);
    });
  });
});

// ---------------------------------------------------------------- what blocks an action

describe("missing inputs", () => {
  const EMBED_READY: EmbedInputs = {
    hasCover: true, hasCoverDetails: true, hasPayload: true,
    hasPassphrase: true, hasPrivateKey: true, overCapacity: false,
  };

  it("is empty when everything is supplied", () => {
    expect(embedMissing(EMBED_READY)).toEqual([]);
    expect(verifyMissing({ hasFile: true, hasPassphrase: true, hasPublicKey: true })).toEqual([]);
    expect(inspectMissing({ hasFile: true })).toEqual([]);
    expect(tamperMissing({ hasFile: true, hasPassphrase: true, hasPublicKey: true })).toEqual([]);
  });

  it("names every missing input on a cold start, in form order", () => {
    expect(embedMissing({
      hasCover: false, hasCoverDetails: false, hasPayload: false,
      hasPassphrase: false, hasPrivateKey: false, overCapacity: false,
    })).toEqual([
      "a picture or WAV to hide it in",
      "a message or a file to hide",
      "a shared password",
      "a signing key",
    ]);
    expect(verifyMissing({ hasFile: false, hasPassphrase: false, hasPublicKey: false }))
      .toEqual(["the file you received", "the shared password", "the sender's public key"]);
    expect(tamperMissing({ hasFile: false, hasPassphrase: false, hasPublicKey: false }))
      .toEqual(["a protected file to attack", "the shared password", "the sender's public key"]);
    expect(inspectMissing({ hasFile: false })).toEqual(["a file to inspect"]);
  });

  it("asks for the cover to finish loading rather than for another cover", () => {
    expect(embedMissing({ ...EMBED_READY, hasCoverDetails: false })).toEqual(["the cover file to finish loading"]);
    expect(embedMissing({ ...EMBED_READY, hasCover: false, hasCoverDetails: false }))
      .toEqual(["a picture or WAV to hide it in"]);
  });

  it("names the capacity problem as its own reason", () => {
    expect(embedMissing({ ...EMBED_READY, overCapacity: true }))
      .toEqual(["something small enough to fit in this cover"]);
  });

  it("asks for a re-run rather than listing inputs when a result is out of date", () => {
    expect(verifyMissing({ hasFile: true, hasPassphrase: true, hasPublicKey: true, needsRecheck: true }))
      .toEqual(["re-run, because the inputs changed"]);
  });

  it("keeps the heading and the list in agreement", () => {
    expect(missingHeading([])).toBe("Ready");
    expect(missingHeading(["one"])).toBe("One thing still needed");
    expect(missingHeading(["a", "b", "c"])).toBe("3 things still needed");
    expect(missingDetail(["a message", "a password"])).toBe("a message · a password");
    expect(missingDetail([])).toBe("");
  });
});

// ---------------------------------------------------------------- verdicts

const ALL_VERDICTS: VerdictName[] = [
  "Authentic", "Tampered", "Signature Invalid", "Payload Missing", "Wrong Start Location", "Cannot Verify",
];

function step(over: Partial<VerifyStep> = {}): VerifyStep {
  return { id: "load", title: "Read stego file and public key", status: "passed", detail: "", ...over };
}

describe("verdicts", () => {
  it("maps every verdict to a tone, so colour and words cannot disagree", () => {
    expect(Object.fromEntries(ALL_VERDICTS.map((v) => [v, verdictReading(v).tone]))).toEqual({
      Authentic: "good",
      Tampered: "bad",
      "Signature Invalid": "bad",
      "Payload Missing": "warn",
      "Wrong Start Location": "warn",
      "Cannot Verify": "flat",
    });
  });

  it("never pairs a failure with a success icon", () => {
    for (const verdict of ALL_VERDICTS) {
      expect(verdictReading(verdict).icon === "shield").toBe(verdictReading(verdict).tone === "good");
    }
    expect(verdictReading("Tampered").icon).toBe("x");
    expect(verdictReading("Wrong Start Location").icon).toBe("target");
  });

  it("gives every verdict its own headline, and never claims certainty", () => {
    const headlines = ALL_VERDICTS.map((v) => verdictReading(v).headline);
    expect(new Set(headlines).size).toBe(ALL_VERDICTS.length);
    for (const verdict of ALL_VERDICTS) {
      const reading = verdictReading(verdict);
      expect(reading.headline).not.toBe(verdict);
      expect(reading.summary.length).toBeGreaterThan(40);
      expect(reading.headline).not.toMatch(/certain|proves|definitely/i);
    }
  });

  it("reads the extract step as an override only when a manual start was sent", () => {
    expect(stepTone(step({ id: "extract", status: "passed", detail: "Read from manually entered start" }))).toBe("override");
    expect(stepTone(step({ id: "extract", status: "passed", detail: "Read from start from header" }))).toBe("passed");
    // A failure on that step must still be red, not amber.
    expect(stepTone(step({ id: "extract", status: "failed", detail: "manually entered start found nothing" }))).toBe("failed");
    expect(stepTone(step({ status: "skipped" }))).toBe("skipped");
  });

  it("counts a clean run and says where a stopped run stopped", () => {
    expect(stepsValue([step(), step({ id: "header" })])).toBe("2 of 2 passed");
    expect(stepsValue([step(), step({ id: "header" }), step({ id: "unlock", status: "failed" })])).toBe("stopped at step 3 of 3");
  });

  it("names the checks that were never reached, and the one that failed", () => {
    const steps = [
      step(),
      step({ id: "unlock", status: "failed", detail: "rejected" }),
      step({ id: "extract", status: "skipped" }),
      step({ id: "decrypt", status: "skipped" }),
    ];
    expect(skippedSteps(steps).map((s) => s.id)).toEqual(["extract", "decrypt"]);
    expect(failedStep(steps)?.id).toBe("unlock");
    expect(failedStep([step()])).toBeNull();
  });
});

// ---------------------------------------------------------------- the stale-result rule

describe("the stale-result rule", () => {
  const labels = ["file", "password", "public key", "start point"];
  const stored = ["a.png", "hunter2hunter2", "pem", "from the password"];

  it("reports nothing when the inputs are untouched", () => {
    expect(changedInputs(labels, stored, [...stored])).toEqual([]);
  });

  it("fires on a file, password, key or override change, in form order", () => {
    expect(changedInputs(labels, stored, ["a.png", "wrong", "pem", "from the password"])).toEqual(["password"]);
    expect(changedInputs(labels, stored, ["a.png", "hunter2hunter2", "other", "from the password"])).toEqual(["public key"]);
    expect(changedInputs(labels, stored, ["b.png", "hunter2hunter2", "pem", "from the password"])).toEqual(["file"]);
    expect(changedInputs(labels, stored, ["a.png", "hunter2hunter2", "pem", "xy:0,0"])).toEqual(["start point"]);
    expect(changedInputs(labels, stored, ["b.png", "wrong", "pem", "xy:0,0"]))
      .toEqual(["file", "password", "start point"]);
  });

  it("says which input moved, in plain words", () => {
    expect(staleReason(["password"])).toBe("The password changed after it was produced.");
    expect(staleReason(["password", "public key"])).toBe("The password and the public key changed after it was produced.");
    expect(staleReason(["file", "password", "start point"]))
      .toBe("The file, the password and the start point changed after it was produced.");
    expect(staleReason([])).toBe("The inputs changed after it was produced.");
  });
});

// ---------------------------------------------------------------- the Inspect reading

const EXACT_MATCH = {
  slots_changed: 5204, bits_changed: 5204, max_difference: 1, psnr_db: 51.14, mse: 0.0012,
  changed_map: "data:image/png;base64,x", amplified: "data:image/png;base64,y",
};

describe("the Inspect evidence reading", () => {
  it("counts only the sections at or above the legend's threshold", () => {
    expect(chiCounts(analyseWith({ chi_square: Array.from({ length: 64 }, () => 0.99) })))
      .toMatchObject({ flagged: 64, total: 64 });
    expect(chiCounts(analyseWith({ chi_square: [null, 0.99, null] }))).toMatchObject({ flagged: 1, total: 3 });
  });

  it("describes one-bit differences without asserting that data was hidden", () => {
    const reading = evidenceReading(analyseWith({ compare: EXACT_MATCH, chi_square: Array.from({ length: 64 }, () => 0.99), chi_square_overall: 1 }));
    expect(reading.headline).toBe("One-bit changes compared with the original");
    expect(reading.summary).toContain("5,204");
    expect(reading.summary).toContain("±1");
    expect(reading.needsOriginal).toBe(true);
  });

  it("describes an identical comparison and large differences without a detector verdict", () => {
    const clean = evidenceReading(analyseWith({ compare: { ...EXACT_MATCH, slots_changed: 0, bits_changed: 0, max_difference: 0, psnr_db: null, mse: 0 } }));
    expect(clean.headline).toBe("No differences in the analysed values");

    const edited = evidenceReading(analyseWith({ compare: { ...EXACT_MATCH, slots_changed: 900, bits_changed: 3000, max_difference: 42 } }));
    expect(edited.headline).toBe("Differences compared with the original");
    expect(edited.summary).toContain("±42");
  });

  it("refuses to conclude from the statistical test alone", () => {
    const flagged = evidenceReading(analyseWith({ chi_square: Array.from({ length: 64 }, () => 0.99), chi_square_overall: 1 }));
    expect(flagged.tone).toBe("flat");
    expect(flagged.headline).toContain("Pair counts resemble LSB replacement");
    expect(flagged.summary).toContain("64 of 64");
    expect(flagged.summary).toContain("Supplying the original");

    const clean = evidenceReading(analyseWith());
    expect(clean.tone).toBe("flat");
    expect(clean.summary).toContain("cannot rule out embedding");
  });

  it("stops describing audio as a picture", () => {
    expect(inspectCopy("audio").unit).toBe("sample");
    expect(inspectCopy("audio").histogramAxis).toBe("low-byte sample value");
    expect(inspectCopy("audio").planesNote).toContain("sound");
    expect(inspectCopy("image").planesNote).toContain("picture");
  });

  it("spells the stride out with a real ordinal", () => {
    expect(ordinal(2)).toBe("2nd");
    expect(ordinal(1)).toBe("1st");
    expect(ordinal(3)).toBe("3rd");
    expect(ordinal(11)).toBe("11th");
    expect(ordinal(112)).toBe("112th");
    expect(inspectCopy("image").strideNote(2)).toBe("every 2nd pixel shown");
  });

  it("labels the histogram axis for the analysed byte, even for deeper audio", () => {
    expect(valueRange({ kind: "image" } as CoverInfo)).toEqual({ min: 0, max: 255 });
    expect(valueRange({ kind: "audio", bits: 16 } as CoverInfo)).toEqual({ min: 0, max: 255 });
    expect(valueRange({ kind: "audio", bits: 8 } as CoverInfo)).toEqual({ min: 0, max: 255 });
  });

  it("does not repeat the word channel", () => {
    expect(channelLabel(analyseWith({ channel: 0, channel_names: ["Channel 1"] }))).toBe("Channel 1");
    expect(channelLabel(analyseWith({ channel: 2 }))).toBe("Blue");
  });
});

// ---------------------------------------------------------------- readings shown as figures

describe("readings", () => {
  it("leads with nothing lost, and puts the size change in the explanation", () => {
    const same = qualityReading({
      sizeUnchanged: true, coverBytes: 921654, stegoBytes: 921654, outputFormat: "BMP", kind: "image",
      formatBytes: (b) => `${b} B`,
    });
    expect(same.value).toBe("Nothing lost");
    expect(same.reading).toContain("exactly the same size");

    const bigger = qualityReading({
      sizeUnchanged: false, coverBytes: 1_200_000, stegoBytes: 1_204_200, outputFormat: "PNG", kind: "image",
      formatBytes: (b) => `${(b / 1024).toFixed(1)} KB`,
    });
    expect(bigger.value).toBe("Nothing lost");
    expect(bigger.tone).toBe("good");
    // The 4.1 KB is still reported — as the explained consequence, not the headline.
    expect(bigger.reading).toContain("4.1 KB larger than the cover file");
    expect(bigger.reading).toContain("PNG re-compresses");
  });

  it("rates a change by whether it can be noticed, and follows the media type", () => {
    expect(differenceReading({ psnrDb: null, mse: 0, kind: "image" }).value).toBe("None");
    expect(differenceReading({ psnrDb: 51, mse: 0.001, kind: "image" }).tone).toBe("good");
    expect(differenceReading({ psnrDb: 35, mse: 0.03, kind: "image" }).tone).toBe("warn");
    expect(differenceLabel("audio")).toBe("Audible change");
    expect(differenceLabel("image")).toBe("Visible change");
  });

  it("reports how much of the carrier was touched, and how full it is", () => {
    const touched = touchedReading({ slotsChanged: 3664, bitsChanged: 3664, totalSlots: 3686400, kind: "image" });
    expect(touched.value).toBe("3,664");
    expect(touched.reading).toContain("One bit per value");

    const room = roomReading({ packageBytes: 916, capacityBytes: 460743, nLsb: 1, kind: "image" });
    expect(room.value).toBe("0.2%");
    expect(room.reading).toContain("916 of 460,743 bytes at 1 bit per colour value");
  });
});

// ---------------------------------------------------------------- waveforms

describe("waveform envelopes", () => {
  const samples = (values: number[]) => Float32Array.from(values);

  it("takes the min and max of each column", () => {
    const columns = waveformColumns(samples([0, 1, -1, 0.5, -0.5, 0]), 2);
    expect(columns).toHaveLength(2);
    expect(columns[0]).toEqual({ low: -1, high: 1 });
    expect(columns[1]).toEqual({ low: -0.5, high: 0.5 });
  });

  it("never emits more columns than there is data for", () => {
    expect(waveformColumns(samples([1, 2, 3]), 100)).toHaveLength(3);
    expect(waveformColumns(samples([]), 10)).toEqual([]);
  });

  it("lifts a near-silent envelope until it is visible, without inventing silence or clipping", () => {
    // 2% amplitude is the audit's case: a 3px-tall bar on an 89px canvas read as a flat line.
    const quiet = normalizeColumns([{ low: -0.02, high: 0.02 }, { low: -0.01, high: 0.01 }]);
    const scaled = Math.max(...quiet.map((c) => c.high)) - Math.min(...quiet.map((c) => c.low));
    expect(scaled).toBeGreaterThan(0.5);
    // Gain is capped at 40x, so a quiet signal is lifted rather than normalised to full scale.
    expect(Math.max(...quiet.map((c) => c.high))).toBeCloseTo(0.8, 5);
  });

  it("leaves true silence alone rather than amplifying noise", () => {
    expect(normalizeColumns([{ low: 0, high: 0 }, { low: 0, high: 0 }])).toEqual([{ low: 0, high: 0 }, { low: 0, high: 0 }]);
  });

  it("gives every column a visible height", () => {
    for (const column of normalizeColumns([{ low: 0, high: 0.001 }, { low: 0.5, high: 0.5001 }])) {
      expect(column.high - column.low).toBeGreaterThan(0.01);
    }
  });
});

// ---------------------------------------------------------------- formatters used by screens

describe("the wording helpers the screens use", () => {
  it("reads a hand-off time as a person would say it", () => {
    const now = 1_000_000_000_000;
    expect(relativeTime(now - 5_000, now)).toBe("just now");
    expect(relativeTime(now - 120_000, now)).toBe("2 minutes ago");
    expect(relativeTime(now - 60_000, now)).toBe("1 minute ago");
    expect(relativeTime(now - 7_200_000, now)).toBe("2 hours ago");
    expect(relativeTime(now - 172_800_000, now)).toBe("2 days ago");
  });

  const scenarios = (): Scenario[] => [
    { id: "baseline", title: "Nothing changed", change: "", expected: ["Authentic"], verdict: "Authentic", summary: "", as_expected: true, file: null },
    { id: "wrong_passphrase", title: "Wrong password", change: "", expected: ["Cannot Verify"], verdict: "Cannot Verify", summary: "", as_expected: true, file: null },
    { id: "clean_cover", title: "The original file", change: "", expected: ["Payload Missing"], verdict: "Payload Missing", summary: "", as_expected: true, file: null },
    { id: "lsb_noise", title: "Every lowest bit overwritten", change: "", expected: ["Payload Missing", "Cannot Verify"], verdict: "Payload Missing", summary: "", as_expected: true, file: null },
  ];

  it("folds the expectation into the description, and explains the either-or cases", () => {
    const list = scenarios();
    expect(expectation(list[0], true)).toBe("Authentic.");
    expect(expectation(list[3], true)).toContain("Payload Missing or Cannot Verify. The first failing check");
    expect(expectation(list[2], false)).toBe("Payload Missing after adding the original cover.");
  });

  it("explains why a scenario has no downloadable modified file", () => {
    const list = scenarios();
    expect(noFileReason(list[0], true)).toBe("file unchanged");
    expect(noFileReason(list[1], false)).toBe("file unchanged; check settings changed");
    expect(noFileReason(list[2], false)).toBe("requires original cover");
    expect(noFileReason(list[2], true)).toBe("original cover used");
  });

  it("spells small counts and falls back to digits", () => {
    expect(numberWord(1)).toBe("one");
    expect(numberWord(9)).toBe("nine");
    expect(numberWord(11)).toBe("11");
  });
});
