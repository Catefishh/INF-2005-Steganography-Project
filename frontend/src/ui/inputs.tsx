import { Fragment, useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { formatBytes } from "../util";
import { Icon, type IconName } from "./layout";
export function DropZone({ title, hint, accept, file, onFile, icon = "upload", label, id, tone = "" }: {
  title: string; hint: string; accept?: string; file: File | null; onFile: (file: File | null) => void;
  icon?: IconName; label?: ReactNode; id?: string; tone?: "" | "bad";
}) {
  const slot = <DropSlot title={title} hint={hint} accept={accept} file={file} onFile={onFile} icon={icon} id={id} tone={tone} />;
  if (!label) return slot;
  return (
    <div className="slot">
      <span className="slot-label">{label}</span>
      {slot}
    </div>
  );
}

function DropSlot({ title, hint, accept, file, onFile, icon, id, tone }: {
  title: string; hint: string; accept?: string; file: File | null; onFile: (file: File | null) => void;
  icon: IconName; id?: string; tone: "" | "bad";
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const open = () => input.current?.click();
  return (
    <div
      id={id}
      className={`drop${over ? " over" : ""}${file ? " filled" : ""}${tone ? ` ${tone}` : ""}`}
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        const dropped = event.dataTransfer.files.item(0);
        if (dropped) onFile(dropped);
      }}
    >
      <input ref={input} type="file" accept={accept} hidden onClick={(event) => event.stopPropagation()} onChange={(event) => {
         const picked = event.target.files?.[0];
        if (picked) onFile(picked);
        event.target.value = "";
      }} />
      <span className="drop-icon"><Icon name={file ? "check" : icon} size={22} /></span>
      <span className="drop-text">
        <strong>{file ? file.name : title}</strong>
        <small>{file ? `${formatBytes(file.size)} · drop or click to replace` : hint}</small>
      </span>
      {file && (
        <button type="button" className="icon-btn" aria-label="Remove file" onClick={(event) => {
          event.stopPropagation();
          onFile(null);
        }}>
          <Icon name="x" />
        </button>
      )}
    </div>
  );
}

export function KeyField({ label, value, onChange, placeholder, vaultPem, vaultLabel }: {
  label: string; value: string; onChange: (pem: string) => void; placeholder: string; vaultPem?: string; vaultLabel?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const fieldId = `${useId()}pem`;
  const readFile = (file: File | null | undefined) => {
    if (file) void file.text().then(onChange);
  };
  return (
    <div className="field">
      <div className="field-head">
        <label htmlFor={fieldId}>{label}</label>
        <span className="field-actions">
          {vaultPem && vaultPem !== value && (
            <button type="button" className="link-btn" onClick={() => onChange(vaultPem)}>{vaultLabel}</button>
          )}
          <button type="button" className="link-btn" onClick={() => input.current?.click()}>Load .pem</button>
        </span>
      </div>
      <input ref={input} type="file" accept=".pem,.key,.pub,.txt" hidden onChange={(event) => {
        readFile(event.target.files?.[0]);
        event.target.value = "";
      }} />
      <textarea
        id={fieldId}
        className={`pem${over ? " over" : ""}`}
        value={value}
        spellCheck={false}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          readFile(event.dataTransfer.files.item(0));
        }}
      />
    </div>
  );
}

export function PassphraseField({ value, onChange, hint, label = "Shared password", placeholder = "Agreed in person, never sent with the file", inputRef }: {
  value: string;
  onChange: (v: string) => void;
  hint?: ReactNode;
  label?: string;
  placeholder?: string;
  inputRef?: RefObject<HTMLInputElement | null>;
}) {
  const [show, setShow] = useState(false);
  const fieldId = `${useId()}passphrase`;
  return (
    <div className="field">
      <div className="field-head">
        <label htmlFor={fieldId}>{label}</label>
        <button type="button" className="link-btn" onClick={() => setShow(!show)}>{show ? "Hide" : "Show"}</button>
      </div>
      <input id={fieldId} ref={inputRef} type={show ? "text" : "password"} value={value} autoComplete="off"
        placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
      {hint && <small className="field-hint">{hint}</small>}
    </div>
  );
}

/**
 * The one place a screen's primary action lives: the bottom of the form column.
 *
 * `missing` drives the blocked state. The reason block gets a stable id which is handed to
 * the render function, so the button can point at it with aria-describedby and a disabled
 * action can never be silent about why.
 */
