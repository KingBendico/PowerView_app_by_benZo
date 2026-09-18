(function setupSettings() {
    const overlay = document.getElementById('settingsOverlay');
    const gear = document.getElementById('settingsButton');
    const input = document.getElementById('ipAddress');
    let generation = 0;
    const message = (text, error = false) => {
        const el = document.getElementById('messages'); el.textContent = text; el.className = error ? 'error-message' : 'info-message';
    };
    const isOpen = () => !overlay.classList.contains('hidden');
    async function open() {
        if (isOpen()) return;
        overlay.classList.remove('hidden'); overlay.setAttribute('aria-hidden', 'false'); gear.setAttribute('aria-expanded', 'true');
        pushModalScrollLock(); input.focus(); message('');
        const current = ++generation;
        const [config, networks] = await Promise.all([api.getConfig(), api.interfaces()]);
        if (generation !== current || !isOpen()) return;
        input.value = config.ipAddress; document.getElementById('closeToTray').checked = config.closeToTray;
        const select = document.getElementById('networkInterface'); select.replaceChildren();
        for (const network of networks) { const option = document.createElement('option'); option.value = network.name; option.textContent = network.label; select.appendChild(option); }
        if (!networks.length) { const option = document.createElement('option'); option.textContent = 'Use mDNS or a manual address'; option.value = ''; select.appendChild(option); }
    }
    function close() {
        if (!isOpen()) return;
        generation++; void api.stopScan(); overlay.classList.add('hidden'); overlay.setAttribute('aria-hidden', 'true'); gear.setAttribute('aria-expanded', 'false');
        popModalScrollLock(); gear.focus();
    }
    uiOverlays.settingsIsOpen = isOpen; uiOverlays.settingsClose = close;
    gear.addEventListener('click', () => { if (isOpen()) close(); else open().catch(error => message(error.message, true)); });
    for (const id of ['settingsBackdrop', 'settingsPanelCloseBtn', 'cancelButton']) document.getElementById(id).addEventListener('click', close);
    async function task(button, label, action) {
        const current = generation; button.disabled = true; message(label);
        try { const result = await action(); if (current === generation) return result; }
        catch (error) { if (current === generation) message(error.message, true); }
        finally { button.disabled = false; }
    }
    document.getElementById('saveButton').addEventListener('click', event => task(event.currentTarget, 'Connecting…', async () => {
        await api.connect(input.value); prefs.closeToTray = document.getElementById('closeToTray').checked; await persistPrefs(); close();
    }));
    document.getElementById('closeToTray').addEventListener('change', async event => { prefs.closeToTray = event.target.checked; await persistPrefs(); });
    document.getElementById('testConnectionButton').addEventListener('click', event => task(event.currentTarget, 'Checking gateway…', async () => {
        const identity = await api.validateGateway(input.value); message(`${identity.name} is reachable and provides home data.`);
    }));
    document.getElementById('openSwaggerButton').addEventListener('click', event => task(event.currentTarget, 'Starting gateway API tools…', async () => message(await api.openSwagger(input.value))));
    document.getElementById('exportSettingsButton').addEventListener('click', event => task(event.currentTarget, 'Exporting settings…', async () => {
        const result = await api.exportSettings(); if (!result.canceled) message('Settings exported successfully.');
    }));
    document.getElementById('importSettingsButton').addEventListener('click', event => task(event.currentTarget, 'Importing settings…', async () => {
        const result = await api.importSettings(); if (!result.canceled) message('Settings imported. Reconnect if the imported gateway is different.');
    }));
    async function discover(button, scan) {
        const current = generation;
        document.getElementById('stopScanButton').hidden = false;
        document.getElementById('scan-results').replaceChildren();
        await task(button, scan ? 'Scanning selected network…' : 'Looking for PowerView gateways…', async () => {
            const result = await (scan ? api.scan(document.getElementById('networkInterface').value) : api.discover());
            if (current !== generation) return;
            message(result.cancelled ? 'Discovery stopped.' : result.devices.length ? 'Select a gateway, then Connect.' : result.error || 'No primary gateway found. Enter its address manually.');
            const target = document.getElementById('scan-results');
            for (const device of result.devices) {
                const button = document.createElement('button'); button.type = 'button'; button.className = 'device';
                button.textContent = `${device.name} · ${device.address}`;
                button.addEventListener('click', () => { input.value = device.address; input.focus(); }); target.appendChild(button);
            }
        });
        document.getElementById('stopScanButton').hidden = true;
    }
    document.getElementById('discoverButton').addEventListener('click', event => discover(event.currentTarget, false));
    document.getElementById('scanButton').addEventListener('click', event => discover(event.currentTarget, true));
    document.getElementById('stopScanButton').addEventListener('click', () => api.stopScan());
    api.onProgress(progress => { if (isOpen()) message(`Scanning selected network: ${progress.current} of ${progress.total} addresses checked`); });
})();
