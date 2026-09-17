// Shared main-process state feeds the existing room, scene and shade controls.
let appState = null;
let refreshPromise = null;
let renderedSignature = '';
function isConnected() { return ['connected', 'demo'].includes(appState?.connection.status); }
function closedPercent(shade) {
    const value = shade.positions.primary;
    return shade.controls.kind === 'top-down' ? Math.round((value ?? 0) * 100) : gatewayPositionToVisualPercent(value);
}
function reportedText(shade) {
    if (!shade.available) return 'Offline · last reported position';
    if (shade.controls.kind === 'dual-rail') {
        if (shade.positions.primary == null || shade.positions.secondary == null) return 'Position not reported';
        return `Reported: top rail ${Math.round(shade.positions.secondary * 100)}% · bottom rail ${closedPercent(shade)}% from top`;
    }
    if (shade.controls.kind === 'tilt') return shade.positions.tilt == null ? 'Tilt not reported' : `Reported tilt: ${Math.round(shade.positions.tilt * 100)}%`;
    return shade.positions.primary == null ? 'Position not reported' : `Reported: ${closedPercent(shade)}% closed`;
}
function updateNavigation() {
    const selected = currentMainView === 'room-shades' ? 'blinds' : currentMainView === 'rooms' ? 'blinds' : currentMainView;
    for (const name of ['home', 'blinds', 'scenes', 'schedules', 'health']) {
        const button = document.getElementById(`btn-${name}`);
        button.classList.toggle('is-active', selected === name);
        if (selected === name) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    }
}
function applyState(state) {
    const previousAddress = appState?.connection.address;
    const previousFavorites = JSON.stringify(appState?.favorites);
    const previousAppearances = JSON.stringify(appState?.config.appearances);
    appState = state;
    if (previousAddress !== state.connection.address) {
        const search = document.getElementById('homeSearch'); if (search) { search.value = ''; search.setAttribute('aria-expanded', 'false'); }
        const results = document.getElementById('searchResults'); if (results) results.hidden = true;
    }
    const recent = state.config.recent[state.connection.address] || { scenes: [], rooms: [] };
    prefs = { ...prefs, theme: state.config.theme, closeToTray: state.config.closeToTray, roomSort: state.config.roomSort,
        favoriteShades: state.favorites.shadeIds,
        favoriteScenes: state.favorites.sceneIds.map(id => ({ id, name: state.snapshot?.scenes.find(scene => scene.id === id)?.name || id })),
        recentScenes: recent.scenes, recentRooms: recent.rooms };
    applyThemeToDocument(); updateThemeButton();
    host = state.connection.address ? `http://${state.connection.address}` : '';
    if (state.snapshot) {
        colors = state.snapshot.rooms.map(room => room.color);
        allRooms = state.snapshot.rooms.map((room, i) => ({ ...room, ptName: room.name, color: i }));
        allScenes = state.snapshot.scenes.map(scene => ({ ...scene, ptName: scene.name }));
        allShades = state.snapshot.shades.map(shade => ({ ...shade, ptName: shade.name,
            positions: Object.fromEntries(['primary', 'secondary', 'tilt'].map(key => [key, shade.positions[key] == null ? null : shade.positions[key] / 100])) }));
        activeSceneIdSet = new Set(state.snapshot.activeSceneIds);
        lastShadesFetchOkAt = new Date(state.snapshot.lastUpdated).getTime();
        persistHubSnapshot();
        shadeTelemetryById.clear();
        for (const shade of allShades) if (!shade.available || shade.batteryLow) shadeTelemetryById.set(Number(shade.id), { offline: !shade.available, batteryLow: shade.batteryLow });
    } else {
        allRooms = []; allScenes = []; allShades = []; activeSceneIdSet.clear(); lastShadesFetchOkAt = 0;
        if (state.config.ipAddress) tryRestoreCachedHubSnapshot(state.config.ipAddress);
    }
    sseConnectionState = state.connection.live || 'idle';
    setConnectionHealthBarVisible(true);
    renderConnectionHealthBar();
    const status = state.connection.status;
    setHubStatus(status !== 'offline' && !state.notice, state.notice || (status === 'offline' ? `${state.connection.error} Last reported data is retained.` : ''));
    const demo = document.getElementById('demoModeBar');
    demo.hidden = status !== 'demo';
    const signature = JSON.stringify([allRooms.map(item => [item.id, item.ptName]), allShades.map(item => [item.id, item.roomId, item.type]), allScenes.map(item => [item.id, item.ptName, item.roomIds])]);
    const structuralChange = signature !== renderedSignature;
    renderedSignature = signature;
    if (!initialShellRevealDone || previousAddress !== state.connection.address) { currentMainView = 'home'; renderCurrentView(); }
    else if (structuralChange || previousAppearances !== JSON.stringify(state.config.appearances)
        || (currentMainView === 'home' && previousFavorites !== JSON.stringify(state.favorites))) renderCurrentView();
    for (const shade of allShades) {
        const tile = document.querySelector(`[data-shade-id="${shade.id}"]`);
        liveShadeTileRefs.get(shade.id)?.();
        for (const input of tile?.querySelectorAll('[data-axis]') || []) {
            if (input !== document.activeElement) input.value = shade.positions[input.dataset.axis] == null ? '' : String(Math.round(shade.positions[input.dataset.axis] * 100));
        }
        const reported = document.getElementById(`shade-reported-${shade.id}`);
        if (reported) reported.textContent = state.motions?.[shade.id] ? reportedText(shade).replace('Reported:', 'Last report:') : reportedText(shade);
        const feedback = state.feedback[`shade:${shade.id}`] || state.feedback[`stop:${shade.id}`];
        const statusEl = document.getElementById(`shade-status-${shade.id}`);
        if (statusEl && feedback) {
            statusEl.textContent = feedback.kind === 'moving' ? '' : feedback.message;
            statusEl.className = `shade-command-status ${feedback.kind === 'error' ? 'is-error' : feedback.kind === 'pending' ? 'is-pending' : 'is-ok'}`;
        }
        updateShadeBadgeInDomIfAny(shade.id); updateShadeBatteryRowInDom(shade.id);
        const star = tile?.querySelector('.scene-star');
        if (star) { star.classList.toggle('is-favorite', state.favorites.shadeIds.includes(shade.id)); star.setAttribute('aria-pressed', String(state.favorites.shadeIds.includes(shade.id))); }
    }
    updateSceneButtons(); updateCommandAvailability(); updateHomeSummary(); updateNavigation(); finalizeInitialShellReveal();
    window.homeInsights?.update();
}
function renderCurrentView() {
    if (currentMainView === 'room-shades' && allRooms.some(room => room.id === displayedRoomId)) displayShadesInRoom(displayedRoomId);
    else if (currentMainView === 'scenes') displayScenesByRoom();
    else if (currentMainView === 'rooms') showRooms(allRooms);
    else if (currentMainView === 'schedules') window.homeInsights?.showSchedules();
    else if (currentMainView === 'health') window.homeInsights?.showHealth();
    else { currentMainView = 'home'; showHome(); }
    updateNavigation(); updateCommandAvailability();
}
async function refreshData() {
    if (refreshPromise) return refreshPromise;
    refreshPromise = api.refresh().catch(error => showSceneRunToast(error.message)).finally(() => { refreshPromise = null; });
    return refreshPromise;
}
function updateSceneButtons() {
    for (const tile of document.querySelectorAll('[data-scene-id]')) {
        const id = tile.dataset.sceneId;
        const pending = sceneRunPendingIds.has(id) || appState?.pending[`scene:${id}`];
        tile.classList.toggle('is-scene-running', !!pending);
        tile.classList.toggle('is-active-scene', activeSceneIdSet.has(id));
        const button = tile.matches('button') ? tile : tile.querySelector('.scene-tile-run');
        if (button) {
            button.disabled = !isConnected() || !!pending; button.setAttribute('aria-busy', String(!!pending));
            if (button.classList.contains('scene-tile-run')) button.textContent = pending ? 'Sending…' : '▶ Run';
        }
        const note = tile.querySelector('.scene-tile-running-note'); if (note) note.hidden = !pending;
        const star = tile.querySelector('.scene-star');
        if (star) { star.classList.toggle('is-favorite', isFavoriteSceneId(id)); star.setAttribute('aria-pressed', String(isFavoriteSceneId(id))); }
    }
}
function updateCommandAvailability() {
    for (const tile of document.querySelectorAll('[data-shade-id]')) {
        const shade = allShades.find(item => item.id === tile.dataset.shadeId);
        if (!shade) continue;
        const pending = !!appState?.pending[`shade:${shade.id}`];
        const unknown = shade.controls.axes.some(axis => shade.positions[axis.key] == null);
        tile.classList.toggle('is-position-unknown', unknown);
        tile.classList.toggle('is-unavailable', !isConnected() || !shade.available);
        for (const control of tile.querySelectorAll('.shade-tile-body button, .shade-tile-body input')) {
            control.disabled = control.dataset.positionBlocked === 'true' || !isConnected() || (control.dataset.action !== 'stop' && (pending || !shade.available));
        }
        for (const visual of tile.querySelectorAll('[role="slider"]')) {
            const disabled = visual.dataset.positionBlocked === 'true' || !isConnected() || !shade.available || pending;
            visual.setAttribute('aria-disabled', String(disabled)); visual.tabIndex = disabled ? -1 : 0;
        }
    }
    for (const button of document.querySelectorAll('[data-gateway-command]')) button.disabled = !isConnected() || (button.dataset.gatewayCommand !== 'stop' && !!appState?.pending[`room:${displayedRoomId}`]);
    const refresh = document.getElementById('connectionHealthRefreshBtn');
    refresh.disabled = !!appState?.refreshing || appState?.connection.status === 'connecting';
    refresh.textContent = appState?.refreshing ? 'Refreshing…' : 'Refresh';
}
async function runShadeAction(id, action, statusEl) {
    try { await api.shadeAction({ id, action }); if (statusEl) statusEl.textContent = 'Command accepted'; }
    catch (error) { if (statusEl) statusEl.textContent = error.message; else showSceneRunToast(error.message); }
}
function createIndividualActions(shade, statusEl) {
    const row = document.createElement('div'); row.className = 'individual-actions';
    for (const [action, label] of [['open','Open'], ['close','Close'], ['stop','Stop']]) {
        if (!shade.controls.known && action !== 'stop') continue;
        const button = document.createElement('button'); button.type = 'button'; button.className = 'btn-fine-shade';
        button.dataset.action = action; button.textContent = shade.controls.kind === 'dual-rail' && action !== 'stop' ? `${label} shade` : label; button.setAttribute('aria-label', `${label} ${shade.ptName}`);
        button.addEventListener('click', () => runShadeAction(shade.id, action, statusEl)); row.appendChild(button);
    }
    return row;
}
function createAxisControl(shade, axis, statusEl) {
    const label = document.createElement('label'); label.className = 'axis-control';
    const text = document.createElement('span'); text.textContent = `${axis.label} (%)`; label.appendChild(text);
    const input = document.createElement('input'); input.type = 'number'; input.min = '0'; input.max = '100'; input.step = '1';
    input.dataset.axis = axis.key; input.value = shade.positions[axis.key] == null ? '' : String(Math.round(shade.positions[axis.key] * 100));
    input.setAttribute('aria-label', `${shade.ptName}, ${axis.label} percent`);
    input.addEventListener('change', async () => {
        if (!input.checkValidity() || input.value === '') { input.reportValidity(); return; }
        try { await api.moveShade({ id: shade.id, positions: { [axis.key]: Number(input.value) } }); }
        catch (error) { statusEl.textContent = error.message; }
    });
    label.appendChild(input); return label;
}
function updateHomeSummary() {
    const status = document.getElementById('homeOverviewStatus');
    if (!status) return;
    const offline = allShades.filter(shade => !shade.available).length;
    status.textContent = !isConnected() ? 'Gateway offline · showing last reported positions.'
        : offline ? `${offline} ${offline === 1 ? 'shade needs' : 'shades need'} attention. Open its room for details.`
        : `${allShades.length} shades across ${allRooms.length} rooms`;
}
function showHome() {
    currentMainView = 'home'; displayedRoomId = null; liveShadeTileRefs.clear();
    const content = document.getElementById('content'); content.className = 'content-home'; content.replaceChildren();
    const eyebrow = document.createElement('div'); eyebrow.className = 'page-eyebrow';
    eyebrow.textContent = new Intl.DateTimeFormat(undefined,{weekday:'long',month:'long',day:'numeric'}).format(new Date()); content.appendChild(eyebrow);
    const title = document.createElement('h2'); title.textContent = 'Home overview'; content.appendChild(title);
    const intro = document.createElement('p'); intro.className = 'home-intro';
    intro.textContent = 'Your everyday controls, all in one place.';
    content.appendChild(intro);
    if (!appState?.snapshot) {
        const empty = document.createElement('div'); empty.className = 'home-empty';
        const text = document.createElement('p'); text.textContent = appState?.connection.status === 'connecting' ? 'Connecting to your gateway…' : 'Connect your PowerView Gen 3 gateway to get started, or explore a demo home.';
        empty.appendChild(text);
        for (const [label, action] of [['Connect gateway', () => document.getElementById('settingsButton').click()], ['Explore demo', () => api.demo(true).catch(error => showSceneRunToast(error.message))]]) {
            const button = document.createElement('button'); button.className = 'btn-back'; button.textContent = label; button.addEventListener('click', action); empty.appendChild(button);
        }
        content.appendChild(empty); return;
    }
    const summary = document.createElement('div'); summary.className = 'home-summary-grid'; content.appendChild(summary);
    const overview = document.createElement('section'); overview.className = 'home-overview';
    const details = document.createElement('div'); details.className = 'overview-copy';
    const heading = document.createElement('h3'); heading.textContent = 'Whole home'; details.appendChild(heading);
    const status = document.createElement('p'); status.id = 'homeOverviewStatus'; details.appendChild(status);
    const quick = createBulkShadeToolbar(allShades.map(shade => shade.id), 'Whole home'); if (quick) details.appendChild(quick);
    overview.appendChild(details);
    const illustration = document.createElement('div'); illustration.className = 'overview-window'; illustration.setAttribute('aria-hidden','true');
    illustration.innerHTML = '<div class="overview-sun"></div><div class="overview-slats"></div>'; overview.appendChild(illustration); summary.appendChild(overview);
    const scenes = document.createElement('section'); scenes.className = 'home-favorite-scenes';
    const scenesTitle = document.createElement('h3'); scenesTitle.textContent = 'Favorite scenes'; scenes.appendChild(scenesTitle);
    const sceneGrid = document.createElement('div'); sceneGrid.className = 'scene-tile-grid';
    for (const scene of allScenes.filter(item => isFavoriteSceneId(item.id))) sceneGrid.appendChild(buildSceneTile(scene));
    if (!sceneGrid.children.length) { const note = document.createElement('p'); note.textContent = 'Star a scene in Scenes to keep it here and in the tray menu.'; sceneGrid.appendChild(note); }
    scenes.appendChild(sceneGrid); summary.appendChild(scenes);
    window.savedControls?.mountHome(content);
    const pinsHeader = document.createElement('div'); pinsHeader.className = 'home-section-heading';
    const pinsTitle = document.createElement('h3'); pinsTitle.textContent = 'Pinned shades'; pinsHeader.appendChild(pinsTitle);
    const manage = document.createElement('button'); manage.type = 'button'; manage.className = 'text-action'; manage.textContent = 'Browse rooms →'; manage.addEventListener('click',fetchAndShowRooms); pinsHeader.appendChild(manage); content.appendChild(pinsHeader);
    const shadeGrid = document.createElement('div'); shadeGrid.className = 'shade-tile-grid';
    for (const shade of allShades.filter(item => appState.favorites.shadeIds.includes(item.id))) shadeGrid.appendChild(buildShadeTile(shade));
    if (!shadeGrid.children.length) { const note = document.createElement('p'); note.textContent = 'Use the star on a shade in Blinds to pin its controls here.'; shadeGrid.appendChild(note); }
    content.appendChild(shadeGrid);
    const roomsHeader = document.createElement('div'); roomsHeader.className = 'home-section-heading';
    const roomsTitle = document.createElement('h3'); roomsTitle.textContent = 'Your rooms'; roomsHeader.appendChild(roomsTitle);
    const browse = document.createElement('button'); browse.type = 'button'; browse.className = 'text-action'; browse.textContent = 'All rooms →'; browse.addEventListener('click',fetchAndShowRooms); roomsHeader.appendChild(browse);content.appendChild(roomsHeader);
    const roomGrid = document.createElement('div'); roomGrid.className = 'home-room-grid';
    for (const room of sortRoomsForDisplay(allRooms)) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'home-room-card';
        button.style.setProperty('--room-accent', colors[room.color] || 'var(--accent)');
        button.appendChild(createRoomTypeIconElement(room.ptName));
        const name = document.createElement('strong'); name.textContent = room.ptName; button.appendChild(name);
        const count = document.createElement('span'); const shades = allShades.filter(shade => shade.roomId === room.id);
        count.textContent = `${shades.length} ${shades.length === 1 ? 'shade' : 'shades'}`; button.appendChild(count);
        button.addEventListener('click', () => navigateToRoomShades(room)); roomGrid.appendChild(button);
    }
    content.appendChild(roomGrid);
    for (const shade of allShades) updateShadeBatteryRowInDom(shade.id);
    updateSceneButtons(); updateCommandAvailability(); updateHomeSummary(); updateNavigation();
}
async function bootstrap() {
    api.onState(applyState); api.onNotice(showSceneRunToast);
    api.onNavigation(action => {
        if (action === 'settings' && !uiOverlays.settingsIsOpen()) document.getElementById('settingsButton').click();
        else if (action?.roomIndex != null && !document.querySelector('dialog[open]')) openRoomByGridIndex(action.roomIndex);
    });
    document.getElementById('btn-home').addEventListener('click', showHome);
    document.getElementById('exitDemoButton').addEventListener('click', () => api.demo(false).catch(error => showSceneRunToast(error.message)));
    document.addEventListener('click', event => {
        const link = event.target.closest('a[href]');
        if (link) { event.preventDefault(); showSceneRunToast('Open gateway tools from Settings.'); }
    });
    await loadPrefs(); applyState(await api.getState());
}
// Modals contain keyboard focus and make the app behind them noninteractive.
const basePushModal = pushModalScrollLock, basePopModal = popModalScrollLock;
pushModalScrollLock = () => { basePushModal(); for (const el of document.querySelectorAll('#content,.bottom-nav,.top-buttons,.command-search,#connectionHealthBar,#demoModeBar')) el.inert = true; };
popModalScrollLock = () => { basePopModal(); if (!modalScrollLock.depth) for (const el of document.querySelectorAll('[inert]')) el.inert = false; };
document.addEventListener('keydown', event => {
    if (event.key !== 'Tab' || document.querySelector('dialog[open]')) return;
    const modal = uiOverlays.settingsIsOpen() ? document.getElementById('settingsOverlay') : uiOverlays.infoIsOpen() ? document.getElementById('infoHelpOverlay') : null;
    if (!modal) return;
    const items = [...modal.querySelectorAll('button,input,select,summary,a[href]')].filter(el => !el.disabled && el.checkVisibility()
        && (!el.closest('details:not([open])') || el.tagName === 'SUMMARY'));
    if (!items.length) return;
    if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1).focus(); }
    else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0].focus(); }
});
