# PowerView session handoff

Updated 18 September 2026. Work is on `powerview-desktop` in `app/`, with draft [PR #2](https://github.com/KingBendico/PowerView_app_by_benZo/pull/2). Keep descriptive branch names without a `codex/` prefix.

The previous crash-recovery increment is complete: direct dual-rail dragging, a shared grip for meeting edges, independent fine adjustment, and compact 26px white circular arrow grips matching the user’s reference. It was pushed in commit `c819326` as beta.7.

The user then asked about API possibilities and authorized the next increment: a schedule timeline and combined health/activity overview. Beta.8 adds Schedules and Health navigation. The weekly schedule view filters days and enabled/paused entries, displays clock times and signed sunrise/sunset offsets, and identifies provisioning errors or missing scenes. No home timezone or exact solar timestamps are supplied by these endpoints, so no next-run timestamp or countdown is invented. Schedules are managed in the PowerView mobile app.

Health shows availability, documented battery ranges, power, RSSI and firmware, with attention ordering/filtering and room navigation. Activity separates accepted/failed app commands from actual gateway reports, records connection/device/scene events, and retains at most 200 entries per home during the session (ten homes maximum). History clears on quit and is not written to preferences or uploaded.

The new code is in `src/shared/home-insights.js`, `src/main/home-insights.js`, `src/renderer/home-insights.js` and `assets/home-insights.css`, with controller/client/IPC/navigation integration. Optional reads have separate loading/error/stale states and reject results from previous connections. HomeDoc/scene-list events refresh the existing snapshot. Demo provides representative schedules and health issues without running scheduled motor actions.

Validation: 69 core tests and 46 native checks, with refreshed desktop/narrow screenshots. New live reads recognized all 16 schedules (9 enabled), all 15 shades and gateway firmware. No real shades were moved. The native test harness now waits for settled macOS visibility/focus and keeps the compositor visible during motion tests to avoid suspended frames and coalesced window notifications.

The macOS arm64 package is `1.1.0-beta.8` at `release/PowerView-darwin-arm64/PowerView.app`. Its 34 runtime files, version metadata and icon match source. The rebuilt app is open against the saved live gateway on Schedules, showing 9 enabled and 7 paused routines; Health was also checked with all 15 devices. Preview data remains in `../redesign-preview-profile`. Details and limits are in `HOME_INSIGHTS.md` and `VALIDATION.md`. Movement speed, native scene/schedule editing, Aura lighting and gateway LED controls were not added in this increment. Remaining field/platform checks include real motors, physical shortcut delivery, sleep/resume and signing/notarization.
