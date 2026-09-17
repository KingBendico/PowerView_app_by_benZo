const api = window.powerView;

let allShades = [];
let allScenes = [];
let allRooms = [];
let colors = [];
let host = '';

const HUB_SNAPSHOT_STORAGE_KEY = 'powerview-hub-snapshot-v1';
/** Last gateway IPv4 from a processed `config` event (`null` until first IP). */
let lastAppliedHubIp = null;

function gatewayIpv4FromHost() {
    if (!host || host === 'http://') {
        return '';
    }
    return host.startsWith('http://') ? host.slice('http://'.length) : host.replace(/^https:\/\//i, '');
}

function readHubSnapshot() {
    try {
        const raw = localStorage.getItem(HUB_SNAPSHOT_STORAGE_KEY);
        if (!raw) {
            return null;
        }
        const o = JSON.parse(raw);
        if (!o || typeof o.ip !== 'string' || o.ip.length === 0) {
            return null;
        }
        return o;
    } catch {
        return null;
    }
}

/** If we have a saved room list for this gateway, paint immediately (network still refreshes). */
function tryRestoreCachedHubSnapshot(ipPlain) {
    const snap = readHubSnapshot();
    if (!snap || snap.ip !== ipPlain || !Array.isArray(snap.rooms) || snap.rooms.length === 0) {
        return false;
    }
    allRooms = snap.rooms;
    if (Array.isArray(snap.colors) && snap.colors.length > 0) {
        colors = snap.colors;
    }
    return true;
}

function persistHubSnapshot() {
    const ipKey = gatewayIpv4FromHost();
    if (!ipKey) {
        return;
    }
    const prev = readHubSnapshot();
    let roomsOut = allRooms;
    if (!Array.isArray(roomsOut) || roomsOut.length === 0) {
        if (prev && prev.ip === ipKey && Array.isArray(prev.rooms) && prev.rooms.length > 0) {
            roomsOut = prev.rooms;
        } else {
            return;
        }
    }
    let colorsOut = colors;
    if (!Array.isArray(colorsOut) || colorsOut.length === 0) {
        if (prev && prev.ip === ipKey && Array.isArray(prev.colors) && prev.colors.length > 0) {
            colorsOut = prev.colors;
        } else {
            colorsOut = [];
        }
    }
    try {
        localStorage.setItem(
            HUB_SNAPSHOT_STORAGE_KEY,
            JSON.stringify({
                ip: ipKey,
                rooms: roomsOut,
                colors: colorsOut,
                at: Date.now(),
            })
        );
    } catch {
        /* ignore quota / private mode */
    }
}

let liveEventSource = null;
const liveShadeTileRefs = new Map();
/** Room id currently shown in `displayShadesInRoom` (for refresh after bulk commands). */
let displayedRoomId = null;

/**
 * Each `fetchAndDisplayShadesInRoom` bumps this; responses only apply when their
 * generation still matches, so rapid Ctrl+1…9 room switches cannot reorder async completions.
 */
let shadesListFetchGeneration = 0;

/** Per-shade flags from SSE (and merged from REST when primary is null). */
const shadeTelemetryById = new Map();

let lastShadesFetchOkAt = 0;
/** idle | connecting | open | reconnecting | closed */
let sseConnectionState = 'idle';

let connectionHealthIntervalId = null;

let prefs = { favoriteScenes: [], recentScenes: [], recentRooms: [], theme: 'light' };
let currentMainView = 'home';

let contentResizeObserver = null;

/** Reserved for future window/content sizing; layout uses document scroll. */
function scheduleMainWindowToContent() {}

function ensureContentResizeObserver() {
    if (contentResizeObserver) {
        return;
    }
    const el = document.getElementById('content');
    if (!el) {
        return;
    }
    contentResizeObserver = new ResizeObserver(() => {
        scheduleMainWindowToContent();
    });
    contentResizeObserver.observe(el);
}

function effectiveThemeIsDark() {
    return prefs.theme === 'dark' || (prefs.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
}

function applyThemeToDocument() {
    document.documentElement.setAttribute('data-theme', effectiveThemeIsDark() ? 'dark' : 'light');
    try {
        localStorage.setItem('powerview-theme', effectiveThemeIsDark() ? 'dark' : 'light');
    } catch (e) {
        /* ignore */
    }
}

function updateThemeButton() {
    const btn = document.getElementById('themeButton');
    if (!btn) {
        return;
    }
    const icon = btn.querySelector('i');
    const dark = effectiveThemeIsDark();
    if (dark) {
        icon.className = 'fas fa-moon';
        btn.title = 'Dark mode — switch to light';
        btn.setAttribute('aria-label', 'Dark mode. Click for light mode.');
    } else {
        icon.className = 'fas fa-sun';
        btn.title = 'Light mode — switch to dark';
        btn.setAttribute('aria-label', 'Light mode. Click for dark mode.');
    }
}

function cycleTheme() {
    prefs.theme = effectiveThemeIsDark() ? 'light' : 'dark';
    applyThemeToDocument();
    updateThemeButton();
    persistPrefs();
    scheduleMainWindowToContent();
}

async function loadPrefs() {
    prefs = { ...prefs, ...await api.getPrefs() };
    applyThemeToDocument(); updateThemeButton();
}

function persistPrefs() {
    return api.setPrefs(prefs).catch(error => showSceneRunToast(error.message));
}

function setHubStatus(ok, message) {
    const el = document.getElementById('app-status-banner');
    if (!el) {
        return;
    }
    document.body.classList.toggle('has-status-banner', !ok);
    if (ok) {
        el.classList.add('hidden');
        el.textContent = '';
        scheduleMainWindowToContent();
        return;
    }
    el.classList.remove('hidden');
    el.textContent = message || 'Cannot reach gateway.';
    scheduleMainWindowToContent();
}

function isFavoriteSceneId(id) {
    return prefs.favoriteScenes.some((f) => f.id === id);
}

function toggleFavoriteScene(scene) {
    const id = scene.id;
    const idx = prefs.favoriteScenes.findIndex((f) => f.id === id);
    if (idx >= 0) {
        prefs.favoriteScenes.splice(idx, 1);
    } else {
        prefs.favoriteScenes.push({ id: scene.id, name: scene.ptName });
    }
    persistPrefs();
}

function recordRecentScene(scene) {
    const entry = { id: scene.id, name: scene.ptName, at: Date.now() };
    prefs.recentScenes = [entry, ...prefs.recentScenes.filter((r) => r.id !== scene.id)].slice(0, 8);
    persistPrefs();
}

function recordRecentRoom(room) {
    const entry = { id: room.id, name: room.ptName, at: Date.now() };
    prefs.recentRooms = [entry, ...prefs.recentRooms.filter((r) => r.id !== room.id)].slice(0, 8);
    persistPrefs();
}

let initialShellRevealDone = false;

function finalizeInitialShellReveal() {
    if (initialShellRevealDone) {
        return;
    }
    initialShellRevealDone = true;
    document.body.classList.remove('app-initial-load');
    const el = document.getElementById('content');
    if (!el) {
        return;
    }
    el.removeAttribute('aria-busy');
    el.removeAttribute('aria-label');
    el.classList.add('content-boot-reveal');
    void el.offsetWidth;
}

function openBlindsViewAfterLoad() {
    currentMainView = 'rooms';
    showRooms(allRooms);
    requestAnimationFrame(() => {
        ensureContentResizeObserver();
        scheduleMainWindowToContent();
        finalizeInitialShellReveal();
    });
}

/** Escape handling: settings above info (higher z-index). Assigned by overlay setup. */
const uiOverlays = {
    settingsIsOpen() {
        return false;
    },
    settingsClose() {},
    infoIsOpen() {
        return false;
    },
    infoClose() {},
};

const modalScrollLock = { depth: 0, prevOverflow: '' };

function pushModalScrollLock() {
    if (modalScrollLock.depth === 0) {
        modalScrollLock.prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
    }
    modalScrollLock.depth += 1;
}

function popModalScrollLock() {
    modalScrollLock.depth = Math.max(0, modalScrollLock.depth - 1);
    if (modalScrollLock.depth === 0) {
        document.body.style.overflow = modalScrollLock.prevOverflow;
    }
}

(function setupInfoHelpOverlay() {
    const overlay = document.getElementById('infoHelpOverlay');
    const backdrop = document.getElementById('infoHelpBackdrop');
    const closeBtn = document.getElementById('infoHelpCloseBtn');
    const infoBtn = document.getElementById('infoButton');
    if (!overlay || !backdrop || !closeBtn || !infoBtn) {
        return;
    }

    function isOpen() {
        return !overlay.classList.contains('hidden');
    }

    function openInfoHelp() {
        overlay.classList.remove('hidden');
        overlay.setAttribute('aria-hidden', 'false');
        infoBtn.setAttribute('aria-expanded', 'true');
        pushModalScrollLock();
        closeBtn.focus();
    }

    function closeInfoHelp() {
        overlay.classList.add('hidden');
        overlay.setAttribute('aria-hidden', 'true');
        infoBtn.setAttribute('aria-expanded', 'false');
        popModalScrollLock();
        infoBtn.focus();
    }

    uiOverlays.infoIsOpen = isOpen;
    uiOverlays.infoClose = closeInfoHelp;

    infoBtn.addEventListener('click', () => {
        if (isOpen()) {
            closeInfoHelp();
        } else {
            openInfoHelp();
        }
    });

    closeBtn.addEventListener('click', closeInfoHelp);
    backdrop.addEventListener('click', closeInfoHelp);
})();



function fetchColors(callback) {
    return refreshData().then(() => { if (callback) callback(); });
}

function touchShadesFetchOk() {
    lastShadesFetchOkAt = Date.now();
    renderConnectionHealthBar();
}

function mergeShadeListTelemetryFromRest() {
    allShades.forEach((s) => {
        const t = shadeTelemetryById.get(s.id) || { offline: false, batteryLow: false };
        let offline = !!t.offline;
        let batteryLow = !!t.batteryLow;
        if (s.positions && s.positions.primary === null) {
            offline = true;
        } else if (s.positions && typeof s.positions.primary === 'number') {
            offline = false;
        }
        if (!offline && !batteryLow) {
            shadeTelemetryById.delete(s.id);
        } else {
            shadeTelemetryById.set(s.id, { offline, batteryLow });
        }
    });
}

/** 0–100 when the hub exposes a level; otherwise `null` (field names vary by firmware). */
function shadeBatteryPercentFromShade(shade) {
    if (!shade || typeof shade !== 'object') {
        return null;
    }
    const bp = shade.batteryPercent;
    if (typeof bp === 'number' && Number.isFinite(bp) && bp >= 0 && bp <= 100) {
        return Math.round(bp);
    }
    const bl = shade.batteryLevel;
    if (typeof bl === 'number' && Number.isFinite(bl) && bl >= 0 && bl <= 100) {
        return Math.round(bl);
    }
    const bs = shade.batteryStrength;
    if (typeof bs === 'number' && Number.isFinite(bs)) {
        if (bs >= 0 && bs <= 100) {
            return Math.round(bs);
        }
        if (bs > 100 && bs <= 255) {
            return Math.min(100, Math.round((bs / 255) * 100));
        }
    }
    return null;
}

function batteryIconClassForPercent(pct) {
    if (pct <= 12) {
        return 'fas fa-battery-empty';
    }
    if (pct <= 37) {
        return 'fas fa-battery-quarter';
    }
    if (pct <= 62) {
        return 'fas fa-battery-half';
    }
    if (pct <= 87) {
        return 'fas fa-battery-three-quarters';
    }
    return 'fas fa-battery-full';
}

function updateShadeBatteryRowInDom(shadeId) {
    const row = document.getElementById(`shade-battery-row-${shadeId}`);
    if (!row) {
        return;
    }
    const shade = allShades.find((s) => s.id === shadeId);
    const pct = shade ? shadeBatteryPercentFromShade(shade) : null;
    const t = shadeTelemetryById.get(Number(shadeId)) || { batteryLow: false };
    row.classList.toggle('shade-tile-battery-row--low', pct == null && !!t.batteryLow);
    if (pct != null) {
        row.innerHTML = `<i class="${batteryIconClassForPercent(
            pct
        )} shade-tile-battery-icon" aria-hidden="true"></i><span>Battery ${pct}%</span>`;
        row.setAttribute('aria-label', `Battery about ${pct} percent`);
    } else if (t.batteryLow) {
        row.innerHTML =
            '<i class="fas fa-battery-quarter shade-tile-battery-icon" aria-hidden="true"></i><span>Battery low</span>';
        row.setAttribute('aria-label', 'Battery low');
    } else {
        row.innerHTML = '<span>Battery —</span>';
        row.setAttribute('aria-label', 'Battery level not reported by gateway');
    }
}

function formatRelativeTime(ts) {
    if (!ts) {
        return 'never';
    }
    const sec = Math.floor((Date.now() - ts) / 1000);
    if (sec < 8) {
        return 'just now';
    }
    if (sec < 60) {
        return `${sec}s ago`;
    }
    const m = Math.floor(sec / 60);
    if (m < 60) {
        return `${m}m ago`;
    }
    const h = Math.floor(m / 60);
    return `${h}h ago`;
}

function setConnectionHealthBarVisible(show) {
    const bar = document.getElementById('connectionHealthBar');
    if (!bar) {
        return;
    }
    bar.classList.toggle('hidden', !show);
    document.body.classList.toggle('has-connection-health', !!show);
}

function renderConnectionHealthBar() {
    const state = appState?.connection;
    const label = state?.status === 'demo' ? 'Demo home' : state?.status === 'offline' ? 'Gateway: offline' : state?.status === 'connecting' ? 'Gateway: connecting…' : state?.status === 'unconfigured' ? 'Gateway: not connected' : sseConnectionState === 'open' ? 'Live: connected' : 'Live: reconnecting';
    document.getElementById('connectionHealthSse').textContent = label;
    document.getElementById('connectionHealthShades').textContent = `Shades: ${formatRelativeTime(lastShadesFetchOkAt)}`;
}



function fillShadeBadgesElement(el, shadeId) {
    if (!el) {
        return;
    }
    el.innerHTML = '';
    const t = shadeTelemetryById.get(Number(shadeId)) || { offline: false, batteryLow: false };
    const shade = allShades.find((s) => s.id === shadeId);
    let offline = t.offline;
    if (shade && !shade.available) {
        offline = true;
    }
    const batteryLow = t.batteryLow;
    if (!offline && !batteryLow) {
        el.classList.remove('has-badge');
        return;
    }
    el.classList.add('has-badge');
    if (offline) {
        const sp = document.createElement('span');
        sp.className = 'shade-badge shade-badge--offline';
        sp.title = 'Shade reported offline';
        sp.setAttribute('aria-label', 'Offline');
        sp.innerHTML = '<i class="fas fa-wifi-slash" aria-hidden="true"></i>';
        el.appendChild(sp);
    }
    if (batteryLow) {
        const sp = document.createElement('span');
        sp.className = 'shade-badge shade-badge--battery';
        sp.title = 'Low battery reported by hub';
        sp.setAttribute('aria-label', 'Low battery');
        sp.innerHTML = '<i class="fas fa-battery-quarter" aria-hidden="true"></i>';
        el.appendChild(sp);
    }
}

function updateShadeBadgeInDomIfAny(shadeId) {
    const el = document.getElementById(`shade-badges-${shadeId}`);
    if (!el) {
        return;
    }
    fillShadeBadgesElement(el, shadeId);
    updateShadeBatteryRowInDom(shadeId);
}

function refreshAllHubDataNow() { return refreshData(); }

function navigateToRoomShades(room) {
    if (!room) {
        return;
    }
    recordRecentRoom(room);
    if (allShades.length > 0) {
        displayShadesInRoom(room.id);
    }
    fetchAndDisplayShadesInRoom(room.id);
}

function fetchAllShades(callback) {
    return refreshData().then(() => { if (callback) callback(); });
}















function nudgeShadePrimaryGatewayDelta(shadeId, deltaGateway, statusEl, onDone) {
    const shade = allShades.find((s) => s.id === shadeId);
    if (!shade || !shade.positions) {
        if (onDone) {
            onDone(false);
        }
        return;
    }
    const cur = Number(shade.positions.primary);
    const base = Number.isFinite(cur) ? cur : 0;
    const delta = shade.controls.kind === 'top-down' ? -deltaGateway : deltaGateway;
    const next = Math.max(0, Math.min(1, base + delta));
    const pVis = shade.controls.kind === 'top-down' ? Math.round(next * 100) : gatewayPositionToVisualPercent(next);
    const secVis = gatewayPositionToVisualPercentSecondary(shade.positions.secondary);
    if (statusEl) {
        statusEl.textContent = 'Sending…';
        statusEl.className = 'shade-command-status is-pending';
    }
    updateShadePosition(shadeId, pVis, secVis, (ok, message) => {
        if (statusEl) {
            statusEl.textContent = ok ? 'Command accepted' : message || 'Failed';
            statusEl.className = ok ? 'shade-command-status is-ok' : 'shade-command-status is-error';
            setTimeout(() => {
                statusEl.textContent = '';
                statusEl.className = 'shade-command-status';
            }, 2200);
        }
        if (onDone) {
            onDone(ok);
        }
    });
}

function moveShadeToGatewayPrimary(shadeId, gatewayPrimary, statusEl, onDone) {
    const shade = allShades.find((s) => s.id === shadeId);
    if (!shade || !shade.positions) {
        if (onDone) {
            onDone(false);
        }
        return;
    }
    const pVis = gatewayPositionToVisualPercent(gatewayPrimary);
    const secVis = gatewayPositionToVisualPercentSecondary(shade.positions.secondary);
    if (statusEl) {
        statusEl.textContent = 'Sending…';
        statusEl.className = 'shade-command-status is-pending';
    }
    updateShadePosition(shadeId, pVis, secVis, (ok, message) => {
        if (statusEl) {
            statusEl.textContent = ok ? 'Command accepted' : message || 'Failed';
            statusEl.className = ok ? 'shade-command-status is-ok' : 'shade-command-status is-error';
            setTimeout(() => {
                statusEl.textContent = '';
                statusEl.className = 'shade-command-status';
            }, 2200);
        }
        if (onDone) {
            onDone(ok);
        }
    });
}

function putShadeMotionJog(shadeId, statusEl) {
    return runShadeAction(shadeId, 'jog', statusEl);
}

function createBulkShadeToolbar(ids, scopeDescription) {
    if (!ids.length) return null;
    const wrap = document.createElement('div'); wrap.className = 'shade-bulk-toolbar';
    const roomId = currentMainView === 'room-shades' ? displayedRoomId : null;
    for (const [action, label, icon] of [['open','Open all','arrow-up'], ['close','Close all','arrow-down'], ['stop','Stop all','stop']]) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'btn-bulk-shade';
        button.innerHTML = `<i class="fas fa-${icon}" aria-hidden="true"></i> ${label}`;
        button.setAttribute('aria-label', `${label}. ${scopeDescription}. ${ids.length} shades.`);
        button.dataset.gatewayCommand = action;
        button.addEventListener('click', async () => {
            if (action !== 'stop' && !confirm(`${label} — ${scopeDescription}? ${ids.length} shades may move.`)) return;
            button.disabled = true;
            try {
                const results = await api.roomAction({ roomId, action });
                const failed = results.filter(result => !result.ok);
                const message = `${results.length - failed.length} of ${results.length} commands accepted.`;
                showSceneRunToast(message);
                const status = document.getElementById('group-command-result');
                if (status) status.textContent = failed.length ? `${message} ${failed.map(item => `${item.name}: ${item.error}`).join(' ')}` : message;
            } catch (error) { showSceneRunToast(error.message); }
            finally { button.disabled = !isConnected(); }
        });
        wrap.appendChild(button);
    }
    const result = document.createElement('div'); result.id = 'group-command-result'; result.className = 'group-command-result';
    result.setAttribute('role','status'); wrap.appendChild(result); return wrap;
}

function createShadeFineControlRow(shade, statusEl) {
    const row = document.createElement('div');
    row.className = 'shade-tile-fine-row';
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', `${shade.ptName}, quick shade actions`);

    const name = shade.ptName;
    const statusId = statusEl && statusEl.id ? statusEl.id : '';

    const jogBtn = document.createElement('button');
    jogBtn.type = 'button';
    jogBtn.className = 'btn-fine-shade';
    jogBtn.title = 'Gateway jog command';
    jogBtn.textContent = 'Jog';
    jogBtn.setAttribute('aria-label', `${name}, jog once (gateway motion command)`);
    if (statusId) {
        jogBtn.setAttribute('aria-describedby', statusId);
    }
    jogBtn.addEventListener('click', () => putShadeMotionJog(shade.id, statusEl));

    const minusBtn = document.createElement('button');
    minusBtn.type = 'button';
    minusBtn.className = 'btn-fine-shade';
    minusBtn.title = 'Decrease percent closed';
    minusBtn.textContent = '−';
    minusBtn.setAttribute('aria-label', `${name}, decrease percent closed`);
    if (statusId) {
        minusBtn.setAttribute('aria-describedby', statusId);
    }
    minusBtn.addEventListener('click', () => nudgeShadePrimaryGatewayDelta(shade.id, 0.08, statusEl));

    const plusBtn = document.createElement('button');
    plusBtn.type = 'button';
    plusBtn.className = 'btn-fine-shade';
    plusBtn.title = 'Increase percent closed';
    plusBtn.textContent = '+';
    plusBtn.setAttribute('aria-label', `${name}, increase percent closed`);
    if (statusId) {
        plusBtn.setAttribute('aria-describedby', statusId);
    }
    plusBtn.addEventListener('click', () => nudgeShadePrimaryGatewayDelta(shade.id, -0.08, statusEl));

    const presets = [
        { label: '25%', gw: 0.75 },
        { label: '50%', gw: 0.5 },
        { label: '75%', gw: 0.25 },
    ];
    const presetWrap = document.createElement('div');
    presetWrap.className = 'shade-tile-preset-chips';
    presetWrap.setAttribute('role', 'group');
    presetWrap.setAttribute('aria-label', `${name}, percent closed presets`);
    presets.forEach(({ label, gw }) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn-fine-shade btn-fine-shade--chip';
        b.textContent = label;
        b.title = `Set ${label} closed`;
        b.setAttribute(
            'aria-label',
            `${name}, set ${label} closed`
        );
        if (statusId) {
            b.setAttribute('aria-describedby', statusId);
        }
        b.addEventListener('click', () => moveShadeToGatewayPrimary(shade.id, gw, statusEl));
        presetWrap.appendChild(b);
    });

    row.appendChild(jogBtn);
    row.appendChild(minusBtn);
    row.appendChild(plusBtn);
    row.appendChild(presetWrap);
    return row;
}

