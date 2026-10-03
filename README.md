# Globe Visualization

An interactive 3D globe showing Galileo and LEO-PNT satellites, built with React, D3 and Vite.
Orbits are propagated in the browser with satellite.js from TLEs published by CelesTrak;
per-satellite service status comes from the Galileo GSC.

## Getting started

```bash
npm install
npm run dev
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Refreshes the data (falls back to existing files on failure), then starts Vite |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serves the production build locally |
| `npm run lint` | Runs ESLint |
| `npm run data:refresh` | Downloads TLEs and status into `public/data/` (`-- --force` ignores the 1-hour cache) |

## Data

The app reads static files from `public/data/` rather than calling CelesTrak or the GSC from
the browser. These files are generated and not committed, so run `npm run data:refresh` (or
`npm run dev`) before `npm run build`. See `scripts/refresh-data.js` for details.
