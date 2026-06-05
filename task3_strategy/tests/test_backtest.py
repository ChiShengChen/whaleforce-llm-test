"""Correctness tests for the filing-date-aligned backtest engine.

The properties that matter for an honest backtest: no lookahead, the filing-date
boundary is respected, costs are charged, and the benchmark is computed over the
same window.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from task3_strategy.pipeline.backtest import run_backtest
from task3_strategy.schemas import PricePoint, StrategySpec


def _series(closes: list[float], start: date = date(2020, 1, 1)) -> list[PricePoint]:
    pts = []
    for i, c in enumerate(closes):
        o = closes[i - 1] if i else c
        pts.append(PricePoint(
            date=start + timedelta(days=i),
            open=o, high=max(o, c) * 1.0, low=min(o, c) * 1.0, close=c, volume=1_000.0,
        ))
    return pts


def test_buy_and_hold_tracks_benchmark_minus_costs():
    prices = _series([100, 101, 102, 103, 104, 105])
    spec = StrategySpec(entry_signal="buy_and_hold", exit_signal="hold")
    r = run_backtest(prices, spec, start=prices[0].date, transaction_cost_bps=10.0)
    # benchmark over the window:
    assert r.metrics.benchmark_return_pct == pytest.approx(5.0, abs=0.01)
    # strategy buys at bar-1 open and is charged ~2 sides of cost → slightly below
    assert r.metrics.total_return_pct < r.metrics.benchmark_return_pct
    assert r.metrics.total_return_pct > 0


def test_no_lookahead_on_final_bar():
    """A signal that only turns true on the very last close cannot be traded —
    there is no next-bar open to fill against."""
    prices = _series([100, 100, 100, 100, 130])  # momentum only fires at the end
    spec = StrategySpec(entry_signal="momentum", momentum_lookback_days=1,
                        momentum_threshold_pct=5.0, exit_signal="hold")
    r = run_backtest(prices, spec, start=prices[0].date)
    # the +30% jump is on the last bar; no entry should capture it
    assert r.metrics.total_return_pct == pytest.approx(0.0, abs=1e-6)
    assert r.metrics.n_trades == 0


def test_filing_date_boundary_excludes_earlier_bars():
    prices = _series([10, 20, 40, 80, 160, 320])  # huge early run-up
    boundary = prices[3].date  # only the last 3 bars are in-window
    spec = StrategySpec(entry_signal="buy_and_hold")
    r = run_backtest(prices, spec, start=boundary)
    assert r.start_date == boundary
    # benchmark from 80 → 320 = +300%, NOT from 10
    assert r.metrics.benchmark_return_pct == pytest.approx(300.0, abs=0.01)


def test_stop_loss_caps_the_loss():
    # rises then crashes; a 10% stop should cut the loss well above the -50% nadir
    prices = _series([100, 110, 99, 80, 60, 50])
    spec = StrategySpec(entry_signal="buy_and_hold", exit_signal="hold", stop_loss_pct=10.0)
    r = run_backtest(prices, spec, start=prices[0].date)
    # the first exit is the stop firing; buy_and_hold may re-enter next bar, so
    # n_trades can be >1, but the stop must materially beat holding to the bottom
    assert r.metrics.n_trades >= 1
    assert r.trades[0].exit_reason == "stop_loss"
    assert r.metrics.total_return_pct > r.metrics.benchmark_return_pct  # stop helped
    assert r.metrics.total_return_pct > -50  # not held to the -50% bottom


def test_sma_cross_generates_trades():
    closes = [10] * 30 + [11, 12, 13, 14, 15, 16, 17, 18, 19, 20] + [19, 18, 17, 16, 15, 14, 13, 12, 11, 10]
    prices = _series(closes)
    spec = StrategySpec(entry_signal="sma_cross", sma_fast=3, sma_slow=10, exit_signal="sma_reverse")
    r = run_backtest(prices, spec, start=prices[0].date)
    assert r.metrics.n_trades >= 1


def test_insufficient_history_raises():
    prices = _series([100])
    with pytest.raises(RuntimeError):
        run_backtest(prices, StrategySpec(entry_signal="buy_and_hold"), start=prices[0].date)