function fetchAllScenes(callback) {
    return refreshData().then(() => { if (callback) callback(); });
}

function fetchAllRooms(callback) {
    return refreshData().then(() => { if (callback) callback(); });
}

document.getElementById('btn-blinds').addEventListener('click', fetchAndShowRooms);
document.getElementById('btn-scenes').addEventListener('click', fetchAndShowScenes);

function fetchAndShowRooms() {
    currentMainView = 'rooms'; showRooms(allRooms); updateNavigation();
    void refreshData();
}

/**
 * Index 0 = first room in the Blinds grid (same order as sort / tiles).
 * Ctrl+1…9 are handled in the main process and invoke `window.__powerviewOpenRoomByIndex` (see main.js).
 */
function roomsForKeyboardShortcuts() {
    return sortRoomsForDisplay(allRooms);
}

function openRoomByGridIndex(idx) {
    const n = Number(idx);
    if (!Number.isFinite(n) || n < 0 || n > 8) {
        return;
    }
    if (uiOverlays.settingsIsOpen() || uiOverlays.infoIsOpen()) return;
    const el = document.activeElement;
    if (
        el &&
        (el.tagName === 'INPUT' ||
            el.tagName === 'TEXTAREA' ||
            el.tagName === 'SELECT' ||
            el.isContentEditable)
    ) {
        return;
    }
    const ordered = roomsForKeyboardShortcuts();
    if (!ordered || ordered.length <= n) {
        return;
    }
    const room = ordered[n];
    navigateToRoomShades(room);
}

