// The same bounded projection is used by the renderer, demo and motion recovery.
(function (root) {
    function project(motion, now = Date.now()) {
        if (!motion) return null;
        const progress = Number.isFinite(motion.durationMs) && motion.durationMs > 0
            ? Math.max(0, Math.min(1, (now - motion.startedAt) / motion.durationMs)) : 0;
        const positions = { ...motion.from };
        for (const axis of ['primary', 'secondary', 'tilt']) {
            if (Number.isFinite(motion.from?.[axis]) && Number.isFinite(motion.target?.[axis])) {
                positions[axis] = motion.from[axis] + (motion.target[axis] - motion.from[axis]) * progress;
            }
        }
        return positions;
    }
    function matches(positions, target, tolerance = 1) {
        const axes = Object.keys(target || {}).filter(key => ['primary', 'secondary', 'tilt'].includes(key));
        return axes.length > 0 && axes.every(axis => Number.isFinite(positions?.[axis])
            && Number.isFinite(target[axis]) && Math.abs(positions[axis] - target[axis]) <= tolerance);
    }
    const api = { project, matches };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.shadeMotion = api;
})(globalThis);
