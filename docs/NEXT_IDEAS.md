# What to add next

The app already has scenes, favorites, whole-room controls, battery/offline badges, search, light/dark themes, visual customization and global shortcuts. Temporary privacy, named positions and custom groups are now implemented in Home → Saved controls, including preset/group hotkeys. The remaining ideas are proposals. The API review confirms schedule listing, but not scene/schedule editing or full scene-target previews; see API_CAPABILITIES.md.

| Priority | Idea | What it would do |
| --- | --- | --- |
| Implemented | Temporary privacy | “Close for 30 minutes, then restore.” Show a visible countdown and Cancel. Manual movement cancels the restore so an old timer cannot override a newer choice. Sleep and quit cancel the timer; no restore is replayed later. |
| Implemented | Named positions and custom groups | Save “Desk without glare” or “Street-facing windows” directly from current positions. Support selected devices across rooms and independent rail/tilt positions, with shortcuts for each preset. |
| 3 | Activity history | A small, readable timeline of commands, acceptance, reported settlement and errors. It helps explain what moved and diagnose failures. Identify an external command's origin only when the gateway actually supplies it. |
| 4 | Health overview | Collect existing low-battery/offline badges into one page, with last-seen information and “needs attention” ordering. Avoid invented battery percentages when the firmware only provides a coarse status. |
| 5 | Scene preview and editor | Show the devices and intended positions in an existing scene, then eventually create/edit scenes in the desktop app if the gateway supports it. Favorites and scene activation already exist. |
| 6 | Routines and a “what happens next” timeline | Coordinate time-of-day, weekday and sunrise/sunset behavior with existing gateway schedules. Start by showing schedules and temporary overrides, then add editing once the hub API is verified. |
| 7 | Glare assistant | Let the user mark window direction and working hours. Offer a suggested saved position when the sun is likely to hit the screen, with explicit activation before any automatic mode. |
| 8 | Personal room views | Optional room photos or window arrangements, reorderable cards, and fabric/transparency choices. Keep the precise control view available alongside a more personal home view. |

With temporary privacy and named positions in place, prioritize a read-only schedule timeline and a health/activity overview. A movement-speed control is a promising follow-up after validating it on the actual motors.
