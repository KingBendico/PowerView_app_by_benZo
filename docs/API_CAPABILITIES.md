# Gateway API review — 17 September 2026

The supplied LAN Swagger UI was reachable. Its `swagger-ui-init.js` embeds **PowerView Gen3 Gateway API 2.13.0**, OpenAPI 3.1.0, with **39 paths and 43 operations**. The shade and automation list endpoints also returned valid live data. This review used documentation and read-only data requests; it sent no motor, schedule, network or integration changes to the real gateway. Raw responses, addresses and device identifiers are not committed to GitHub.

| Feature | Documented interface | What it means for this app |
| --- | --- | --- |
| Shades and curtains | GET `/home/shades`; PUT `/home/shades/positions`, `/home/shades/stop`; per-shade Jog | Individual and selected-device control, positions, rail/tilt controls and immediate Stop. Already used by the app. |
| Movement speed | Optional `positions.velocity`, 0–1 | A speed control is feasible on compatible hardware. Reading a value is not proof that every motor accepts every speed; movement testing is still needed. |
| Aura lighting | Optional `positions.light` brightness and temperature, plus documented transition options | Not applicable to the inspected installation: its 15 shades did not expose Aura light objects. This generic Gen 3 field is intentionally not surfaced in this app. |
| Existing scenes | GET `/home/scenes`, `/home/scenes/active`, `/home/scenes/{id}`; PUT activation | Run and display existing scenes. No scene create, edit or delete operation is documented. Scene detail includes room IDs and metadata, not the shade target positions needed for a full scene preview. |
| Existing automations | GET `/home/automations` and individual automation detail | A schedule overview can show weekdays, enabled status, associated scene, clock times and before/after sunrise/sunset offsets. Provisioning error shade IDs can identify schedules needing attention. No schedule create/edit/enable/disable operation is documented. |
| Live events | `/home/events`, shade/scene event streams, HomeDoc events | Live movement, status and scene activity, plus refreshing room/scene lists when home configuration changes. They do not promise continuous motor telemetry. |
| Device health | Shade battery status, power type, signal strength, firmware and null/offline positions | A better health dashboard and diagnostics; interpret each field according to firmware rather than inventing precise percentages. |
| Gateway light | GET/PUT `/gateway/led` | Gateway indicator color and brightness controls are possible. The published brightness bounds appear inverted; verify before implementing a slider. |
| Gateway diagnostics | `/gateway/info`, manifest, network status and radio metadata | Firmware and connection diagnostics. Changes such as reboot, network reconfiguration and firmware update checks are separate explicit operations. |
| Matter and Lutron | `/matter`, `/matter/passcode`, `/lutron` | Integration setup helpers are exposed, but some GET requests start integration services or return pairing credentials. They were not invoked during this review. |

Local presets/custom groups and temporary privacy do not need new gateway endpoints: the app stores device selections and supported positions and uses the existing movement interface. They do not create native gateway scenes or automations. Timers consequently require this app to remain running and the computer awake; sleep, quit and connection loss cancel them instead of sending delayed commands later.

The command response schema revealed a material reliability detail: HTTP 200 can carry a nonzero top-level `err` or per-shade `responses[].err`. The client now treats those responses as failed movement commands, with automated coverage.

Version 1.1.0-beta.8 implements the **read-only schedule timeline**, **health overview** and **activity history**. See [Home insights](HOME_INSIGHTS.md). Aura lighting is not applicable to the inspected installation. A **tested movement-speed option** remains a follow-up. Full scene editing, scene-target previews and editing gateway schedules cannot be promised from this documented interface alone. Shade capability codes reported by the inspected devices agreed with the app's current mappings, but no physical movement was tested.
