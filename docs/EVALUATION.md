**PowerView by BenZo — revised evaluation and roadmap**

Revised 16 September 2026 against the current local PowerView source supplied by BenZo, including its uncommitted changes. This is the source matching the supplied screenshot. The earlier GitHub-master review described an older, substantially less capable app and is superseded for product decisions.

**This is already a capable desktop controller, but its visual design and information layout need a substantial upgrade.** Preserve the working control behavior while redesigning the dashboard, navigation and shade presentation. Reliability and clearer feedback remain equally important. Favorites, tray access, room-wide actions, live updates, keyboard shortcuts, numeric positioning and visual controls are existing features, not proposed additions.

The untouched baseline is preserved in the local evaluation workspace, with a [file hash manifest](evaluation-evidence/current-source-manifest.json). This assessment describes that baseline before the improvements in this branch. The original source folder has not been modified.

**What the app already has**

| Area | Existing behavior verified in source |
| --- | --- |
| Desktop shell | Electron app, PowerView branding, resizable main window, macOS menu bar/system tray icon, focus/show action, quit menu and native editing menu. |
| Rooms | Room tiles, room colors and name-based icons; gateway, alphabetical and recent sorting; recently opened room shortcuts; numbered keyboard hints. |
| Shade visuals | Integrated draggable window graphics, touch/pointer handling, editable percentages, single-shade keyboard adjustment, dual grips and rail/hem fields for type 8. This is active application UI, not just the separate `shade.html` prototype. |
| Shade quick actions | Jog, ±8-point primary-position adjustments, 25/50/75 presets, and command status messages. |
| Group actions | Open all, Close all and Stop all for a room or the whole home, with confirmation dialogs. |
| Scenes | Gateway scene tiles, grouping in expandable room sections, Run buttons, favorites, recent scenes, active highlighting, pending feedback and a run toast. Correct Gen 3 scene activation path. |
| Live updates | Server-sent events for movement positions, scene activity, connectivity and battery alerts; automatic EventSource reconnection; connection/freshness display and manual refresh. |
| Device health | Offline/low-battery badges, plus battery percentage display when certain fields are present. Firmware interpretation and the initial rendering still need checking. |
| Preferences | Persisted favorite scenes, recent scenes/rooms, room sorting, light/dark themes and gateway address. Favorite scenes are also available from the tray. |
| Setup and discovery | Manual IPv4 entry, Test connection, Save after validation with Save anyway fallback, `.local` hostname discovery, parallel subnet scan and progress, selection of discovered addresses. |
| Help and API access | In-window Settings and Help overlays, Escape dismissal, Swagger UI enable/open workflow and a script to export the gateway OpenAPI document. |
| Keyboard/navigation | Ctrl+B/Ctrl+S, Ctrl+1–9 room shortcuts, main-row and numpad handling, All rooms back button, bottom navigation. |
| Startup and packaging | Cached room/color snapshot, loading skeleton, appearance transitions, reduced-motion/transparency handling, electron-builder configuration and existing Apple Silicon `.app`/DMG artifacts. Artifacts were found, not validated as releases. |

Some of these features need refinement; their presence should not be confused with complete reliability or hardware coverage.

**Corrections to the earlier assessment**

