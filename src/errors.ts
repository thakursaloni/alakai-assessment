/**
 * Thrown for malformed input: a caller/schema bug, not a billing edge case.
 * Keeping this distinct from `warnings` lets the API return 400s for bad
 * requests while still returning 200s with warnings for valid-but-unusual
 * billing data (e.g. a meter rollover).
 */
export class InvalidInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidInputError';
  }
}
