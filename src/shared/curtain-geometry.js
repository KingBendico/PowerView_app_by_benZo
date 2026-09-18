(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.curtainGeometry = factory();
})(typeof window === 'object' ? window : globalThis, function () {
    const stack = 4;
    function panels(closed, draw = 'split') {
        const value = Math.max(0, Math.min(100, closed));
        if (draw === 'left') return { left: stack + value * .96, right: 0 };
        if (draw === 'right') return { left: 0, right: stack + value * .96 };
        return { left: stack + value * .46, right: stack + value * .46 };
    }
    function positionAt(fraction, draw = 'split', side = 'left') {
        const fromRight = draw === 'right' || draw === 'split' && side === 'right';
        return ((fromRight ? 1 - fraction : fraction) * 100 - stack) / (draw === 'split' ? .46 : .96);
    }
    return { panels, positionAt };
});
