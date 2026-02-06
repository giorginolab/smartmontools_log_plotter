import React, { useMemo, useRef, useState } from "react";
import { Card, CardContent } from "./components/ui/card";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { SMART_ATTR_NAMES } from "./data/smartAttributes";
import {
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

/**
 * SMART log format (semicolon separated, often with tabs):
 * timestamp; attr; norm; raw; attr; norm; raw; ...
 *
 * Example line:
 * 2020-07-14 13:04:23;\t1;67;5113173;\t3;96;0; ...
 */

function parseTimestampToMs(s: string): number | null {
  // Expect "YYYY-MM-DD HH:mm:ss"
  const trimmed = s.trim();
  // Convert to ISO-like string for Date parsing
  const isoish = trimmed.replace(" ", "T");
  const d = new Date(isoish);
  const ms = d.getTime();
  return Number.isFinite(ms) ? ms : null;
}

function splitFields(line: string): string[] {
  // Split by ';', trim, and drop empties.
  return line
    .split(";")
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

function attrLabel(id: string): string {
  const name = SMART_ATTR_NAMES[id];
  return name ? `${id} — ${name}` : id;
}

type SeriesPoint = { t: number; v: number };

type AttrSeries = {
  id: string;
  raw: SeriesPoint[];
  norm: SeriesPoint[];
};

type Parsed = {
  byAttr: Record<string, AttrSeries>;
  attrs: string[];
  rows: number;
  tMin: number | null;
  tMax: number | null;
};

function parseSmartLog(text: string): Parsed {
  const byAttr: Record<string, AttrSeries> = {};
  let rows = 0;
  let tMin: number | null = null;
  let tMax: number | null = null;

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  for (const line of lines) {
    const fields = splitFields(line);
    if (fields.length < 4) continue;

    const t = parseTimestampToMs(fields[0]);
    if (t == null) continue;

    tMin = tMin == null ? t : Math.min(tMin, t);
    tMax = tMax == null ? t : Math.max(tMax, t);

    // Triplets from index 1 onwards: attr, norm, raw
    for (let i = 1; i + 2 < fields.length; i += 3) {
      const attrId = fields[i];
      const normVal = Number(fields[i + 1]);
      const rawVal = Number(fields[i + 2]);

      if (!attrId) continue;
      if (!Number.isFinite(normVal) && !Number.isFinite(rawVal)) continue;

      if (!byAttr[attrId]) {
        byAttr[attrId] = { id: attrId, raw: [], norm: [] };
      }
      if (Number.isFinite(rawVal)) byAttr[attrId].raw.push({ t, v: rawVal });
      if (Number.isFinite(normVal)) byAttr[attrId].norm.push({ t, v: normVal });
    }

    rows++;
  }

  const attrs = Object.keys(byAttr).sort((a, b) => Number(a) - Number(b));
  // sort each series by time
  for (const id of attrs) {
    byAttr[id].raw.sort((a, b) => a.t - b.t);
    byAttr[id].norm.sort((a, b) => a.t - b.t);
  }

  return { byAttr, attrs, rows, tMin, tMax };
}

function formatMs(ms: number): string {
  const d = new Date(ms);
  // Local-ish display
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatDateMs(ms: number): string {
  return formatMs(ms).slice(0, 10);
}

function pickPalette(idx: number): string {
  // A simple, deterministic palette (no user request for specific colors; this is UI-only).
  const colors = [
    "#1f77b4",
    "#ff7f0e",
    "#2ca02c",
    "#d62728",
    "#9467bd",
    "#8c564b",
    "#e377c2",
    "#7f7f7f",
    "#bcbd22",
    "#17becf",
  ];
  return colors[idx % colors.length];
}

function formatAxisTick(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return String(n);
}

type PlotMode = "raw" | "norm" | "both";

export default function App() {
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [selectedAttr, setSelectedAttr] = useState<string | null>(null);
  const [plotMode, setPlotMode] = useState<PlotMode>("both");
  const [status, setStatus] = useState<string>("Upload a log file to plot");

  const showRaw = plotMode === "raw" || plotMode === "both";
  const showNorm = plotMode === "norm" || plotMode === "both";
  const plotModeLabel = plotMode === "both" ? "Both" : plotMode === "raw" ? "Raw" : "Normalized";

  const summary = useMemo(() => {
    if (!parsed) return null;
    const range =
      parsed.tMin != null && parsed.tMax != null
        ? `${formatMs(parsed.tMin)} → ${formatMs(parsed.tMax)}`
        : "—";
    return {
      rows: parsed.rows,
      attrs: parsed.attrs.length,
      range,
    };
  }, [parsed]);

  // Build a single “wide” dataset for recharts:
  // [{ t, "194_raw": value, "194_norm": value, ... }, ...]
  // Note: points may be missing for some attrs; we keep them undefined.
  const chartData = useMemo(() => {
    if (!parsed) return [] as any[];
    if (!selectedAttr) return [] as any[];

    const map = new Map<number, any>();
    if (showRaw) {
      const rawSeries = parsed.byAttr[selectedAttr]?.raw ?? [];
      for (const p of rawSeries) {
        const row = map.get(p.t) ?? { t: p.t };
        row[`${selectedAttr}_raw`] = p.v;
        map.set(p.t, row);
      }
    }
    if (showNorm) {
      const normSeries = parsed.byAttr[selectedAttr]?.norm ?? [];
      for (const p of normSeries) {
        const row = map.get(p.t) ?? { t: p.t };
        row[`${selectedAttr}_norm`] = p.v;
        map.set(p.t, row);
      }
    }

    return Array.from(map.values()).sort((a, b) => a.t - b.t);
  }, [parsed, selectedAttr, showRaw, showNorm]);

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;

    setStatus("Loading…");
    const text = await f.text();

    setStatus("Parsing…");
    const p = parseSmartLog(text);

    setParsed(p);

    if (p.rows === 0 || p.attrs.length === 0) {
      setSelectedAttr(null);
      setStatus("No usable data found in file");
      return;
    }

    setStatus("Ready");
    // default select first attr
    setSelectedAttr(p.attrs[0] ?? null);
  }

  function clearSelection() {
    setSelectedAttr(null);
  }

  function cyclePlotMode() {
    setPlotMode((prev) => {
      if (prev === "both") return "raw";
      if (prev === "raw") return "norm";
      return "both";
    });
  }

  const selectedAttrColor = useMemo(() => {
    if (!parsed || !selectedAttr) return pickPalette(0);
    const idx = parsed.attrs.indexOf(selectedAttr);
    return pickPalette(idx >= 0 ? idx : 0);
  }, [parsed, selectedAttr]);

  return (
    <div className="page">
      <div className="container">
        <div className="top-bar">
          <div>
            <div className="title">SMART Log Plotter</div>
            <div className="subtitle">
              Upload a log file; choose attributes; plot raw and normalized values over time.
            </div>
            <div className="subtitle">
              SMART attribute descriptions:{" "}
              <a
                href="https://en.wikipedia.org/wiki/Self-Monitoring,_Analysis_and_Reporting_Technology"
                target="_blank"
                rel="noopener noreferrer"
              >
                Wikipedia
              </a>
            </div>
          </div>

          <div className="controls">
            <Input
              ref={fileRef as any}
              type="file"
              className="file-input"
              accept=".txt,.log,.csv,.tsv,*/*"
              onChange={onFileChange}
            />

            <Button
              variant="secondary"
              disabled={!parsed || !selectedAttr}
              onClick={cyclePlotMode}
            >
              Mode: {plotModeLabel}
            </Button>

            <Button
              variant="secondary"
              disabled={!parsed || !selectedAttr}
              onClick={clearSelection}
            >
              Clear
            </Button>
          </div>
        </div>

        <div className="main-grid">
          <Card className="panel">
            <CardContent className="panel-content">
              <div className="panel-header">
                <div>
                  <div className="panel-title">Attributes</div>
                  <div className="panel-subtitle">
                    Select one attribute to plot.
                  </div>
                </div>
                <div className="status">{status}</div>
              </div>

              <div className="panel-body">
                <Label className="label">Selected ({selectedAttr ? 1 : 0})</Label>
                <div className="attr-list">
                  {parsed ? (
                    <div className="attr-grid">
                      {parsed.attrs.map((id, idx) => {
                        const checked = selectedAttr === id;
                        return (
                          <label
                            key={id}
                            className="attr-item"
                          >
                            <input
                              type="radio"
                              name="selected-attr"
                              checked={checked}
                              onChange={() => setSelectedAttr(id)}
                            />
                            <span className="mono">{attrLabel(id)}</span>
                            <span
                              className="dot"
                              style={{ background: pickPalette(idx) }}
                            />
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="muted">Upload a file to see attributes.</div>
                  )}
                </div>

                <div className="summary">
                  <div>Rows</div>
                  <div className="mono right">{summary?.rows ?? "—"}</div>
                  <div>Attrs found</div>
                  <div className="mono right">{summary?.attrs ?? "—"}</div>
                  <div className="span-2">Time range</div>
                  <div className="mono span-2">{summary?.range ?? "—"}</div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="panel">
            <CardContent className="chart">
              <div className="chart-box">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 10, right: 20, bottom: 10, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="t"
                      type="number"
                      domain={["dataMin", "dataMax"]}
                      tickFormatter={(v) => formatDateMs(Number(v))}
                      minTickGap={20}
                    />
                    {showRaw && (
                      <YAxis
                        yAxisId="raw"
                        orientation="left"
                        tickFormatter={formatAxisTick}
                      />
                    )}
                    {showNorm && (
                      <YAxis
                        yAxisId="norm"
                        orientation="right"
                        tickFormatter={formatAxisTick}
                      />
                    )}
                    <Tooltip
                      labelFormatter={(v) => formatMs(Number(v))}
                      formatter={(value: any, name: any) => [value, String(name)]}
                    />
                    <Legend />

                    {selectedAttr && (
                      <React.Fragment key={selectedAttr}>
                        {showRaw && (
                          <Line
                            type="linear"
                            yAxisId="raw"
                            dataKey={`${selectedAttr}_raw`}
                            name={`${attrLabel(selectedAttr)} (raw)`}
                            dot={false}
                            stroke={selectedAttrColor}
                            strokeWidth={2}
                            connectNulls={false}
                            isAnimationActive={false}
                          />
                        )}
                        {showNorm && (
                          <Line
                            type="linear"
                            yAxisId="norm"
                            dataKey={`${selectedAttr}_norm`}
                            name={`${attrLabel(selectedAttr)} (norm)`}
                            dot={false}
                            stroke={selectedAttrColor}
                            strokeDasharray="6 3"
                            strokeWidth={2}
                            connectNulls={false}
                            isAnimationActive={false}
                          />
                        )}
                      </React.Fragment>
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div className="muted">
                X-axis is date; mode is {plotModeLabel.toLowerCase()}.
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="panel">
          <CardContent className="panel-content">
            <div className="panel-title">Expected format</div>
            <div className="mono small">
              YYYY-MM-DD HH:mm:ss; attr; norm; raw; attr; norm; raw; ...
            </div>
            <div className="muted">
              Notes: the parser splits on semicolons, trims whitespace/tabs, ignores empty trailing separators, and skips non-numeric values. Logs are usually found in `/var/lib/smartmontools/`.
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
