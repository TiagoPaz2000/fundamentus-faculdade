"use client";

import { useEffect, useRef } from "react";

export type Candle = {
  time: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
};

export type PriceMark = {
  kind: "buy" | "sell";
  date: string; // YYYY-MM-DD
  price: number;
  label: string;
};

/** Ajusta a data de um marcador para o primeiro candle >= data (ou o último). */
function snapToCandle(date: string, times: string[]): string {
  for (const t of times) if (t >= date) return t;
  return times[times.length - 1];
}

export function CandleChart({ candles, marks }: { candles: Candle[]; marks: PriceMark[] }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || candles.length === 0) return;
    let disposed = false;
    let cleanup: (() => void) | undefined;

    (async () => {
      const lw = await import("lightweight-charts");
      if (disposed) return;
      const dark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
      const text = dark ? "#d4d4d8" : "#3f3f46";
      const grid = dark ? "#27272a" : "#f4f4f5";

      const chart = lw.createChart(el, {
        autoSize: true,
        layout: {
          background: { type: lw.ColorType.Solid, color: "transparent" },
          textColor: text,
          fontFamily: "inherit",
        },
        grid: { vertLines: { color: grid }, horzLines: { color: grid } },
        rightPriceScale: { borderVisible: false },
        timeScale: { borderVisible: false },
        localization: {
          locale: "pt-BR",
          priceFormatter: (p: number) =>
            p.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 }),
        },
        crosshair: { mode: lw.CrosshairMode.Normal },
      });

      const series = chart.addSeries(lw.CandlestickSeries, {
        upColor: "#16a34a",
        downColor: "#dc2626",
        borderVisible: false,
        wickUpColor: "#16a34a",
        wickDownColor: "#dc2626",
      });
      series.setData(
        candles.map((c) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close })),
      );

      if (candles.some((c) => c.volume !== null && c.volume > 0)) {
        const volume = chart.addSeries(lw.HistogramSeries, {
          priceFormat: { type: "volume" },
          priceScaleId: "volume",
          lastValueVisible: false,
          priceLineVisible: false,
        });
        volume.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
        volume.setData(
          candles
            .filter((c) => c.volume !== null)
            .map((c) => ({
              time: c.time,
              value: c.volume ?? 0,
              color: c.close >= c.open ? "rgba(22,163,74,0.35)" : "rgba(220,38,38,0.35)",
            })),
        );
        series.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.25 } });
      }

      for (const m of marks) {
        series.createPriceLine({
          price: m.price,
          color: m.kind === "buy" ? "#2563eb" : "#ea580c",
          lineWidth: 1,
          lineStyle: lw.LineStyle.Dashed,
          axisLabelVisible: true,
          title: m.label,
        });
      }

      const times = candles.map((c) => c.time);
      const markers = marks
        .map((m) => ({
          time: snapToCandle(m.date, times),
          position: m.kind === "buy" ? ("belowBar" as const) : ("aboveBar" as const),
          shape: m.kind === "buy" ? ("arrowUp" as const) : ("arrowDown" as const),
          color: m.kind === "buy" ? "#2563eb" : "#ea580c",
          text: m.kind === "buy" ? "C" : "V",
        }))
        .sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
      lw.createSeriesMarkers(series, markers);

      chart.timeScale().fitContent();
      cleanup = () => chart.remove();
    })();

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [candles, marks]);

  return <div ref={containerRef} className="h-[420px] w-full" />;
}
