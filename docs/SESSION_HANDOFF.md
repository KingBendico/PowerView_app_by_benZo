# PowerView session handoff

Updated 17 September 2026 after recovering from a Mac crash.

The recovered request removes the Top rail / Bottom rail selector in favor of direct edge dragging. Each edge has a grip when there is room; meeting edges share one grip, and the initial pull direction chooses the edge for the entire gesture, including reversal. Fine adjustment expands to independent position fields and bottom-edge nudges/presets.

Work is on `powerview-desktop` in `app/`, with existing draft [PR #2](https://github.com/KingBendico/PowerView_app_by_benZo/pull/2). Keep descriptive branch names without a `codex/` prefix. The preview uses `../redesign-preview-profile`; real hardware has not been operated during this update.

The user subsequently supplied a PowerView screenshot and asked for similar pulling handles, then requested a smaller size. All shade and curtain grips are now compact **26px white circles**, reduced from the first 32px design, with proportionally smaller slate arrows, a subtle border and a soft shadow. Shade arrows point up/down; curtain arrows point left/right. Hover labels and accessible edge names remain available. Endpoint insets and shared-grip spacing follow the smaller size.

Implementation is in `src/renderer/shade-control.js`, `src/renderer/renderer.js` and `assets/shade-controls.css`. Validation is in `scripts/smoke.cjs`; README, motion documentation, evaluation and validation notes describe the final behavior.

Syntax/resource checks and all 58 core tests pass. The final 26px version passes all **41 native Electron checks**, with no renderer errors, including actual mouse input, pointer capture, both endpoints, merged/separate grips, reversal, cancellation, keyboard focus and resizing. Light/dark/narrow screenshots were refreshed and inspected. The harness hides scripted dialogs during movement waits and awaits native macOS show/hide events to prevent desktop interference and transition races.

The packaged macOS arm64 app is **1.1.0-beta.7** at `release/PowerView-darwin-arm64/PowerView.app`; runtime files, package metadata and icon match source. The preview uses `--demo --disable-gpu --data-dir=../redesign-preview-profile`. No real shades were moved during validation. Field testing of real motor synchronization, physical shortcut delivery, broader device/platform coverage and signing/notarization remains outstanding as documented in `VALIDATION.md`.
