export type PublicQueryErrorReason =
  | "inconsistent_filter_range"
  | "invalid_pagination_cursor"
  | "invalid_region"
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
