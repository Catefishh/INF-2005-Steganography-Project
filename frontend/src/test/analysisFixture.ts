import type { Analysis } from "../api";

export const analysisExtras: Pick<Analysis, "chi_square_details" | "bpcs" | "durations_ms"> = {
  chi_square_details: {
    method: "westfeld-pfitzmann-pairs-of-values", pair_count: 128, minimum_expected_count: 5,
    segment_count: 2, presentation_heuristic: 0.95, descriptive_only: true,
    explanation: {
      high_p_value: "A high p-value is consistent with equalised pairs produced by random LSB replacement; it does not prove embedding.",
      limitations: ["Texture or naturally noisy data can equalise pairs.", "Flat regions and small samples can weaken the approximation."],
    },
    overall: { sample_count: 64, valid_category_count: 2, degrees_of_freedom: 1, statistic: 0, p_value: 1, interpretable: true, reason: null },
    segments: [
      { index: 0, start: 0, end: 32, sample_count: 32, valid_category_count: 2, degrees_of_freedom: 1, statistic: 0, p_value: 1, interpretable: true, reason: null },
      { index: 1, start: 32, end: 64, sample_count: 32, valid_category_count: 0, degrees_of_freedom: null, statistic: null, p_value: null, interpretable: false, reason: "At least two value pairs with expected count >= 5 are required." },
    ],
  },
  bpcs: {
    supported: true, reason: null,
    config: { channel: 0, block_size: 8, bit_plane_start: 0, bit_plane_end: 7, complexity_threshold: 0.3, partial_block_policy: "include-valid-adjacencies" },
    image: { width: 8, height: 8 },
    planes: [{
      bit_plane: 0, block_rows: 1, block_columns: 1, block_count: 1, complex_blocks: 1, non_complex_blocks: 0, complex_percent: 100,
      transition_count: 112, possible_transition_count: 112, transition_ratio: 1, mean_complexity: 1, minimum_complexity: 1, maximum_complexity: 1,
      capacity_bits: 64, capacity_bytes_floor: 8, capacity_remainder_bits: 0,
      complexity_map: "data:image/png;base64,x", classification_map: "data:image/png;base64,x", map_rows: 1, map_columns: 1, map_block_stride: 1,
    }],
    summary: { selected_plane_count: 1, block_count: 1, complex_blocks: 1, non_complex_blocks: 0, complex_percent: 100,
      transition_count: 112, possible_transition_count: 112, transition_ratio: 1, mean_complexity: 1, minimum_complexity: 1, maximum_complexity: 1,
      capacity_bits: 64, capacity_bytes_floor: 8, capacity_remainder_bits: 0 },
    comparison: null,
  },
  durations_ms: { load: 1, bit_planes: 2, histogram: 1, chi_square: 1, bpcs: 3, difference: 1, total: 9 },
};