window.__powerviewOpenRoomByIndex = openRoomByGridIndex;

function sortRoomsForDisplay(rooms) {
    const mode = prefs.roomSort || 'default';
    const copy = [...rooms];
    if (mode === 'az') {
        copy.sort((a, b) => String(a.ptName).localeCompare(String(b.ptName), undefined, { sensitivity: 'base' }));
        return copy;
    }
    if (mode === 'recent') {
        const seen = new Set();
        const ordered = [];
        (prefs.recentRooms || []).forEach((r) => {
            const room = copy.find((x) => x.id === r.id);
            if (room && !seen.has(room.id)) {
                ordered.push(room);
                seen.add(room.id);
            }
        });
        copy.sort((a, b) => String(a.ptName).localeCompare(String(b.ptName), undefined, { sensitivity: 'base' }));
        copy.forEach((r) => {
            if (!seen.has(r.id)) {
                ordered.push(r);
            }
        });
        return ordered;
    }
    return copy;
}

function normalizeRoomNameForIcon(roomName) {
    return String(roomName || '')
        .normalize('NFKD')
        .replace(/\p{M}/gu, '')
        .toLowerCase();
}

/*
 * FA Free has no refrigerator. Outline + solid handles to match Font Awesome solid weight (~2px at 1em).
 */
const KITCHEN_ROOM_REFRIGERATOR_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512" class="room-icon-refrigerator-svg" aria-hidden="true" focusable="false" fill="none">' +
    '<rect x="72" y="48" width="304" height="416" rx="28" ry="28" stroke="currentColor" stroke-width="36" stroke-linejoin="round"/>' +
    '<line x1="108" y1="232" x2="340" y2="232" stroke="currentColor" stroke-width="32" stroke-linecap="round"/>' +
    '<rect x="292" y="112" width="32" height="64" rx="8" fill="currentColor"/>' +
    '<rect x="292" y="288" width="32" height="88" rx="8" fill="currentColor"/>' +
    '</svg>';

function iconClassForRoomName(roomName) {
    const n = normalizeRoomNameForIcon(roomName);
    if (/(office|study|desk|work)/.test(n)) return 'fas fa-desktop';
    if (/(bed|bedroom|guest)/.test(n)) return 'fas fa-bed';
    if (/(stair|hall|entry|foyer|entrance|corridor)/.test(n)) return 'fas fa-stairs';
    if (/(living|family|lounge|tv|den)/.test(n)) return 'fas fa-couch';
    if (/(dining|eat|breakfast)/.test(n)) return 'fas fa-utensils';
    if (/(bath|toilet|wash|powder)/.test(n)) return 'fas fa-bath';
    if (/(garage|car)/.test(n)) return 'fas fa-warehouse';
    if (/(laundry|utility)/.test(n)) return 'fas fa-soap';
    if (/(patio|terrace|balcony|garden|yard|outdoor)/.test(n)) return 'fas fa-tree';
    return 'fas fa-door-open';
}

