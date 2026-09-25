import { useState } from "react";

function mark(text: string) {
  return text
    .replaceAll("\u200b", "⟦ZWSP⟧")
    .replaceAll("\u200c", "⟦ZWNJ⟧")
    .replace(/ +$/gm, (spaces) => `⟦${"·".repeat(spaces.length)}⟧`)
    .replace(/\t+$/gm, (tabs) => `⟦${"→".repeat(tabs.length)}⟧`);
}

function counts(text: string) {
  return {
    zeroWidth: [...text].filter((character) => character === "\u200b" || character === "\u200c").length,
    trailingSpaces: text.split("\n").filter((line) => / +$/.test(line)).length,
    trailingTabs: text.split("\n").filter((line) => /\t+$/.test(line)).length,
  };
}

export function CharacterChanges({ before, after, method }: { before: string; after: string; method: string }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"visible" | "encoded">("visible");
  const visible = before || "(generated after protection)";
  const encoded = after || visible;
  const stats = counts(encoded);
  const methodLabel = method === "acrostic" ? "line initials" : method === "whitespace" ? "trailing whitespace" : "zero-width characters";

  return <section className={`character-evidence${open ? " open" : ""}`}>
    <button type="button" className="character-toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <span><strong>Character changes</strong><small>Inspect the {methodLabel} used by this carrier</small></span>
      <span className="character-toggle-icon" aria-hidden="true">{open ? "−" : "+"}</span>
    </button>
    {open && <div className="character-body">
      <div className="segmented" role="tablist" aria-label="Character evidence view">
        <button type="button" role="tab" aria-selected={view === "visible"} className={view === "visible" ? "on" : ""} onClick={() => setView("visible")}>Visible text</button>
        <button type="button" role="tab" aria-selected={view === "encoded"} className={view === "encoded" ? "on" : ""} onClick={() => setView("encoded")}>Encoded carrier</button>
      </div>
      <pre className="character-code" aria-label={view === "visible" ? "Visible text" : "Encoded carrier"}>{mark(view === "visible" ? visible : encoded)}</pre>
      <div className="character-meta">
        <span>{stats.zeroWidth} zero-width symbols</span>
        <span>{stats.trailingSpaces} lines with trailing spaces</span>
        <span>{stats.trailingTabs} lines with trailing tabs</span>
      </div>
      <p className="field-hint">Markers: <code>·</code> space, <code>→</code> tab, <code>ZWSP</code>/<code>ZWNJ</code> zero-width symbols. Visible wording is not authenticated.</p>
    </div>}
  </section>;
}