| Earlier statement | Correct assessment of this version |
| --- | --- |
| Failed shade commands overwrite remembered positions. | Fixed for HTTP failure. Successful HTTP acknowledgment still replaces the remembered position before a physical-device report. |
| Scene activation uses the wrong endpoint. | Fixed: it uses `/home/scenes/{id}/activate`, refreshes active scenes in the Scenes view, and receives scene SSE events. |
| Room names are inserted as HTML. | The room heading now uses a text node. The original injection example no longer reproduces. Renderer privilege isolation remains a separate concern. |
| Preload points to a missing file. | Path is corrected. However, its contextBridge design conflicts with `contextIsolation: false`; the renderer still directly imports Electron. |
| Empty setup generates invalid gateway requests. | Request guards and a setup message now exist. Basic HTTP and JSON error handling also exists. |
| Discovery launches every probe at once and progress regresses. | It now launches waves of at most 96 and counts completions for both reachable and unreachable hosts. Interface choice, subnet assumptions, role detection and cancellation remain concerns. |
| Fixed 650-pixel window; sliders only; no back button. | Window is resizable with a 360-pixel minimum; visual controls, number fields, presets and a back action are implemented. |
| Favorites, room actions, tray, theme and keyboard controls should be added. | Already implemented. Improve them and add only the missing pieces. |
| There is only a start script and no modern macOS build setup. | Build and OpenAPI export scripts exist; Apple Silicon build artifacts are present. |
| The dependency audit reports seven affected packages. | That count belonged to the old GitHub lockfile. The current lockfile has been audited separately; see current evidence below. |

**Findings that should drive the next increment**

Priority here describes implementation order, not a formal security rating.

| Priority | Finding in the supplied source | Recommended improvement |
| --- | --- | --- |
| High | The main window still enables Node integration and disables context isolation (`src/main/main.js`, window options). IPC handlers do not validate the sender; external URLs accept arbitrary HTTP(S); icons load from a CDN. | Isolate and sandbox the renderer; move gateway access into the main process; expose narrow validated preload methods; restrict navigation and external destinations; bundle icons and set a content policy. |
| High | `updateShadePosition` interprets HTTP success as the new reported position. Both axes are always transmitted. Only type 8 gets dual controls. | Keep requested/accepted/reported states distinct, omit untouched axes, and handle verified shade capabilities and rail constraints. Never pretend an acknowledgment proves movement finished. |
| High | Preset labels and the number field use opposite conventions: pressing 25% sends gateway primary 0.25, which the UI displays as **75% closed**. | Use one explicit convention throughout the room view; retain “% closed” and make presets/nudges agree. |
| High | Renderer XHRs have no explicit timeout. A gateway switch does not invalidate all old responses; a pending room read can reopen that room after the user has switched to Scenes. | Centralize finite-time requests, stale-response guards and connection ownership. Reads may retry within bounds; movement commands should not automatically repeat. |
| Medium | A successful colors request can clear a connection error from another request. Refresh on the room grid requests only colors and shades. | Use one connection state and refresh a consistent snapshot of rooms, shades and scenes. Preserve last known information with an explicit stale/offline status. |
| Medium | Group actions assume the same primary-axis direction for every shade; failures are reported as one group result. Stop all also asks for confirmation. | Resolve commands per supported mechanism and report individual failures. Make Stop immediate. Keep clearly scoped confirmation for whole-home movement. |
| Medium | Subnet discovery still chooses the first IPv4 interface and assumes `/24`; no visible cancellation control in the active overlay. Test connection only checks `/home/colors`; help still suggests the lower IP is primary. | Prefer mDNS, verify gateway identity/role, allow interface choice, honor subnet boundaries and cancel outstanding work. Remove the lower-IP heuristic. |
| Medium | Malformed config JSON still escapes parsing; config/prefs writes are not atomic. Favorites/recents are not scoped to the gateway. | Recover damaged settings with a backup, use atomic writes, migrate existing preferences and keep favorites specific to each home. |
| Medium | Tray Settings calls `createSettingsWindow`, which is not defined. Tray scene execution is delegated to a renderer and depends on renderer initialization. | Open the existing Settings overlay from the tray; execute scene commands through the shared gateway service. Make background/quit behavior explicit. |
| Medium | Room cards are clickable divs. Dual grips are focusable but have no keyboard movement handler. Overlays declare modal semantics without a focus trap/inert background; nav hides on scroll and has no active destination. | Use native room buttons, keyboard-operable rail controls, contained modal focus, persistent navigation and an active view indicator. |
| Low–medium | Battery row population is attempted before its node is attached. Unknown position values can render as fully closed; percentage inference accepts several ambiguous fields. | Populate after insertion, distinguish unknown from 0%, and show only verified battery values or known low-battery signals. |
| Low–medium | Bulk PUT helper calls completion on both `error` and `loadend`; a network failure invokes it twice. | Deliver each request result once and keep errors visible until the user can understand them. |

