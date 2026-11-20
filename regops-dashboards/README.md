# RegOps — transaction reporting dashboards

Ten dashboard designs for running regulatory transaction reporting in an investment bank.
They cover MiFIR / UK MiFIR, EMIR Refit, SFTR and CFTC Parts 43/45, for reporting ops, technology and compliance users.

**All data is illustrative.** The numbers are invented but add up across screens. For example, the 13,163 rejections on the command centre equal the totals on the regime and reconciliation pages. Rejection codes are made up, and dates in the regulatory change list are placeholders.

## Screens

| # | Screen | Audience |
|---|--------|----------|
| 1 | Command centre | Ops |
| 2 | EMIR Refit | Ops |
| 3 | MiFIR / UK MiFIR | Ops |
| 4 | SFTR & CFTC | Ops |
| 5 | Exceptions workbench | Ops |
| 6 | Rejection analytics | Ops |
| 7 | Completeness & reconciliation | Ops · Compliance |
| 8 | Pipeline health | Tech |
| 9 | Data quality & reference data | Tech · Ops |
| 10 | Controls & attestation | Compliance |

Screenshots of each are in `screenshots/`.

## Layout

```
generator/   Python source: one set of data and components builds both outputs
  lib.py         design tokens and components (cards, stat tiles, charts, tables, heatmaps)
  screens.py     the ten screens and their data
  build.py       writes canvas/ and prototype/
  screenshot.py  renders each screen at 1440px, saves PNGs, records page heights
  heights.json   page heights used for the canvas frames
canvas/      Claude Design canvas files (.dc.html artboards + canvas.json)
prototype/   standalone clickable prototype (single index.html, open in a browser)
screenshots/ PNG of each screen at 1440px
```

## Build

Requires Python 3.9+ and no other packages.

```sh
python3 generator/build.py          # regenerate canvas/ and prototype/
```

To refresh screenshots and page heights (needs Playwright):

```sh
pip install playwright && playwright install chromium
python3 generator/screenshot.py     # set CHROME_PATH to use a specific Chrome
python3 generator/build.py          # rebuild so canvas frames pick up new heights
```

## Prototype features

- Navigation between all ten screens. The URL hash names each screen, e.g. `#exceptions`.
- A **Regime** filter that fades out the other regimes on every screen.
- Hover tooltips on every chart point, bar, segment and heatmap cell.
- Saved views on the exceptions queue (My queue, Breaching today, Older than 5 days, Unassigned).
- Sortable tables (click a column header).
- A simulated countdown to the T+1 submission deadline.
- Responsive layout for laptop, tablet and phone.

## Design system

- **Ground and accent:** white cards on `#F5F7FA`, navy `#0B2A5B` / `#1F4FA8`. Type is Inter.
- **Regime colours:** MiFIR `#1f4fa8`, EMIR `#eb6834`, SFTR `#1baf7a`, CFTC `#6250d6`. These were checked with a colour-vision validator; neighbouring pairs score ΔE ≥ 9.2 under colour-blindness simulation.
- **Status colours:** good, warning, serious and critical. Each is always shown with an icon and a label, never colour alone.
- **Sequential blue ramp** for heatmaps and ageing buckets.
