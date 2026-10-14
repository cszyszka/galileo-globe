# Galileo Constellation

**Live: https://galileo.spacecone.dev**

![Orbits of the Galileo satellites around the Earth](public/og.png)

An interactive 3D globe showing the Galileo and LEO-PNT (ESA Celeste) satellites in real time,
built with React, D3 and Vite. Spin and zoom the globe (drag and scroll, or drag and pinch on a
phone), click a satellite for its position and status, or click the Earth to see which satellites
are above the horizon from that spot.

Orbits are propagated in the browser with satellite.js from TLEs published by
[CelesTrak](https://celestrak.org); per-satellite service status comes from the
[European GNSS Service Centre](https://www.gsc-europa.eu/system-service-status/constellation-information).

## Getting started

```bash
npm install
npm run dev
```

The data refresh is written in Python and managed with [pixi](https://pixi.sh). `npm run dev` calls it
to top up stale data; without pixi installed it falls back to the committed files.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Refreshes any data older than 12 hours (falls back to existing files on failure), then starts Vite |
| `npm run build` | Typechecks, then builds into `dist/` |
| `npm run preview` | Serves the production build locally |
| `npm run typecheck` | Runs the TypeScript compiler without emitting |
| `npm run lint` | Runs ESLint |
| `npm test` | Runs the Vitest unit tests |
| `npm run data:refresh` | Downloads TLEs and status into `public/data/` (`-- --force` ignores the 1-hour cache); runs `pixi run refresh` |
| `pixi run -e dev test` | Runs the Python tests (also `lint` and `typecheck` tasks) |

TypeScript 7 does the type checking (`tsc`, installed as the `@typescript/native` alias). TypeScript 7
has no JavaScript API yet, so the `typescript` package is Microsoft's TypeScript 6 compatibility build
(`@typescript/typescript6`, with a `tsc6` binary), which typescript-eslint needs. When typescript-eslint
supports TypeScript 7, `typescript` can move to 7 and the alias can go.

## Code layout

| Path | What lives there |
| --- | --- |
| `src/components/GalileoGlobe.tsx` | The app: owns the state and wires the globe, hooks and panel together |
| `src/components/panel/` | The side panel (a bottom sheet on phones): tabs, sections, satellite details |
| `src/components/` | Overlays on the globe (notices, legend, theme toggle), time controls, the sky plot |
| `src/globe/` | The d3 globe: SVG layers, the animation loop (`scene.ts`), camera, pointer input |
| `src/hooks/` | Data loading, the simulated clock, the panel readout, the bottom sheet and other state |
| `src/lib/` | Pure logic with unit tests: TLE parsing and propagation, geometry, sky view, formatting |
| `data_refresh/` | The Python data refresh and its validation (run by `pixi run refresh` and the scheduled workflow); tests in `tests/` |

Each component imports its own stylesheet from next to it; `GalileoGlobe.css` holds the app shell
and the small utilities shared by all of them.

## Data

The app reads static files from `public/data/` rather than calling CelesTrak or the GSC from
the browser. The files are committed to the repo, and a scheduled GitHub Actions workflow
(`.github/workflows/refresh-data.yml`) refreshes them every 6 hours and pushes any change.
CelesTrak refuses downloads from Cloudflare's build servers, which is why the build does not
fetch them itself. See `data_refresh/` for the validation it applies; a failed
download keeps the previous file.

## Deployment

The site is a static build served by a Cloudflare Worker named `galileo` (static assets),
connected to this repo, with `galileo.spacecone.dev` as its custom domain. Cloudflare builds and
deploys on every push to `main`, including the data refresh commits.

| Setting | Value |
| --- | --- |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy --assets=dist --name=galileo --compatibility-date=2026-10-01` |

`.github/workflows/ci.yml` runs lint, typecheck, tests and a build on pull requests.

`wrangler.jsonc` holds the Worker settings: the `dist/` assets, and no `*.workers.dev` address or
preview URLs, so the site is served only on the custom domain. `public/_headers` sets the security
headers (Content-Security-Policy, `X-Frame-Options`, `nosniff`, `Referrer-Policy`,
`Permissions-Policy`); a new external script or connection must be added to the CSP there.

## Credits

Orbital elements: [CelesTrak](https://celestrak.org). Service status: European GNSS Service
Centre (GSC). Country outlines: [world-atlas](https://github.com/topojson/world-atlas).

## License

The code is released under the [MIT License](LICENSE). It covers this project's own code and
assets only:

- The satellite data in `public/data/` comes from CelesTrak and the European GNSS Service Centre
  and stays under their terms. Keep their attribution if you reuse it.
- Dependencies keep their own licences, including the fonts (SIL Open Font License 1.1) and the
  country outlines (world-atlas, ISC, from Natural Earth).

This is an independent project, not affiliated with or endorsed by CelesTrak, EUSPA, the GSC or ESA.
