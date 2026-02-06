import React, { useMemo, useRef, useState } from "react";
import { Card, CardContent } from "./components/ui/card";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
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

// SMART attribute ID → human name (based on the table you provided)
const SMART_ATTR_NAMES: Record<string, string> = {
  "1": "Read Error Rate",
  "2": "Throughput Performance",
  "3": "Spin-Up Time",
  "4": "Start/Stop Count",
  "5": "Reallocated Sectors Count",
  "6": "Read Channel Margin",
  "7": "Seek Error Rate",
  "8": "Seek Time Performance",
  "9": "Power-On Hours",
  "10": "Spin Retry Count",
  "11": "Recalibration Retries or Calibration Retry Count",
  "12": "Power Cycle Count",
  "13": "Soft Read Error Rate",
  "22": "Current Helium Level",
  "23": "Helium Condition Lower",
  "24": "Helium Condition Upper",
  "170": "Available Reserved Space",
  "171": "SSD Program Fail Count",
  "172": "SSD Erase Fail Count",
  "173": "SSD Wear Leveling Count",
  "174": "Unexpected Power Loss Count",
  "175": "Power Loss Protection Failure",
  "176": "Erase Fail Count",
  "177": "Wear Range Delta",
  "178": "Used Reserved Block Count",
  "179": "Used Reserved Block Count Total",
  "180": "Unused Reserved Block Count Total",
  "181": "Program Fail Count Total or Non-4K Aligned Access Count",
  "182": "Erase Fail Count",
  "183": "SATA Downshift Error Count or Runtime Bad Block",
  "184": "End-to-End error / IOEDC",
  "185": "Head Stability",
  "186": "Induced Op-Vibration Detection",
  "187": "Reported Uncorrectable Errors",
  "188": "Command Timeout",
  "189": "High Fly Writes",
  "190": "Temperature Difference or Airflow Temperature",
  "191": "G-sense Error Rate",
  "192": "Power-off Retract Count, Emergency Retract Cycle Count, or Unsafe Shutdown Count",
  "193": "Load Cycle Count or Load/Unload Cycle Count",
  "194": "Temperature or Temperature Celsius",
  "195": "Hardware ECC Recovered",
  "196": "Reallocation Event Count",
  "197": "Current Pending Sector Count",
  "198": "(Offline) Uncorrectable Sector Count",
  "199": "UltraDMA CRC Error Count",
  "200": "Multi-Zone Error Rate / Write Error Rate (Fujitsu)",
  "201": "Soft Read Error Rate or TA Counter Detected",
  "202": "Data Address Mark errors or TA Counter Increased",
  "203": "Run Out Cancel",
  "204": "Soft ECC Correction",
  "205": "Thermal Asperity Rate",
  "206": "Flying Height",
  "207": "Spin High Current",
  "208": "Spin Buzz",
  "209": "Offline Seek Performance",
  "210": "Vibration During Write",
  "211": "Vibration During Write",
  "212": "Shock During Write",
  "220": "Disk Shift",
  "221": "G-Sense Error Rate",
  "222": "Loaded Hours",
  "223": "Load/Unload Retry Count",
  "224": "Load Friction",
  "225": "Load/Unload Cycle Count",
  "226": "Load 'In'-time",
  "227": "Torque Amplification Count",
  "228": "Power-Off Retract Cycle",
  "230": "GMR Head Amplitude (magnetic HDDs), Drive Life Protection Status (SSDs)",
  "231": "Life Left (SSDs) or Temperature",
  "232": "Endurance Remaining or Available Reserved Space",
  "233": "Media Wearout Indicator (SSDs) or Power-On Hours",
  "234": "Average erase count AND Maximum Erase Count",
  "235": "Good Block Count AND System(Free) Block Count",
  "240": "Head Flying Hours or Transfer Error Rate (Fujitsu)",
  "241": "Total LBAs Written or Total Host Writes",
  "242": "Total LBAs Read or Total Host Reads",
  "243": "Total LBAs Written Expanded or Total Host Writes Expanded",
  "244": "Total LBAs Read Expanded or Total Host Reads Expanded",
  "245": "Remaining Rated Write Endurance",
  "246": "Cumulative host sectors written",
  "247": "Host program page count",
  "248": "Background program page count",
  "249": "NAND Writes (1GiB)",
  "250": "Read Error Retry Rate",
  "251": "Minimum Spares Remaining",
  "252": "Newly Added Bad Flash Block",
  "254": "Free Fall Protection",
};

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

