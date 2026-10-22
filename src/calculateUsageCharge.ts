import { InvalidInputError } from './errors.js';
import type { UsageChargeInput, UsageChargeResult } from './types.js';

/** Arbitrary guard against gross meter/data errors; callers can override per tariff. */
const DEFAULT_HIGH_USAGE_THRESHOLD = 10_000;

function assertFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new InvalidInputError(`${field} must be a finite number, got ${JSON.stringify(value)}`);
  }
  return value;
}

/** Round to the nearest cent. Inputs here are always >= 0, so Math.round's
 * "round half away from zero" behaves as round-half-up. */
function roundToCents(dollars: number): number {
  return Math.round(dollars * 100) / 100;
}

/**
 * Converts a meter reading pair and a tariff into a structured customer
 * charge. Throws InvalidInputError for malformed input (bad request).
 * Returns a result with `warnings` for valid-but-unusual billing data
 * (meter rollover, zero rate, usage spikes) — the charge is still computed
 * so the result stays usable, but flagged for human review.
 */
export function calculateUsageCharge(input: UsageChargeInput): UsageChargeResult {
  const { accountId, meterMaxValue, highUsageThreshold = DEFAULT_HIGH_USAGE_THRESHOLD } = input;

  if (typeof accountId !== 'string' || accountId.trim().length === 0) {
    throw new InvalidInputError('accountId must be a non-empty string');
  }

  const previousReading = assertFiniteNumber(input.previousReading, 'previousReading');
  const currentReading = assertFiniteNumber(input.currentReading, 'currentReading');
  const baseFee = assertFiniteNumber(input.baseFee, 'baseFee');
  const ratePerUnit = assertFiniteNumber(input.ratePerUnit, 'ratePerUnit');

  if (previousReading < 0 || currentReading < 0) {
    throw new InvalidInputError('Meter readings cannot be negative');
  }
  if (baseFee < 0 || ratePerUnit < 0) {
    throw new InvalidInputError('baseFee and ratePerUnit cannot be negative');
  }
  if (meterMaxValue !== undefined && (!Number.isFinite(meterMaxValue) || meterMaxValue <= 0)) {
    throw new InvalidInputError('meterMaxValue must be a positive finite number when provided');
  }

  const warnings: string[] = [];
  let usage: number;

  if (currentReading < previousReading) {
    if (meterMaxValue !== undefined && meterMaxValue > previousReading) {
      usage = meterMaxValue - previousReading + currentReading;
      warnings.push(
        `currentReading (${currentReading}) is less than previousReading (${previousReading}); treated as a meter rollover using meterMaxValue=${meterMaxValue}. Confirm this matches the physical dial before finalizing the bill.`,
      );
    } else {
      usage = 0;
      warnings.push(
        `currentReading (${currentReading}) is less than previousReading (${previousReading}). This may be a meter rollover, a meter swap, or a data error. meterMaxValue was not provided, so usage was set to 0 instead of guessing — route this account for manual review.`,
      );
    }
  } else {
    usage = currentReading - previousReading;
  }

  if (usage > highUsageThreshold) {
    warnings.push(
      `Usage (${usage}) exceeds the configured high-usage threshold (${highUsageThreshold}). The charge was still calculated, but this account should be flagged for a possible leak or meter fault.`,
    );
  }

  if (ratePerUnit === 0) {
    warnings.push(
      'ratePerUnit is 0, so the usage charge will be $0 regardless of usage. Confirm this tariff (e.g. a flat-rate or promotional plan) is intentional.',
    );
  }

  // Only the final dollar amounts are rounded — ratePerUnit may carry
  // sub-cent precision (e.g. $0.12345/unit), which is common in real
  // utility tariffs, so rounding it early would quietly misbill usage.
  const baseCharge = roundToCents(baseFee);
  const usageCharge = roundToCents(usage * ratePerUnit);
  const total = roundToCents(baseCharge + usageCharge);

  return {
    accountId,
    usage,
    baseCharge,
    usageCharge,
    total,
    currency: 'USD',
    warnings,
  };
}
