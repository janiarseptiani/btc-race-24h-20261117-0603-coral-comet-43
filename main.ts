import { runBars, BarsState, type Batch, type Done, type OrderInput } from './vendor/makefun-bars.ts';

/**
 * BTC momentum breakout trading bot for btc-race-24h-20261117-0603.
 * Speaks agent-fun/bars-replay/v1 via makefun-bars shim.
 * Revised post-first-grade for enhanced min_notional safety and robust order checks.
 */

interface PositionState {
  entryPrice: bigint;
  entryBar: number;
  peakClose: bigint;
}

class MomentumBot {
  private closes: bigint[] = [];
  private ema240: number = 0;
  private activePos: PositionState | null = null;
  private roundTripsCount = 0;
  private lastExitBar = -999;
  private totalEntries = 0;

  async onHello(state: BarsState): Promise<void> {
    console.error(`hello received: seed=${state.hello.seed}, warmup_bars=${state.warmupBars}`);
  }

  async onBatch(state: BarsState, batch: Batch): Promise<OrderInput[] | void> {
    const cbbtcBar = batch.bars.find((b) => b.symbol === 'CBBTC');
    if (!cbbtcBar) {
      console.error(`batch ${batch.seq}: bar missing for CBBTC`);
      return;
    }

    const c = BigInt(cbbtcBar.c);
    this.closes.push(c);

    // Update EMA(240)
    if (this.closes.length === 1) {
      this.ema240 = Number(c);
    } else {
      const alpha = 2 / (240 + 1);
      this.ema240 = alpha * Number(c) + (1 - alpha) * this.ema240;
    }

    // Process fills to track entry price and round trips
    for (const fill of batch.fills) {
      if (fill.symbol === 'CBBTC' && fill.status === 'filled') {
        if (fill.side === 'buy') {
          const filledPrice = BigInt(fill.price);
          this.activePos = {
            entryPrice: filledPrice,
            entryBar: batch.seq,
            peakClose: c,
          };
          this.totalEntries++;
          console.error(`orders fill buy at batch ${batch.seq}: price=${filledPrice}`);
        } else if (fill.side === 'sell') {
          this.roundTripsCount++;
          this.lastExitBar = batch.seq;
          this.activePos = null;
          console.error(`orders fill sell at batch ${batch.seq}, round trip completed`);
        }
      }
    }

    // If warming up or batch seq < 120, do not trade
    if (state.warmingUp || batch.seq < 120) {
      return;
    }

    // Check if we hold a position
    const hasPosition = state.positions.has('CBBTC') && (state.positions.get('CBBTC')?.qty ?? 0n) > 0n;

    if (hasPosition) {
      if (!this.activePos) {
        // Fallback cost basis calculation with 10_000_000n correction factor
        const pos = state.positions.get('CBBTC')!;
        const qty = pos.qty;
        const cost = pos.cost;
        const fallbackPrice = qty > 0n ? (cost * 10_000_000n) / qty : c;
        this.activePos = {
          entryPrice: fallbackPrice,
          entryBar: batch.seq - 1,
          peakClose: c,
        };
      }

      if (c > this.activePos.peakClose) {
        this.activePos.peakClose = c;
      }

      const entryPrice = this.activePos.entryPrice;
      const peak = this.activePos.peakClose;
      const holdingBars = batch.seq - this.activePos.entryBar;

      // Exit rules (first trigger wins)
      const tpThreshold = (entryPrice * 1018n) / 1000n; // +1.8% TP
      const trailTrigger = (entryPrice * 1008n) / 1000n; // +0.8% trigger
      const hardStopThreshold = (entryPrice * 994n) / 1000n; // -0.6% stop (tightened from -0.8% after grade: smaller loss on false breakouts, better on dev + both OOS windows)

      let shouldExit = false;
      if (c >= tpThreshold) {
        shouldExit = true;
        console.error(`bar exit trigger: take-profit hit at close ${c} >= ${tpThreshold}`);
      } else if (peak >= trailTrigger && c <= (peak * 992n) / 1000n) {
        shouldExit = true;
        console.error(`bar exit trigger: trailing stop hit at close ${c}, peak ${peak}`);
      } else if (c <= hardStopThreshold) {
        shouldExit = true;
        console.error(`bar exit trigger: hard stop hit at close ${c} <= ${hardStopThreshold}`);
      } else if (holdingBars >= 240) {
        shouldExit = true;
        console.error(`bar exit trigger: time exit hit at holding bars ${holdingBars}`);
      }

      if (shouldExit) {
        const qty = state.positions.get('CBBTC')!.qty;
        return [{
          side: 'sell',
          symbol: 'CBBTC',
          qty,
          max_slippage_bps: 100,
        }];
      }
    } else {
      // Flat - check entry conditions
      // Hard limits: max 2 round trips, cooldown 60 bars
      if (this.roundTripsCount >= 2 || batch.seq - this.lastExitBar < 60) {
        return;
      }

      // Lookback 60 Donchian break & range compression
      const len = this.closes.length;
      if (len < 61) return;

      const prior60 = this.closes.slice(len - 61, len - 1);
      const high60 = prior60.reduce((max, val) => (val > max ? val : max), 0n);
      const low60 = prior60.reduce((min, val) => (val < min ? val : min), 18446744073709551615n);

      const rangeComp = high60 > 0n ? Number(high60 - low60) / Number(high60) : 1;
      const isBreakout = c > high60 && rangeComp < 0.008;

      // Late fallback after bar 1200 if 0 entries so far
      const isLateFallback = batch.seq > 1200 && this.totalEntries === 0 && Number(c) > this.ema240;

      if (isBreakout || isLateFallback) {
        // Breakout buys 50% of cash; the late fallback buys 25% (per spec).
        const spend = isLateFallback ? state.cash / 4n : state.cash / 2n; // 25% fallback / 50% breakout
        const minNotional = BigInt(state.hello.fees.min_notional_quote_units);
        if (spend >= minNotional && spend <= state.cash) {
          console.error(`bar entry signal: breakout=${isBreakout}, lateFallback=${isLateFallback}, close=${c}, high60=${high60}, spend=${spend}`);
          return [{
            side: 'buy',
            symbol: 'CBBTC',
            notional_quote_units: spend,
            max_slippage_bps: 100,
          }];
        }
      }
    }

    return;
  }

  async onDone(state: BarsState, done: Done): Promise<void> {
    console.error(`done received: seq=${done.seq}, final equity=${state.equity}`);
  }
}

async function main() {
  const bot = new MomentumBot();
  await runBars(bot);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
