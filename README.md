# PowerView by BenZo

A local desktop companion for Hunter Douglas PowerView Gen 3. Control rooms, visual shade positions and existing gateway scenes from your computer.

This update carries the newer local app into GitHub with a redesigned desktop interface: a persistent sidebar, warm light and dark themes, compact shade graphics, Home controls and search. It retains draggable single/dual shade controls, Jog, presets, scenes, room sorting, shortcuts, live events, discovery and the tray menu.

![Home with favorite scenes and pinned shades](docs/screenshots/home-light.png)

## Run

Use Node.js 22.12 or newer:

```sh
npm ci
npm run demo
```

Demo mode uses simulated devices and a separate settings profile. To connect your home, run `npm start`, open Settings and enter the primary Gen 3 gateway address or use discovery. Only a verified connection replaces the saved address. Existing `PowerView` config and preferences migrate automatically; the old preferences file is retained.

Home puts whole-home actions and favorite scenes above pinned shades, with room shortcuts below. Blinds opens the room grid; Scenes lists your gateway scenes. Search jumps to a room or shade, or runs a matching scene. Single-shade presets use **percent closed**, matching the number field. Dual-rail controls measure each edge's **percentage from the top**. A command acknowledgment is separate from the reported position. Stop acts immediately without a confirmation dialog. Room/whole-home movement retains a confirmation and reports partial failures. The inspected installation exposes no Aura lighting hardware, so lighting controls are intentionally absent.

Drag the dashed target to choose a position; release to send it. The solid fabric follows reported movement, with a smooth, explicitly approximate animation when the gateway supplies a travel time. The final position comes from the gateway. Demo mode simulates travel and lets you stop partway through. See [movement behavior and limits](docs/MOTION_AND_APPEARANCE.md).

The pulling handles are small white circles with opposing arrows: up/down for shades and left/right for curtains. For a dual-rail shade, **drag the top or bottom edge directly**. When the edges meet or are close together, one grip lets you pull up to raise the top edge or down to lower the bottom edge. The first pull chooses the edge for that gesture; reversing direction keeps control of the same edge. Expand **Fine adjustment** for independent numeric positions and bottom-edge nudges/presets. **Open shade / Close shade / Stop** control the whole shade.

Use the **palette button** beside a shade's name to choose **shades/blinds or curtains**, fabric texture, and a preset or custom color. Curtains can open from the center as a pair or use a **single curtain that opens and stacks on the left or right**. The preview, horizontal dragging and animation follow your choice, saved for that device and home. Real two-rail shades retain both rail controls and support texture/color customization. In demo, those devices can also simulate curtains; choosing Shades / blinds or Reset restores their rail controls. Appearance changes are local and send no motor commands.

Command/Ctrl+K opens search; arrow keys and Enter select a result. Ctrl+B and Ctrl+S switch views; Ctrl+1–9 open rooms in the selected order. Escape closes search or overlays, or returns from a room. Shade graphics support pointer interaction and keyboard adjustment. The tray runs favorite scenes through the same gateway connection, and Settings offers an optional close-to-tray preference.

**Settings → Keyboard shortcuts** adds custom, system-wide keys for individual shades, rooms, the whole home, gateway scenes, showing/hiding PowerView and refreshing status. They work while PowerView is running, including in the background. The starter assigns Ctrl+Shift+C/O/H to Close/Open/50% closed for your chosen shade; every combination and percentage is editable. Room and whole-home shortcuts run immediately. Conflicts are checked before saving; recording pauses shortcuts, and each home/demo has separate bindings. See [shortcut setup and behavior](docs/SHORTCUTS.md).

**Home → Saved controls** lets you save named positions, build custom groups across rooms, and temporarily close selected shades before restoring their previous positions. Presets and groups can also have global shortcuts. Privacy timers start after closure is confirmed and require the app to stay running and the computer awake; a newer command, connection loss, sleep or quit cancels the restore. See [saved controls](docs/SAVED_CONTROLS.md) and the [review of your gateway API's capabilities](docs/API_CAPABILITIES.md).

**Schedules** shows existing gateway routines by weekday, including clock times, sunrise/sunset offsets, paused entries and setup errors. **Health → Device health** collects battery ranges, power, reported signal, firmware and offline status; **Health → Activity** shows app commands, acceptance, gateway reports and failures for this app session. See [schedules, health and activity](docs/HOME_INSIGHTS.md).

## Verify and build

```sh
npm run check
npm test
npm run smoke
npm run package
```

The smoke test opens an isolated Electron runtime, uses a temporary profile and a loopback gateway fixture, and does not move real shades. It writes results and native screenshots under `docs/`. `npm run package` creates a local application bundle under `release/`. The existing electron-builder flow is also available through `npm run build:mac` for a DMG. Public distribution still requires signing/notarization and platform/hardware validation.

Advanced gateway tools remain in Settings. To export the gateway's OpenAPI document after enabling Swagger:

```sh
npm run fetch-openapi -- 192.168.1.10
```

The generated document is ignored by Git because it may contain your gateway address.

## Evaluation and compatibility

Read the [revised assessment and feature roadmap](docs/EVALUATION.md) and [validation record](docs/VALIDATION.md). The earlier review of GitHub master described an older version; its missing-feature claims do not describe the newer local app.

The UI and API paths have automated coverage for simulated standard and dual-rail shades, failures, live events, navigation and settings. Physical movement, firmware-specific battery fields and the wider set of shade mechanisms still need testing with actual devices. Gen 1/2 gateways are not supported by this release. Gateway schedules can be viewed, but native schedule editing and automatic glare control are not included.

The renderer is sandboxed, has no Node or gateway network access, and communicates through a restricted preload bridge. Icons are bundled locally. Dependencies are locked for repeatable installation.
