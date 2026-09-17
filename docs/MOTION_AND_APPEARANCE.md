# Shade movement and appearance

The shade card separates the chosen destination from the device's movement. Dragging moves a dashed target and updates the target percentage. Releasing sends one command. Refreshes leave an active drag alone; cancelling a gesture sends nothing. Numeric entry and keyboard controls choose the same target. The solid fabric represents the latest reported position or clearly labeled estimated progress, so it no longer snaps to the destination and back to an older report.

## Movement feedback

Gen 3 motion events may include `currentPositions`, `targetPositions` and `targetPositions.etaInSeconds`. When a valid travel time is supplied, the app interpolates from the reported start to the target and labels the intermediate position **approximate**. It waits for the final gateway report to confirm arrival. Acknowledgment alone never confirms a physical position. Cached reads during timed travel, older timestamped events and late acknowledgments cannot rewind the graphic. A short guard also protects a newly reported stop position from stale reads.

The event shape is supported by [first-hand Gen 3 gateway captures in the Hubitat community, posts 243–244](https://community.hubitat.com/t/hunter-douglas-api/39655?page=12). Those logs are implementation evidence, not an official API guarantee. The tests use equivalent loopback HTTP/SSE events; no real motor was operated during this work.

This is not continuous physical position telemetry. Travel speed, motor startup delay, obstructions and multi-rail sequencing can differ from a linear estimate. A missing/invalid travel time leaves the graphic at reported positions instead of inventing a speed. Stop freezes the estimate while awaiting a report. Lost live updates freeze it with an explicit message; bounded follow-up reads check unresolved movement. The actual gateway and representative mechanisms still need field validation.

Demo mode simulates travel and emits the same motion-event shape. It supports intermediate Stop and retargeting, making the interaction testable without connecting hardware.

## Appearance settings

Select the palette button beside a shade's name. Choose shades/blinds or split curtains, then a fabric style and color. The preview updates immediately; Save appearance applies it to the card and persists it for that device and gateway. Cancel leaves the previous appearance intact. Reset restores the default when saved.

- Shades/blinds: pleated, smooth roller or slatted fabric; vertical target dragging.
- Curtains: soft folds, linen or fine folds; horizontal target dragging with both panels moving together.
- Colors: Natural, Sage, Clay, Charcoal and Mist, a custom color picker, or the theme color.
- Two-rail shades: texture and color choices retain both rail controls; curtain mode is unavailable for these devices.

Appearance changes affect the drawing only. They send no motor command and do not change capability validation or the gateway's device type. The editor is available on the visual standard, top-down, vertical and dual-rail controls; tilt-only and overlapped mechanisms retain their existing controls. Single-sided curtains and additional stacking arrangements are possible future additions.

![Appearance editor](screenshots/appearance-editor.png)