Electron's own recommendations support the isolation, sandbox, navigation and IPC changes. [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security). Shade families and hub generations need distinct treatment; existing reference implementations are useful for mapping capabilities, but are not proof of compatibility with this home's firmware. [Home Assistant PowerView integration](https://www.home-assistant.io/integrations/hunterdouglas_powerview/), [Gen 3 shade reference implementation](https://github.com/sander76/aio-powerview-api/blob/master/aiopvapi/resources/shade.py).

**UI and UX direction**

The first proposed visual changes were too modest for the requested improvement. The revised direction uses a desktop sidebar, warm neutral surfaces, restrained green accents, a forest dark theme and simpler textured window graphics. Home prioritizes pinned shade controls, with whole-home actions and favorite scenes together above them. Room shortcuts and global search reduce navigation steps. Keep the established drag, numeric, rail and scene behavior while changing the surrounding design.

- Put the room title, Back and room actions in a coherent header. A single-shade room currently has a lot of empty space and a detached toolbar; use a comfortable content width that adapts to shade count.
- Keep Home, Blinds and Scenes navigation visible and indicate the active destination. Home can collect existing favorite scenes and newly pinned shades; it does not require rebuilding scene favorites.
- Keep the large draggable control, with the reported value clearly distinguishable from a requested value. Explain unknown/offline state rather than showing a fabricated position.
- Label presets consistently as percentage closed; give Stop a direct, easy-to-find action. Add individual Open/Close/Stop where that makes sense for the mechanism.
- Provide search across rooms, shades and scenes, with Command/Ctrl+K and keyboard result navigation; preserve room order, color indicators and recent shortcuts.
- Make command feedback concise and specific: “Sending”, “Command accepted”, “Reported: 29% closed”, or a recoverable error. An active scene and an accepted scene command should have different meanings.
- Keep technical Swagger tools in an Advanced section so first-time setup stays short. Preserve the tools for troubleshooting.
- Add readable empty states and retain keyboard focus when refreshing data. Verify 360-pixel width, long names, dark mode, zoom and keyboard-only operation.

**New ideas, separated from what already exists**

| Priority | Idea | What is actually new |
| --- | --- | --- |
| Next | Home dashboard and pinned shades | Brings existing favorite scenes together with shade favorites and status. Favorites themselves already exist. |
| Next | Reliable background control | Runs tray actions through a shared gateway service, supports deliberate close-to-tray behavior, and gives visible command feedback. Tray itself already exists. |
| Next | Demo mode | A clearly labeled simulated home for onboarding, design review and automated testing without moving real shades. |
| Soon | Search/command palette | Search rooms, shades and scenes by name. Existing Ctrl shortcuts remain useful. |
| Soon | Selected-shade groups and saved positions | Operate a chosen subset, save a preferred percentage, and retry only failed targets. Whole-room actions already exist. |
| Soon | Local activity history and diagnostic export | Distinguish requests, acknowledgments and reported positions; export useful, optionally redacted diagnostics. Existing live health badges remain. |
| Later | Scene preview | Show affected shades and target positions before activation, if the gateway exposes scene membership. |
| Later | Named desktop modes | Work, Video call or Privacy shortcuts built on existing scenes, with explicit activation first. |
| Later | Preference backup and ordering | Export local favorites/shortcuts/theme and choose their order; not a promise to back up motor calibration or the hub. |
| Explore | Multi-home profiles | Named, separately scoped homes with unmistakable active-home identity. Connectivity to remote homes is a separate problem. |
| Explore | Schedule overview and temporary overrides | Show what happens next and when an override ends, subject to gateway API support and interaction with existing schedules. |
| Explore | Glare suggestions | Suggest a saved setting with a clear explanation and manual control. Validate demand and inputs before building automatic movement. |

Scheduling, automatic glare control and natural-language control should follow compatibility and usability work. Existing native PowerView routines should remain the authority unless integration has been verified. Desktop timers also need an explicit sleep/exit policy.

**Revised implementation sequence**

1. Preserve the current source and preferences. Fix percentages, stale navigation, state/timeout handling, Electron isolation and settings recovery. Refresh dependencies and test relevant shade capabilities.
2. Redesign Home and the desktop navigation, add pinned shades, search and demo mode, and update the shade illustrations. Improve the existing tray, group results and keyboard access while preserving working control paths.
3. Validate against the actual hub and representative single/dual shades, then prioritize diagnostics and scene previews. Treat automation as a later project.

**Implementation update after design feedback**

The review branch now includes the new layout and light/dark visual system, compact shade controls, a Home dashboard with pinned shades and existing favorite scenes, whole-home shortcuts, room shortcuts, and name search for rooms, shades and scenes. It also includes the isolation, request handling, configuration recovery, percentage, group-result and navigation fixes described above. Home, background control, demo and search in the idea table are now implemented in this branch. The table records the original roadmap; scene previews, saved custom groups, activity history and automation remain future ideas. See the validation record for tested behavior and hardware limits.

The 17 September motion update addresses the reported jump between old and selected positions. A separate dashed target remains stable while dragging; the fabric follows reported movement or an explicitly approximate gateway travel-time animation. Stale reads cannot rewind active travel, and final reports confirm settlement. Demo now simulates travel and intermediate Stop. A palette editor adds per-device shades/blinds or curtains, textures and custom colors with a live preview and saved preferences per home. Curtains can open from the center as a pair, or use a single panel opening to the left or right. Real two-rail shades retain both rails and support texture/color changes. Demo two-rail shades, including Bedroom left, can switch to curtains and back, with Reset restoring their original controls. These behaviors pass 34 core tests and 23 native Electron checks, including a loopback HTTP/SSE fixture. Exact synchronization with real hardware remains unverified. See [movement and appearance](MOTION_AND_APPEARANCE.md) and the [validation record](VALIDATION.md).

The global-shortcut update adds customizable system-wide keys while PowerView runs. It covers shade Open/Close/Stop and arbitrary percentages, room and whole-home actions, existing gateway scenes, app visibility and refresh. The editor pauses keys while recording, checks conflicts, and saves separately for each home and demo. This extends the original in-window navigation shortcuts; it is not a claim that keyboard access was absent before. The complete suite now has 46 core tests and 29 native Electron checks. See [shortcut behavior](SHORTCUTS.md).

For the next increment, prioritize **temporary privacy timers** (restore previous positions after a chosen interval), **named positions and custom groups**, and **activity history**. A consolidated health page can build on existing battery/offline badges. Scene previews, schedule visibility, sun/glare suggestions and personal room views offer further value. These are future ideas, described in [the updated feature shortlist](NEXT_IDEAS.md), and are separate from the new shortcuts already implemented.

**Evidence and limits**

Twelve baseline checks were executed successfully with simulated DOM, IPC and gateway responses: [results](evaluation-evidence/current-source-results.json), [reproduction script](evaluation-evidence/review-current-source.cjs). They verify corrections as well as remaining defects; they are not a release test suite. The separately captured [dependency audit](evaluation-evidence/current-dependency-audit.json) reports 27 affected package entries (2 critical, 22 high, 2 moderate, 1 low), not 27 proven exploitable application flaws. Electron is shipped as the application runtime even though npm classifies it as a development dependency.

The assessment also inspected the active renderer/main/preload source, styles, views, package configuration, export script and supplied screenshot. It did not operate real blinds, scan the actual network, verify physical battery readings, validate the existing DMG, conduct user interviews or certify accessibility/security. Native runtime validation of the upgrade belongs in its separate validation record.

The original GitHub review and its evidence remain in the local evaluation workspace as historical context only. Its feature gaps, source line numbers and dependency counts must not be attributed to this local baseline.
