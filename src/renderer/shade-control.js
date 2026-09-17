// A target is an editable overlay. The solid fabric always represents the device.
function createLiveShadeControl(shade, statusEl) {
    const dual = shade.controls.kind === 'dual-rail';
    const appearance = shadeAppearanceFor(shade);
    const curtains = appearance.kind === 'curtain' && !dual;
    const curtainDraw = appearance.draw || 'split';
    const root = document.createElement('div');
    root.className = dual ? 'shade-unified-dual shade-unified-dual--tile motion-control' : 'shade-single-stack shade-single-tile motion-control';
    root.setAttribute('aria-live', 'off');
    const visual = document.createElement('div'); visual.className = 'shade-window-visual';
    visual.title = `Drag ${curtains ? 'horizontally' : 'vertically'} to choose a target. The fabric follows reported movement.`;
    const inner = document.createElement('div'); inner.className = 'shade-window-inner shade-window-inner--realistic motion-window';
    inner.dataset.covering = curtains ? 'curtain' : 'shade'; inner.dataset.fabric = appearance.fabric; inner.dataset.draw = curtainDraw;
    if (appearance.color) inner.style.setProperty('--fabric-color', appearance.color);
    inner.innerHTML = '<div class="shade-window-glass shade-window-glass--realistic"></div><div class="shade-fabric motion-fabric"></div><div class="curtain-panel curtain-left"></div><div class="curtain-panel curtain-right"></div><div class="motion-target target-primary" hidden></div><div class="motion-target target-secondary" hidden></div>';
    visual.appendChild(inner); root.appendChild(visual);
    const fabric = inner.querySelector('.motion-fabric');
    const leftCurtain = inner.querySelector('.curtain-left'), rightCurtain = inner.querySelector('.curtain-right');
    const primaryMarker = inner.querySelector('.target-primary'), secondaryMarker = inner.querySelector('.target-secondary');
    const inputsRow = document.createElement('div'); inputsRow.className = dual ? 'dual-rail-controls' : 'shade-tile-pct-row';
    const railButtons = {}, grips = {};
    let activeAxis = 'primary', quickActions = null;
    const railName = axis => axis === 'primary' ? 'Bottom rail' : 'Top rail';
    const handle = dual ? document.createElement('div') : visual;
    const railEdge = dual ? document.createElement('div') : null;
    const railHint = dual ? document.createElement('div') : null;
    if (dual) {
        railEdge.className = 'dual-rail-edge'; railEdge.setAttribute('aria-hidden', 'true'); inner.appendChild(railEdge);
        handle.className = 'shade-handle motion-grip dual-rail-grip';
        const caption = document.createElement('span'); caption.className = 'dual-rail-grip-label'; handle.appendChild(caption); inner.appendChild(handle);
        const picker = document.createElement('div'); picker.className = 'dual-rail-picker'; picker.setAttribute('role', 'group');
        picker.setAttribute('aria-label', `${shade.ptName}, rail to control`);
        railHint.className = 'dual-rail-hint'; railHint.id = `shade-${shade.id}-rail-hint`;
        for (const axis of ['secondary', 'primary']) {
            const button = document.createElement('button'); button.type = 'button'; button.dataset.rail = axis;
            const icon = document.createElement('span'); icon.className = 'dual-rail-icon'; icon.setAttribute('aria-hidden', 'true'); button.appendChild(icon);
            button.appendChild(document.createTextNode(railName(axis))); button.setAttribute('aria-describedby', railHint.id);
            button.addEventListener('click', () => {
                if (drag || !canEdit() || !railRange(axis).movable) return;
                draft = null; activeAxis = axis; sync();
            });
            picker.appendChild(button); railButtons[axis] = button;
        }
        inputsRow.appendChild(picker); handle.setAttribute('aria-describedby', railHint.id);
    }
    const label = document.createElement('label'); label.className = dual ? 'dual-rail-position' : 'shade-tile-pct-label';
    const input = document.createElement('input'); input.type = 'number'; input.min = '0'; input.max = '100'; input.step = dual ? 'any' : '1';
    input.className = 'slider-input'; input.id = dual ? `shade-${shade.id}-rail-position` : `shade-${shade.id}-pct-closed`;
    input.setAttribute('aria-label', `${shade.ptName}, percent closed`);
    if (dual) { label.appendChild(document.createTextNode('Position')); input.setAttribute('aria-describedby', railHint.id); }
    label.appendChild(input);
    const suffix = document.createElement('span'); suffix.className = 'shade-tile-pct-suffix'; suffix.textContent = dual ? '% from top' : '% closed'; label.appendChild(suffix);
    inputsRow.appendChild(label);
    if (dual) inputsRow.appendChild(railHint);
    handle.tabIndex = 0; handle.setAttribute('role', 'slider');
    handle.setAttribute('aria-label', `${shade.ptName}, ${curtains ? 'curtain position' : 'shade position'}`);
    handle.setAttribute('aria-orientation', curtains ? 'horizontal' : 'vertical');
    handle.setAttribute('aria-valuemin', '0'); handle.setAttribute('aria-valuemax', '100');
    if (!dual) {
        for (const side of curtains ? ['left', 'right'] : ['primary']) {
            const grip = document.createElement('span');
            grip.className = `motion-grip${curtains ? ' motion-grip-curtain' : ''}`;
            grip.dataset.axis = 'primary'; grip.dataset.side = side;
            grip.setAttribute('aria-hidden', 'true');
            inner.appendChild(grip); grips[side] = grip;
        }
    }
    root.appendChild(inputsRow);
    const note = document.createElement('div'); note.className = 'shade-motion-note'; root.appendChild(note);
    let draft = null, localTarget = null, drag = null, frame = null, rendered = null, correction = null, lastSignature = '';
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const clamp = value => Math.max(0, Math.min(100, value));
    const latest = () => allShades.find(item => item.id === shade.id) || shade;
    const reported = () => Object.fromEntries(Object.entries(latest().positions).filter(([,value]) => Number.isFinite(value)).map(([axis,value]) => [axis,value * 100]));
    const toVisual = positions => ({ primary: shade.controls.kind === 'top-down' ? positions.primary : 100 - positions.primary,
        secondary: positions.secondary ?? 0 });
    const toGateway = (values, axis) => ({ [axis]: axis === 'primary' && shade.controls.kind !== 'top-down' ? 100 - values[axis] : values[axis] });
    const motion = () => appState?.motions?.[shade.id];
    const devicePosition = () => shadeMotion.project(motion()) || reported();
    const canEdit = () => isConnected() && latest().available && !appState?.pending[`shade:${shade.id}`];
    function selection() {
        const target = localTarget || appState?.targets?.[shade.id]?.positions || motion()?.target;
        return draft || toVisual({ ...devicePosition(), ...target });
    }
    function description(values) {
        return dual ? `top rail ${Math.round(values.secondary)}% · bottom rail ${Math.round(values.primary)}%` : `${Math.round(values.primary)}% closed`;
    }
    function railRange(axis) {
        const positions = reported(), values = toVisual(positions);
        const known = Number.isFinite(positions.primary) && Number.isFinite(positions.secondary);
        const min = known && axis === 'primary' ? clamp(values.secondary) : 0;
        const max = known && axis === 'secondary' ? clamp(values.primary) : 100;
        return { min, max, movable: known && max - min > .01 };
    }
    function bounded(value, axis, values) {
        value = clamp(Math.round(value));
        if (!dual) return value;
        const range = railRange(axis);
        return Math.max(range.min, Math.min(range.max, value));
    }
    function draw() {
        const physical = devicePosition();
        if (correction) {
            const elapsed = (performance.now() - correction.at) / 180;
            if (elapsed >= 1) correction = null;
            else for (const axis of Object.keys(correction.offset)) physical[axis] += correction.offset[axis] * (1 - elapsed) ** 2;
        }
        const values = toVisual(physical), chosen = selection(); rendered = { ...physical };
        const valid = Number.isFinite(values.primary) && (!dual || Number.isFinite(physical.secondary));
        inner.classList.toggle('position-unreported', !valid);
        if (dual && !drag && !draft && document.activeElement !== input && !railRange(activeAxis).movable) {
            const other = activeAxis === 'primary' ? 'secondary' : 'primary';
            if (railRange(other).movable) activeAxis = other;
        }
        if (valid) {
            const p = clamp(values.primary), s = dual ? Math.min(p, clamp(values.secondary)) : 0;
            fabric.style.top = `${s}%`; fabric.style.height = `${Math.max(0, p - s)}%`;
            const panels = curtainGeometry.panels(p, curtainDraw);
            leftCurtain.style.width = `${panels.left}%`; rightCurtain.style.width = `${panels.right}%`;
            leftCurtain.hidden = panels.left === 0; rightCurtain.hidden = panels.right === 0;
            inner.dataset.physicalPrimary = p.toFixed(2);
            if (dual) {
                const edge = activeAxis === 'primary' ? p : s;
                handle.style.top = `clamp(14px, ${edge}%, calc(100% - 14px))`;
                railEdge.style.top = `clamp(1px, ${edge}%, calc(100% - 2px))`;
                inner.dataset.physicalSecondary = s.toFixed(2);
            } else if (curtains) {
                for (const side of ['left', 'right']) {
                    grips[side].hidden = panels[side] === 0;
                    grips[side].style[side] = `clamp(11px, calc(${panels[side]}% - 7px), calc(100% - 11px))`;
                }
            } else grips.primary.style.top = `clamp(11px, ${p}%, calc(100% - 11px))`;
        }
        const target = localTarget || appState?.targets?.[shade.id]?.positions || motion()?.target;
        const showTarget = !!draft || !!target && Object.keys(target).length > 0;
        const activeHasTarget = !!draft || Number.isFinite(target?.[activeAxis]);
        suffix.textContent = dual ? activeHasTarget ? 'target % from top' : '% from top' : showTarget ? 'target % closed' : '% closed';
        primaryMarker.hidden = !showTarget || dual && (draft ? activeAxis !== 'primary' : !Number.isFinite(target?.primary));
        secondaryMarker.hidden = !showTarget || (dual ? draft ? activeAxis !== 'secondary' : !Number.isFinite(target?.secondary) : !curtains || curtainDraw !== 'split');
        if (showTarget) {
            if (curtains) {
                const panels = curtainGeometry.panels(chosen.primary, curtainDraw);
                primaryMarker.style.left = `${curtainDraw === 'right' ? 100 - panels.right : panels.left}%`;
                secondaryMarker.style.right = `${panels.right}%`;
            } else {
                primaryMarker.style.top = `${chosen.primary}%`;
                secondaryMarker.style.top = `${chosen.secondary}%`;
            }
        }
        const display = activeHasTarget ? chosen[activeAxis] : values[activeAxis];
        if (document.activeElement !== input) input.value = Number.isFinite(display) ? String(dual ? Number(display.toFixed(2)) : Math.round(display)) : '';
        const blocked = dual && !railRange(activeAxis).movable;
        handle.dataset.positionBlocked = input.dataset.positionBlocked = String(blocked);
        input.disabled = !canEdit() || blocked;
        handle.setAttribute('aria-disabled', String(!canEdit() || blocked)); handle.tabIndex = !canEdit() || blocked ? -1 : 0;
        if (Number.isFinite(display)) {
            handle.setAttribute('aria-valuenow', String(Math.round(display)));
            handle.setAttribute('aria-valuetext', `${activeHasTarget ? 'Target: ' : ''}${Math.round(display)} percent${dual ? ' from top' : ''}`);
        } else {
            handle.removeAttribute('aria-valuenow'); handle.setAttribute('aria-valuetext', 'Position not reported');
        }
        if (dual) {
            const range = railRange(activeAxis);
            handle.dataset.axis = activeAxis; inner.dataset.activeRail = activeAxis;
            handle.querySelector('.dual-rail-grip-label').textContent = railName(activeAxis);
            handle.setAttribute('aria-label', `${shade.ptName}, ${railName(activeAxis)} position`);
            handle.title = `Drag to move the ${railName(activeAxis).toLowerCase()}`;
            input.setAttribute('aria-label', `${shade.ptName}, ${railName(activeAxis)} percent from top`);
            input.min = String(range.min); input.max = String(range.max);
            handle.setAttribute('aria-valuemin', input.min); handle.setAttribute('aria-valuemax', input.max);
            for (const [axis, button] of Object.entries(railButtons)) {
                button.dataset.positionBlocked = String(!!drag || !railRange(axis).movable);
                button.disabled = !canEdit() || button.dataset.positionBlocked === 'true';
                button.setAttribute('aria-pressed', String(axis === activeAxis));
            }
            railHint.textContent = !valid ? 'Refresh to get both rail positions.' : !railRange('secondary').movable ? 'Lower the bottom rail first to use the top rail.'
                : !railRange('primary').movable ? 'Raise the top rail first to use the bottom rail.' : 'Drag, type or use presets for this rail.';
            if (quickActions) for (const button of quickActions.querySelectorAll('[data-rail-value],[data-rail-step]')) {
                const step = Number(button.dataset.railStep), value = Number(button.dataset.railValue);
                const disabled = !range.movable || (button.hasAttribute('data-rail-step') ? step < 0 ? chosen[activeAxis] <= range.min : chosen[activeAxis] >= range.max : value < range.min || value > range.max);
                button.dataset.positionBlocked = String(disabled); button.disabled = !canEdit() || disabled;
                const action = button.hasAttribute('data-rail-step') ? `${step < 0 ? 'Raise' : 'Lower'} the ${railName(activeAxis).toLowerCase()}` : `Set the ${railName(activeAxis).toLowerCase()} to ${value}% from top`;
                button.title = action; button.setAttribute('aria-label', `${shade.ptName}, ${action}`);
            }
        }
        const moving = motion();
        let message = '';
        if (draft) message = `Target: ${description(chosen)}${drag ? ' · release to move' : ''}`;
        else if (moving?.status === 'stale') message = 'Live updates lost · last estimate shown';
        else if (moving?.status === 'stopping') message = 'Stopping · waiting for reported position';
        else if (moving?.status === 'unconfirmed') message = 'Position unconfirmed · last estimate shown';
        else if (moving?.durationMs) message = Date.now() < moving.startedAt + moving.durationMs
            ? `Moving · approx. ${description(values)}` : 'Finishing · waiting for reported position';
        else if (moving) message = 'Moving · waiting for position updates';
        else if (showTarget) message = `Target: ${description(chosen)} · waiting for gateway`;
        if (note.textContent !== message) note.textContent = message;
        root.classList.toggle('is-moving', moving?.status === 'moving');
        return !!correction || !!moving?.durationMs && Date.now() < moving.startedAt + moving.durationMs;
    }
    function tick() {
        frame = null;
        if (!root.isConnected) { cancelDrag(); return; }
        if (draw()) frame = requestAnimationFrame(tick);
    }
    function sync() {
        const signature = JSON.stringify([motion(), reported()]);
        if (signature !== lastSignature && rendered && !reducedMotion.matches) {
            const next = devicePosition();
            correction = { at: performance.now(), offset: Object.fromEntries(Object.keys(next).filter(axis => Number.isFinite(rendered[axis])).map(axis => [axis, rendered[axis] - next[axis]])) };
        }
        lastSignature = signature;
        draw();
        if (!frame) frame = requestAnimationFrame(tick);
    }
    function commit(axis) {
        if (!draft || !canEdit() || dual && !railRange(axis).movable) { draft = null; sync(); return; }
        draft[axis] = bounded(draft[axis], axis, draft);
        const positions = toGateway(draft, axis);
        const existing = localTarget || appState?.targets?.[shade.id]?.positions || motion()?.target || reported();
        if (dual && Math.abs(positions[axis] - existing[axis]) < .01) { draft = null; sync(); return; }
        localTarget = positions; draft = null; sync(); statusEl.textContent = 'Sending…';
        api.moveShade({ id: shade.id, positions }).catch(error => { statusEl.textContent = error.message; })
            .finally(() => { localTarget = null; sync(); });
    }
    function cancelDrag() {
        if (!drag) return;
        const active = drag; drag = null;
        document.removeEventListener('pointermove', onMove, true);
        document.removeEventListener('pointerup', onEnd, true);
        document.removeEventListener('pointercancel', onCancel, true);
        window.removeEventListener('blur', onCancel);
        inner.removeEventListener('lostpointercapture', onCancel);
        inner.classList.remove('shade-window-dragging');
        try { inner.releasePointerCapture(active.id); } catch { /* Pointer may already be released. */ }
    }
    function chooseAt(event) {
        const { rect, axis, side, offset } = drag;
        const fraction = (curtains ? (event.clientX - rect.left) / rect.width : (event.clientY - rect.top) / rect.height) - offset;
        const value = curtains ? curtainGeometry.positionAt(fraction, curtainDraw, side) : fraction * 100;
        draft[axis] = bounded(value, axis, draft); sync();
    }
    function onMove(event) { if (drag && event.pointerId === drag.id) { event.preventDefault(); chooseAt(event); } }
    function onEnd(event) {
        if (!drag || event.pointerId !== drag.id) return;
        chooseAt(event); const axis = drag.axis; cancelDrag(); commit(axis);
    }
    function onCancel(event) {
        if (drag && event?.pointerId != null && event.pointerId !== drag.id) return;
        cancelDrag(); draft = null; if (root.isConnected) sync();
    }
    inner.addEventListener('pointerdown', event => {
        if (drag || !canEdit() || dual && !railRange(activeAxis).movable || (event.pointerType !== 'touch' && event.button !== 0)) return;
        event.preventDefault();
        if (root.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') document.activeElement.blur();
        const rect = inner.getBoundingClientRect(); draft = { ...selection() };
        const y = (event.clientY - rect.top) / rect.height * 100;
        const grip = event.target.closest('.motion-grip');
        const axis = activeAxis;
        const side = grip?.dataset.side || (event.clientX < rect.left + rect.width / 2 ? 'left' : 'right');
        let offset = 0;
        if (grip) {
            // A grip is inset at the endpoints. Preserve where it was grabbed so
            // touching a fully open shade does not suddenly choose a new position.
            const physical = toVisual(rendered || devicePosition());
            if (Number.isFinite(physical[axis])) {
                draft[axis] = physical[axis];
                const panels = curtainGeometry.panels(physical.primary, curtainDraw);
                const edge = curtains ? (side === 'right' ? 100 - panels.right : panels.left) / 100 : physical[axis] / 100;
                offset = (curtains ? (event.clientX - rect.left) / rect.width : y / 100) - edge;
            }
        }
        handle.focus({ preventScroll: true });
        drag = { id: event.pointerId, rect, axis, side, offset };
        inner.classList.add('shade-window-dragging');
        try { inner.setPointerCapture(event.pointerId); } catch { /* Synthetic test pointers have no capture. */ }
        document.addEventListener('pointermove', onMove, true); document.addEventListener('pointerup', onEnd, true);
        document.addEventListener('pointercancel', onCancel, true); window.addEventListener('blur', onCancel);
        inner.addEventListener('lostpointercapture', onCancel); chooseAt(event);
    });
    input.addEventListener('input', () => {
        if (!input.checkValidity() || input.value === '') return;
        draft = { ...selection() }; draft[activeAxis] = bounded(Number(input.value), activeAxis, draft); sync();
    });
    input.addEventListener('change', () => {
        if (!input.checkValidity() || input.value === '') { input.reportValidity(); return; }
        draft = { ...selection() }; draft[activeAxis] = bounded(Number(input.value), activeAxis, draft); commit(activeAxis);
    });
    input.addEventListener('blur', () => { draft = null; sync(); });
    handle.addEventListener('keydown', event => {
        if (!canEdit() || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault(); draft = { ...selection() };
        const horizontalReverse = curtains && curtainDraw === 'right' && ['ArrowLeft','ArrowRight'].includes(event.key) ? -1 : 1;
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? 100 : draft[activeAxis] + (['ArrowUp','ArrowLeft'].includes(event.key) ? -1 : 1) * horizontalReverse;
        draft[activeAxis] = bounded(next, activeAxis, draft); commit(activeAxis);
    });
    sync(); return { root, sync, ...(dual ? {
        setRailPosition(value) { draft = { ...selection() }; draft[activeAxis] = bounded(value, activeAxis, draft); commit(activeAxis); },
        nudgeRail(step) { this.setRailPosition(selection()[activeAxis] + step); },
        bindQuickActions(row) { quickActions = row; sync(); },
    } : {}) };
}
