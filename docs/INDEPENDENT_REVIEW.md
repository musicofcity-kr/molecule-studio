# Independent integration review

Reviewed the chemistry API, frontend request flow, sketcher conversion, VSEPR selection, Three.js viewer state, and study-card export wiring while preparing `scripts/browser-check.mjs`.

The following integration issues were found during review and are now reflected in the current source state:

- Sketcher conversion now sends only `{ graph }`, matching the API's exactly-one-input contract.
- API error rendering now reads `error.message`, so invalid requests do not surface as `[object Object]`.
- `StudyCard` now receives and attaches `cardRef`, allowing PNG export to reach `html-to-image`.
- Angle mode now reports VSEPR for the middle selected atom, which is the angle vertex.
- Empty selection no longer falls back to an arbitrary supported VSEPR result.
- The viewer measurement ref initialization order was corrected. Its capture registration also avoids re-registering an inline parent callback on every render.

The browser runner covers the remaining live integration boundaries: initial ethanol API and canvas mount, projected canvas atom selection, water O/H distance and H/O/H angle measurements, orbital disclaimer, spectra tabs, invalid SMILES, sketcher graph conversion, collection note save/load, study-card PNG download, and desktop/mobile screenshots. It writes `evidence/browser/browser-check.json` and related artifacts.

Current validation limits: the browser run requires the Vite app and Python API to be running, Microsoft Edge, Playwright, and the installed chemistry runtime. A successful UI/package check does not independently prove RDKit's scientific correctness beyond the API response observed by the browser.
