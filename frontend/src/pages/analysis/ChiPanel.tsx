import type { Analysis } from "../../api";
import { chiCounts } from "../../analysis";
import { ChiStrip, Icon, Metric, Panel } from "../../components";

/** Westfeld-Pfitzmann pairs of values, shown with its interpretation limits. */
export function ChiPanel({ analysis }: { analysis: Analysis }) {
  const chi = chiCounts(analysis);
  const compare = analysis.compare;
  return (
        <Panel title="Statistical test"
          subtitle="Each bar is one section of the file, in the order data would be written. A high bar means the value pairs (2i, 2i+1) have been evened out, which is what writing random encrypted bits into the lowest bit does.">
          <ChiStrip values={analysis.chi_square} />
          <div className="legend">
            <span><i style={{ background: "var(--teal)" }} /> under 0.5 — lower p-value</span>
            <span><i style={{ background: "var(--amber)" }} /> 0.5 to 0.95 — unclear</span>
            <span><i style={{ background: "var(--coral)" }} /> 0.95 and over — high p-value</span>
          </div>
          <div className="metrics two">
            <Metric label="Per section" value={`${chi.flagged} of ${chi.total}`} tone={chi.flagged ? "warn" : "good"}
              reading={`${chi.flagged === chi.total && chi.total > 0 ? "Every" : chi.flagged === 0 ? "No" : `${chi.flagged}`} section${chi.total === 1 ? "" : "s"} scored 0.95 or above when measured on its own.`} />
            <Metric label="Whole file at once" value={chi.overall === null ? "not enough data" : chi.overall.toFixed(4)}
              reading="The same test applied to the file as one block." />
          </div>
          {analysis.chi_square_details && <p className="field-hint">
            {analysis.chi_square_details.method}: {analysis.chi_square_details.overall.valid_categories} valid value pairs
            from {analysis.chi_square_details.overall.sample_count.toLocaleString()} samples.
            The 0.95 marker is a presentation heuristic. Texture, flat regions, small samples and preprocessing can
            produce misleading readings; other embedding methods may evade this test.
          </p>}
          {chi.flagged > 0 && (
            <div className="note note-warn">
              <Icon name="alert" size={16} />
              <span>
                <b>Read this one with care.</b> {chi.flagged} of {chi.total} sections are flagged, while the whole-file
                figure is {chi.overall === null ? "not available" : chi.overall.toFixed(4)}. Very flat or very noisy files
                make this test say "embedded" whether or not anything is. On 16-bit or deeper audio the lowest byte is
                already noise-like, so the test is only indicative there.{" "}
                {compare ? "The exact comparison above is the stronger signal." : "Supplying the original is what turns this into an exact answer."}
              </span>
            </div>
          )}
        </Panel>

  );
}
