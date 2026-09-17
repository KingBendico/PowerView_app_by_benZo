(function setupShortcuts() {
    const launch = document.getElementById('keyboardShortcutsButton'), format = window.shortcutFormat;
    let opening = false;
    function updateSummary(state) {
        const unavailable = state.rows.filter(row => ['conflict', 'missing', 'unsupported'].includes(row.status)).length;
        launch.querySelector('small').textContent = unavailable ? `${unavailable} shortcut${unavailable === 1 ? '' : 's'} need attention`
            : !state.bindings.length ? 'Control your home from any app' : !state.enabled ? 'Disabled for this home'
                : state.editing ? 'Paused while editing' : `${state.rows.filter(row => row.status === 'active').length} active · Control from any app`;
    }
    api.onShortcuts(updateSummary); api.getShortcuts().then(updateSummary).catch(() => {});
    const option = (parent, value, label) => { const el = document.createElement('option'); el.value = value; el.textContent = label; parent.appendChild(el); return el; };
    async function open() {
        if (opening || document.querySelector('dialog')) return;
        opening = true;
        try {
            const initial = await api.setShortcutsEditing(true);
            const draft = { address: initial.address, enabled: initial.enabled, bindings: structuredClone(initial.bindings) };
            let latest = initial, recording = null, saving = false;
            const dialog = document.createElement('dialog'); dialog.id = 'keyboardShortcutsDialog'; dialog.className = 'shortcuts-dialog';
            dialog.setAttribute('aria-labelledby', 'shortcutsTitle');
            dialog.innerHTML = `<form>
                <header class="shortcuts-header"><div class="shortcuts-icon"><i class="fas fa-keyboard" aria-hidden="true"></i></div><div><div class="page-eyebrow" id="shortcutsHome"></div><h2 id="shortcutsTitle">Keyboard shortcuts</h2></div><button type="button" class="shortcuts-close" aria-label="Close keyboard shortcuts">×</button></header>
                <div class="shortcuts-scroll"><p class="shortcuts-intro">A little less clicking. Control your shades, rooms and scenes from anywhere on your desktop.</p>
                <div class="shortcuts-toolbar"><label><input type="checkbox" id="shortcutsEnabled"> Enable for this home</label><span class="shortcuts-paused"><span aria-hidden="true">●</span> Paused while editing</span></div>
                <section class="shortcuts-starters" aria-labelledby="shortcutsStarterTitle"><h3 id="shortcutsStarterTitle">Start with the essentials</h3><p>Choose a shade, then add Open, Close and 50% closed. You can change every key.</p><div class="shortcuts-starter-shade"><label class="sr-only" for="shortcutStarterShade">Shade for the starter shortcuts</label><select id="shortcutStarterShade"></select><button type="button" id="shortcutAddEssentials">Add three shortcuts <span aria-hidden="true">↗</span></button></div><div class="shortcuts-quick-add"><button type="button" id="shortcutAddStop"><i class="fas fa-stop" aria-hidden="true"></i> Stop the whole home</button><button type="button" id="shortcutAddApp"><i class="fas fa-desktop" aria-hidden="true"></i> Show / hide PowerView</button></div></section>
                <div class="shortcuts-list-heading"><h3>Your shortcuts <span id="shortcutsCount"></span></h3><button type="button" id="shortcutAdd">+ Add shortcut</button></div>
                <div id="shortcutsList"></div><p class="shortcuts-empty">Your favorite actions, one key combination away.<br>Add a starter above or create your own shortcut.</p>
                <p class="shortcuts-error" role="alert" hidden></p><p class="shortcuts-last-run" role="status" hidden></p></div>
                <footer><p>Works while PowerView is running, including in the background. Quitting releases your keys.</p><div><button type="button" class="shortcuts-cancel">Cancel</button><button type="submit" class="shortcuts-save">Save shortcuts</button></div></footer>
            </form>`;
            const list = dialog.querySelector('#shortcutsList'), error = dialog.querySelector('.shortcuts-error'), save = dialog.querySelector('.shortcuts-save');
            const enabled = dialog.querySelector('#shortcutsEnabled'), starter = dialog.querySelector('#shortcutStarterShade');
            enabled.checked = draft.enabled;
            dialog.querySelector('#shortcutsHome').textContent = initial.homeName;
            for (const shade of initial.shades.filter(item => item.supportsPosition)) option(starter, shade.id, `${shade.roomName} · ${shade.name}`);
            const office = initial.shades.find(shade => shade.supportsPosition && /office/i.test(shade.roomName));
            if (office) starter.value = office.id;
            dialog.querySelector('#shortcutAddEssentials').disabled = !starter.options.length;
            if (!starter.options.length) option(starter, '', 'No shades with percentage control');
            function message(text = '') { error.textContent = text; error.hidden = !text; if (text) error.scrollIntoView({ block: 'nearest' }); }
            function updateStatus() {
                for (const row of list.children) {
                    const binding = draft.bindings.find(item => item.id === row.dataset.id);
                    const status = row.querySelector('.shortcut-status');
                    const existing = latest.bindings.find(item => item.id === binding.id);
                    const same = existing && JSON.stringify(existing) === JSON.stringify(binding);
                    const result = same && latest.rows.find(item => item.id === binding.id);
                    status.textContent = !draft.enabled || !binding.enabled ? 'Disabled' : result?.status === 'conflict' ? result.message
                        : same && ['offline', 'missing', 'unsupported'].includes(result?.status) ? result.message : same ? 'Saved · paused while editing' : 'Ready to save';
                    status.classList.toggle('has-error', result?.status === 'conflict');
                }
                const lastRun = dialog.querySelector('.shortcuts-last-run');
                lastRun.hidden = !latest.lastRun; lastRun.textContent = latest.lastRun ? `Last shortcut: ${latest.lastRun.message}` : '';
                if (latest.address !== draft.address) { message('The active home changed. Close this editor and reopen it for the new home.'); save.disabled = true; }
            }
            function stopRecording() {
                if (!recording) return;
                const button = recording.button, binding = recording.binding;
                recording = null; button.classList.remove('is-recording'); button.setAttribute('aria-pressed', 'false');
                button.textContent = binding.accelerator ? format.display(binding.accelerator, initial.platform) : 'Record keys';
            }
            function makeBinding(target, targetId, action, accelerator = '', percent) {
                return { id: crypto.randomUUID(), target, ...(['shade', 'room', 'scene'].includes(target) ? { targetId } : {}), action, enabled: true, accelerator, ...(action === 'position' ? { percent } : {}) };
            }
            function add(bindings) {
                if (draft.bindings.length + bindings.length > 40) { message('You can save up to 40 shortcuts for this home.'); return; }
                draft.bindings.push(...bindings); message(); render();
                list.lastElementChild?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                list.lastElementChild?.querySelector('.shortcut-target').focus({ preventScroll: true });
            }
            function populateTarget(select, binding) {
                for (const [target, title, items] of [['shade', 'Shades & curtains', initial.shades], ['room', 'Rooms', initial.rooms], ['scene', 'Scenes', initial.scenes]]) {
                    if (!items.length) continue;
                    const group = document.createElement('optgroup'); group.label = title;
                    for (const item of items) option(group, `${target}:${item.id}`, target === 'shade' ? `${item.roomName} · ${item.name}` : item.name);
                    select.appendChild(group);
                }
                option(select, 'home', 'Whole home'); option(select, 'app', 'PowerView app');
                const value = binding.targetId ? `${binding.target}:${binding.targetId}` : binding.target;
                if (![...select.options].some(item => item.value === value)) option(select, value, `Unavailable ${binding.target} (${binding.targetId})`);
                select.value = value;
            }
            function render() {
                const focused = document.activeElement, focusedRow = focused?.closest('.shortcut-row')?.dataset.id;
                const focusedControl = ['shortcut-target', 'shortcut-action'].find(name => focused?.classList.contains(name));
                stopRecording(); list.replaceChildren();
                dialog.querySelector('.shortcuts-empty').hidden = !!draft.bindings.length;
                dialog.querySelector('#shortcutsCount').textContent = String(draft.bindings.length);
                for (const binding of draft.bindings) {
                    const row = document.createElement('article'); row.className = 'shortcut-row'; row.dataset.id = binding.id;
                    row.innerHTML = `<div class="shortcut-fields"><label>Control<select class="shortcut-target"></select></label><label>Action<select class="shortcut-action"></select><span class="shortcut-percent"><input type="number" min="0" max="100" step="1" aria-label="Percent closed">% closed</span></label><label>Key combination<button type="button" class="shortcut-record" aria-pressed="false"></button></label><button type="button" class="shortcut-remove" aria-label="Remove shortcut">×</button></div><div class="shortcut-row-footer"><label><input type="checkbox" class="shortcut-enabled"> Enabled</label><span class="shortcut-status"></span></div><p class="shortcut-hint" hidden></p>`;
                    const target = row.querySelector('.shortcut-target'), action = row.querySelector('.shortcut-action'), percent = row.querySelector('.shortcut-percent input'), record = row.querySelector('.shortcut-record');
                    populateTarget(target, binding);
                    const shade = initial.shades.find(item => item.id === binding.targetId);
                    for (const value of format.actions[binding.target]) {
                        const item = option(action, value, value === 'position' ? 'Set percentage…' : format.actionLabel({ action: value }));
                        if (binding.target === 'shade' && (value === 'position' && !shade?.supportsPosition || value !== 'stop' && !shade?.known)) item.disabled = true;
                    }
                    action.value = binding.action; percent.value = binding.percent ?? 50;
                    row.querySelector('.shortcut-percent').hidden = binding.action !== 'position';
                    percent.required = binding.action === 'position'; percent.disabled = binding.action !== 'position';
                    record.textContent = binding.accelerator ? format.display(binding.accelerator, initial.platform) : 'Record keys';
                    const check = row.querySelector('.shortcut-enabled'); check.checked = binding.enabled;
                    const hint = row.querySelector('.shortcut-hint');
                    const hintText = binding.target === 'home' ? 'Runs immediately for every shade and curtain in this home.'
                        : binding.target === 'room' ? 'Runs immediately for every shade and curtain in this room.'
                        : binding.action === 'position' && shade?.dualRail ? 'Percentage presets place the top rail at the top, then position the bottom rail.' : '';
                    hint.hidden = !hintText; hint.textContent = hintText;
                    target.addEventListener('change', () => {
                        const [kind, id] = target.value.split(':'); binding.target = kind; delete binding.targetId;
                        if (id) binding.targetId = id;
                        binding.action = kind === 'app' ? 'toggle' : kind === 'scene' ? 'activate' : 'stop'; delete binding.percent; render();
                    });
                    action.addEventListener('change', () => { binding.action = action.value; if (action.value === 'position') binding.percent = 50; else delete binding.percent; render(); });
                    percent.addEventListener('input', () => { binding.percent = percent.value === '' ? null : Number(percent.value); updateStatus(); });
                    check.addEventListener('change', () => { binding.enabled = check.checked; updateStatus(); });
                    record.addEventListener('click', () => {
                        const same = recording?.binding === binding; stopRecording(); if (same) return;
                        recording = { binding, button: record }; record.classList.add('is-recording'); record.setAttribute('aria-pressed', 'true'); record.textContent = 'Press keys… Esc to cancel'; message();
                    });
                    record.addEventListener('blur', stopRecording);
                    row.querySelector('.shortcut-remove').addEventListener('click', () => { draft.bindings = draft.bindings.filter(item => item.id !== binding.id); render(); dialog.querySelector('#shortcutAdd').focus(); });
                    list.appendChild(row);
                }
                updateStatus();
                if (focusedRow && focusedControl) list.querySelector(`[data-id="${focusedRow}"] .${focusedControl}`)?.focus({ preventScroll: true });
            }
            dialog.addEventListener('keydown', event => {
                if (!recording) return;
                if (event.key === 'Tab' && !event.ctrlKey && !event.altKey && !event.metaKey) { stopRecording(); return; }
                event.preventDefault(); event.stopImmediatePropagation();
                if (event.key === 'Escape') { stopRecording(); return; }
                try {
                    const accelerator = format.fromEvent(event); if (!accelerator) return;
                    recording.binding.accelerator = accelerator; stopRecording(); message(); updateStatus();
                } catch (failure) { message(failure.message); }
            }, true);
            enabled.addEventListener('change', () => { draft.enabled = enabled.checked; updateStatus(); });
            dialog.querySelector('#shortcutAdd').addEventListener('click', () => add([initial.shades.length ? makeBinding('shade', starter.value || initial.shades[0].id, 'stop') : makeBinding('app', null, 'toggle')]));
            dialog.querySelector('#shortcutAddEssentials').addEventListener('click', () => add([
                makeBinding('shade', starter.value, 'close', 'Control+Shift+C'), makeBinding('shade', starter.value, 'open', 'Control+Shift+O'), makeBinding('shade', starter.value, 'position', 'Control+Shift+H', 50),
            ]));
            dialog.querySelector('#shortcutAddStop').addEventListener('click', () => add([makeBinding('home', null, 'stop', 'Control+Alt+Shift+S')]));
            dialog.querySelector('#shortcutAddApp').addEventListener('click', () => add([makeBinding('app', null, 'toggle', 'Control+Alt+P')]));
            for (const button of dialog.querySelectorAll('.shortcuts-close,.shortcuts-cancel')) button.addEventListener('click', () => { if (!saving) dialog.close(); });
            dialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); });
            dialog.querySelector('form').addEventListener('submit', async event => {
                event.preventDefault(); if (saving) return; stopRecording(); message();
                try {
                    format.cleanSettings(draft); saving = true; save.disabled = true;
                    const result = await api.saveShortcuts(draft);
                    dialog.close(); showSceneRunToast(result.enabled ? `${result.rows.filter(row => row.status === 'active').length} global shortcuts active` : 'Global shortcuts disabled for this home');
                } catch (failure) { message(failure.message); save.disabled = latest.address !== draft.address || !draft.address; }
                finally { saving = false; }
            });
            const unsubscribe = api.onShortcuts(state => { latest = state; updateStatus(); });
            const stopNavigation = api.onNavigation(action => { if (action === 'close-shortcuts') dialog.close(); });
            dialog.addEventListener('close', async () => {
                unsubscribe(); stopNavigation();
                try { await api.setShortcutsEditing(false); } catch (failure) { showSceneRunToast(failure.message); }
                finally { dialog.remove(); launch.focus(); }
            }, { once: true });
            document.body.appendChild(dialog); render();
            if (!draft.address) { message('Connect a gateway or open the demo to create shortcuts for your home.'); save.disabled = true; }
            dialog.showModal();
        } catch (failure) { await api.setShortcutsEditing(false).catch(() => {}); showSceneRunToast(failure.message); }
        finally { opening = false; }
    }
    launch.addEventListener('click', open);
})();
