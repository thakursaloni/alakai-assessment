# Reliable Usage Charge Calculator

Converts a meter reading pair and a tariff into a structured customer charge.
Built for the Alaka'i Senior Full-Stack take-home exercise.

## How to run

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # vitest run — 12 tests
npm run build       # emits dist/
```

Try it directly:

```ts
import { calculateUsageCharge } from './src/index.js';

calculateUsageCharge({
  accountId: 'acct-123',
  previousReading: 1000,
  currentReading: 1050,
  baseFee: 10,
  ratePerUnit: 0.18,
});
// { accountId: 'acct-123', usage: 50, baseCharge: 10, usageCharge: 9,
//   total: 19, currency: 'USD', warnings: [] }
```

## Design

- `calculateUsageCharge(input): UsageChargeResult` — pure function, no I/O.
- Two different failure modes, kept deliberately distinct:
  - **`InvalidInputError` (thrown)** — the request is malformed: non-numeric
    or negative readings, a negative tariff, an empty `accountId`. This is a
    caller/schema bug, so it should fail loudly and map to an HTTP 400.
  - **`warnings: string[]` (returned)** — the request is well-formed but the
    *billing data* is unusual (a meter rollover, a zero-rate tariff, an
    abnormal usage spike). The charge is still computed so the result stays
    usable, but it's flagged for a human to review rather than silently
    trusted. Billing software that crashes or blocks on every odd-but-valid
    reading creates an operational bottleneck; software that guesses
    silently creates a billing dispute. Warnings let the same result serve
    automated billing in the common case and manual review in the edge case.

## Edge cases handled

1. **Decreasing reading / meter rollover** — `currentReading < previousReading`.
   Real meters roll over (e.g. a 5-digit dial wraps at 99999) or get
   replaced. Without knowing the dial's max value we cannot safely infer
   usage, so by default usage is set to `0` with a warning rather than
   guessing a number that could over- or under-bill the customer. An
   optional `meterMaxValue` lets a caller who *does* know the dial opt into
   rollover math (`usage = (meterMaxValue - previous) + current`).
2. **Zero usage** (`current === previous`) — valid (e.g. vacant property,
   seasonal shutoff). Only the base fee is charged; no warning.
3. **Unusually high usage** — usage above a configurable
   `highUsageThreshold` (default 10,000 units) is still billed but flagged,
   since a spike this size is more often a leak or a misread digit than
   real consumption.
4. **Zero-rate tariff** (`ratePerUnit === 0`) — valid for flat-rate/promo
   plans, but flagged since it's easy to enter by mistake.
5. **Malformed input** — non-numeric/non-finite readings, negative
   readings, negative `baseFee`/`ratePerUnit`, empty `accountId`, or a
   non-positive `meterMaxValue`. These throw `InvalidInputError` instead of
   producing a charge, since there's no safe guess to fall back to.
6. **Sub-cent tariff rates** — real utility rates are often priced to more
   than two decimal places (e.g. `$0.12345`/unit). Rounding the rate itself
   to cents before multiplying would silently distort every bill at scale,
   so only the final `baseCharge`, `usageCharge`, and `total` are rounded
   (round-half-up, since all billing inputs are non-negative).

## Assumptions (requirements were intentionally incomplete)

- **Money representation**: inputs/outputs are plain `number` in dollars
  (e.g. `19.99`), not integer cents or a decimal library. This keeps the
  API ergonomic for this exercise; a production system handling real money
  should use integer minor units (cents) or a decimal type end-to-end to
  eliminate float drift entirely — see Trade-offs below.
- **Single currency**: hardcoded `'USD'`. Multi-currency would need a
  currency-aware amount type and FX-free comparisons.
- **No persistence / no account lookup**: the tariff and readings are
  passed in directly rather than fetched by `accountId`; per the exercise
  boundary, this function has no I/O.
- **Meter rollover max is unknown unless supplied**: I chose "don't guess"
  over "assume a common dial size (e.g. 99999)" because a wrong guess
  produces a wrong invoice, which is worse than a flagged-for-review $0
  usage charge.
- **Usage can be fractional**: some meters (e.g. calibrated/sub-metered)
  report non-integer readings, so `usage` is not rounded or truncated.
- **`highUsageThreshold` is a static, caller-overridable default**, not a
  per-account historical baseline (e.g. "3x last month") — that needs
  historical data this function doesn't have access to.

## Trade-offs / what I'd change for production

- **Decimal precision**: `number` is fine up to ~2^53 and this function
  only rounds once at the end, but a real billing ledger should use an
  integer-cents or arbitrary-precision decimal type (e.g. `decimal.js`) to
  guarantee no float error can ever accumulate across millions of bills.
- **Rollover heuristic**: currently binary (guess with `meterMaxValue`, or
  punt to review). A production system would likely also sanity-check the
  *inferred* rollover usage against the account's historical usage before
  trusting it, and log an audit trail of which branch fired.
- **Warnings are strings**: fine for a human-readable API response, but a
  production system would want a typed `warnings: { code, message, severity }[]`
  so downstream systems (e.g. a review queue) can route on `code` instead
  of regexing message text.

## Exposing this through an API, and operating it safely

- **Endpoint**: `POST /v1/accounts/:accountId/charges` — compute-only, no
  side effects, so it's safe to retry and safe to call speculatively (e.g.
  for a bill preview) without double-charging anything.
- **Validation boundary**: `InvalidInputError` maps to `400 Bad Request`
  with the thrown message; anything else is a `500` and should page
  on-call, since it means the function broke an invariant it's supposed to
  guarantee.
- **Never silently auto-bill a warning**: a response with a non-empty
  `warnings` array should land in a review queue before the charge is
  finalized/sent to the customer, not just get logged. The function
  guarantees it *can* compute a number even in odd cases; it does not
  guarantee that number should go straight to an invoice.
- **Observability**: emit a metric per warning type (rollover count, high-usage
  count, zero-rate count) so an operator notices a sudden spike (e.g. a
  batch of meters with a data feed bug) before it becomes a wave of
  customer disputes, not after.
- **Idempotency**: since this is a pure function of its inputs, the same
  request always produces the same result — no idempotency key needed at
  this layer, but the caller that persists the charge does need one, so a
  retried HTTP request can't create two invoice line items.
- **Backward compatibility**: `UsageChargeInput` is intentionally only the
  five required fields plus two optional ones with defaults, so adding
  future optional fields (e.g. `meterMaxValue`, `highUsageThreshold`) never
  breaks existing callers.

## AI / work log

- **Delegated to AI**: scaffolding the TypeScript project (package.json,
  tsconfig, vitest config) and drafting the initial edge-case list and
  test matrix from the exercise prompt.
- **Verified**: ran `npm run typecheck` and `npm test` myself after every
  change; recalculated the sub-cent rounding test case by hand
  (`1234 × 0.12345 = 152.3373 → $152.34`) after the first version of that
  test had a wrong expected value and failed on first run.
- **Corrected**: switched the rounding strategy mid-build — the first draft
  rounded `ratePerUnit` to cents before multiplying by usage, which would
  silently misbill any tariff with sub-cent pricing (common for utilities);
  changed it to round only the final dollar amounts.
- **Chose myself**: the split between throwing `InvalidInputError` for
  malformed input versus returning `warnings` for valid-but-unusual billing
  data — this distinction isn't in the prompt, but it's the core design
  decision for "safe failure behavior" in a billing context.
- **Chose myself**: punting on meter rollover by default (usage = 0 +
  warning) rather than assuming a common dial size, since a wrong guess
  produces a wrong invoice and this function has no way to know the real
  dial size.

## Why utility billing shaped one decision

Utility rates routinely price below a cent per unit, so I rejected rounding
`ratePerUnit` to the nearest cent before multiplying by usage — at the scale
of a real utility customer base, that would quietly shift every bill by a
small but systematic amount. I also chose not to guess at meter rollover
math by default: in a domain where a wrong number becomes a disputed
invoice and a support ticket, a flagged $0 is a safer failure than a
confident wrong one.
