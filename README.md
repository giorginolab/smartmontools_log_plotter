# SMART Log Plotter

SMART Log Plotter is a local web app for exploring SMART attribute history from
`smartmontools` logs. It parses timestamped attribute data and plots one
selected attribute over time, with support for both raw and normalized values.

This is useful when you want to inspect disk health trends (for example,
temperature, pending sectors, reallocated sectors, or power-on hours) without
manual spreadsheet work.

## What It Does

- Parses log rows in this shape:
  - `YYYY-MM-DD HH:mm:ss; attr; norm; raw; attr; norm; raw; ...`
- Extracts attribute series by SMART ID.
- Lets you select one attribute from the detected list.
- Plots:
  - `raw`
  - `normalized`
  - `both` (dual Y-axes)
- Shows summary info:
  - number of parsed rows
  - number of discovered attributes
  - detected time range

## Input Format

Expected input is semicolon-separated text where each row starts with a
timestamp and then repeats SMART triplets.

Example:

```text
2020-07-14 13:04:23; 1; 67; 5113173; 3; 96; 0; 5; 100; 0;
```

Parser behavior:

- Splits by `;`
- Trims whitespace and tab characters
- Ignores empty trailing separators
- Skips unusable rows/values (invalid timestamp or non-numeric value)

## Example Data

Sample files are included in `examples/` and can be used to test the UI quickly.

## Tech Stack

- React + TypeScript
- Vite
- Recharts

## Development

Install dependencies and start the dev server:

```bash
npm install
npm run dev
```

Build for production:

```bash
npm run build
```

Preview a production build locally:

```bash
npm run preview
```

## Notes

- This project is client-side only (no backend).
- Timestamps are displayed using your local browser time formatting from parsed
  log data.

## Deploy To GitHub Pages (Actions)

This repo includes a workflow at `.github/workflows/deploy-pages.yml` that:

- builds the app on pushes to `main` (or manually via workflow dispatch)
- publishes `dist/` to GitHub Pages
- sets the Vite base path automatically for project pages

One-time repository setup:

1. Open repository `Settings` -> `Pages`.
2. Set `Source` to `GitHub Actions`.
3. Push to `main` (or run the workflow manually from `Actions`).
