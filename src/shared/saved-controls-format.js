(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(); else root.savedControlsFormat = factory();
})(typeof window === 'object' ? window : globalThis, function () {
    function ids(value) {
        if (!Array.isArray(value) || !value.length || value.length > 100 || value.some(id => typeof id !== 'string' || !/^\d+$/.test(id)) || new Set(value).size !== value.length) throw new Error('Choose between 1 and 100 different shades.');
        return [...value];
    }
    function name(value) {
        if (typeof value !== 'string' || !value.trim() || value.trim().length > 60) throw new Error('Enter a name of up to 60 characters.');
        return value.trim();
    }
    function cleanEntry(value, kind) {
        if (!value || typeof value.id !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(value.id)) throw new Error('Invalid saved control.');
        const result = { id: value.id, name: name(value.name), shadeIds: ids(value.shadeIds) };
        if (kind === 'presets') {
            if (!Array.isArray(value.positions) || value.positions.length !== result.shadeIds.length) throw new Error('Invalid saved positions.');
            result.positions = result.shadeIds.map(id => {
                const item = value.positions.find(item => item?.id === id), positions = item?.positions;
                if (!positions || !Number.isInteger(item.code) || item.code < 0 || item.code > 10 || !Object.keys(positions).length || Object.entries(positions).some(([key, val]) => !['primary', 'secondary', 'tilt'].includes(key) || typeof val !== 'number' || !Number.isFinite(val) || val < 0 || val > 100)) throw new Error('Invalid saved positions.');
                return { id, code: item.code, positions: { ...positions } };
            });
        }
        return result;
    }
    function cleanHome(value) {
        const result = {};
        for (const kind of ['groups', 'presets']) {
            if (!Array.isArray(value?.[kind]) || value[kind].length > 50) throw new Error('Use up to 50 groups and 50 presets per home.');
            result[kind] = value[kind].map(item => cleanEntry(item, kind));
            if (new Set(result[kind].map(item => item.id)).size !== result[kind].length) throw new Error('Duplicate saved control.');
        }
        return result;
    }
    return { ids, name, cleanHome };
});
