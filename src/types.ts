export interface UsageChargeInput {
  accountId: string;
  previousReading: number;
  currentReading: number;
  baseFee: number;
  ratePerUnit: number;
  /**
   * Dial rollover point for the meter (e.g. a 5-digit mechanical dial rolls
   * over at 99999). Only used when currentReading < previousReading.
   * Omit it if unknown: the calculator will not guess.
   */
  meterMaxValue?: number;
  /** Usage above this is flagged (not blocked) for manual review. */
  highUsageThreshold?: number;
}

export interface UsageChargeResult {
  accountId: string;
  usage: number;
  baseCharge: number;
  usageCharge: number;
  total: number;
  currency: 'USD';
  warnings: string[];
}
