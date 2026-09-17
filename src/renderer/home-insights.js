(() => {
    const format = window.homeInsightsFormat;
    let data = null, day = -1, scheduleFilter = 'enabled', healthTab = 'devices', healthFilter = 'all', activityFilter = 'all';
    let scheduleSignature = '', healthSignature = '', activitySignature = '';
    const element = (tag, className, text) => {
        const el = document.createElement(tag); if (className) el.className = className;
        if (text != null) el.textContent = text; return el;
    };
    const button = (label, action, className = 'insight-button') => {
        const el = element('button', className, label); el.type = 'button'; el.addEventListener('click', action); return el;
    };
    const time = value => value ? new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : 'Not yet refreshed';
    const current = () => data?.address === appState?.connection.address ? data : null;
    function choice(label, id, values, selected, onChange) {
        const wrap = element('label', 'insight-select-label', label), select = element('select', 'insight-select'); select.id = id;
        for (const [value, name] of values) { const option = element('option', '', name); option.value = value; select.appendChild(option); }
        select.value = selected; select.addEventListener('change', () => onChange(select.value)); wrap.appendChild(select); return wrap;
    }
    function shell(view, title, description) {
        currentMainView = view; displayedRoomId = null; liveShadeTileRefs.clear();
        const content = document.getElementById('content'); content.className = 'content-insights'; content.replaceChildren();
        const header = element('header', 'insight-header'), copy = element('div');
        copy.append(element('div', 'page-eyebrow', view === 'schedules' ? 'YOUR ROUTINES' : 'YOUR HOME'), element('h2', '', title), element('p', 'insight-intro', description));
        const refresh = button('Refresh', async () => {
            refresh.disabled = true;
            await Promise.allSettled([api.refreshInsights(), api.refresh()]);
            update();
        });
        refresh.id = 'insightsRefresh'; header.append(copy, refresh); content.appendChild(header);
        const notice = element('p', 'insight-notice'); notice.id = 'insightsNotice'; notice.setAttribute('role', 'status'); content.appendChild(notice);
        updateNavigation(); window.scrollTo(0, 0); return content;
    }
    function showSchedules() {
        scheduleSignature = '';
        const content = shell('schedules', 'Schedule timeline', 'See the routines saved in your PowerView home.');
        const stats = element('div', 'insight-stats'); stats.id = 'scheduleStats'; content.appendChild(stats);
        const controls = element('div', 'insight-controls');
        const weekdays = element('div', 'schedule-days'); weekdays.setAttribute('role', 'group'); weekdays.setAttribute('aria-label', 'Filter schedules by weekday');
        for (let index = -1; index < 7; index++) {
            const selectDay = button(index === -1 ? 'All week' : format.days[index].slice(0, 3), () => { day = index; updateSchedules(); }, 'insight-chip');
            selectDay.dataset.day = String(index); selectDay.setAttribute('aria-label', index === -1 ? 'All week' : format.days[index]); weekdays.appendChild(selectDay);
        }
        controls.append(weekdays, choice('Show', 'scheduleFilter', [['enabled', 'Enabled schedules'], ['all', 'All schedules'], ['paused', 'Paused schedules']], scheduleFilter, value => { scheduleFilter = value; updateSchedules(); }));
        content.append(controls, element('p', 'insight-footnote', 'Clock times follow your PowerView home. Daylight routines use sunrise/sunset offsets.'));
        const list = element('div', 'schedule-timeline'); list.id = 'scheduleTimeline'; content.appendChild(list);
        content.appendChild(element('p', 'insight-footnote', 'Manage these schedules in the PowerView mobile app. This view updates automatically while connected.'));
        updateSchedules();
    }
    function stats(container, values) {
        container.replaceChildren();
        for (const [value, label] of values) { const card = element('div', 'insight-stat'); card.append(element('strong', '', value), element('span', '', label)); container.appendChild(card); }
    }
    function notice(resource) {
        const banner = document.getElementById('insightsNotice'), refresh = document.getElementById('insightsRefresh');
        if (!banner) return;
        refresh.disabled = !isConnected() || resource?.status === 'loading' || !!appState?.refreshing;
        refresh.textContent = resource?.status === 'loading' || appState?.refreshing ? 'Refreshing…' : 'Refresh';
        banner.classList.toggle('is-warning', !isConnected() || resource?.status === 'error');
        banner.textContent = !appState?.snapshot ? 'Connect a gateway or explore the demo to see your home.'
            : !isConnected() ? 'Gateway offline · showing the last available information.'
            : resource?.status === 'error' ? `${resource.error} ${resource.data ? `Showing information refreshed at ${time(resource.updatedAt)}.` : 'Use Refresh to try again.'}`
            : resource?.status === 'loading' ? 'Refreshing from your gateway…'
            : resource?.updatedAt ? `Updated at ${time(resource.updatedAt)}` : 'Waiting for gateway information…';
    }
    function updateSchedules() {
        if (currentMainView !== 'schedules') return;
        const resource = current()?.schedules; notice(resource);
        for (const el of document.querySelectorAll('.schedule-days button')) el.setAttribute('aria-pressed', String(Number(el.dataset.day) === day));
        const items = resource?.data || [], snapshot = appState?.snapshot;
        const signature = JSON.stringify([items, resource?.status, day, scheduleFilter, snapshot?.scenes, snapshot?.rooms, snapshot?.shades.map(shade => [shade.id, shade.name])]);
        if (signature === scheduleSignature) return; scheduleSignature = signature;
        stats(document.getElementById('scheduleStats'), [[items.filter(item => item.enabled === true).length, 'Enabled'],
            [items.filter(item => item.enabled === false).length, 'Paused'],
            [items.filter(item => item.errorShadeIds.length || !item.timingKnown || item.days === null || item.days === 0 || item.enabled === null || !snapshot?.scenes.some(scene => scene.id === item.sceneId)).length, 'Need attention']]);
        const timeline = document.getElementById('scheduleTimeline'); timeline.replaceChildren();
        if (!resource?.data) {
            timeline.appendChild(element('p', 'insight-empty', resource?.status === 'error' ? 'Schedules are unavailable. Your shade controls are still available in Blinds.' : 'Your saved schedules will appear here.')); return;
        }
        const filtered = items.filter(item => (day === -1 || item.days === null || item.days === 0 || item.days & (1 << day))
            && (scheduleFilter === 'all' || (scheduleFilter === 'paused' ? item.enabled === false : item.enabled !== false)));
        if (!filtered.length) { timeline.appendChild(element('p', 'insight-empty', items.length ? `No ${scheduleFilter === 'all' ? '' : scheduleFilter + ' '}schedules ${day === -1 ? 'in this view' : 'for ' + format.days[day]}. Try another filter.` : 'No schedules saved in this home. Add a routine in the PowerView mobile app and refresh.')); return; }
        for (const group of ['Clock times', 'Around sunrise', 'Around sunset', 'Other schedules']) {
            const rows = filtered.filter(item => format.scheduleTime(item).group === group).sort((a, b) => format.scheduleTime(a).order - format.scheduleTime(b).order || a.id.localeCompare(b.id));
            if (!rows.length) continue;
            const section = element('section', 'schedule-group'); section.appendChild(element('h3', '', group));
            const list = element('ol', 'schedule-list');
            for (const item of rows) {
                const scene = snapshot?.scenes.find(value => value.id === item.sceneId);
                const row = element('li', 'schedule-row'); row.dataset.scheduleId = item.id;
                if (item.enabled === false) row.classList.add('is-paused');
                const when = element('div', 'schedule-when', format.scheduleTime(item).text), details = element('div', 'schedule-details');
                const heading = element('div', 'schedule-row-heading');
                heading.append(element('strong', '', scene?.name || 'Scene unavailable'), element('span', `insight-badge ${item.enabled === false ? 'is-muted' : item.enabled === null ? 'is-warning' : ''}`, item.enabled === false ? 'Paused' : item.enabled === null ? 'Status unknown' : 'Enabled'));
                details.append(heading, element('p', 'schedule-repeats', format.scheduleDays(item.days)));
                const rooms = snapshot?.rooms.filter(room => scene?.roomIds.includes(room.id)).map(room => room.name).join(' · ');
                if (rooms) details.appendChild(element('p', 'insight-muted', rooms));
                const problems = [];
                if (item.errorShadeIds.length) problems.push(`Not saved to: ${item.errorShadeIds.map(id => snapshot?.shades.find(shade => shade.id === id)?.name || 'a missing shade').join(', ')}.`);
                if (!scene) problems.push('The associated scene is no longer in the gateway list.');
                if (!item.timingKnown || item.days === null || item.days === 0 || item.enabled === null) problems.push('Check this routine’s timing and enabled status in PowerView.');
                if (problems.length) details.appendChild(element('p', 'insight-problem', problems.join(' ')));
                row.append(when, details); list.appendChild(row);
            }
            section.appendChild(list); timeline.appendChild(section);
        }
    }
    function showHealth() {
        healthSignature = ''; activitySignature = '';
        const content = shell('health', 'Health & activity', 'Device reports and recent activity, all in one place.');
        const switcher = element('div', 'insight-segments'); switcher.setAttribute('role', 'group'); switcher.setAttribute('aria-label', 'Health view');
        for (const [key, label] of [['devices', 'Device health'], ['activity', 'Activity']]) {
            const tab = button(label, () => { healthTab = key; updateHealth(); }, 'insight-chip'); tab.dataset.healthTab = key; switcher.appendChild(tab);
        }
        content.appendChild(switcher);
        const devices = element('section'); devices.id = 'healthDevices';
        const gateway = element('div', 'gateway-health'); gateway.id = 'gatewayHealth';
        const counts = element('div', 'insight-stats'); counts.id = 'healthStats';
        const controls = element('div', 'insight-controls'); controls.appendChild(choice('Devices', 'healthFilter', [['all', 'All devices'], ['attention', 'Needs attention']], healthFilter, value => { healthFilter = value; updateHealth(); }));
        const grid = element('div', 'health-grid'); grid.id = 'healthGrid';
        devices.append(gateway, counts, controls, grid, element('p', 'insight-footnote', 'Battery ranges are approximate gateway reports. Signal is the reported RSSI in dBm. Missing values stay marked “Not reported”.'));
        const activity = element('section'); activity.id = 'healthActivity';
        activity.append(choice('Events', 'activityFilter', [['all', 'All activity'], ['issues', 'Needs attention'], ['commands', 'App commands'], ['reports', 'Gateway reports']], activityFilter, value => { activityFilter = value; updateActivity(); }));
        const list = element('ol', 'activity-list'); list.id = 'activityList'; activity.appendChild(list);
        activity.appendChild(element('p', 'insight-footnote', 'Latest 200 entries for this home during this app session. History clears when PowerView quits. Gateway reports can include movement from other controls; the initiating person or app is not supplied.'));
        content.append(devices, activity); updateHealth();
    }
    function updateHealth() {
        if (currentMainView !== 'health') return;
        const state = current(); notice(state?.gateway);
        for (const tab of document.querySelectorAll('[data-health-tab]')) tab.setAttribute('aria-pressed', String(tab.dataset.healthTab === healthTab));
        document.getElementById('healthDevices').hidden = healthTab !== 'devices'; document.getElementById('healthActivity').hidden = healthTab !== 'activity';
        if (healthTab === 'activity') { updateActivity(); return; }
        const snapshot = appState?.snapshot, shades = snapshot?.shades || [];
        const gateway = document.getElementById('gatewayHealth'); gateway.replaceChildren();
        const copy = element('div'); copy.append(element('strong', '', appState?.connection.name || 'PowerView gateway'),
            element('p', 'insight-muted', `Firmware ${state?.gateway.data?.firmware || 'not reported'} · Shade data refreshed ${time(snapshot?.lastUpdated)}`));
        gateway.append(copy, element('span', `insight-badge ${isConnected() && appState.connection.live === 'open' ? '' : 'is-warning'}`,
            !isConnected() ? 'Offline' : appState.connection.live === 'open' ? 'Live updates connected' : 'Live updates reconnecting'));
        const attention = shades.filter(shade => format.healthSummary(shade).issues.length);
        stats(document.getElementById('healthStats'), [[shades.length, 'Devices'], [attention.length, 'Need attention'], [shades.filter(shade => !shade.available).length, 'Offline']]);
        const signature = JSON.stringify([healthFilter, snapshot?.rooms, shades.map(shade => [shade.id, shade.name, shade.roomId, shade.powerType, shade.batteryPercent, shade.batteryStatus, shade.batteryLow, shade.signalStrength, shade.firmware, format.healthSummary(shade)])]);
        if (signature === healthSignature) return; healthSignature = signature;
        const grid = document.getElementById('healthGrid'); grid.replaceChildren();
        const filtered = [...(healthFilter === 'attention' ? attention : shades)].sort((a, b) => format.healthSummary(a).priority - format.healthSummary(b).priority || a.name.localeCompare(b.name));
        if (!filtered.length) { grid.appendChild(element('p', 'insight-empty', shades.length ? 'No devices need attention in the latest reports.' : 'Device health will appear after connecting to a home.')); return; }
        for (const shade of filtered) {
            const health = format.healthSummary(shade), room = snapshot.rooms.find(item => item.id === shade.roomId);
            const card = element('article', `health-card${health.issues.length ? ' needs-attention' : ''}`); card.dataset.healthShade = shade.id;
            const header = element('div', 'health-card-heading'), name = element('div'); name.append(element('h3', '', shade.name), element('p', 'insight-muted', room?.name || 'No room assigned'));
            header.append(name, element('span', `insight-badge ${health.issues.length ? 'is-warning' : ''}`, health.issues[0] || 'Available')); card.appendChild(header);
            if (health.issues.length > 1) card.appendChild(element('p', 'insight-problem', health.issues.slice(1).join(' · ')));
            const facts = element('dl', 'health-facts');
            for (const [label, value] of [['Battery', health.battery], ['Power', health.power], ['Signal', shade.signalStrength == null ? 'Not reported' : `${shade.signalStrength} dBm`], ['Firmware', shade.firmware || 'Not reported']]) {
                const fact = element('div'); fact.append(element('dt', '', label), element('dd', '', value)); facts.appendChild(fact);
            }
            card.appendChild(facts);
            if (room) card.appendChild(button('Open room →', () => { const currentRoom = allRooms.find(item => item.id === room.id); if (currentRoom) navigateToRoomShades(currentRoom); }, 'text-action'));
            grid.appendChild(card);
        }
    }
    function updateActivity() {
        const list = document.getElementById('activityList'); if (!list) return;
        const entries = current()?.activity || [];
        const signature = JSON.stringify([entries, activityFilter]); if (signature === activitySignature) return; activitySignature = signature;
        const filtered = entries.filter(entry => activityFilter === 'all' || activityFilter === 'issues' && ['error', 'warning'].includes(entry.status)
            || activityFilter === 'commands' && entry.kind === 'command' || activityFilter === 'reports' && entry.kind === 'report');
        list.replaceChildren();
        if (!filtered.length) { list.appendChild(element('li', 'insight-empty', entries.length ? 'No activity matches this filter.' : 'New commands and gateway reports will appear here while PowerView is running.')); return; }
        for (const entry of filtered) {
            const row = element('li', `activity-entry is-${entry.status}`); row.dataset.activityId = entry.id;
            const dot = element('span', 'activity-dot'); dot.setAttribute('aria-hidden', 'true');
            const copy = element('div', 'activity-copy');
            copy.appendChild(element('strong', '', [entry.targetName, entry.title].filter(Boolean).join(' · ')));
            if (entry.detail) copy.appendChild(element('p', '', entry.detail));
            const status = { pending: 'Sending', accepted: 'Accepted', error: 'Failed', warning: 'Needs attention', reported: 'Reported' }[entry.status] || 'Recorded';
            copy.appendChild(element('span', 'insight-muted', `${entry.source === 'gateway' ? 'Gateway report' : 'This app'} · ${status}`));
            const stamp = element('time', '', time(entry.at)); stamp.dateTime = new Date(entry.at).toISOString(); stamp.title = new Date(entry.at).toLocaleString();
            row.append(dot, copy, stamp); list.appendChild(row);
        }
    }
    function update() { if (currentMainView === 'schedules') updateSchedules(); else if (currentMainView === 'health') updateHealth(); }
    window.homeInsights = { showSchedules, showHealth, update };
    document.getElementById('btn-schedules').addEventListener('click', showSchedules);
    document.getElementById('btn-health').addEventListener('click', showHealth);
    api.onInsights(state => { data = state; update(); });
    api.getInsights().then(state => { data = state; update(); }).catch(() => {});
})();