function createRoomTypeIconElement(roomName) {
    const n = normalizeRoomNameForIcon(roomName);
    if (/(kitchen|pantry|cook|chef)/.test(n)) {
        const wrap = document.createElement('span');
        wrap.className = 'room-icon-refrigerator';
        wrap.setAttribute('aria-hidden', 'true');
        wrap.innerHTML = KITCHEN_ROOM_REFRIGERATOR_SVG;
        return wrap;
    }
    const icon = document.createElement('i');
    icon.className = iconClassForRoomName(roomName);
    icon.setAttribute('aria-hidden', 'true');
    return icon;
}

function showRooms(rooms) {
    const content = document.getElementById('content');
    content.classList.remove('content-home', 'content-boot-loading');
    content.classList.remove('content-room-shades');
    content.classList.remove('content-home', 'content-boot-loading');
    content.classList.remove('content-scenes-view');
    content.classList.remove('content-boot-loading');
    content.innerHTML = '';

    const firstTitle = document.createElement('h2');
    const iconBlinds = document.createElement('i');
    iconBlinds.className = 'fas fa-window-maximize';
    firstTitle.appendChild(iconBlinds);
    firstTitle.appendChild(document.createTextNode(' Blinds'));
    content.appendChild(firstTitle);

    const sortRow = document.createElement('div');
    sortRow.className = 'room-sort-row';
    const sortModes = [
        { id: 'default', label: 'Gateway order' },
        { id: 'az', label: 'A–Z' },
        { id: 'recent', label: 'Recent first' },
    ];
    sortModes.forEach(({ id, label }) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'room-sort-btn';
        if ((prefs.roomSort || 'default') === id) {
            b.classList.add('is-active');
        }
        b.textContent = label;
        b.addEventListener('click', () => {
            prefs.roomSort = id;
            persistPrefs();
            showRooms(allRooms);
        });
        sortRow.appendChild(b);
    });
    content.appendChild(sortRow);

    liveShadeTileRefs.clear();
    displayedRoomId = null;
    const wholeHomeIds = allShades.map((s) => s.id);
    const homeBulk = createBulkShadeToolbar(wholeHomeIds, 'Whole home');
    if (homeBulk) {
        content.appendChild(homeBulk);
    }

    if (prefs.recentRooms && prefs.recentRooms.length > 0) {
        const label = document.createElement('div');
        label.className = 'section-label';
        label.textContent = 'Recent rooms';
        content.appendChild(label);
        const row = document.createElement('div');
        row.className = 'chip-row';
        prefs.recentRooms.forEach((r) => {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'chip';
            chip.textContent = r.name;
            chip.addEventListener('click', () => {
                const room = allRooms.find((x) => x.id === r.id);
                if (room) {
                    navigateToRoomShades(room);
                }
            });
            row.appendChild(chip);
        });
        content.appendChild(row);
    }

    const grid = document.createElement('div');
    grid.className = 'room-grid';

    const sortedRooms = sortRoomsForDisplay(rooms);
    sortedRooms.forEach((room, gridIndex) => {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'card room-tile';
        card.style.setProperty('--room-accent', colors[parseInt(room.color)] || '#8da6ab');
        card.dataset.roomId = room.id;

        if (gridIndex < 9) {
            const k = gridIndex + 1;
            const hint = document.createElement('span');
            hint.className = 'room-tile-shortcut';
            hint.textContent = String(k);
            hint.title = `Open room: Ctrl+${k} (main keyboard or numpad)`;
            hint.setAttribute('aria-hidden', 'true');
            card.appendChild(hint);
        }

        const title = document.createElement('div');
        title.className = 'card-title';
        title.textContent = room.ptName;

        const iconWrap = document.createElement('div');
        iconWrap.className = 'room-tile-icon';
        iconWrap.appendChild(createRoomTypeIconElement(room.ptName));

        card.appendChild(iconWrap);
        card.appendChild(title);
        const subtitle = document.createElement('span'); subtitle.className = 'room-card-count';
        const count = allShades.filter(shade => shade.roomId === room.id).length; subtitle.textContent = `${count} ${count === 1 ? 'shade' : 'shades'}`; card.appendChild(subtitle);

        card.addEventListener('click', function () {
            navigateToRoomShades(room);
        });

        grid.appendChild(card);
    });
    content.appendChild(grid);
    scheduleMainWindowToContent();
}

function fetchAndDisplayShadesInRoom(roomId) {
    displayShadesInRoom(roomId); updateNavigation(); void refreshData();
}

function createShadeWindowControl(labelText, initialPercent, onUserCommit, layoutOpts) {
    const variant = layoutOpts && layoutOpts.variant === 'tile' ? 'tile' : 'stack';
    const hangFromTop = layoutOpts && layoutOpts.fabricModel === 'hangFromTop';
    const a11yName =
        (layoutOpts && layoutOpts.a11yName) || String(labelText || '').replace(':', '').trim() || 'Shade';
    const row = document.createElement('div');
    row.className =
        variant === 'tile'
            ? 'slider-container shade-single-stack shade-single-tile'
            : 'slider-container shade-single-stack';

    const topRow = document.createElement('div');
    topRow.className = 'shade-single-top-row';

    const label = document.createElement('label');
    label.className = 'shade-visual-label';
    label.textContent = labelText;

    const visualOuter = document.createElement('div');
    visualOuter.className = 'shade-window-visual';
    visualOuter.setAttribute('role', 'slider');
    visualOuter.setAttribute('aria-valuemin', '0');
    visualOuter.setAttribute('aria-valuemax', '100');
    visualOuter.setAttribute('aria-orientation', 'vertical');
    visualOuter.setAttribute(
        'aria-label',
        `${a11yName}, shade opening. 0 is fully open, 100 is fully closed. Use Up, Down, Home, and End keys when focused.`
    );
    visualOuter.tabIndex = 0;

    const inner = document.createElement('div');
    inner.className = 'shade-window-inner shade-window-inner--realistic';

    const glass = document.createElement('div');
    glass.className = 'shade-window-glass shade-window-glass--realistic';

    const decor = document.createElement('div');
    decor.className = 'shade-window-decor';
    decor.setAttribute('aria-hidden', 'true');

    const fabric = document.createElement('div');
    fabric.className = hangFromTop
        ? 'shade-fabric shade-fabric-single shade-fabric-single--from-top'
        : 'shade-fabric shade-fabric-single';
    const hem = document.createElement('div');
    hem.className = hangFromTop ? 'shade-hem shade-hem-fabric-bottom' : 'shade-hem shade-hem-primary-top';
    fabric.appendChild(hem);

    const grip = document.createElement('div');
    grip.className = 'shade-pull-grip';
    grip.setAttribute('aria-hidden', 'true');
    const g1 = document.createElement('span');
    g1.className = 'shade-pull-grip-ridge';
    const g2 = document.createElement('span');
    g2.className = 'shade-pull-grip-ridge';
    grip.appendChild(g1);
    grip.appendChild(g2);
    fabric.appendChild(grip);

    inner.appendChild(glass);
    inner.appendChild(decor);
    inner.appendChild(fabric);
    visualOuter.appendChild(inner);

    visualOuter.setAttribute(
        'title',
        'Drag vertically anywhere in the window to adjust the shade (or use arrow keys when focused).'
    );

    const numInput = document.createElement('input');
    numInput.type = 'number';
    numInput.min = '0';
    numInput.max = '100';
    numInput.step = '1';
    numInput.className = 'slider-input';
    if (layoutOpts && layoutOpts.a11yNumInputId) {
        numInput.id = layoutOpts.a11yNumInputId;
    } else {
        numInput.id = `shade-pct-${Math.random().toString(36).slice(2, 10)}`;
    }
    numInput.setAttribute(
        'aria-label',
        `${a11yName}, percent closed (0 open through 100 fully closed)`
    );
    if (variant !== 'tile') {
        label.setAttribute('for', numInput.id);
    }

    function setPercent(p) {
        const v = Math.max(0, Math.min(100, Math.round(Number(p) || 0)));
        /* v = % closed (0 open, 100 closed). Bottom stack: fabric from sill up. Top hang: fabric from header down. */
        fabric.style.height = `${v}%`;
        numInput.value = String(v);
        visualOuter.setAttribute('aria-valuenow', String(v));
        visualOuter.setAttribute('aria-valuetext', `${v} percent closed`);
    }

    function getPercent() {
        return Math.max(0, Math.min(100, parseInt(numInput.value, 10) || 0));
    }

    function percentFromClientY(clientY) {
        const rect = inner.getBoundingClientRect();
        if (rect.height <= 0) {
            return getPercent();
        }
        const y = Math.max(0, Math.min(rect.height, clientY - rect.top));
        return Math.round(Math.max(0, Math.min(100, (y / rect.height) * 100)));
    }

    setPercent(initialPercent);

    let singleDragActive = false;

    inner.addEventListener('pointerdown', (e) => {
        if (singleDragActive) {
            return;
        }
        if (e.pointerType !== 'touch' && e.button !== 0) {
            return;
        }
        e.preventDefault();
        singleDragActive = true;
        const pid = e.pointerId;
        inner.classList.add('shade-window-dragging');
        try {
            inner.setPointerCapture(pid);
        } catch (_) {
            /* ignore */
        }

        const onMove = (ev) => {
            if (ev.pointerId !== pid) {
                return;
            }
            setPercent(percentFromClientY(ev.clientY));
        };
        const onEnd = (ev) => {
            if (ev.pointerId !== pid) {
                return;
            }
            document.removeEventListener('pointermove', onMove, true);
            document.removeEventListener('pointerup', onEnd, true);
            document.removeEventListener('pointercancel', onEnd, true);
            try {
                inner.releasePointerCapture(pid);
            } catch (_) {
                /* ignore */
            }
            inner.classList.remove('shade-window-dragging');
            singleDragActive = false;
            if (ev.type !== 'pointercancel' && inner.isConnected) onUserCommit(getPercent(), true);
        };

        document.addEventListener('pointermove', onMove, true);
        document.addEventListener('pointerup', onEnd, true);
        document.addEventListener('pointercancel', onEnd, true);

        setPercent(percentFromClientY(e.clientY));
    });

    visualOuter.addEventListener('keydown', (e) => {
        let v = getPercent();
        /* ArrowUp / Home = more open (less %); ArrowDown / End = more closed. */
        if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
            v = Math.max(0, v - 1);
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
            v = Math.min(100, v + 1);
        } else if (e.key === 'Home') {
            v = 0;
        } else if (e.key === 'End') {
            v = 100;
        } else {
            return;
        }
        e.preventDefault();
        setPercent(v);
        onUserCommit(v, true);
    });

    numInput.addEventListener('input', function () {
        const v = Math.max(0, Math.min(100, parseInt(this.value, 10) || 0));
        setPercent(v);
    });

    numInput.addEventListener('change', function () {
        onUserCommit(getPercent(), true);
    });

    if (variant === 'tile') {
        row.appendChild(visualOuter);
        const pctRow = document.createElement('div');
        pctRow.className = 'shade-tile-pct-row';
        const pctLabel = document.createElement('label');
        pctLabel.className = 'shade-tile-pct-label';
        pctLabel.appendChild(numInput);
        const pctLbl = document.createElement('span');
        pctLbl.className = 'shade-tile-pct-suffix';
        pctLbl.textContent = '% closed';
        pctLabel.appendChild(pctLbl);
        pctRow.appendChild(pctLabel);
        row.appendChild(pctRow);
    } else {
        topRow.appendChild(label);
        topRow.appendChild(numInput);
        row.appendChild(topRow);
        row.appendChild(visualOuter);
    }

    return { row, getPercent, setPercent };
}

