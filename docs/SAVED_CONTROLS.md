# Saved positions, custom groups and temporary privacy

Open **Home → Saved controls**. The three tabs share the same shade picker; select a room or an existing group for convenience, then adjust the individual selections.

**Saved positions:** arrange the shades using their normal controls, wait for movement to settle, name the preset and save. The app refreshes and captures each selected device's reported supported axes. Separate rail and tilt values are retained. Saving does not move anything. Apply preset recalls those positions and reports accepted/failed commands per device. A changed mechanism, missing position, offline device or changed home prevents an invalid recall. Up to 50 presets per home are stored locally.

**Custom groups:** name any selection of up to 100 shades, including devices in different rooms. Open, Close and Stop act on that selection through the existing capability-aware controller. Stop cancels queued group/preset movement. Groups and presets can be removed from Manage; removal uses a second explicit click. There are up to 50 groups per home.

Both appear on Home, with all entries available in Manage. **Settings → Keyboard shortcuts** includes Saved positions and Custom groups as targets. Removing a saved control leaves any corresponding shortcut visibly unavailable; it cannot silently target another device. All data is scoped to the current gateway, with separate demo settings.

**Temporary privacy:** select devices and a duration from 1 minute to 4 hours. PowerView captures their current positions, then sends Close. The countdown starts only after all requested closed positions are confirmed, with no outstanding motion/target. If closing fails or is not confirmed within two minutes, no automatic return is armed.

The timer runs in the main process while the app remains running, including with its window hidden. **Restore now** returns early; **Cancel timer** cancels the future return and leaves current positions alone. A newer app command affecting any selected device, an activated scene, a reported new movement/change, lost live/gateway connectivity, a changed home, sleep or quit cancels the return. Reopening the app does not restore old timers. Resume does not replay expired work. A timer more than 15 seconds late is discarded. These choices are shown in the timer editor.

Before restoring, PowerView reads fresh positions directly from the gateway and checks that the devices still match the expected closed state. Visual stale-read guards cannot hide an intervening physical change from that check. It validates the saved axes and rechecks cancellation/connection ownership before each device command. An in-flight command already accepted by a motor may continue; Cancel timer is not a physical Stop button. Use the existing Stop controls to halt travel.

Between-app/external movement can only be recognized when reported by the gateway. Automated tests validate simulation, cancellation, ordering and protocol handling, not real motors or every firmware. Completed timers report **restore commands accepted**, while the usual shade controls show reported settlement. Nothing in this feature changes native gateway schedules.

System sleep handling uses Electron's [powerMonitor suspend/resume events](https://www.electronjs.org/docs/latest/api/power-monitor). See [the gateway API review](API_CAPABILITIES.md) for native scene/schedule limitations.
