(function setupSavedControls() {
    let model = null, opening = false, routines = [], triggers = [];
    const active = timer => ['closing', 'waiting', 'restoring'].includes(timer.status);
    const button = (label, action, className = '') => { const el = document.createElement('button'); el.type = 'button'; el.textContent = label; el.className = className; el.addEventListener('click', action); return el; };
    const text = (tag, value, className = '') => { const el = document.createElement(tag); el.textContent = value; el.className = className; return el; };
    const names = ids => ids.map(id => model.shades.find(shade => shade.id === id)?.name || `Unavailable shade ${id}`).join(', ');
    async function task(action) { try { await action(); } catch (error) { showSceneRunToast(error.message); } }
    function countdown() {
        for (const el of document.querySelectorAll('[data-privacy-countdown]')) {
            const timer = model?.timers.find(item => item.id === el.dataset.privacyCountdown);
            if (!timer) continue;
            const seconds = Math.max(0, Math.ceil((timer.dueAt - Date.now()) / 1000));
            el.textContent = timer.status === 'waiting' ? `Restores in ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : timer.message;
        }
    }
    function timerCard(timer) {
        const card = document.createElement('article'); card.className = `privacy-card ${active(timer) ? 'is-active' : ''}`;
        card.appendChild(text('strong', timer.name));
        const status = text('p', timer.message); status.dataset.privacyCountdown = timer.id; card.appendChild(status);
        if (active(timer)) {
            const controls = document.createElement('div'); controls.className = 'saved-card-actions';
            const restore = button('Restore now', () => task(() => api.restorePrivacy(timer.id))); restore.disabled = timer.status !== 'waiting'; controls.appendChild(restore);
            controls.appendChild(button('Cancel timer', () => task(() => api.cancelPrivacy(timer.id)), 'saved-secondary')); card.appendChild(controls);
        }
        return card;
    }
    function savedCard(entry, kind, remove = false) {
        const card = document.createElement('article'); card.className = 'saved-card'; card.dataset.savedId = entry.id;
        card.appendChild(text('strong', entry.name));
        card.appendChild(text('p', `${entry.shadeIds.length} ${entry.shadeIds.length === 1 ? 'shade' : 'shades'} · ${names(entry.shadeIds)}`));
        if (kind === 'presets') {
            const details = document.createElement('details'); details.appendChild(text('summary', 'Saved positions'));
            const list = document.createElement('ul');
            for (const item of entry.positions) {
                const p = item.positions;
                const value = item.code === 7 ? `top rail ${p.secondary}%, bottom rail ${100 - p.primary}% closed`
                    : item.code === 5 ? `tilt ${p.tilt}%` : item.code >= 8 ? `sheer ${p.primary}%, blackout ${p.secondary}%`
                        : `${item.code === 6 ? p.primary : 100 - p.primary}% closed${p.tilt === undefined ? '' : ` · tilt ${p.tilt}%`}`;
                list.appendChild(text('li', `${names([item.id])}: ${value}`));
            }
            details.appendChild(list); card.appendChild(details);
        }
        const controls = document.createElement('div'); controls.className = 'saved-card-actions';
        for (const [label, action] of kind === 'presets' ? [['Apply preset', 'activate']] : [['Open', 'open'], ['Close', 'close'], ['Stop', 'stop']]) {
            const run = button(label, () => task(() => api.runControl({ address: model.address, kind, id: entry.id, action })), action === 'stop' ? 'saved-secondary' : '');
            run.dataset.savedAction = action; run.disabled = !model.connected || model.busy.includes(`${kind}:${entry.id}:${action}`); controls.appendChild(run);
        }
        if (remove) {
            const removeButton = button('Remove', () => {
                if (removeButton.dataset.confirm !== 'true') { removeButton.dataset.confirm = 'true'; removeButton.textContent = 'Confirm remove'; return; }
                void task(() => api.removeControl({ address: model.address, kind, id: entry.id }));
            }, 'saved-remove'); controls.appendChild(removeButton);
        }
        card.appendChild(controls); return card;
    }
    function routineCard(routine) {
        const card = document.createElement('article'); card.className = 'saved-card routine-card'; card.appendChild(text('strong', routine.name));
        card.appendChild(text('p', routine.steps.map(step => step.label).join(' → ')));
        const controls = document.createElement('div'); controls.className = 'saved-card-actions';
        controls.appendChild(button('Run routine', () => task(async () => { await api.runRoutine(routine.id); showSceneRunToast(`${routine.name} started`); }), ''));
        controls.appendChild(button('Remove', () => task(async () => { await api.removeRoutine(routine.id); await refreshRoutines(); }), 'saved-remove')); card.appendChild(controls); return card;
    }
    async function refreshRoutines() { try { routines = await api.getRoutines(); renderHome(); } catch (error) { showSceneRunToast(error.message); } }
    async function refreshTriggers() { try { triggers = await api.getTriggers(); renderHome(); } catch (error) { showSceneRunToast(error.message); } }
    async function openTriggerEditor() {
        if (opening || document.querySelector('dialog') || !routines.length) { if (!routines.length) showSceneRunToast('Create a routine before scheduling it.'); return; }
        opening = true;
        try {
            const dialog = document.createElement('dialog'); dialog.className = 'shortcuts-dialog saved-dialog'; dialog.innerHTML = '<form><header class="shortcuts-header"><div><div class="page-eyebrow">LOCAL AUTOMATION</div><h2>Schedule a routine</h2></div><button type="button" class="shortcuts-close" aria-label="Close schedule editor">×</button></header><div class="shortcuts-scroll"><label>Routine<select id="triggerRoutine"></select></label><label>Time<input id="triggerTime" type="time" required></label><fieldset><legend>Days</legend><div id="triggerDays"></div></fieldset><p class="shortcuts-error" role="alert" hidden></p></div><footer><button type="button" class="shortcuts-cancel">Cancel</button><button type="submit" class="shortcuts-save">Save schedule</button></footer></form>';
            const routineSelect = dialog.querySelector('#triggerRoutine'), daysRoot = dialog.querySelector('#triggerDays'), names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            routines.forEach(routine => routineSelect.appendChild(new Option(routine.name, routine.id))); names.forEach((name, day) => { const label = document.createElement('label'); const input = document.createElement('input'); input.type = 'checkbox'; input.value = String(day); input.checked = true; label.append(input, document.createTextNode(` ${name}`)); daysRoot.appendChild(label); });
            dialog.querySelector('form').addEventListener('submit', async event => { event.preventDefault(); const selected = [...daysRoot.querySelectorAll('input:checked')].map(input => Number(input.value)), error = dialog.querySelector('.shortcuts-error'); if (!selected.length) { error.textContent = 'Choose at least one day.'; error.hidden = false; return; } try { await api.saveTrigger({ routineId: routineSelect.value, time: dialog.querySelector('#triggerTime').value, days: selected }); dialog.close(); await refreshTriggers(); } catch (failure) { error.textContent = failure.message; error.hidden = false; } });
            for (const el of dialog.querySelectorAll('.shortcuts-close,.shortcuts-cancel')) el.addEventListener('click', () => dialog.close()); dialog.addEventListener('close', () => dialog.remove(), { once: true }); document.body.appendChild(dialog); dialog.showModal();
        } catch (error) { showSceneRunToast(error.message); } finally { opening = false; }
    }
    async function openRoutineEditor() {
        if (opening || document.querySelector('dialog')) return;
        opening = true;
        try {
            const state = await api.getState(), dialog = document.createElement('dialog'); dialog.className = 'shortcuts-dialog saved-dialog'; dialog.setAttribute('aria-labelledby', 'routineTitle');
            dialog.innerHTML = '<form><header class="shortcuts-header"><div><div class="page-eyebrow">LOCAL AUTOMATION</div><h2 id="routineTitle">Create routine</h2></div><button type="button" class="shortcuts-close" aria-label="Close routine editor">×</button></header><div class="shortcuts-scroll"><label class="saved-name-field">Name<input id="routineName" maxlength="60" placeholder="e.g. Movie time" required></label><div class="routine-builder"><label>Step<select id="routineType"><option value="scene">Run scene</option><option value="preset">Apply saved position</option><option value="group">Control saved group</option><option value="delay">Wait</option></select></label><label id="routineTargetLabel">Action<select id="routineTarget"></select></label><label id="routineActionLabel">Action<select id="routineAction"></select></label><button type="button" class="btn-secondary" id="routineAdd">Add step</button></div><ol id="routineSteps" class="routine-steps"></ol><p class="shortcuts-error" role="alert" hidden></p></div><footer><button type="button" class="shortcuts-cancel">Cancel</button><button type="submit" class="shortcuts-save">Save routine</button></footer></form>';
            const steps = [], type = dialog.querySelector('#routineType'), target = dialog.querySelector('#routineTarget'), action = dialog.querySelector('#routineAction'), targetLabel = dialog.querySelector('#routineTargetLabel'), actionLabel = dialog.querySelector('#routineActionLabel'), list = dialog.querySelector('#routineSteps');
            function updateFields() {
                const value = type.value; target.replaceChildren(); action.replaceChildren(); targetLabel.hidden = false; actionLabel.hidden = false;
                if (value === 'scene') for (const item of state.snapshot?.scenes || []) target.appendChild(new Option(item.name, item.id));
                if (value === 'preset') for (const item of model.presets) target.appendChild(new Option(item.name, item.id));
                if (value === 'group') for (const item of model.groups) target.appendChild(new Option(item.name, item.id));
                if (value === 'delay') { targetLabel.firstChild.textContent = 'Seconds'; target.appendChild(new Option('10 seconds', '10')); target.appendChild(new Option('30 seconds', '30')); target.appendChild(new Option('60 seconds', '60')); actionLabel.hidden = true; }
                else { targetLabel.firstChild.textContent = value === 'scene' ? 'Scene' : value === 'preset' ? 'Saved position' : 'Saved group'; for (const [label, value] of value === 'preset' ? [['Apply', 'activate']] : [['Open', 'open'], ['Close', 'close'], ['Stop', 'stop']]) action.appendChild(new Option(label, value)); }
            }
            function renderSteps() { list.replaceChildren(); steps.forEach((step, index) => { const row = document.createElement('li'); row.textContent = step.label; const remove = button('Remove', () => { steps.splice(index, 1); renderSteps(); }, 'saved-remove'); row.appendChild(remove); list.appendChild(row); }); }
            type.addEventListener('change', updateFields); updateFields();
            dialog.querySelector('#routineAdd').addEventListener('click', () => { const value = type.value; if (value === 'delay') steps.push({ kind: 'delay', ms: Number(target.value) * 1000, label: `Wait ${target.value} seconds` }); else { const item = value === 'scene' ? state.snapshot.scenes.find(x => x.id === target.value) : model[value === 'preset' ? 'presets' : 'groups'].find(x => x.id === target.value); steps.push(value === 'scene' ? { kind: 'scene', id: target.value, label: item?.name || 'Scene' } : { kind: 'saved', savedKind: value === 'preset' ? 'presets' : 'groups', id: target.value, action: action.value, label: `${item?.name || 'Saved control'} · ${action.value}` }); } renderSteps(); });
            dialog.querySelector('form').addEventListener('submit', async event => { event.preventDefault(); const error = dialog.querySelector('.shortcuts-error'); if (!steps.length) { error.textContent = 'Add at least one step.'; error.hidden = false; return; } try { await api.saveRoutine({ name: dialog.querySelector('#routineName').value, steps: steps.map(({ label, ...step }) => step) }); dialog.close(); await refreshRoutines(); } catch (failure) { error.textContent = failure.message; error.hidden = false; } });
            for (const el of dialog.querySelectorAll('.shortcuts-close,.shortcuts-cancel')) el.addEventListener('click', () => dialog.close()); dialog.addEventListener('close', () => dialog.remove(), { once: true }); document.body.appendChild(dialog); dialog.showModal();
        } catch (error) { showSceneRunToast(error.message); } finally { opening = false; }
    }
    function renderHome() {
        const root = document.getElementById('savedControlsHome'); if (!root || !model) return;
        root.replaceChildren();
        const header = document.createElement('div'); header.className = 'home-section-heading';
        header.appendChild(text('h3', 'Saved controls'));
        header.appendChild(button('Manage →', () => open('presets'), 'text-action')); root.appendChild(header);
        const quick = document.createElement('div'); quick.className = 'saved-quick-actions';
        quick.appendChild(button('◷  Temporary privacy', () => open('privacy')));
        quick.appendChild(button('+ Save a position', () => open('presets')));
        quick.appendChild(button('+ Create a group', () => open('groups'))); root.appendChild(quick);
        const routineHeader = document.createElement('div'); routineHeader.className = 'home-section-heading'; routineHeader.appendChild(text('h3', 'Local routines')); routineHeader.appendChild(button('+ Create routine', openRoutineEditor, 'text-action')); routineHeader.appendChild(button('Schedule', openTriggerEditor, 'text-action')); root.appendChild(routineHeader);
        const routineGrid = document.createElement('div'); routineGrid.className = 'saved-controls-grid'; for (const routine of routines.slice(0, 3)) routineGrid.appendChild(routineCard(routine)); root.appendChild(routineGrid);
        const triggerGrid = document.createElement('div'); triggerGrid.className = 'privacy-list'; for (const trigger of triggers) { const card = document.createElement('article'); card.className = 'privacy-card'; card.appendChild(text('strong', `${trigger.time} · ${trigger.routineName}`)); card.appendChild(text('p', trigger.days.map(day => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day]).join(', '))); card.appendChild(button('Remove', () => task(async () => { await api.removeTrigger(trigger.id); await refreshTriggers(); }), 'saved-remove')); triggerGrid.appendChild(card); } if (triggers.length) root.appendChild(triggerGrid);
        const cards = document.createElement('div'); cards.className = 'saved-controls-grid';
        for (const kind of ['presets', 'groups']) for (const entry of model[kind].slice(0, 3)) cards.appendChild(savedCard(entry, kind));
        root.appendChild(cards);
        if (!cards.children.length) root.appendChild(text('p', 'Save your favorite positions, combine shades across rooms, or close them for a little while.', 'saved-empty'));
        const timers = document.createElement('div'); timers.className = 'privacy-list';
        for (const timer of model.timers.filter(active)) timers.appendChild(timerCard(timer));
        root.appendChild(timers); countdown();
    }
    async function open(tab = 'presets') {
        if (opening || document.querySelector('dialog')) return;
        opening = true;
        try {
            model = await api.getSavedControls(); const initial = model, address = model.address;
            const dialog = document.createElement('dialog'); dialog.id = 'savedControlsDialog'; dialog.className = 'shortcuts-dialog saved-dialog'; dialog.setAttribute('aria-labelledby', 'savedControlsTitle');
            dialog.innerHTML = `<form><header class="shortcuts-header"><div class="shortcuts-icon"><i class="fas fa-bookmark" aria-hidden="true"></i></div><div><div class="page-eyebrow">MAKE ROOM FOR YOUR DAY</div><h2 id="savedControlsTitle">Saved controls</h2></div><button type="button" class="shortcuts-close" aria-label="Close saved controls">×</button></header><nav class="saved-tabs" aria-label="Saved control type"></nav><div class="shortcuts-scroll"><p class="saved-intro"></p><div class="saved-name-field"><label for="savedControlName">Name</label><input id="savedControlName" maxlength="60" placeholder="e.g. Desk without glare" required></div><div class="privacy-duration" hidden><label for="privacyMinutes">Keep closed for</label><select id="privacyMinutes"><option value="1">1 minute</option><option value="5">5 minutes</option><option value="15">15 minutes</option><option value="30" selected>30 minutes</option><option value="60">1 hour</option><option value="120">2 hours</option><option value="240">4 hours</option></select></div><div class="saved-selection-heading"><h3>Choose shades</h3><label><span class="sr-only">Select a room or group</span><select id="savedSelectGroup"><option value="">Select a room or group…</option></select></label></div><div class="saved-shade-picker"></div><p class="saved-selection-count" aria-live="polite"></p><p class="saved-policy" hidden>Countdown starts after closing is confirmed. Keep PowerView running and your computer awake. A newer command, connection loss, sleep or quitting cancels the restore. Cancel timer keeps the current positions.</p><p class="shortcuts-error" role="alert" hidden></p><section class="saved-existing"><h3></h3><div class="saved-existing-list"></div></section></div><footer><p class="saved-footer-note">Saved on this computer, separately for each home. Available in Keyboard shortcuts.</p><div><button type="button" class="shortcuts-cancel">Done</button><button type="submit" class="shortcuts-save">Save current positions</button></div></footer></form>`;
            const form = dialog.querySelector('form'), picker = dialog.querySelector('.saved-shade-picker'), select = dialog.querySelector('#savedSelectGroup'), name = dialog.querySelector('#savedControlName'), save = dialog.querySelector('.shortcuts-save'), error = dialog.querySelector('.shortcuts-error');
            let busy = false;
            const selected = () => [...picker.querySelectorAll('input:checked')].map(input => input.value);
            function updateCount() { dialog.querySelector('.saved-selection-count').textContent = `${selected().length} selected`; }
            function message(value = '') { error.textContent = value; error.hidden = !value; if (value) error.scrollIntoView({ block: 'nearest' }); }
            function renderExisting() {
                const root = dialog.querySelector('.saved-existing-list'); root.replaceChildren();
                dialog.querySelector('.saved-existing h3').textContent = tab === 'privacy' ? 'Privacy timers' : tab === 'presets' ? 'Your saved positions' : 'Your groups';
                if (tab === 'privacy') for (const timer of [...model.timers].reverse()) root.appendChild(timerCard(timer));
                else for (const entry of model[tab]) root.appendChild(savedCard(entry, tab, true));
                if (!root.children.length) root.appendChild(text('p', tab === 'privacy' ? 'No privacy timers yet.' : 'Your saved controls will appear here and on Home.', 'saved-empty'));
                countdown();
            }
            function switchTab(value) {
                tab = value; message();
                for (const el of dialog.querySelectorAll('.saved-tabs button')) el.setAttribute('aria-pressed', String(el.dataset.tab === value));
                name.required = value !== 'privacy'; dialog.querySelector('.saved-name-field').hidden = value === 'privacy';
                dialog.querySelector('.privacy-duration').hidden = value !== 'privacy'; dialog.querySelector('.saved-policy').hidden = value !== 'privacy';
                dialog.querySelector('.saved-intro').textContent = value === 'presets' ? 'Get your shades just right, then save their current reported positions together. Saving sends no movement commands.'
                    : value === 'groups' ? 'Bring selected shades together, even across different rooms. Give the group a name, then control it with one click.'
                        : 'Close selected shades for a while, then return them to the positions they had before. New commands or reported changes cancel the return.';
                save.textContent = value === 'privacy' ? 'Close & start timer' : value === 'groups' ? 'Save group' : 'Save current positions';
                name.placeholder = value === 'groups' ? 'e.g. Street-facing windows' : 'e.g. Desk without glare';
                renderExisting();
            }
            for (const [label, value] of [['Saved positions', 'presets'], ['Custom groups', 'groups'], ['Privacy timer', 'privacy']]) {
                const el = button(label, () => { if (!busy) switchTab(value); }); el.dataset.tab = value; dialog.querySelector('.saved-tabs').appendChild(el);
            }
            for (const shade of initial.shades) {
                const label = document.createElement('label'); label.className = 'saved-shade-choice';
                const input = document.createElement('input'); input.type = 'checkbox'; input.value = shade.id; input.disabled = !shade.available || !shade.known; input.addEventListener('change', updateCount); label.appendChild(input);
                const caption = document.createElement('span'); caption.appendChild(text('strong', shade.name)); caption.appendChild(text('small', `${shade.roomName}${input.disabled ? ' · Unavailable' : ''}`)); label.appendChild(caption); picker.appendChild(label);
            }
            const rooms = [...new Map(initial.shades.map(shade => [shade.roomId, shade.roomName])).entries()];
            for (const [value, label] of [...rooms.map(([id, room]) => [`room:${id}`, room]), ...initial.groups.map(group => [`group:${group.id}`, group.name])]) {
                const option = document.createElement('option'); option.value = value; option.textContent = label; select.appendChild(option);
            }
            select.addEventListener('change', () => {
                const [kind, id] = select.value.split(':');
                const ids = kind === 'room' ? initial.shades.filter(shade => shade.roomId === id).map(shade => shade.id) : initial.groups.find(group => group.id === id)?.shadeIds || [];
                for (const input of picker.querySelectorAll('input')) input.checked = !input.disabled && ids.includes(input.value); updateCount();
            });
            const unsubscribe = api.onSavedControls(state => {
                model = state;
                if (state.address !== address) { message('The active home changed. Close this editor and reopen it.'); save.disabled = true; }
                else renderExisting();
            });
            form.addEventListener('submit', async event => {
                event.preventDefault(); if (busy) return; message();
                if (!selected().length) { message('Choose at least one shade.'); return; }
                busy = true; save.disabled = true;
                try {
                    if (tab === 'privacy') await api.startPrivacy({ address, shadeIds: selected(), minutes: Number(dialog.querySelector('#privacyMinutes').value) });
                    else await api.saveControl({ address, kind: tab, name: name.value, shadeIds: selected() });
                    showSceneRunToast(tab === 'privacy' ? 'Closing shades · the countdown starts on confirmation' : tab === 'groups' ? 'Group saved' : 'Current positions saved');
                    if (tab !== 'privacy') name.value = '';
                } catch (failure) { message(failure.message); }
                finally { busy = false; save.disabled = model.address !== address || !model.connected; }
            });
            for (const el of dialog.querySelectorAll('.shortcuts-close,.shortcuts-cancel')) el.addEventListener('click', () => dialog.close());
            dialog.addEventListener('close', () => { unsubscribe(); dialog.remove(); document.querySelector('#savedControlsHome .text-action')?.focus(); }, { once: true });
            document.body.appendChild(dialog); switchTab(tab); updateCount(); save.disabled = !model.connected;
            dialog.showModal();
        } catch (error) { showSceneRunToast(error.message); }
        finally { opening = false; }
    }
    window.savedControls = { open, mountHome(parent) { const root = document.createElement('section'); root.id = 'savedControlsHome'; parent.appendChild(root); renderHome(); } };
    api.onSavedControls(state => { model = state; renderHome(); });
    api.getSavedControls().then(state => { model = state; renderHome(); }).catch(error => showSceneRunToast(error.message));
    void refreshRoutines(); void refreshTriggers();
    setInterval(countdown, 1000);
})();
