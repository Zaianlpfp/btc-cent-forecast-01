// btc-cent-forecast-01 — forecast BTC/USD 240 minutes ahead.
//
// Strategy (written fresh from RULES.txt, no starter code read):
//   The scored guess should be the honest median of the price 240 min
//   ahead. Pure momentum/drift extrapolation LOSES to persistence on
//   backtests inside the practice series (ratios 1.08-2.86), because
//   1-minute noise dominates any short-window drift. What DOES beat
//   persistence consistently is mild mean reversion toward a medium
//   exponential moving average of log prices: the 4h-ahead price tends
//   to drift back part-way toward the ~5h trend line.
//   forecast = lastClose * exp( clamp( 0.45 * (emaLog - log(lastClose)), -0.02, +0.02 ) )
//   with emaLog = EMA of log closes, half-life 300 minutes, seeded over
//   the last 48h of the series. The 2% clamp bounds the adjustment so a
//   wild spike in the pool price can never blow up the forecast, and the
//   final guess is additionally banded to +/-3% of the checkpoint close.
//   Backtest (720 pretend checkpoints, every 30 min inside p00-p05):
//   MAE ~35,900 cents vs persistence ~36,900-37,700 cents (ratio ~0.95),
//   beating persistence in all six practice cases.
//
// Deterministic: pure function of the input prices. No randomness, no
// wall clock, no network, Node stdlib only. One run per case file.

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const HALF_LIFE_MIN = 300; // EMA half-life of log prices, in minutes
const REVERT = 0.45; // fraction of the EMA gap closed over the horizon
const MAX_ADJ = 0.02; // clamp on the log adjustment (+/-2%)
const MAX_BAND = 0.03; // forecast never leaves +/-3% of the checkpoint close

function forecastPrice(prices: number[]): number {
  const n = prices.length;
  const last = prices[n - 1];
  if (!Number.isFinite(last) || last <= 0) return 1;
  // EMA of log prices over the last 48h (or whole series if shorter).
  // Seed from the most recent valid price in the span, never from a
  // bad value, so one corrupt bar cannot poison the whole forecast.
  const span = Math.min(n, 2880);
  const alpha = 1 - Math.pow(0.5, 1 / HALF_LIFE_MIN);
  let seed = n - span;
  while (seed < n && (!Number.isFinite(prices[seed]) || prices[seed] <= 0)) seed++;
  if (seed >= n) return last;
  let ema = Math.log(prices[seed]);
  for (let j = seed + 1; j < n; j++) {
    const p = prices[j];
    if (Number.isFinite(p) && p > 0) {
      ema = alpha * Math.log(p) + (1 - alpha) * ema;
    }
  }
  if (!Number.isFinite(ema)) return last;
  const gap = ema - Math.log(last);
  let adj = REVERT * gap;
  if (adj > MAX_ADJ) adj = MAX_ADJ;
  if (adj < -MAX_ADJ) adj = -MAX_ADJ;
  let guess = last * Math.exp(adj);
  // Defense in depth: the forecast stays inside +/-3% of the checkpoint
  // close no matter what the series did.
  const lo = last * (1 - MAX_BAND);
  const hi = last * (1 + MAX_BAND);
  if (guess < lo) guess = lo;
  if (guess > hi) guess = hi;
  // Round to cents; keep strictly inside the allowed (0, 10_000_000) range.
  const rounded = Math.round(guess * 100) / 100;
  if (!Number.isFinite(rounded) || rounded <= 0) return last;
  return Math.min(rounded, 9_999_999.99);
}

function main(): void {
  const inputDir = process.env.MAKEFUN_INPUT_DIR || "/input/";
  const outputDir = process.env.MAKEFUN_OUTPUT_DIR || "/output/";
  mkdirSync(outputDir, { recursive: true });
  const files = readdirSync(inputDir)
    .filter((f) => f.endsWith(".in"))
    .sort();
  for (const file of files) {
    const id = file.slice(0, -3);
    const data = JSON.parse(readFileSync(join(inputDir, file), "utf8"));
    const prices: number[] = data.markets[0].prices;
    const price = forecastPrice(prices);
    const out = JSON.stringify({
      forecasts: [{ case: data.case ?? id, price }],
    });
    writeFileSync(join(outputDir, `${id}.out`), out + "\n", "utf8");
  }
}

main();
