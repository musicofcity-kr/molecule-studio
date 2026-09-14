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

## Resume review, 2026-09-14

Two independent agents reviewed the chemistry/API and UI/export paths. The main agent integrated the repairs and ran the checks. Further significant findings were repaired:

- VSEPR schematics now use molecular shape and depth cues; water is bent and tetrahedral centers are no longer drawn as planar squares.
- Importing the server molecule into the editor preserves formal charge; an ammonium round trip remains `[NH4+]`.
- Exported cards initially contained only background pixels. Computed logical `inset-inline` properties survived a physical `left` override. Static positioning of the cloned card neutralizes both and restores the contents.
- Spectrum SVG strokes and text attributes are inline so they remain visible in exported images.
- Browser checks select visible atom controls, synchronize the matching API response, and verify PNG content pixels, including mobile exports.

The final local browser report finished at `2026-09-14T02:06:24.522Z`: 13/13 passed and no uncaught page errors. An independent agent inspected final desktop/mobile screenshots and both study-card PNGs and returned AC-REVIEW PASS. Vercel production verification remains separate and incomplete because the connected API returned HTTP 403 for production deployment creation.

The user subsequently explicitly deferred Vercel deployment. Current completion therefore covers the verified local application and public GitHub sources. The earlier Vercel failure evidence is retained; no public Vercel runtime is claimed.