export default function App() {
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [selectedAttrs, setSelectedAttrs] = useState<string[]>([]);
  const [status, setStatus] = useState<string>("Upload a log file to plot");

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
    if (selectedAttrs.length === 0) return [] as any[];

    const map = new Map<number, any>();

    for (const attrId of selectedAttrs) {
      const rawSeries = parsed.byAttr[attrId]?.raw ?? [];
      const normSeries = parsed.byAttr[attrId]?.norm ?? [];

      for (const p of rawSeries) {
        const row = map.get(p.t) ?? { t: p.t };
        row[`${attrId}_raw`] = p.v;
        map.set(p.t, row);
      }

      for (const p of normSeries) {
        const row = map.get(p.t) ?? { t: p.t };
        row[`${attrId}_norm`] = p.v;
        map.set(p.t, row);
      }
    }

    return Array.from(map.values()).sort((a, b) => a.t - b.t);
  }, [parsed, selectedAttrs]);

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;

    setStatus("Loading…");
    const text = await f.text();

    setStatus("Parsing…");
    const p = parseSmartLog(text);

    setParsed(p);

    if (p.rows === 0 || p.attrs.length === 0) {
      setSelectedAttrs([]);
      setStatus("No usable data found in file");
      return;
    }

    setStatus("Ready");
    // default select first 5 attrs
    setSelectedAttrs(p.attrs.slice(0, 5));
  }

  function selectAll() {
    if (!parsed) return;
    setSelectedAttrs(parsed.attrs);
  }

  function clearSelection() {
    setSelectedAttrs([]);
  }

  return (
    <div className="page">
      <div className="container">
        <div className="top-bar">
          <div>
            <div className="title">SMART Log Plotter</div>
            <div className="subtitle">
              Upload a log file; choose attributes; plot raw and normalized values over time.
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
              disabled={!parsed || parsed.attrs.length === 0}
              onClick={selectAll}
            >
              Select all
            </Button>
            <Button
              variant="secondary"
              disabled={!parsed || selectedAttrs.length === 0}
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
                    Multi-select to plot multiple series.
                  </div>
                </div>
                <div className="status">{status}</div>
              </div>

              <div className="panel-body">
                <Label className="label">Selected ({selectedAttrs.length})</Label>
                <div className="attr-list">
                  {parsed ? (
                    <div className="attr-grid">
                      {parsed.attrs.map((id, idx) => {
                        const checked = selectedAttrs.includes(id);
                        return (
                          <label
                            key={id}
                            className="attr-item"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(ev) => {
                                const on = ev.target.checked;
                                setSelectedAttrs((prev) => {
                                  if (on) return Array.from(new Set([...prev, id]));
                                  return prev.filter((x) => x !== id);
                                });
                              }}
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
                      tickFormatter={(v) => formatMs(Number(v)).slice(11, 19)}
                      minTickGap={20}
                    />
                    <YAxis
                      yAxisId="raw"
                      orientation="left"
                      tickFormatter={(v) => {
                        const n = Number(v);
                        if (!Number.isFinite(n)) return "";
                        // Compact large counters
                        const abs = Math.abs(n);
                        if (abs >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
                        if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
                        if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
                        if (abs >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
                        return String(n);
                      }}
                    />
                    <YAxis
                      yAxisId="norm"
                      orientation="right"
                      tickFormatter={(v) => {
                        const n = Number(v);
                        if (!Number.isFinite(n)) return "";
                        const abs = Math.abs(n);
                        if (abs >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
                        if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
                        if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
                        if (abs >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
                        return String(n);
                      }}
                    />
                    <Tooltip
                      labelFormatter={(v) => formatMs(Number(v))}
                      formatter={(value: any, name: any) => [value, String(name)]}
                    />
                    <Legend />

                    {selectedAttrs.map((id, idx) => (
                      <React.Fragment key={id}>
                        <Line
                          type="monotone"
                          yAxisId="raw"
                          dataKey={`${id}_raw`}
                          name={`${attrLabel(id)} (raw)`}
                          dot={false}
                          stroke={pickPalette(idx)}
                          strokeWidth={2}
                          connectNulls={false}
                          isAnimationActive={false}
                        />
                        <Line
                          type="monotone"
                          yAxisId="norm"
                          dataKey={`${id}_norm`}
                          name={`${attrLabel(id)} (norm)`}
                          dot={false}
                          stroke={pickPalette(idx)}
                          strokeDasharray="6 3"
                          strokeWidth={2}
                          connectNulls={false}
                          isAnimationActive={false}
                        />
                      </React.Fragment>
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div className="muted">
                X-axis is time; left Y-axis is raw value; right Y-axis is normalized value.
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
              Notes: the parser splits on semicolons, trims whitespace/tabs, ignores empty trailing separators, and skips non-numeric values.
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
