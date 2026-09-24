import { useEffect, useId, useMemo, useRef, useState } from "react";
import { api, fetchAsFile, fileUrl, type CoverInfo, type HideReport, type HideResponse, type StoredFile } from "../../api";
import {
  ActionBar, ByteDiagram, CompareSlider, Disclosure, DropZone, ErrorNote, HideTimeline, Icon, InputStrip, KeyField,
  LectureTable, MediaPreview, Meter, Metric, Outcome, Panel, PassphraseField, Spinner, Waveform,
} from "../../components";
import { differenceLabel, differenceReading, qualityReading, roomReading, touchedReading } from "../../readings";
import { embedMissing } from "../../requirements";
import { LONG_MESSAGE, SHORT_MESSAGE } from "../../samples";
import { errorText, formatBytes, shortHash, useDebounced, useObjectUrl, type Handoff, type Page, type Vault } from "../../util";
import { HashEvidence } from "../../ui/hashEvidence";


export function EmbedResult({ report, stego, usedCoverUrl, stegoUrl, team, onEdit, onHandOff }: {
  report: HideReport;
  stego: StoredFile;
  usedCoverUrl: string | null;
  stegoUrl: string;
  team: string;
  onEdit: () => void;
  onHandOff: (page: Page) => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const kind = report.cover.kind;

  // The outcome must be the first thing read, not something the user has to scroll to find.
  useEffect(() => {
    heading.current?.focus();
  }, []);

  const quality = qualityReading({
    sizeUnchanged: report.size_unchanged,
    coverBytes: report.cover.file_size ?? 0,
    stegoBytes: report.stego_size,
    outputFormat: report.cover.output_format,
    kind,
    formatBytes,
  });
  const difference = differenceReading({ psnrDb: report.psnr_db, mse: report.mse, kind });
  const touched = touchedReading({
    slotsChanged: report.slots_changed,
    bitsChanged: report.bits_changed,
    totalSlots: report.cover.n_slots,
    kind,
  });
  const room = roomReading({
    packageBytes: report.package_bytes,
    capacityBytes: report.capacity_bytes,
    nLsb: report.n_lsb,
    kind,
  });

  const record = report.record;
  const noun = kind === "audio" ? "recording" : "picture";

  return (
    <div className="result-column">
      <Outcome tone="good" icon="shield" label="Done" title="File protected" headingRef={heading}
        summary={
          <>
            Your {record.payload?.filename === "message.txt" ? "message" : "file"} is hidden inside the {noun} and
            signed with your key. Send <b>{stego.filename}</b> to the receiver, and tell them the password some other
            way — never with the file.
          </>
        }
        actions={
          <>
            <a className="btn primary lg" href={fileUrl(stego.id, true)} download={stego.filename}>
              <Icon name="download" /> Download {stego.filename}
            </a>
            <span className="sub">{formatBytes(stego.size)} · {report.cover.output_format}</span>
          </>
        } />

      <InputStrip
        
        items={[
          { label: "Cover", value: report.cover.filename ?? "-", icon: kind === "audio" ? "music" : "image" },
          { label: "Hidden", value: `${record.payload?.filename} · ${formatBytes(record.payload?.size ?? 0)}` },
          { label: "Depth", value: `${report.n_lsb} bit${report.n_lsb === 1 ? "" : "s"}` },
          { label: "Start", value: report.start_mode === "auto" ? "hidden, from the password" : "chosen by hand" },
          { label: "Label", value: team || "not set" },
        ]}
        actions={
          <button type="button" className="btn ghost sm" onClick={onEdit}>
            <Icon name="pen" size={14} /> Edit and run again
          </button>
        } />

      {report.payload_hash && <HashEvidence evidence={report.payload_hash} title="Payload SHA-256 before embedding" />}

      <div className="metrics">
        <Metric label="Quality" value={quality.value} reading={quality.reading} tone={quality.tone} />
        <Metric label={differenceLabel(kind)} value={difference.value} reading={difference.reading} tone={difference.tone} />
        <Metric label="Values touched" tone={touched.tone}
          value={<>{touched.value} <small>of {report.cover.n_slots.toLocaleString()}</small></>}
          reading={touched.reading} />
        <Metric label="Room used" value={room.value} reading={room.reading} tone={room.tone} />
      </div>

      <div className="columns">
        <Panel title={kind === "image" ? "Before and after — drag to compare" : "Before and after — listen for a difference"}>
          {kind === "image" && usedCoverUrl ? (
            <CompareSlider before={usedCoverUrl} after={stegoUrl} />
          ) : (
            <div className="audio-compare">
              {usedCoverUrl && <div><span className="tag">Cover</span><MediaPreview url={usedCoverUrl} mime="audio/wav" name="cover" /></div>}
              <div><span className="tag hot">Protected</span><MediaPreview url={stegoUrl} mime="audio/wav" name="stego" /></div>
            </div>
          )}
          <p className="muted small">
            {kind === "image"
              ? `They should look the same. That is the point — the difference is ${report.n_lsb} bit in each of ${report.slots_changed.toLocaleString()} colour values.`
              : `They should sound the same. The difference is ${report.n_lsb} bit in the quietest part of each of ${report.slots_changed.toLocaleString()} samples.`}
          </p>
        </Panel>

        <Panel title="Where it went">
          <div className="note note-info">
            <Icon name="target" />
            <span>
              <b>Hidden content starts at {report.start.text}</b>
              Position {report.start.slot.toLocaleString()}.{" "}
              {report.start_mode === "auto"
                ? "Worked out from your password, so nobody can find it without it."
                : "You chose this spot by hand, so it is not protected by the password."}
            </span>
          </div>
          <div className="note note-info">
            <Icon name="lock" />
            <span>
              <b>Encrypted directory at the end of the file</b>
              {report.header.text} · last 520 positions, 1 bit each. It holds the encrypted start point and is what the
              receiver reads first.
            </span>
          </div>
          <p className="muted small">
            The receiver needs only the file, the password and your public key. No location has to be shared.
          </p>
        </Panel>
      </div>

      <Panel title="Or carry on with this file" className="next-steps">
        <div className="btn-row">
          <button type="button" className="btn ghost" onClick={() => onHandOff("verify")}>
            <Icon name="eye" /> Verify it as the receiver would
          </button>
          <button type="button" className="btn ghost" onClick={() => onHandOff("analyse")}>
            <Icon name="layers" /> Inspect it for traces
          </button>
          <button type="button" className="btn ghost" onClick={() => onHandOff("attacks")}>
            <Icon name="zap" /> Run the tamper tests
          </button>
        </div>
        <p className="muted small">
          Each one opens with this file already loaded. The password is carried across too; it is shown so you know it was.
        </p>
      </Panel>

      <Disclosure title="Step by step — what the app just did" value={`${report.steps.length} steps`}>
        <HideTimeline steps={report.steps} />
      </Disclosure>

      <Disclosure title={`Bit-level view of the first ${report.lecture_rows.length} values`} value="before → after">
        <LectureTable rows={report.lecture_rows} nLsb={report.n_lsb} />
        <p className="muted small">
          Only the underlined bit{report.n_lsb === 1 ? "" : "s"} can change. A changed value is shown in red.
        </p>
      </Disclosure>

      <Disclosure title="The signed record hidden in the file" value={`SHA-256 ${shortHash(report.record_sha256, 12)}`}>
        <div className="table-wrap">
          <table className="kv">
            <tbody>
              <tr><th>Media ID</th><td className="mono">{record.media_id}</td></tr>
              <tr><th>Created (UTC)</th><td className="mono">{record.timestamp}</td></tr>
              <tr><th>Label</th><td className="mono">{record.team || "not set"}</td></tr>
              <tr><th>Signed by</th><td className="mono">{record.signer_fingerprint}</td></tr>
              <tr><th>Cover</th><td className="mono">{record.cover?.filename} ({record.cover?.descriptor})</td></tr>
              <tr><th>Cover SHA-256</th><td className="mono">{record.cover?.sha256}</td></tr>
              <tr><th>Hidden content</th><td className="mono">{record.payload?.filename} · {record.payload?.media_type} · {record.payload?.size} B</td></tr>
              <tr><th>Content SHA-256</th><td className="mono">{record.payload?.sha256}</td></tr>
              <tr><th>How it was hidden</th><td className="mono">{record.embedding?.method}, {record.embedding?.lsb_bits} bit(s), start position {Number(record.embedding?.start_slot).toLocaleString()}</td></tr>
            </tbody>
          </table>
        </div>
        <Disclosure title="Raw JSON" value="as signed">
          <pre className="raw-json">{JSON.stringify(record, null, 2)}</pre>
        </Disclosure>
      </Disclosure>
    </div>
  );
}
