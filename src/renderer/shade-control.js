// A target is an editable overlay. The solid fabric always represents the device.
function createLiveShadeControl(shade, statusEl) {
    const dual = shade.controls.kind === 'dual-rail';
    const appearance = shadeAppearanceFor(shade);
    const curtains = appearance.kind === 'curtain' && !dual;
    const root = document.createElement('div');
    root.className = dual ? 'shade-unified-dual shade-unified-dual--tile motion-control' : 'shade-single-stack shade-single-tile motion-control';
    root.setAttribute('aria-live', 'off');
    const visual = document.createElement('div'); visual.className = 'shade-window-visual';
    visual.title = `Drag ${curtains ? 'horizontally' : 'vertically'} to choose a target. The fabric follows reported movement.`;
    const inner = document.createElement('div'); inner.className = 'shade-window-inner shade-window-inner--realistic motion-window';
    inner.dataset.covering = curtains ? 'curtain' : 'shade'; inner.dataset.fabric = appearance.fabric;
    if (appearance.color) inner.style.setProperty('--fabric-color', appearance.color);
    inner.innerHTML = '<div class="shade-window-glass shade-window-glass--realistic"></div><div class="shade-fabric motion-fabric"></div><div class="curtain-panel curtain-left"></div><div class="curtain-panel curtain-right"></div><div class="motion-target target-primary" hidden></div><div class="motion-target target-secondary" hidden></div>';
    visual.appendChild(inner); root.appendChild(visual);
    const fabric = inner.querySelector('.motion-fabric');
    const leftCurtain = inner.querySelector('.curtain-left'), rightCurtain = inner.querySelector('.curtain-right');
    const primaryMarker = inner.querySelector('.target-primary'), secondaryMarker = inner.querySelector('.target-secondary');
    const inputsRow = document.createElement('div'); inputsRow.className = dual ? 'shade-dual-inputs' : 'shade-tile-pct-row';
    const inputs = {}, handles = {};
    const axes = dual ? ['secondary', 'primary'] : ['primary'];
    for (const axis of axes) {
        const label = document.createElement('label'); label.className = dual ? 'shade-dual-input-label' : 'shade-tile-pct-label';
        const input = document.createElement('input'); input.type = 'number'; input.min = '0'; input.max = '100'; input.step = '1';
        input.className = dual ? 'slider-input shade-dual-num' : 'slider-input';
        input.id = dual ? `shade-${shade.id}-dual-${axis === 'primary' ? 'hem' : 'rail'}` : `shade-${shade.id}-pct-closed`;
        input.setAttribute('aria-label', `${shade.ptName}, ${dual ? axis === 'primary' ? 'bottom rail' : 'top rail' : 'percent closed'}`);
        if (dual) label.appendChild(document.createTextNode(axis === 'primary' ? 'Shade ' : 'Rail '));
        label.appendChild(input);
        if (!dual) { const suffix = document.createElement('span'); suffix.className = 'shade-tile-pct-suffix'; suffix.textContent = '% closed'; label.appendChild(suffix); }
        inputsRow.appendChild(label); inputs[axis] = input;
        const handle = dual ? document.createElement('div') : visual;
        if (dual) { handle.className = `shade-handle shade-handle-${axis === 'primary' ? 'primary' : 'rail'}`; inner.appendChild(handle); }
        handle.tabIndex = 0; handle.setAttribute('role', 'slider');
        handle.setAttribute('aria-label', `${shade.ptName}, ${dual ? axis === 'primary' ? 'bottom rail' : 'top rail' : curtains ? 'curtain position' : 'shade position'}`);
        handle.setAttribute('aria-orientation', curtains ? 'horizontal' : 'vertical');
        handle.setAttribute('aria-valuemin', '0'); handle.setAttribute('aria-valuemax', '100'); handles[axis] = handle;
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
        return dual ? `rail ${Math.round(values.secondary)}% · shade ${Math.round(values.primary)}%` : `${Math.round(values.primary)}% closed`;
    }
    function bounded(value, axis, values) {
        value = clamp(Math.round(value));
        if (!dual) return value;
        return axis === 'primary' ? Math.max(values.secondary, value) : Math.min(values.primary, value);
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
        if (valid) {
            const p = clamp(values.primary), s = dual ? Math.min(p, clamp(values.secondary)) : 0;
            fabric.style.top = `${s}%`; fabric.style.height = `${Math.max(0, p - s)}%`;
            for (const panel of [leftCurtain, rightCurtain]) panel.style.width = `${4 + p * .46}%`;
            inner.dataset.physicalPrimary = p.toFixed(2);
            if (dual) {
                handles.secondary.style.top = `${s}%`; handles.primary.style.top = `${p}%`;
                inner.dataset.physicalSecondary = s.toFixed(2);
            }
        }
        const target = localTarget || appState?.targets?.[shade.id]?.positions || motion()?.target;
        const showTarget = !!draft || !!target && Object.keys(target).length > 0;
        const suffix = inputsRow.querySelector('.shade-tile-pct-suffix');
        if (suffix) suffix.textContent = showTarget ? 'target % closed' : '% closed';
        primaryMarker.hidden = !showTarget; secondaryMarker.hidden = !showTarget || (!dual && !curtains);
        if (showTarget) {
            if (curtains) {
                primaryMarker.style.left = `${4 + chosen.primary * .46}%`;
                secondaryMarker.style.right = `${4 + chosen.primary * .46}%`;
            } else {
                primaryMarker.style.top = `${chosen.primary}%`;
                secondaryMarker.style.top = `${chosen.secondary}%`;
            }
        }
        for (const axis of axes) {
            const display = showTarget ? chosen[axis] : values[axis];
            if (document.activeElement !== inputs[axis] && Number.isFinite(display)) inputs[axis].value = String(Math.round(display));
            if (Number.isFinite(display)) {
                handles[axis].setAttribute('aria-valuenow', String(Math.round(display)));
                handles[axis].setAttribute('aria-valuetext', `${showTarget ? 'Target: ' : ''}${Math.round(display)} percent`);
            } else {
                handles[axis].removeAttribute('aria-valuenow'); handles[axis].setAttribute('aria-valuetext', 'Position not reported');
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
        if (!draft || !canEdit()) { draft = null; sync(); return; }
        const positions = toGateway(draft, axis);
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
        const { rect, axis, side } = drag;
        const fraction = curtains ? (event.clientX - rect.left) / rect.width : (event.clientY - rect.top) / rect.height;
        const value = curtains ? ((side === 'left' ? fraction : 1 - fraction) * 100 - 4) / .46 : fraction * 100;
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
        if (drag || !canEdit() || (event.pointerType !== 'touch' && event.button !== 0)) return;
        event.preventDefault();
        if (root.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') document.activeElement.blur();
        const rect = inner.getBoundingClientRect(); draft = { ...selection() };
        const y = (event.clientY - rect.top) / rect.height * 100;
        const axis = dual && Math.abs(y - draft.secondary) < Math.abs(y - draft.primary) ? 'secondary' : 'primary';
        handles[axis].focus({ preventScroll: true });
        drag = { id: event.pointerId, rect, axis, side: event.clientX < rect.left + rect.width / 2 ? 'left' : 'right' };
        inner.classList.add('shade-window-dragging');
        try { inner.setPointerCapture(event.pointerId); } catch { /* Synthetic test pointers have no capture. */ }
        document.addEventListener('pointermove', onMove, true); document.addEventListener('pointerup', onEnd, true);
        document.addEventListener('pointercancel', onCancel, true); window.addEventListener('blur', onCancel);
        inner.addEventListener('lostpointercapture', onCancel); chooseAt(event);
    });
    for (const axis of axes) {
        inputs[axis].addEventListener('input', () => {
            if (!inputs[axis].checkValidity() || inputs[axis].value === '') return;
            draft = { ...selection() }; draft[axis] = bounded(Number(inputs[axis].value), axis, draft); sync();
        });
        inputs[axis].addEventListener('change', () => {
            if (!inputs[axis].checkValidity() || inputs[axis].value === '') { inputs[axis].reportValidity(); return; }
            draft = { ...selection() }; draft[axis] = bounded(Number(inputs[axis].value), axis, draft); commit(axis);
        });
        inputs[axis].addEventListener('blur', () => { draft = null; sync(); });
        handles[axis].addEventListener('keydown', event => {
            if (!canEdit() || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault(); draft = { ...selection() };
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? 100 : draft[axis] + (['ArrowUp','ArrowLeft'].includes(event.key) ? -1 : 1);
            draft[axis] = bounded(next, axis, draft); commit(axis);
        });
    }
    sync(); return { root, sync };
}
