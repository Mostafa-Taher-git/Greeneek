/** Browser-safe wire types for Deep-agent source health. */

/** One source health record. */
export interface SourceHealth {
  readonly kind: string
  readonly lastPollAt?: string
  readonly lastError?: string
  readonly ingested: number
}
