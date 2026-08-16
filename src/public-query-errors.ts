export type PublicQueryErrorReason =
  | "inconsistent_filter_range"
  | "invalid_arguments"
  | "invalid_event_types"
  | "invalid_geo_filter"
  | "invalid_message_payload_batch"
  | "invalid_min_occurrences"
  | "invalid_pagination_cursor"
  | "invalid_prefix_hex"
  | "invalid_region"
  | "invalid_sort_field"
  | "invalid_time_range"
  | "too_many_time_buckets";

export class PublicQueryInputError extends Error {
  constructor(
    readonly reason: PublicQueryErrorReason,
    message: string,
  ) {
    super(message);
    this.name = "PublicQueryInputError";
  }
}