function clampDualVisuals(primaryV, secondaryV) {
    let p = Math.max(0, Math.min(100, Math.round(Number(primaryV) || 0)));
    let s = Math.max(0, Math.min(100, Math.round(Number(secondaryV) || 0)));
    if (p < s) {
        p = s;
    }
    return [p, s];
}

function createShadeUpdateDispatcher(shadeId, statusEl) {
    return (primary, secondary, isFinal) => {
        if (!isFinal) return;
        statusEl.textContent = 'Sending…';
        updateShadePosition(shadeId, primary, secondary, (ok, message) => {
            statusEl.textContent = ok ? 'Command accepted · waiting for position' : message || 'Command failed';
            statusEl.className = `shade-command-status ${ok ? 'is-ok' : 'is-error'}`;
        });
    };
}

/**
 * Dual shade (type 8): one fabric band between rail (top / secondary) and hem (bottom / primary).
 * Drag the top grip (middle rail) or bottom grip (shade). Sum of both % ≤ 100%.
 */
function createDualShadeWindowControl(initialPrimary, initialSecondary, onUserCommit, layoutOpts) {
    const tile = layoutOpts && layoutOpts.variant === 'tile';
    const a11yName = (layoutOpts && layoutOpts.a11yName) || 'Dual shade';
    let [primaryV, secondaryV] = clampDualVisuals(initialPrimary, initialSecondary);
    let activeDrag = null;
    let dualDocDragging = false;

    const root = document.createElement('div');
    root.className = tile ? 'shade-unified-dual shade-unified-dual--tile' : 'shade-unified-dual';
    root.setAttribute('role', 'group');
    root.setAttribute(
        'aria-label',
        `${a11yName}, dual shade. Drag the middle rail or shade grips, or use the number fields below.`
    );

    const hint = document.createElement('div');
    hint.className = tile ? 'shade-dual-hint shade-dual-hint--compact' : 'shade-dual-hint';
    hint.textContent = tile
        ? 'Top grip: rail · bottom grip: shade'
        : 'Drag top grip: middle rail · Drag bottom grip: shade';
    if (tile) {
        hint.setAttribute('aria-hidden', 'true');
    }

    const visualOuter = document.createElement('div');
    visualOuter.className = 'shade-window-visual shade-window-visual-dual';

    const inner = document.createElement('div');
    inner.className = 'shade-window-inner shade-window-inner-dual shade-window-inner--realistic';

    const glass = document.createElement('div');
    glass.className = 'shade-window-glass shade-window-glass--realistic';

    const decor = document.createElement('div');
    decor.className = 'shade-window-decor';
    decor.setAttribute('aria-hidden', 'true');

    const band = document.createElement('div');
    band.className = 'shade-fabric shade-fabric-unified-band';

    const handleRail = document.createElement('div');
    handleRail.className = 'shade-handle shade-handle-rail';
    handleRail.setAttribute(
        'aria-label',
        `${a11yName}, middle rail grip. Drag vertically to move the rail, or use the Rail number field.`
    );
    handleRail.tabIndex = 0;
    const railHandleLbl = document.createElement('span');
    railHandleLbl.className = 'shade-handle-label';
    railHandleLbl.textContent = 'Rail';
    railHandleLbl.setAttribute('aria-hidden', 'true');
    handleRail.appendChild(railHandleLbl);

    const handlePrimary = document.createElement('div');
    handlePrimary.className = 'shade-handle shade-handle-primary';
    handlePrimary.setAttribute(
        'aria-label',
        `${a11yName}, shade hem grip. Drag vertically to move the bottom hem, or use the Shade number field.`
    );
    handlePrimary.tabIndex = 0;
    const primaryHandleLbl = document.createElement('span');
    primaryHandleLbl.className = 'shade-handle-label';
    primaryHandleLbl.textContent = 'Shade';
    primaryHandleLbl.setAttribute('aria-hidden', 'true');
    handlePrimary.appendChild(primaryHandleLbl);

    inner.appendChild(glass);
    inner.appendChild(decor);
    inner.appendChild(band);
    inner.appendChild(handleRail);
    inner.appendChild(handlePrimary);
    visualOuter.appendChild(inner);

    visualOuter.setAttribute(
        'title',
        'Drag the rail or shade grip vertically, or use the number fields (dual shade).'
    );

    const inputsRow = document.createElement('div');
    inputsRow.className = 'shade-dual-inputs';

    const railLabel = document.createElement('label');
    railLabel.className = 'shade-dual-input-label';
    railLabel.appendChild(document.createTextNode('Rail '));
    const railInput = document.createElement('input');
    railInput.type = 'number';
    railInput.min = '0';
    railInput.max = '100';
    railInput.step = '1';
    railInput.className = 'slider-input shade-dual-num';
    railInput.id =
        (layoutOpts && layoutOpts.a11yRailInputId) || `shade-dual-rail-${Math.random().toString(36).slice(2, 10)}`;
    railInput.setAttribute(
        'aria-label',
        `${a11yName}, middle rail position, percent from top of window (0 through 100)`
    );
    railLabel.appendChild(railInput);

    const shadeLabel = document.createElement('label');
    shadeLabel.className = 'shade-dual-input-label';
    shadeLabel.appendChild(document.createTextNode('Shade '));
    const shadeInput = document.createElement('input');
    shadeInput.type = 'number';
    shadeInput.min = '0';
    shadeInput.max = '100';
    shadeInput.step = '1';
    shadeInput.className = 'slider-input shade-dual-num';
    shadeInput.id =
        (layoutOpts && layoutOpts.a11yShadeInputId) || `shade-dual-hem-${Math.random().toString(36).slice(2, 10)}`;
    shadeInput.setAttribute(
        'aria-label',
        `${a11yName}, shade hem position, percent from top of window (0 through 100)`
    );
    shadeLabel.appendChild(shadeInput);

    inputsRow.appendChild(railLabel);
    inputsRow.appendChild(shadeLabel);

    root.appendChild(hint);
    root.appendChild(visualOuter);
    root.appendChild(inputsRow);

    for (const [handle, which] of [[handleRail, 'rail'], [handlePrimary, 'primary']]) {
        handle.setAttribute('role', 'slider'); handle.setAttribute('aria-valuemin', '0'); handle.setAttribute('aria-valuemax', '100');
        handle.setAttribute('aria-orientation', 'vertical');
        handle.addEventListener('keydown', event => {
            if (!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
            event.preventDefault();
            const delta = ['ArrowUp','ArrowLeft'].includes(event.key) ? -1 : 1;
            let value = which === 'rail' ? secondaryV : primaryV;
            value = event.key === 'Home' ? 0 : event.key === 'End' ? 100 : value + delta;
            if (which === 'rail') secondaryV = Math.max(0, Math.min(primaryV, value));
            else primaryV = Math.min(100, Math.max(secondaryV, value));
            applyHeights(); onUserCommit(primaryV, secondaryV, true);
        });
    }
    function applyHeights() {
        [primaryV, secondaryV] = clampDualVisuals(primaryV, secondaryV);
        const mid = Math.max(0, primaryV - secondaryV);
        band.style.top = `${secondaryV}%`;
        band.style.height = `${mid}%`;
        band.style.bottom = 'auto';
        handleRail.style.top = `${secondaryV}%`;
        handlePrimary.style.top = `${primaryV}%`;
        handleRail.setAttribute('aria-valuenow', String(secondaryV));
        handlePrimary.setAttribute('aria-valuenow', String(primaryV));
        railInput.value = String(secondaryV);
        shadeInput.value = String(primaryV);
        inner.classList.toggle('shade-inner-tight-gap', mid <= 12);
    }

    applyHeights();

    function yFracToSecondary(yf) {
        return Math.round(Math.max(0, Math.min(100, yf * 100)));
    }

    function yFracToPrimary(yf) {
        return Math.round(Math.max(0, Math.min(100, yf * 100)));
    }

    function applyDrag(clientY) {
        const rect = inner.getBoundingClientRect();
        if (rect.height <= 0) {
            return;
        }
        const yClamped = Math.max(0, Math.min(rect.height, clientY - rect.top));
        const yf = yClamped / rect.height;
        if (activeDrag === 'rail') {
            secondaryV = yFracToSecondary(yf);
            secondaryV = Math.min(secondaryV, primaryV);
        } else if (activeDrag === 'primary') {
            primaryV = yFracToPrimary(yf);
            primaryV = Math.max(primaryV, secondaryV);
        }
        applyHeights();
    }

    function pickDragModeFromY(clientY) {
        const rect = inner.getBoundingClientRect();
        if (rect.height <= 0) {
            return 'primary';
        }
        const yClamped = Math.max(0, Math.min(rect.height, clientY - rect.top));
        const yf = yClamped / rect.height;
        const topEdge = secondaryV / 100;
        const botEdge = primaryV / 100;
        const topDist = Math.abs(yf - topEdge);
        const botDist = Math.abs(yf - botEdge);
        if (topDist < botDist) {
            return 'rail';
        }
        if (botDist < topDist) {
            return 'primary';
        }
        return yf < (topEdge + botEdge) / 2 ? 'rail' : 'primary';
    }

    function beginDrag(mode, e) {
        if (dualDocDragging) {
            return;
        }
        if (e.pointerType !== 'touch' && e.button !== 0) {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        dualDocDragging = true;
        activeDrag = mode;
        const pid = e.pointerId;
        inner.classList.add('shade-window-dragging');
        try {
            inner.setPointerCapture(pid);
        } catch (_) {
            /* ignore */
        }

        const onMove = (ev) => {
            if (ev.pointerId !== pid || !activeDrag) {
                return;
            }
            ev.preventDefault();
            applyDrag(ev.clientY);
        };
        const onEnd = (ev) => {
            if (ev.pointerId !== pid) {
                return;
            }
            document.removeEventListener('pointermove', onMove, true);
            document.removeEventListener('pointerup', onEnd, true);
            document.removeEventListener('pointercancel', onEnd, true);
            try {
                inner.releasePointerCapture(pid);
            } catch (_) {
                /* ignore */
            }
            inner.classList.remove('shade-window-dragging');
            activeDrag = null;
            dualDocDragging = false;
            if (ev.type !== 'pointercancel' && inner.isConnected) onUserCommit(primaryV, secondaryV, true);
        };

        document.addEventListener('pointermove', onMove, true);
        document.addEventListener('pointerup', onEnd, true);
        document.addEventListener('pointercancel', onEnd, true);

        applyDrag(e.clientY);
    }

    inner.addEventListener('pointerdown', (e) => {
        if (dualDocDragging) {
            return;
        }
        if (e.pointerType !== 'touch' && e.button !== 0) {
            return;
        }
        beginDrag(pickDragModeFromY(e.clientY), e);
    });

    railInput.addEventListener('input', function () {
        secondaryV = Math.max(0, Math.min(100, parseInt(this.value, 10) || 0));
        if (secondaryV > primaryV) {
            primaryV = secondaryV;
        }
        applyHeights();
    });

    railInput.addEventListener('change', function () {
        onUserCommit(primaryV, secondaryV, true);
    });

    shadeInput.addEventListener('input', function () {
        primaryV = Math.max(0, Math.min(100, parseInt(this.value, 10) || 0));
        if (primaryV < secondaryV) {
            secondaryV = primaryV;
        }
        applyHeights();
    });

    shadeInput.addEventListener('change', function () {
        onUserCommit(primaryV, secondaryV, true);
    });

    function setDualVisual(primaryVis, secondaryVis) {
        [primaryV, secondaryV] = clampDualVisuals(primaryVis, secondaryVis);
        applyHeights();
    }

    return { root, getPrimary: () => primaryV, getSecondary: () => secondaryV, setDualVisual };
}

/*
 * Type 8 (dual): `positions.primary` is the bottom hem — gateway 1 = open, 0 = closed.
 * UI v = fabric coverage from bottom (0 open, 100 closed).
 */
function gatewayPositionToVisualPercent(pos) {
    const p = Number(pos);
    const clamped = Math.max(0, Math.min(1, Number.isFinite(p) ? p : 0));
    return Math.round((1 - clamped) * 100);
}

function visualPercentToGatewayPosition(visual) {
    const v = Math.max(0, Math.min(100, Math.round(Number(visual) || 0)));
    return (100 - v) / 100;
}

/* Middle rail (secondary): gateway position scales with rail % from top (same sense as UI). */
function gatewayPositionToVisualPercentSecondary(pos) {
    const p = Number(pos);
    const clamped = Math.max(0, Math.min(1, Number.isFinite(p) ? p : 0));
    return Math.round(clamped * 100);
}

function visualPercentToGatewayPositionSecondary(visual) {
    const v = Math.max(0, Math.min(100, Math.round(Number(visual) || 0)));
    return v / 100;
}

function displayShadesInRoom(roomId) {
    currentMainView = 'room-shades';
    displayedRoomId = roomId;
    liveShadeTileRefs.clear();
    const filteredShades = allShades.filter((shade) => shade.roomId === roomId);
    const room = allRooms.find((r) => r.id === roomId);
    const content = document.getElementById('content');
    content.classList.remove('content-home', 'content-boot-loading');
    content.classList.remove('content-scenes-view');
    content.classList.add('content-room-shades');
    content.innerHTML = '';

    const toolbar = document.createElement('div');
    toolbar.className = 'toolbar-row';
    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'btn-back';
    backBtn.innerHTML = '<i class="fas fa-arrow-left"></i> All rooms';
    backBtn.addEventListener('click', () => fetchAndShowRooms());
    toolbar.appendChild(backBtn);
    content.appendChild(toolbar);

    const roomIds = filteredShades.map((s) => s.id);
    const bulkBar = createBulkShadeToolbar(roomIds, room ? `Room: ${room.ptName}` : 'This room');
    if (bulkBar) {
        content.appendChild(bulkBar);
    }

    const h2 = document.createElement('h2');
    h2.className = 'room-blinds-title';
    if (room) {
        h2.appendChild(createRoomTypeIconElement(room.ptName));
        h2.appendChild(document.createTextNode(` ${room.ptName} blinds`));
    } else {
        h2.textContent = 'Shades in room';
    }
    content.appendChild(h2);

    const section = document.createElement('section');
    section.className = 'room-shades-section';
    const secLabel = document.createElement('div');
    secLabel.className = 'shade-section-label';
    secLabel.textContent = 'Shades';
    const grid = document.createElement('div');
    grid.className = 'shade-tile-grid';
    section.appendChild(secLabel);
    section.appendChild(grid);
    content.appendChild(section);

    filteredShades.forEach(shade => grid.appendChild(buildShadeTile(shade)));
    filteredShades.forEach(shade => updateShadeBatteryRowInDom(shade.id));
    updateNavigation(); updateCommandAvailability();
    ensureContentResizeObserver();
    scheduleMainWindowToContent();
}

function updateShadePosition(shadeId, primaryValue, secondaryValue, onDone) {
    const shade = allShades.find(item => item.id === shadeId);
    if (!shade) { onDone?.(false, 'Shade unavailable.'); return; }
    const primary = shade.controls.kind === 'top-down' ? primaryValue : 100 - primaryValue;
    const positions = { primary };
    if (shade.controls.kind === 'dual-rail') {
        positions.secondary = secondaryValue;
        for (const axis of ['primary', 'secondary']) {
            if (Math.abs(positions[axis] - (shade.positions[axis] * 100)) < 0.01) delete positions[axis];
        }
    }
    if (!Object.keys(positions).length) { onDone?.(true); return; }
    api.moveShade({ id: shadeId, positions }).then(() => onDone?.(true))
        .catch(error => { onDone?.(false, error.message); liveShadeTileRefs.get(shadeId)?.(); });
}

/** Normalized string ids — gateway /active and /scenes sometimes disagree on number vs string. */
let activeSceneIdSet = new Set();

/** Scenes the user just triggered; cleared when activate XHR ends or SSE reports scene-activated. */
let sceneRunPendingIds = new Set();

function normalizeSceneId(id) {
    if (id == null) {
        return '';
    }
    return String(id);
}

function parseActiveScenesPayload(raw) {
    if (raw == null || typeof raw !== 'object') {
        return [];
    }
    if (Array.isArray(raw)) {
        return raw;
    }
    if (Array.isArray(raw.scenes)) {
        return raw.scenes;
    }
    if (Array.isArray(raw.sceneIds)) {
        return raw.sceneIds;
    }
    if (Array.isArray(raw.activeScenes)) {
        return raw.activeScenes;
    }
    return [];
}

function extractActiveSceneId(entry) {
    if (entry == null) {
        return '';
    }
    if (typeof entry === 'number' || typeof entry === 'string') {
        return normalizeSceneId(entry);
    }
    return normalizeSceneId(entry.id ?? entry.sceneId ?? entry.scene?.id ?? entry.sceneID);
}

function fetchActiveScenes(callback) {
    return refreshData().then(() => { if (callback) callback(); });
}

function fetchAndShowScenes() {
    currentMainView = 'scenes'; liveShadeTileRefs.clear(); displayedRoomId = null;
    displayScenesByRoom(); updateNavigation(); void refreshData();
}

function showSceneRunToast(message) {
    let el = document.getElementById('sceneRunToast');
    if (!el) {
        el = document.createElement('div');
        el.id = 'sceneRunToast';
        el.className = 'scene-run-toast';
        el.setAttribute('role', 'status');
        el.setAttribute('aria-live', 'polite');
        document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.add('is-visible');
    clearTimeout(showSceneRunToast._hideTimer);
    showSceneRunToast._hideTimer = setTimeout(() => {
        el.classList.remove('is-visible');
        el.textContent = '';
    }, 2600);
}

function refreshScenesViewIfShowing() {
    if (currentMainView === 'scenes') {
        displayScenesByRoom();
    }
}

function buildSceneTile(scene) {
    const sidNorm = normalizeSceneId(scene.id);
    const isPending = sceneRunPendingIds.has(sidNorm);

    const tile = document.createElement('article');
    tile.className = 'scene-tile';
    tile.dataset.sceneId = sidNorm;
    if (activeSceneIdSet.has(sidNorm)) {
        tile.classList.add('is-active-scene');
    }
    if (isPending) {
        tile.classList.add('is-scene-running');
    }

    const top = document.createElement('div');
    top.className = 'scene-tile-top';

    const sceneTitle = document.createElement('div');
    sceneTitle.className = 'scene-tile-name';
    sceneTitle.textContent = scene.ptName;

    const starBtn = document.createElement('button');
    starBtn.type = 'button';
    starBtn.className = 'scene-star' + (isFavoriteSceneId(scene.id) ? ' is-favorite' : '');
    starBtn.title = isFavoriteSceneId(scene.id) ? 'Remove from favorites' : 'Add to favorites';
    starBtn.setAttribute('aria-label', `${starBtn.title}: ${scene.ptName}`);
    starBtn.setAttribute('aria-pressed', String(isFavoriteSceneId(scene.id)));
    starBtn.innerHTML = '<i class="fas fa-star" aria-hidden="true"></i>';
    starBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFavoriteScene(scene);
        starBtn.classList.toggle('is-favorite', isFavoriteSceneId(scene.id));
        starBtn.setAttribute('aria-pressed', String(isFavoriteSceneId(scene.id)));
    });

    top.appendChild(sceneTitle);
    top.appendChild(starBtn);
    tile.appendChild(top);

    const runBtn = document.createElement('button');
    runBtn.type = 'button';
    runBtn.className = 'scene-tile-run';
    if (isPending) {
        runBtn.disabled = true;
        runBtn.setAttribute('aria-busy', 'true');
        runBtn.setAttribute('aria-label', `Running ${scene.ptName}…`);
        runBtn.innerHTML =
            '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i><span> Running…</span>';
    } else {
        runBtn.setAttribute('aria-label', `Run scene ${scene.ptName}`);
        runBtn.innerHTML = '<i class="fas fa-play" aria-hidden="true"></i><span> Run</span>';
    }
    runBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        activateScene(scene.id);
    });
    tile.appendChild(runBtn);

    if (isPending) {
        const statusNote = document.createElement('div');
        statusNote.className = 'scene-tile-running-note';
        statusNote.setAttribute('aria-live', 'polite');
        statusNote.textContent = 'Sending to gateway…';
        tile.appendChild(statusNote);
    }

    tile.addEventListener('click', (e) => {
        if (e.target.closest('button')) {
            return;
        }
        if (sceneRunPendingIds.has(sidNorm)) {
            return;
        }
        activateScene(scene.id);
    });

    return tile;
}

