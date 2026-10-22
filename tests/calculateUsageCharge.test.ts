import { describe, expect, it } from 'vitest';
import { calculateUsageCharge } from '../src/calculateUsageCharge.js';
import { InvalidInputError } from '../src/errors.js';

describe('calculateUsageCharge — happy path', () => {
  it('computes base charge + usage charge for a normal reading pair', () => {
    const result = calculateUsageCharge({
      accountId: 'acct-1',
      previousReading: 100,
      currentReading: 150,
      baseFee: 10,
      ratePerUnit: 0.5,
    });

    expect(result).toEqual({
      accountId: 'acct-1',
      usage: 50,
      baseCharge: 10,
      usageCharge: 25,
      total: 35,
      currency: 'USD',
      warnings: [],
    });
  });

  it('rounds sub-cent tariff rates only at the final step', () => {
    // 1234 units * $0.12345/unit = $152.3373 -> rounds to $152.34
    const result = calculateUsageCharge({
      accountId: 'acct-2',
      previousReading: 0,
      currentReading: 1234,
      baseFee: 9.99,
      ratePerUnit: 0.12345,
    });

    expect(result.usageCharge).toBe(152.34);
    expect(result.baseCharge).toBe(9.99);
    expect(result.total).toBe(162.33);
  });
});

describe('calculateUsageCharge — edge cases', () => {
  it('handles zero usage with no warnings', () => {
    const result = calculateUsageCharge({
      accountId: 'acct-3',
      previousReading: 200,
      currentReading: 200,
      baseFee: 15,
      ratePerUnit: 0.3,
    });

    expect(result.usage).toBe(0);
    expect(result.usageCharge).toBe(0);
    expect(result.total).toBe(15);
    expect(result.warnings).toEqual([]);
  });

  it('flags a decreasing reading as a possible rollover and does not guess usage', () => {
    const result = calculateUsageCharge({
      accountId: 'acct-4',
      previousReading: 500,
      currentReading: 20,
      baseFee: 10,
      ratePerUnit: 1,
    });

    expect(result.usage).toBe(0);
    expect(result.usageCharge).toBe(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/rollover/i);
  });

  it('computes rollover usage correctly when meterMaxValue is supplied', () => {
    const result = calculateUsageCharge({
      accountId: 'acct-5',
      previousReading: 99980,
      currentReading: 20,
      baseFee: 10,
      ratePerUnit: 1,
      meterMaxValue: 99999,
    });

    // (99999 - 99980) + 20 = 39
    expect(result.usage).toBe(39);
    expect(result.usageCharge).toBe(39);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/meterMaxValue/);
  });

  it('flags unusually high usage but still bills it', () => {
    const result = calculateUsageCharge({
      accountId: 'acct-6',
      previousReading: 0,
      currentReading: 50_000,
      baseFee: 10,
      ratePerUnit: 0.1,
      highUsageThreshold: 10_000,
    });

    expect(result.usage).toBe(50_000);
    expect(result.usageCharge).toBe(5000);
    expect(result.warnings.some((w) => /high-usage threshold/i.test(w))).toBe(true);
  });

  it('flags a zero-rate tariff as a soft warning while still returning a valid result', () => {
    const result = calculateUsageCharge({
      accountId: 'acct-7',
      previousReading: 0,
      currentReading: 100,
      baseFee: 20,
      ratePerUnit: 0,
    });

    expect(result.usageCharge).toBe(0);
    expect(result.total).toBe(20);
    expect(result.warnings.some((w) => /ratePerUnit is 0/.test(w))).toBe(true);
  });
});

describe('calculateUsageCharge — invalid input (fails safely, does not guess)', () => {
  it('rejects an empty accountId', () => {
    expect(() =>
      calculateUsageCharge({
        accountId: '',
        previousReading: 0,
        currentReading: 10,
        baseFee: 10,
        ratePerUnit: 1,
      }),
    ).toThrow(InvalidInputError);
  });

  it('rejects non-numeric readings', () => {
    expect(() =>
      calculateUsageCharge({
        accountId: 'acct-8',
        previousReading: Number.NaN,
        currentReading: 10,
        baseFee: 10,
        ratePerUnit: 1,
      }),
    ).toThrow(InvalidInputError);
  });

  it('rejects negative readings', () => {
    expect(() =>
      calculateUsageCharge({
        accountId: 'acct-9',
        previousReading: -5,
        currentReading: 10,
        baseFee: 10,
        ratePerUnit: 1,
      }),
    ).toThrow(InvalidInputError);
  });

  it('rejects a negative tariff', () => {
    expect(() =>
      calculateUsageCharge({
        accountId: 'acct-10',
        previousReading: 0,
        currentReading: 10,
        baseFee: -1,
        ratePerUnit: 1,
      }),
    ).toThrow(InvalidInputError);
  });

  it('rejects a non-positive meterMaxValue', () => {
    expect(() =>
      calculateUsageCharge({
        accountId: 'acct-11',
        previousReading: 50,
        currentReading: 10,
        baseFee: 10,
        ratePerUnit: 1,
        meterMaxValue: 0,
      }),
    ).toThrow(InvalidInputError);
  });
});
