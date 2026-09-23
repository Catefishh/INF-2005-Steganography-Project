import type { Analysis } from "../../api";
import { Panel } from "../../components";

export function BpcsPanel({ result }: { result: NonNullable<Analysis["bpcs"]> }) {
  return <Panel title="Bit-plane complexity segmentation"
    subtitle="Complex blocks may have room for hidden data. The maps provide descriptive evidence.">
    {!result.supported ? <p className="field-hint">{result.reason}</p> : <>
      <p className="field-hint">Block {result.configuration.block_size} px · planes {result.configuration.first_plane}–{result.configuration.last_plane}
        · threshold {result.configuration.threshold}. Estimated raw complex-block capacity:
        {" "}{result.estimated_capacity_bits?.toLocaleString()} bits. {result.edge_policy}</p>
      <div className="columns">
        {result.planes?.map((plane) => <div key={plane.bit_plane}>
          <h3>Plane {plane.bit_plane}</h3>
          <p className="field-hint">{plane.complex_blocks} of {plane.blocks} blocks complex ({plane.complex_percent.toFixed(1)}%).
            {plane.comparison && ` ${plane.comparison.classification_flips} classifications changed against the original.`}</p>
          <div className="planes two">
            <figure><img src={plane.complexity_map} alt={`Complexity map for plane ${plane.bit_plane}`} /><figcaption>Complexity</figcaption></figure>
            <figure><img src={plane.classification_map} alt={`Complex block map for plane ${plane.bit_plane}`} /><figcaption>Complex blocks</figcaption></figure>
          </div>
        </div>)}
      </div>
    </>}
  </Panel>;
}
