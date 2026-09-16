**Validation — PowerView desktop increment, 16 September 2026**

The supplied local application is the baseline for this work. The corrected [evaluation](EVALUATION.md) distinguishes its existing features from remaining defects and future ideas.

- `npm run check`: all application, script and test JavaScript parses; referenced UI resources exist.
- `npm test`: 21 focused tests pass. Coverage includes finite requests, HTTP failures, malformed responses, cancellation, secondary-gateway rejection, per-home favorites, configuration recovery and legacy migration, partial group failures, Stop during movement, SSE chunking and subnet boundaries.
- `npm run smoke`: 13 native Electron checks pass on macOS arm64 with Electron 44.4.1. The test uses a temporary profile, demo data and a loopback HTTP/SSE fixture. It covers renderer isolation, percentage presets, numeric entry, type 9 dual rails, keyboard controls, pinning, scene activation, navigation races, modal focus, dark theme, narrow/zoomed layouts, HTTP errors, acknowledgments, SSE updates and invalid IDs. No renderer errors were recorded. [Machine-readable results](native-smoke-results.json).
- `npm audit`: the upgraded lockfile has zero reported vulnerabilities at the time of this review. The original local baseline had 27 affected package entries; its audit is retained separately. Audit counts are not a security certification.
- `npm run package`: generated a macOS arm64 app bundle under `release/PowerView-darwin-arm64/PowerView.app`. It uses local resources and an ASAR archive. No signed/notarized installer is being published.
- Native [Home](screenshots/home-light.png), [dark room](screenshots/room-dark.png) and [narrow room](screenshots/room-narrow.png) captures were inspected.

The original source directory remains unchanged. The app name and user-data identity remain PowerView. The legacy prefs file is retained during migration. Demo launched with `--demo` uses a separate profile; the preview opened for review uses an explicit temporary/workspace profile.

Physical movement has not been tested. Broader type mappings, tilt/overlapped/top-down geometry, real discovery across networks, Swagger startup, device battery interpretation, sleep/resume, tray interactions on each OS, Windows/Linux builds and macOS distribution signing still need field/platform checks. The automated tests validate protocol handling and simulated behavior, not a real motor or every firmware version.

Routes and capability mappings were cross-checked against the [aio-powerview-api reference](https://github.com/sander76/aio-powerview-api/blob/master/aiopvapi/resources/shade.py), its [scene resource](https://github.com/sander76/aio-powerview-api/blob/master/aiopvapi/resources/scene.py) and [Home Assistant integration documentation](https://www.home-assistant.io/integrations/hunterdouglas_powerview/). The reference is guidance rather than proof of hardware compatibility. Renderer isolation follows [Electron's guidance](https://www.electronjs.org/docs/latest/tutorial/security).

The draft remains version `1.1.0-beta.1` to make its field-validation status clear. The pull request is a reviewable integration of the current local app and first improvement increment; it does not implement the entire future-feature roadmap.
