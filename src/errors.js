/** Every reason code a run can fail with. Fixtures may only expect these. */
export const REASONS = [
  // Transport
  'fetch-failed',
  // Response envelope
  'unexpected-response-shape',
  'item-identity-mismatch',
  // Schedule text
  'unknown-line',
  'unknown-group',
  'missing-groups',
  'duplicate-group',
  'invalid-date',
  'invalid-time',
  'off-grid-time',
  'empty-or-reversed-interval',
  'overlapping-intervals',
  'implausible-interval-count',
  // Snapshot plausibility
  'date-out-of-range',
  'updated-at-in-future',
  'inconsistent-days',
  'schema-violation',
  // Last-known-good protection
  'empty-would-overwrite',
  'source-regressed',
  'previous-unavailable',
];

/** A source or snapshot problem that must stop publication. `reason` is a stable machine code. */
export class ValidationError extends Error {
  constructor(reason, message, details = {}) {
    if (!REASONS.includes(reason)) throw new Error(`Unknown validation reason: ${reason}`);
    super(`[${reason}] ${message}`);
    this.name = 'ValidationError';
    this.reason = reason;
    this.details = details;
  }
}
