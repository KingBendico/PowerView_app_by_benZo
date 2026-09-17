(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.shortcutFormat = factory();
})(typeof window === 'object' ? window : globalThis, function () {
    const modifiers = { ctrl: 'Control', control: 'Control', alt: 'Alt', option: 'Alt', shift: 'Shift', command: 'Super', cmd: 'Super', meta: 'Super', super: 'Super' };
    const order = ['Control', 'Alt', 'Shift', 'Super'];
    const keys = ['Space', 'Return', 'Tab', 'Backspace', 'Delete', 'Insert', 'Up', 'Down', 'Left', 'Right', 'Home', 'End', 'PageUp', 'PageDown'];
    const actions = { shade: ['open', 'close', 'position', 'stop'], room: ['open', 'close', 'stop'],
        home: ['open', 'close', 'stop'], scene: ['activate'], preset: ['activate'], group: ['open', 'close', 'stop'], app: ['toggle', 'refresh'] };
    function normalizeAccelerator(value) {
        if (typeof value !== 'string' || value.length > 90) throw new Error('Record a valid key combination.');
        const parts = value.split('+').map(part => part.trim());
        const rawKey = parts.pop();
        const key = /^[a-z0-9]$/i.test(rawKey) || /^f(?:[1-9]|1\d|2[0-4])$/i.test(rawKey) ? rawKey.toUpperCase()
            : keys.find(item => item.toLowerCase() === rawKey.toLowerCase());
        const mods = parts.map(part => modifiers[part.toLowerCase()]);
        if (!key || mods.some(mod => !mod) || new Set(mods).size !== mods.length
            || !mods.some(mod => ['Control', 'Alt', 'Super'].includes(mod))) {
            throw new Error('Use Ctrl, Alt/Option or Command with a letter, number, function key or navigation key.');
        }
        return [...order.filter(mod => mods.includes(mod)), key].join('+');
    }
    function fromEvent(event) {
        if (event.repeat || ['Control', 'Shift', 'Alt', 'Meta', 'Dead'].includes(event.key)) return null;
        const code = event.code || '';
        const key = /^Key[A-Z]$/.test(code) ? code.slice(3) : /^Digit\d$/.test(code) ? code.slice(5)
            : /^F\d+$/.test(code) ? code : ({ ' ': 'Space', Enter: 'Return', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right' }[event.key] || event.key);
        return normalizeAccelerator([event.ctrlKey && 'Control', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Super', key].filter(Boolean).join('+'));
    }
    function display(value, platform = 'darwin') {
        return value.split('+').map(part => ({ Control: 'Ctrl', Alt: platform === 'darwin' ? 'Option' : 'Alt', Super: platform === 'darwin' ? 'Cmd' : 'Super' }[part] || part)).join(' + ');
    }
    function cleanBinding(value) {
        if (!value || typeof value.id !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(value.id)
            || typeof value.target !== 'string' || !Object.hasOwn(actions, value.target) || !actions[value.target].includes(value.action) || typeof value.enabled !== 'boolean') throw new Error('Choose a target and an action for every shortcut.');
        if (['shade', 'room', 'scene'].includes(value.target) && (typeof value.targetId !== 'string' || !/^\d+$/.test(value.targetId))) throw new Error('Choose a shade, room or scene.');
        if (['preset', 'group'].includes(value.target) && (typeof value.targetId !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(value.targetId))) throw new Error('Choose a saved preset or group.');
        if (value.action === 'position' && (!Number.isInteger(value.percent) || value.percent < 0 || value.percent > 100)) throw new Error('Enter a whole percentage between 0 and 100.');
        return { id: value.id, target: value.target, ...(['shade', 'room', 'scene', 'preset', 'group'].includes(value.target) ? { targetId: value.targetId } : {}), action: value.action, enabled: value.enabled,
            accelerator: normalizeAccelerator(value.accelerator), ...(value.action === 'position' ? { percent: value.percent } : {}) };
    }
    function cleanSettings(value) {
        if (!value || typeof value.enabled !== 'boolean' || !Array.isArray(value.bindings) || value.bindings.length > 40) throw new Error('Use up to 40 shortcuts for each home.');
        const bindings = value.bindings.map(cleanBinding), ids = new Set(), accelerators = new Set();
        for (const binding of bindings) {
            if (ids.has(binding.id)) throw new Error('Each shortcut needs a unique ID.');
            if (binding.enabled && accelerators.has(binding.accelerator)) throw new Error(`${display(binding.accelerator)} is assigned more than once. Choose a different combination.`);
            ids.add(binding.id); if (binding.enabled) accelerators.add(binding.accelerator);
        }
        return { enabled: value.enabled, bindings };
    }
    const actionLabel = binding => ({ open: 'Open fully', close: 'Close fully', stop: 'Stop', position: `${binding.percent}% closed`, activate: binding.target === 'preset' ? 'Apply preset' : 'Run scene', toggle: 'Show / hide app', refresh: 'Refresh status' }[binding.action]);
    return { normalizeAccelerator, fromEvent, display, cleanBinding, cleanSettings, actionLabel, actions };
});