function displayScenesByRoom() {
    const content = document.getElementById('content');
    content.classList.remove('content-home', 'content-boot-loading');
    content.classList.remove('content-room-shades');
    content.classList.add('content-scenes-view');
    content.innerHTML = '';

    const h2 = document.createElement('h2');
    h2.className = 'scenes-page-title';
    const icon = document.createElement('i');
    icon.className = 'fas fa-play';
    icon.setAttribute('aria-hidden', 'true');
    h2.appendChild(icon);
    h2.appendChild(document.createTextNode(' Scenes'));
    content.appendChild(h2);

    if (prefs.favoriteScenes.length > 0) {
        const favLabel = document.createElement('div');
        favLabel.className = 'shade-section-label scenes-page-section';
        favLabel.textContent = 'Starred';
        content.appendChild(favLabel);
        const favGrid = document.createElement('div');
        favGrid.className = 'scene-tile-grid';
        prefs.favoriteScenes.forEach((fav) => {
            const scene = allScenes.find((s) => s.id === fav.id);
            if (scene) {
                favGrid.appendChild(buildSceneTile(scene));
            }
        });
        content.appendChild(favGrid);
    }

    if (prefs.recentScenes.length > 0) {
        const recLabel = document.createElement('div');
        recLabel.className = 'shade-section-label scenes-page-section';
        recLabel.textContent = 'Recent';
        content.appendChild(recLabel);
        const row = document.createElement('div');
        row.className = 'scene-chip-row';
        prefs.recentScenes.forEach((r) => {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'scene-chip';
            const rid = normalizeSceneId(r.id);
            chip.dataset.sceneId = rid;
            const chipPending = sceneRunPendingIds.has(rid);
            if (chipPending) {
                chip.classList.add('is-scene-running');
                chip.disabled = true;
                chip.setAttribute('aria-busy', 'true');
                chip.setAttribute('aria-label', `Running ${r.name}…`);
                chip.innerHTML = '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i> ';
                chip.appendChild(document.createTextNode(`${r.name} — running…`));
            } else {
                chip.setAttribute('aria-label', `Run scene ${r.name}`);
                chip.innerHTML = '<i class="fas fa-play" aria-hidden="true"></i> ';
                chip.appendChild(document.createTextNode(r.name));
            }
            chip.addEventListener('click', () => activateScene(r.id));
            row.appendChild(chip);
        });
        content.appendChild(row);
    }

    const scenesByRoom = {};
    allRooms.forEach((room) => {
        scenesByRoom[room.id] = {
            name: room.ptName,
            color: colors[parseInt(room.color)] || '#FFFFFF',
            scenes: [],
        };
    });

    allScenes.forEach((scene) => {
        (scene.roomIds || []).forEach((roomId) => {
            if (scenesByRoom[roomId]) {
                scenesByRoom[roomId].scenes.push(scene);
            }
        });
    });

    const roomLabel = document.createElement('div');
    roomLabel.className = 'shade-section-label scenes-page-section';
    roomLabel.textContent = 'By room';
    content.appendChild(roomLabel);

    const roomStack = document.createElement('div');
    roomStack.className = 'scene-rooms-stack';

    allRooms.forEach((room) => {
        const roomInfo = scenesByRoom[room.id];
        if (!roomInfo || roomInfo.scenes.length === 0) {
            return;
        }

        const details = document.createElement('details');
        details.className = 'scene-room-details';

        const summary = document.createElement('summary');
        summary.className = 'scene-room-summary';
        summary.style.setProperty('--scene-room-accent', roomInfo.color);

        const sumMain = document.createElement('div');
        sumMain.className = 'scene-room-summary-main';
        const sumTitle = document.createElement('span');
        sumTitle.className = 'scene-room-summary-name';
        sumTitle.textContent = roomInfo.name;
        const sumCount = document.createElement('span');
        sumCount.className = 'scene-room-summary-count';
        sumCount.textContent = String(roomInfo.scenes.length);
        sumMain.appendChild(sumTitle);
        sumMain.appendChild(sumCount);

        const chev = document.createElement('span');
        chev.className = 'scene-room-chevron';
        chev.setAttribute('aria-hidden', 'true');
        chev.innerHTML = '<i class="fas fa-chevron-down"></i>';

        summary.appendChild(sumMain);
        summary.appendChild(chev);
        details.appendChild(summary);

        const grid = document.createElement('div');
        grid.className = 'scene-tile-grid scene-tile-grid--in-room';
        roomInfo.scenes.forEach((scene) => {
            grid.appendChild(buildSceneTile(scene));
        });
        details.appendChild(grid);

        roomStack.appendChild(details);
    });

    content.appendChild(roomStack);
    scheduleMainWindowToContent();
}

