import type { Analysis } from "../../api";
import { Metric, Panel } from "../../components";

/** Regular/singular groups are a heuristic, never an authenticity verdict. */
export function RsPanel({ rs }: { rs: NonNullable<Analysis["rs"]> }) {
  return (
<Panel title="RS steganalysis"
          subtitle="Regular and singular pixel groups are statistical evidence, not proof of a hidden message.">
          <div className="metrics two">
            <Metric label="Positive mask R / S" value={`${rs.positive.regular.toLocaleString()} / ${rs.positive.singular.toLocaleString()}`}
              reading={`${rs.groups.toLocaleString()} horizontal groups; mask [0,1,1,0].`} />
            <Metric label="Negative mask R / S" value={`${rs.negative.regular.toLocaleString()} / ${rs.negative.singular.toLocaleString()}`}
              reading="Shifted LSB flipping is compared with ordinary flipping." />
            <Metric label="Estimated occupancy" value={rs.estimated_rate === null ? "Inconclusive" : `${(rs.estimated_rate * 100).toFixed(1)}%`}
              reading={rs.reason || "Heuristic estimate; texture and local placement can bias it."} />
          </div>
          <p className="field-hint">How it works: classify adjacent four-pixel groups after positive and negative flips; extrapolate their curves. Natural images, noise, and localized embedding can mislead this estimate. Source: analysis_parts/rs.py.</p>
        </Panel>
  );
}
