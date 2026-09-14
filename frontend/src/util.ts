import { useEffect, useState } from "react";

export type Page = "keys" | "hide" | "verify" | "analyse" | "attacks";

export interface Vault {
  privatePem: string;
  publicPem: string;
  privateFingerprint: string | null;
  publicFingerprint: string | null;
  bits: number | null;
}

/** Files passed from the sender page to the receiver / analysis / attack pages. */
export interface Handoff {
  stego: File;
  cover: File;
  passphrase: string;
  publicPem: string;
  serial: number;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes.toLocaleString()} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function shortHash(hex: string | null | undefined, size = 16): string {
  if (!hex) return "-";
  return hex.length > size ? `${hex.slice(0, size)}…` : hex;
}

export function useObjectUrl(blob: Blob | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const created = URL.createObjectURL(blob);
    setUrl(created);
    return () => URL.revokeObjectURL(created);
  }, [blob]);
  return url;
}

export function useDebounced<T>(value: T, delay: number): T {
  const [current, setCurrent] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setCurrent(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return current;
}

export function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/x-pem-file" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
