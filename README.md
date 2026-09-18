# PowerView by BenZo

PowerView by BenZo is an unofficial macOS desktop companion for Hunter Douglas PowerView Gen 3 gateways. It provides a faster desktop interface for viewing rooms, controlling shades, running existing gateway scenes, and inspecting schedules and device health.

This project is not made, sponsored, certified, or supported by Hunter Douglas. It communicates with a local gateway using the gateway's HTTP API. Use it as a beta field tool and keep the official PowerView app available for setup, pairing, firmware work, and native scene or schedule management.

![Home with favorite scenes and pinned shades](docs/screenshots/home-light.png)

## Current status

Version `1.1.0-beta.8` is merged into `master`. The application has been tested with simulated devices, a loopback gateway fixture, and read-only requests to one live Gen 3 installation.

The live installation used for verification has 15 shades and no Aura lighting hardware. Aura brightness or color controls are therefore intentionally absent. The app does not assume that an optional API field is supported by every shade.

The app can:

- control individual shades, rooms, whole-home selections, dual rails, curtains, tilt-capable devices, and Jog where the reported device capability supports it;
- run existing gateway scenes and show active-scene feedback;
- display live movement, connection, battery, scene, and HomeDoc events;
- provide saved positions, custom groups, temporary privacy timers, favorites, search, tray access, and global shortcuts;
- show existing schedules with weekday, clock, sunrise/sunset, enabled/paused, scene, and provisioning information;
- show device health with documented battery ranges, power source, RSSI, firmware, offline state, and session activity history;
- customize the Home dashboard card order and visibility, including Whole home, Favorite scenes, Saved controls, Pinned shades, and Your rooms, with drag-and-drop, Show checkboxes, or keyboard move controls saved per gateway;
- manage pinned shades and favorite scenes from Home with per-gateway ordering and one-click removal;
- create local routines that sequence gateway scenes, saved controls and timed pauses, with validation before saving;
- schedule those local routines on selected days and times while PowerView is running;
- run without a real gateway in Demo mode for design review and testing.

The app does not currently create, edit, enable, disable, or delete native gateway scenes or schedules. The documented local API exposes scene activation and schedule reads. Hunter Douglas RemoteConnect can manage those objects through its authenticated cloud service, but this project does not use or reverse-engineer that service. See [API capabilities](docs/API_CAPABILITIES.md) and [home insights](docs/HOME_INSIGHTS.md).

## Safety and hardware disclaimer

PowerView commands can move real window coverings. Confirm the selected home, room, shade, rail, and target before releasing a drag or invoking a shortcut. Keep the official remote or app available, make sure the travel area is clear, and test with one shade before using room or whole-home actions. Stop commands are provided, but no software can guarantee that a motor will stop immediately or that a gateway, network, battery, or motor will respond.

The visual fabric animation can be an estimate between gateway reports when a travel time is available. It is not continuous motor telemetry. A command acknowledgment means the gateway accepted a request; it does not prove that a shade reached the requested position. The app preserves reported state separately and shows errors when the gateway reports them.

No real motor was moved during automated validation. Physical motor behavior, every shade mechanism, battery interpretation, sleep/resume behavior, and operation across Windows or Linux still require field testing. Use Demo mode when reviewing the interface or test logic.

## Install and run

Use Node.js 22.12 or newer:

```sh
npm ci
npm run demo
```

Demo mode uses simulated devices and a separate settings profile. To connect to a home, run `npm start`, open Settings, and enter the primary Gen 3 gateway address or use discovery. Only a verified connection replaces the saved address. Existing PowerView configuration and preferences migrate automatically; the old preferences file is retained.

The renderer has no Node.js or direct gateway-network access. It communicates through a restricted preload bridge. Gateway addresses and preferences are stored locally by Electron; do not publish your profile directory or expose the gateway's unauthenticated local API to the internet.

## Using the app

Home places whole-home actions and favorite scenes above pinned shades. Blinds opens the room grid, Scenes lists gateway scenes, and search jumps to rooms, shades, or scenes. Single-shade values use **percent closed**. Dual-rail controls measure each edge's **percentage from the top**. Open, Close, and Stop are whole-shade actions.

Drag the dashed target and release to send a position. The solid fabric follows reported movement. Dual-rail shades have compact white arrow grips on their top and bottom edges; when the rails meet, the first pull direction selects the rail for that gesture. Fine adjustment provides independent numeric values and bottom-edge nudges. Curtains can be paired or single-draw and can stack left or right. Appearance settings are local and do not send motor commands.

Command/Ctrl+K opens search. Ctrl+B and Ctrl+S switch views. Ctrl+1–9 open rooms in the selected order. Escape closes search or overlays, or returns from a room. Settings → Keyboard shortcuts supports shade, room, whole-home, scene, refresh, and app-visibility actions. Home → Saved controls stores named positions, groups, and temporary privacy timers. Privacy timers require the app to remain running and the computer to stay awake; sleep, quit, disconnection, or a newer command cancels restoration.

Schedules is a read-only view of gateway routines. Health contains Device health and Activity. Activity distinguishes an accepted app command from a later gateway report and keeps a bounded history for the current app session; it does not claim to know who initiated an external gateway action.

## API scope

The inspected gateway advertises PowerView Gen 3 Gateway API `2.13.0`, OpenAPI 3.1, with 39 paths and 43 operations. The app uses documented local routes for shades, scenes, automations, events, gateway information, and health reads. HTTP success responses that contain gateway-level or per-shade errors are treated as failures.

The API also documents optional features that are not enabled here, such as Aura lighting and movement velocity. The inspected shades did not expose Aura objects, and movement speed has not been tested on physical motors. Gateway reboot, network configuration, LED changes, firmware-update checks, Matter, Lutron, and integration-management routes are deliberately not exposed as casual controls because they change gateway state or start services.

To export the gateway's OpenAPI document after enabling Swagger:

```sh
npm run fetch-openapi -- 192.168.1.10
```

The generated document is ignored by Git because it may contain your gateway address and device data.

## Verify and build

```sh
npm run check
npm test
npm run smoke
npm run package
```

The current validation record reports 69 core tests and 46 native Electron checks passing. Native smoke tests use an isolated profile, demo data, and a loopback HTTP/SSE fixture; they do not move real shades. `npm run package` creates a local application bundle under `release/`. `npm run build:mac` can produce a DMG, but public distribution still requires code signing, notarization, platform testing, and hardware validation.

Read the [evaluation and roadmap](docs/EVALUATION.md), [validation record](docs/VALIDATION.md), [motion details](docs/MOTION_AND_APPEARANCE.md), [saved controls](docs/SAVED_CONTROLS.md), [shortcut behavior](docs/SHORTCUTS.md), and [API review](docs/API_CAPABILITIES.md) for known limits and implementation evidence.

## License and support expectations

This is a personal, unofficial integration. Use it at your own risk. Gateway firmware, API behavior, shade mechanisms, and mobile-cloud features can change without notice. A passing test or a successful HTTP response is not a warranty of compatibility, safety, availability, or motor movement. Keep backups of any local configuration and use the official PowerView app for account, gateway, firmware, pairing, scene, and schedule operations.
