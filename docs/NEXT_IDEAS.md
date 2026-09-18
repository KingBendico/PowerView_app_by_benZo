# What to add next

The app already has scenes, favorites, whole-room controls, battery/offline badges, search, light/dark themes, visual customization and global shortcuts. Temporary privacy, named positions and custom groups are now implemented in Home → Saved controls, including preset/group hotkeys. The schedule timeline, health overview and session activity history are also implemented in beta.8. The remaining ideas are proposals. The API review confirms schedule listing, but not scene/schedule editing or full scene-target previews; see API_CAPABILITIES.md.

| Priority | Idea | What it would do |
| --- | --- | --- |
| Implemented | Temporary privacy | “Close for 30 minutes, then restore.” Show a visible countdown and Cancel. Manual movement cancels the restore so an old timer cannot override a newer choice. Sleep and quit cancel the timer; no restore is replayed later. |
| Implemented | Named positions and custom groups | Save “Desk without glare” or “Street-facing windows” directly from current positions. Support selected devices across rooms and independent rail/tilt positions, with shortcuts for each preset. |
| Implemented | Activity history | A session history of commands, acceptance, gateway reports and errors, filtered by issues, app commands or gateway reports. Limited to 200 entries per home and cleared on quit; external sources are not guessed. |
| Implemented | Health overview | Device availability, approximate battery ranges, power source, signal and firmware, with a Needs attention filter and room navigation. Refresh timestamps describe gateway reads, not assumed motor contact. |
| 5 | Scene preview and editor | Show the devices and intended positions in an existing scene, then eventually create/edit scenes in the desktop app if the gateway supports it. Favorites and scene activation already exist. |
| Implemented / future | Schedule timeline / editing | Weekly overview with weekday and enabled/paused filters, clock times, solar offsets and setup errors is implemented. Native schedule editing remains unavailable in the documented API. |
| 7 | Glare assistant | Let the user mark window direction and working hours. Offer a suggested saved position when the sun is likely to hit the screen, with explicit activation before any automatic mode. |
| 8 | Personal room views | Optional room photos or window arrangements, reorderable cards, and fabric/transparency choices. Keep the precise control view available alongside a more personal home view. |

With the schedule timeline and health/activity overview delivered, a movement-speed control is a possible follow-up after validating it on the actual motors. Scene/schedule editing still requires a supported interface; exact solar next-run times cannot be inferred from the current schedule response alone.