async function activateScene(sceneId) {
    const id = String(sceneId);
    if (sceneRunPendingIds.has(id)) return;
    const scene = allScenes.find(item => item.id === id);
    sceneRunPendingIds.add(id); updateSceneButtons();
    try {
        await api.activateScene(id);
        if (scene) recordRecentScene(scene);
        showSceneRunToast(`Command accepted: ${scene?.ptName || 'Scene'}`);
    } catch (error) { showSceneRunToast(error.message); }
    finally { sceneRunPendingIds.delete(id); updateSceneButtons(); }
}

document.addEventListener('DOMContentLoaded', function () {
    bootstrap().catch(error => setHubStatus(false, error.message));
    requestAnimationFrame(() => {
        ensureContentResizeObserver();
        scheduleMainWindowToContent();
    });

    const healthRefresh = document.getElementById('connectionHealthRefreshBtn');
    if (healthRefresh) {
        healthRefresh.addEventListener('click', () => refreshAllHubDataNow());
        healthRefresh.setAttribute(
            'aria-label',
            'Refresh shades, scenes, and rooms from the gateway without leaving this view'
        );
    }
    if (connectionHealthIntervalId) {
        clearInterval(connectionHealthIntervalId);
    }
    connectionHealthIntervalId = setInterval(() => renderConnectionHealthBar(), 20000);

    const themeButton = document.getElementById('themeButton');
    if (themeButton) {
        themeButton.addEventListener('click', cycleTheme);
    }

    document.addEventListener(
        'keydown',
        function (event) {
            if (event.key === 'Escape') {
                if (uiOverlays.settingsIsOpen()) {
                    event.preventDefault();
                    event.stopImmediatePropagation();
                    uiOverlays.settingsClose();
                    return;
                }
                if (uiOverlays.infoIsOpen()) {
                    event.preventDefault();
                    event.stopImmediatePropagation();
                    uiOverlays.infoClose();
                    return;
                }
                if (event.target.closest?.('.command-search')) return;
                if (currentMainView === 'room-shades') {
                    event.preventDefault();
                    fetchAndShowRooms();
                    return;
                }
            }
            if (uiOverlays.settingsIsOpen() || uiOverlays.infoIsOpen()) return;
            if (event.ctrlKey && (event.key === 'b' || event.key === 'B')) {
                event.preventDefault();
                document.getElementById('btn-blinds').click();
            } else if (event.ctrlKey && (event.key === 's' || event.key === 'S')) {
                event.preventDefault();
                document.getElementById('btn-scenes').click();
            }
        },
        true
    );
});

