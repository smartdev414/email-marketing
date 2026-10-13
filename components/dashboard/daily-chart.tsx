"use client";

import { useEffect, useRef, useState } from "react";

import type { DailyActivity } from "@/lib/stats";

type Metric = Exclude<keyof DailyActivity, "day">;

type Series = { key: Metric; label: string; color: string };

type Props = {
  data: DailyActivity[];
  series: Series[];
  /** Stacked: the series are parts of one total. Grouped: side-by-side bars. */
  layout: "stacked" | "grouped";
  /** Read by screen readers in place of the bars. */
  summary: string;
};

const HEIGHT = 200;
const MARGIN = { top: 8, right: 4, bottom: 24, left: 36 };
const MAX_BAR = 24;
const GAP = 2;
const RADIUS = 4;

/** Rounded data end, square at the baseline. */
function columnPath(x: number, y: number, width: number, height: number, rounded: boolean) {
  const r = rounded ? Math.min(RADIUS, width / 2, height) : 0;
  return [
    `M${x},${y + height}`,
    `V${y + r}`,
    r ? `Q${x},${y} ${x + r},${y}` : "",
    `H${x + width - r}`,
    r ? `Q${x + width},${y} ${x + width},${y + r}` : "",
    `V${y + height}`,
    "Z",
  ].join(" ");
}

/** A round axis maximum (1, 2, 2.5 or 5 × 10ⁿ) with four even steps below it. */
function niceMax(value: number) {
  if (value <= 4) return 4;
  const step = value / 4;
  const magnitude = 10 ** Math.floor(Math.log10(step));
  const nice = [1, 2, 2.5, 5, 10].find((factor) => factor * magnitude >= step) ?? 10;
  return nice * magnitude * 4;
}

function formatDay(day: string, withWeekday = false) {
  const date = new Date(`${day}T12:00:00Z`);
  return date.toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    ...(withWeekday ? { weekday: "short" } : {}),
  });
}

export function DailyChart({ data, series, layout, summary }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hovered, setHovered] = useState<number | null>(null);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const plotWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const band = data.length ? plotWidth / data.length : 0;

  const peak = Math.max(
    0,
    ...data.map((row) =>
      layout === "stacked"
        ? series.reduce((total, s) => total + row[s.key], 0)
        : Math.max(...series.map((s) => row[s.key])),
    ),
  );
  const yMax = niceMax(peak);
  const y = (value: number) => MARGIN.top + plotHeight - (value / yMax) * plotHeight;
  const ticks = [0, 1, 2, 3, 4].map((step) => (yMax / 4) * step);

  // Grouped bars share the band; each bar stays thin and leaves air around it.
  const groupWidth = Math.min(band * 0.7, layout === "stacked" ? MAX_BAR : MAX_BAR * series.length);
  const barWidth =
    layout === "stacked"
      ? groupWidth
      : Math.max(1, (groupWidth - GAP * (series.length - 1)) / series.length);

  const labelEvery = Math.max(1, Math.ceil(data.length / Math.max(1, Math.floor(plotWidth / 64))));
  const active = hovered === null ? null : data[hovered];

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {series.map((s) => (
          <span key={s.key} className="text-muted-foreground flex items-center gap-1.5">
            <span className="size-2.5 rounded-[3px]" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>

      <div ref={containerRef} className="relative" style={{ height: HEIGHT }}>
        {width > 0 ? (
          <svg
            width={width}
            height={HEIGHT}
            role="img"
            aria-label={summary}
            onMouseLeave={() => setHovered(null)}
          >
            {ticks.map((tick) => (
              <g key={tick}>
                <line
                  x1={MARGIN.left}
                  x2={width - MARGIN.right}
                  y1={y(tick)}
                  y2={y(tick)}
                  className={tick === 0 ? "stroke-border" : "stroke-border/60"}
                  strokeDasharray={tick === 0 ? undefined : "2 4"}
                />
                <text
                  x={MARGIN.left - 8}
                  y={y(tick)}
                  dy="0.32em"
                  textAnchor="end"
                  className="fill-muted-foreground text-[10px] tabular-nums"
                >
                  {tick.toLocaleString()}
                </text>
              </g>
            ))}

            {data.map((row, index) => {
              const center = MARGIN.left + band * index + band / 2;
              const left = center - groupWidth / 2;
              let stackTop = y(0);

              return (
                <g key={row.day}>
                  {hovered === index ? (
                    <rect
                      x={MARGIN.left + band * index}
                      y={MARGIN.top}
                      width={band}
                      height={plotHeight}
                      className="fill-muted"
                      rx={4}
                    />
                  ) : null}

                  {series.map((s, position) => {
                    const value = row[s.key];
                    if (value <= 0) return null;
                    const height = y(0) - y(value);

                    if (layout === "stacked") {
                      // Every segment after the first leaves a 2px surface gap below it.
                      const gap = stackTop < y(0) ? GAP : 0;
                      const top = stackTop - gap - height;
                      const isTop = series
                        .slice(position + 1)
                        .every((next) => row[next.key] <= 0);
                      stackTop = top;
                      return (
                        <path
                          key={s.key}
                          d={columnPath(left, top, barWidth, Math.max(1, height), isTop)}
                          fill={s.color}
                        />
                      );
                    }

                    return (
                      <path
                        key={s.key}
                        d={columnPath(
                          left + position * (barWidth + GAP),
                          y(value),
                          barWidth,
                          Math.max(1, height),
                          true,
                        )}
                        fill={s.color}
                      />
                    );
                  })}

                  {(index % labelEvery === 0 && index < data.length - labelEvery / 2) ||
                  index === data.length - 1 ? (
                    <text
                      x={index === data.length - 1 ? width - MARGIN.right : center}
                      y={HEIGHT - 6}
                      // The last label hugs the right edge instead of running past it.
                      textAnchor={index === data.length - 1 ? "end" : "middle"}
                      className="fill-muted-foreground text-[10px]"
                    >
                      {formatDay(row.day)}
                    </text>
                  ) : null}

                  {/* Hit target: the whole band, taller and wider than any bar. */}
                  <rect
                    x={MARGIN.left + band * index}
                    y={MARGIN.top}
                    width={band}
                    height={plotHeight}
                    fill="transparent"
                    onMouseEnter={() => setHovered(index)}
                  />
                </g>
              );
            })}
          </svg>
        ) : null}

        {active && hovered !== null ? (
          <div
            className="bg-popover text-popover-foreground pointer-events-none absolute top-0 z-10 min-w-36 rounded-lg border p-2.5 text-xs shadow-md"
            // Beside the hovered day, never over it: right of it in the left
            // half of the chart, left of it in the right half.
            style={
              hovered < data.length / 2
                ? { left: MARGIN.left + band * (hovered + 1) + 8 }
                : { right: width - (MARGIN.left + band * hovered) + 8 }
            }
          >
            <p className="mb-1.5 font-medium">{formatDay(active.day, true)}</p>
            {series.map((s) => (
              <p key={s.key} className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground flex items-center gap-1.5">
                  <span className="size-2 rounded-[2px]" style={{ background: s.color }} />
                  {s.label}
                </span>
                <span className="font-medium tabular-nums">{active[s.key].toLocaleString()}</span>
              </p>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
