# Global keyboard shortcuts

Open **Settings → Keyboard shortcuts**, choose a target and action, then click **Record keys** and press your combination. **Save shortcuts** checks availability and applies the configuration. Cancel keeps the previous bindings. The entire editor pauses PowerView's global shortcuts, so recording a movement key cannot operate a shade. Escape cancels recording first, then closes the editor on a subsequent press.

Shortcuts work system-wide while PowerView is running, even with another app focused or the window hidden. Quitting releases the registrations; starting the app restores saved bindings after connecting. Close-to-tray is available in Settings. These shortcuts do not launch an app that has quit, wake a sleeping computer or run while the computer is asleep.

| Target | Available actions |
| --- | --- |
| Any supported shade or curtain | Open fully, close fully, stop, or an integer percentage closed from 0–100 |
| Room | Open, close or stop every shade in that room |
| Whole home | Open, close or stop all shades |
| Existing gateway scene | Run the scene |
| Named preset | Apply its saved positions |
| Custom group | Open, close or stop its selected shades |
| PowerView | Show/hide the app, or refresh status |

The three-action starter uses **Ctrl+Shift+C** for Close, **Ctrl+Shift+O** for Open and **Ctrl+Shift+H** for 50% closed on the selected shade. Other optional starters use **Ctrl+Alt/Option+Shift+S** for whole-home Stop and **Ctrl+Alt/Option+P** for the app window. None is installed until you save. Use a different combination for each enabled action; the editor supports up to 40 bindings per home.

Percentage presets follow the same mechanism-specific controls as the app. Top-down direction is preserved. Two-rail shades place the top rail at the top and set the bottom rail for the requested closed percentage; the editor explains this before saving. Tilt-only and overlapped mechanisms retain Open/Close/Stop, but do not offer a single percentage shortcut. Room and whole-home shortcuts act immediately without a second confirmation; their scope is shown in the editor. Partial group failures are reported as a command count, and acceptance never claims physical movement is complete.

Saved bindings belong to a specific gateway address. Demo has its own settings and cannot trigger a real home's actions. Switching homes releases the previous keys. Unavailable targets and disconnected gateways do not queue movement for later replay; PowerView's window shortcut remains available during a gateway outage. Editing, disabling, deleting or quitting releases the corresponding keys. Failed saves preserve the previous configuration. Repeated key callbacks are debounced; Stop uses an independent command path and can interrupt ongoing movement.

The system may reserve a combination, or another app may own it. PowerView reports the conflict and lets you choose a different key; it cannot identify the other owner. Reopening the editor shows unavailable saved shortcuts, and Settings displays an attention count. A busy combination discovered at startup is left inactive until it can be registered. Common editing keys are accepted if available, so choose combinations you are happy to reserve across your desktop.

Native registration and renderer key recording are tested on macOS arm64 with Electron 44.4.1. Automated checks exercise command routing while unfocused, demo travel, configuration persistence, conflict recovery, master disable, app visibility, editor cleanup and home changes. Tests invoke the registered handler path; they do **not** synthesize a physical operating-system keypress into another app. Physical keyboard delivery, alternative keyboard layouts, sleep/resume and Windows/Linux behavior still need manual checks. No real shades were moved for validation.

Implementation uses Electron's main-process [globalShortcut API](https://www.electronjs.org/docs/latest/api/global-shortcut) and supported [keyboard accelerator format](https://www.electronjs.org/docs/latest/tutorial/keyboard-shortcuts). It does not require a background keyboard logger or renderer access to native APIs.