function buildShadeTile(shade) {
        const tile = document.createElement('article');
        tile.className =
            shade.controls?.kind === 'dual-rail' ? 'shade-tile shade-tile--dual' : 'shade-tile';
        tile.style.cursor = 'default';
        tile.dataset.shadeId = shade.id;

        const statusEl = document.createElement('div');
        statusEl.className = 'shade-tile-status shade-command-status';
        statusEl.setAttribute('aria-live', 'polite');
        statusEl.id = `shade-status-${shade.id}`;

        const header = document.createElement('div');
        header.className = 'shade-tile-header';
        const nameHeading = document.createElement('h3');
        nameHeading.className = 'shade-tile-name';
        nameHeading.id = `shade-name-${shade.id}`;
        nameHeading.textContent = shade.ptName;
        const badges = document.createElement('div');
        badges.className = 'shade-tile-badges';
        badges.id = `shade-badges-${shade.id}`;
        header.appendChild(nameHeading);
        const star = document.createElement('button'); star.type = 'button'; star.className = 'scene-star';
        star.classList.toggle('is-favorite', appState?.favorites.shadeIds.includes(shade.id));
        star.innerHTML = '<i class="fas fa-star" aria-hidden="true"></i>';
        star.setAttribute('aria-label', `Pin ${shade.ptName} to Home`);
        star.setAttribute('aria-pressed', String(appState?.favorites.shadeIds.includes(shade.id) || false));
        star.addEventListener('click', () => api.favorite({ kind: 'shade', id: shade.id }).catch(error => showSceneRunToast(error.message)));
        header.appendChild(star);
        header.appendChild(badges);
        fillShadeBadgesElement(badges, shade.id);
        const batRow = document.createElement('div');
        batRow.className = 'shade-tile-battery-row';
        batRow.id = `shade-battery-row-${shade.id}`;
        batRow.setAttribute('role', 'status');
        header.appendChild(batRow);
        updateShadeBatteryRowInDom(shade.id);
        tile.appendChild(header);
        tile.setAttribute('aria-labelledby', nameHeading.id);

        const body = document.createElement('div');
        body.className = 'shade-tile-body';

        const dispatchShadeUpdate = createShadeUpdateDispatcher(shade.id, statusEl);

        if (shade.controls?.kind === 'dual-rail') {
            const primaryPct = gatewayPositionToVisualPercent(shade.positions.primary);
            const secondaryPct = gatewayPositionToVisualPercentSecondary(shade.positions.secondary);
            const dual = createDualShadeWindowControl(
                primaryPct,
                secondaryPct,
                (p, s, isFinal) => {
                    dispatchShadeUpdate(p, s, !!isFinal);
                },
                {
                    variant: 'tile',
                    a11yName: shade.ptName,
                    a11yRailInputId: `shade-${shade.id}-dual-rail`,
                    a11yShadeInputId: `shade-${shade.id}-dual-hem`,
                }
            );
            body.appendChild(dual.root);
            liveShadeTileRefs.set(shade.id, () => {
                const s = allShades.find((x) => x.id === shade.id);
                if (!s || !s.positions) {
                    return;
                }
                dual.setDualVisual(
                    gatewayPositionToVisualPercent(s.positions.primary),
                    gatewayPositionToVisualPercentSecondary(s.positions.secondary)
                );
                updateShadeBatteryRowInDom(shade.id);
            });
        } else if (['standard', 'top-down', 'vertical'].includes(shade.controls?.kind) && shade.controls.known) {
            const primaryPct = closedPercent(shade);
            const primaryCtrl = createShadeWindowControl(
                'Shade',
                primaryPct,
                (p, isFinal) => {
                    const cur = allShades.find((s) => s.id === shade.id);
                    const secRaw =
                        cur && cur.positions
                            ? cur.positions.secondary
                            : shade.positions.secondary;
                    const secVis = gatewayPositionToVisualPercentSecondary(secRaw);
                    dispatchShadeUpdate(p, secVis, !!isFinal);
                },
                {
                    variant: 'tile',
                    fabricModel: 'hangFromTop',
                    a11yName: shade.ptName,
                    a11yNumInputId: `shade-${shade.id}-pct-closed`,
                }
            );
            body.appendChild(primaryCtrl.row);
            liveShadeTileRefs.set(shade.id, () => {
                const s = allShades.find((x) => x.id === shade.id);
                if (!s || !s.positions) {
                    return;
                }
                primaryCtrl.setPercent(closedPercent(s));
                updateShadeBatteryRowInDom(shade.id);
            });
        }

        if (shade.controls.known && !['overlapped', 'tilt'].includes(shade.controls.kind)) body.appendChild(createShadeFineControlRow(shade, statusEl));
        if (!shade.controls.known) {
            const note = document.createElement('p'); note.textContent = 'This shade type is not supported yet.'; body.appendChild(note);
        } else {
            const axes = shade.controls.axes.filter(axis => axis.key === 'tilt' || shade.controls.kind === 'overlapped');
            for (const axis of axes) body.appendChild(createAxisControl(shade, axis, statusEl));
        }
        body.appendChild(createIndividualActions(shade, statusEl));
        const reported = document.createElement('div'); reported.className = 'shade-reported'; reported.id = `shade-reported-${shade.id}`;
        reported.textContent = reportedText(shade); body.appendChild(reported);

        const footer = document.createElement('div');
        footer.className = 'shade-tile-footer';
        footer.appendChild(statusEl);

        tile.appendChild(body);
        tile.appendChild(footer);
        return tile;
}
