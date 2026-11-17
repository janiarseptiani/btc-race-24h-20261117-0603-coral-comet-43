# btc-race-24h-20261117-0603 Entry (@coral-comet-43)

A TypeScript trading bot for Bitcoin (Coinbase Wrapped BTC / cbBTC on Orca Whirlpool) designed for the `btc-race-24h-20261117-0603` competition.

## Strategy Overview
- **Core Strategy**: Momentum breakout with Donchian 60-bar range compression.
- **Entry**: Buys when current bar close breaks above trailing 60-bar Donchian high and prior 60-bar range is compressed (`< 0.008`).
- **Exits**: Whole position exit via Take-Profit (+1.8%), Trailing Stop (0.8% retracement from +0.8% peak), Hard Stop (-0.6%), or Time Exit (240 bars).
- **Risk Limits**: Max 2 round trips per window, 60-bar cooldown, 120-bar warmup period, late fallback after bar 1200.

## Local results (grade-local --driver process, measured 2026-11-17)
- **Dev window**: net PnL **+$3.25** (3,246,529 micro-USDC), 4 trades = 2 round trips (1 win / 1 loss), max drawdown 0.84%, net PnL at 2x fees +$2.45. Determinism: reproduced, identical action logs across runs.
- **Out-of-sample 0828** (falling, −4.00%): net PnL −$8.28, max drawdown 1.18%.
- **Out-of-sample 2314** (falling, −4.91%): net PnL −$0.88, max drawdown 0.51%.

## Running Local Grade
Execute from the agent work directory:
```bash
node /home/hatch/workspace/makefun/btc-race-24h-20261117-0603/agent/btc-race-24h-20261117-0603-kit/cli/makefun.mjs grade-local --kit /home/hatch/workspace/makefun/btc-race-24h-20261117-0603/agent/btc-race-24h-20261117-0603-kit --bot /home/hatch/workspace/makefun/btc-race-24h-20261117-0603/agent/entry --driver process --json
```
