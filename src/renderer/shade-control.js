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
    visual.title = dual ? 'Drag either edge. When the edges meet, pull up for the top edge or down for the bottom edge.'
        : `Drag ${curtains ? 'horizontally' : 'vertically'} to choose a target. The fabric follows reported movement.`;
    const inner = document.createElement('div'); inner.className = 'shade-window-inner shade-window-inner--realistic motion-window';
    inner.dataset.covering = curtains ? 'curtain' : 'shade'; inner.dataset.fabric = appearance.fabric; inner.dataset.draw = curtainDraw;
    if (appearance.color) inner.style.setProperty('--fabric-color', appearance.color);
    inner.innerHTML = '<div class="shade-window-glass shade-window-glass--realistic"></div><div class="shade-fabric motion-fabric"></div><div class="curtain-panel curtain-left"></div><div class="curtain-panel curtain-right"></div><div class="motion-target target-primary" hidden></div><div class="motion-target target-secondary" hidden></div>';
    visual.appendChild(inner); root.appendChild(visual);
    const fabric = inner.querySelector('.motion-fabric');
    const leftCurtain = inner.querySelector('.curtain-left'), rightCurtain = inner.querySelector('.curtain-right');
    const primaryMarker = inner.querySelector('.target-primary'), secondaryMarker = inner.querySelector('.target-secondary');
    const inputs = {}, suffixes = {}, grips = {}, edges = {};
    const edgeName = axis => axis === 'primary' ? 'Bottom edge' : 'Top edge';
    let quickActions = null;
    const railHint = dual ? document.createElement('div') : null;
    const fineAdjustment = dual ? document.createElement('details') : null;
    if (dual) {
        railHint.className = 'dual-rail-hint'; railHint.id = `shade-${shade.id}-rail-hint`;
        root.appendChild(railHint);
        for (const axis of ['secondary', 'primary', 'merged']) {
            const grip = document.createElement('div'); grip.className = 'shade-handle motion-grip dual-rail-grip'; grip.dataset.axis = axis;
            grip.setAttribute('aria-describedby', railHint.id);
            grip.title = axis === 'merged' ? 'Pull up or down to separate the edges.' : `${edgeName(axis)} · drag to adjust`;
            inner.appendChild(grip); grips[axis] = grip;
            if (axis !== 'merged') {
                const edge = document.createElement('div'); edge.className = 'dual-rail-edge'; edge.dataset.edge = axis;
                edge.setAttribute('aria-hidden', 'true'); inner.appendChild(edge); edges[axis] = edge;
            }
        }
        fineAdjustment.className = 'dual-rail-fine';
        const summary = document.createElement('summary'); summary.textContent = 'Fine adjustment'; fineAdjustment.appendChild(summary);
        root.appendChild(fineAdjustment);
    } else {
        for (const side of curtains ? ['left', 'right'] : ['primary']) {
            const grip = document.createElement('span'); grip.className = `motion-grip${curtains ? ' motion-grip-curtain' : ''}`;
            grip.dataset.axis = 'primary'; grip.dataset.side = side; grip.setAttribute('aria-hidden', 'true');
            inner.appendChild(grip); grips[side] = grip;
        }
    }
    const inputsRow = document.createElement('div'); inputsRow.className = dual ? 'dual-rail-inputs' : 'shade-tile-pct-row';
    for (const axis of dual ? ['secondary', 'primary'] : ['primary']) {
        const label = document.createElement('label'); label.className = dual ? 'dual-rail-position' : 'shade-tile-pct-label';
        const input = document.createElement('input'); input.type = 'number'; input.min = '0'; input.max = '100'; input.step = dual ? 'any' : '1';
        input.className = 'slider-input'; input.id = dual ? `shade-${shade.id}-${axis}-position` : `shade-${shade.id}-pct-closed`;
        input.setAttribute('aria-label', `${shade.ptName}, ${dual ? `${edgeName(axis)} percent from top` : 'percent closed'}`);
        if (dual) {
            input.dataset.railInput = axis; input.setAttribute('aria-describedby', `shade-${shade.id}-position-help`);
            const name = document.createElement('span'); name.textContent = edgeName(axis); label.appendChild(name);
        }
        label.appendChild(input);
        const suffix = document.createElement('span'); suffix.className = 'shade-tile-pct-suffix'; suffix.textContent = dual ? '%' : '% closed'; label.appendChild(suffix);
        inputsRow.appendChild(label); inputs[axis] = input; suffixes[axis] = suffix;
    }
    (fineAdjustment || root).appendChild(inputsRow);
    if (dual) {
        const help = document.createElement('p'); help.id = `shade-${shade.id}-position-help`; help.className = 'dual-rail-position-help';
        help.textContent = 'Positions measured from the top of the window.'; fineAdjustment.appendChild(help);
    }
    const sliders = dual ? grips : { primary: visual };
    for (const [axis, handle] of Object.entries(sliders)) {
        handle.tabIndex = 0; handle.setAttribute('role', 'slider');
        handle.setAttribute('aria-label', `${shade.ptName}, ${dual ? axis === 'merged' ? 'meeting edges; Up moves the top edge, Down moves the bottom edge' : edgeName(axis) : curtains ? 'curtain position' : 'shade position'}`);
        handle.setAttribute('aria-orientation', curtains ? 'horizontal' : 'vertical');
        handle.setAttribute('aria-valuemin', '0'); handle.setAttribute('aria-valuemax', '100');
    }
    const note = document.createElement('div'); note.className = 'shade-motion-note'; root.appendChild(note);
    let draft = null, draftAxis = null, localTarget = null, drag = null, frame = null, rendered = null, correction = null, lastSignature = '';
    let merged = false, lastMovedAxis = 'primary';
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
        return dual ? `top edge ${Math.round(values.secondary)}% · bottom edge ${Math.round(values.primary)}%` : `${Math.round(values.primary)}% closed`;
    }
    function railRange(axis) {
        const positions = reported(), values = toVisual(positions);
        const known = Number.isFinite(positions.primary) && Number.isFinite(positions.secondary);
        const min = known && axis === 'primary' ? clamp(values.secondary) : 0;
        const max = known && axis === 'secondary' ? clamp(values.primary) : 100;
        return { min, max, movable: known && max - min > .01 };
    }
    function bounded(value, axis) {
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
        if (valid) {
            const p = clamp(values.primary), s = dual ? Math.min(p, clamp(values.secondary)) : 0;
            fabric.style.top = `${s}%`; fabric.style.height = `${Math.max(0, p - s)}%`;
            const panels = curtainGeometry.panels(p, curtainDraw);
            leftCurtain.style.width = `${panels.left}%`; rightCurtain.style.width = `${panels.right}%`;
            leftCurtain.hidden = panels.left === 0; rightCurtain.hidden = panels.right === 0;
            inner.dataset.physicalPrimary = p.toFixed(2);
            if (dual) {
                // Keep one reachable grip when hit areas would overlap. Hysteresis
                // prevents flickering between one and two grips during movement.
                const height = inner.clientHeight || 135;
                const gripCenter = value => Math.max(15, Math.min(height - 15, value / 100 * height));
                if (!drag) merged = gripCenter(p) - gripCenter(s) < (merged ? 40 : 32);
                inner.dataset.railsMerged = String(merged); inner.dataset.physicalSecondary = s.toFixed(2);
                const focused = document.activeElement;
                for (const [axis, edge] of [['primary', p], ['secondary', s], ['merged', (p + s) / 2]]) {
                    grips[axis].hidden = axis === 'merged' ? !merged : merged;
                    grips[axis].style.top = `clamp(15px, ${edge}%, calc(100% - 15px))`;
                    if (edges[axis]) edges[axis].style.top = `clamp(1px, ${edge}%, calc(100% - 2px))`;
                }
                if (!drag && Object.values(grips).includes(focused) && focused.hidden) {
                    (merged ? grips.merged : grips[lastMovedAxis]).focus({ preventScroll: true });
                }
            } else if (curtains) {
                for (const side of ['left', 'right']) {
                    grips[side].hidden = panels[side] === 0;
                    grips[side].style[side] = `clamp(15px, calc(${panels[side]}% - 7px), calc(100% - 15px))`;
                }
            } else grips.primary.style.top = `clamp(15px, ${p}%, calc(100% - 15px))`;
        }
        const target = localTarget || appState?.targets?.[shade.id]?.positions || motion()?.target;
        const showTarget = !!draft || !!target && Object.keys(target).length > 0;
        const hasTarget = axis => draft ? draftAxis === axis : Number.isFinite(target?.[axis]);
        primaryMarker.hidden = !showTarget || dual && !hasTarget('primary');
        secondaryMarker.hidden = !showTarget || (dual ? !hasTarget('secondary') : !curtains || curtainDraw !== 'split');
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
        for (const [axis, input] of Object.entries(inputs)) {
            const display = hasTarget(axis) ? chosen[axis] : values[axis];
            if (document.activeElement !== input) input.value = Number.isFinite(display) ? String(dual ? Number(display.toFixed(2)) : Math.round(display)) : '';
            suffixes[axis].textContent = dual ? hasTarget(axis) ? '% target' : '%' : showTarget ? 'target % closed' : '% closed';
            const blocked = dual && !railRange(axis).movable;
            input.dataset.positionBlocked = String(blocked); input.disabled = !canEdit() || blocked;
            if (dual) { const range = railRange(axis); input.min = String(range.min); input.max = String(range.max); }
        }
        for (const [axis, handle] of Object.entries(sliders)) {
            const joint = axis === 'merged';
            const display = joint ? draft ? chosen[draftAxis] : (values.primary + values.secondary) / 2 : hasTarget(axis) ? chosen[axis] : values[axis];
            const range = dual && !joint ? railRange(axis) : { min: 0, max: 100, movable: valid };
            const blocked = dual && (handle.hidden || !range.movable);
            handle.dataset.positionBlocked = String(blocked);
            handle.setAttribute('aria-disabled', String(!canEdit() || blocked)); handle.tabIndex = !canEdit() || blocked ? -1 : 0;
            handle.setAttribute('aria-valuemin', String(range.min)); handle.setAttribute('aria-valuemax', String(range.max));
            if (Number.isFinite(display)) {
                handle.setAttribute('aria-valuenow', String(dual ? display : Math.round(display)));
                handle.setAttribute('aria-valuetext', `${joint ? draft ? `${edgeName(draftAxis)} target: ` : 'Edges near ' : hasTarget(axis) ? 'Target: ' : ''}${Math.round(display)} percent${dual ? ' from top' : ''}`);
            } else { handle.removeAttribute('aria-valuenow'); handle.setAttribute('aria-valuetext', 'Position not reported'); }
        }
        if (dual) {
            railHint.textContent = !valid ? 'Refresh to get both edge positions.' : drag?.started ? `${edgeName(drag.axis)} · release to move`
                : !merged ? 'Drag the top or bottom edge.' : !railRange('secondary').movable ? 'Pull down to lower the shade.'
                : !railRange('primary').movable ? 'Pull up to raise the shade.' : 'Pull up or down to separate the edges.';
            grips.merged.title = railHint.textContent;
            if (quickActions) for (const button of quickActions.querySelectorAll('[data-rail-value],[data-rail-step]')) {
                const range = railRange('primary'), step = Number(button.dataset.railStep), value = Number(button.dataset.railValue);
                const disabled = !range.movable || (button.hasAttribute('data-rail-step') ? step < 0 ? chosen.primary <= range.min : chosen.primary >= range.max : value < range.min || value > range.max);
                button.dataset.positionBlocked = String(disabled); button.disabled = !canEdit() || disabled;
                const action = button.hasAttribute('data-rail-step') ? `${step < 0 ? 'Raise' : 'Lower'} the bottom edge` : `Set the bottom edge to ${value}% from top`;
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
        lastSignature = signature; draw();
        if (!frame) frame = requestAnimationFrame(tick);
    }
    function commit(axis) {
        if (!draft || !canEdit() || dual && !railRange(axis).movable) { draft = null; sync(); return; }
        draft[axis] = bounded(draft[axis], axis);
        const positions = toGateway(draft, axis);
        const existing = localTarget || appState?.targets?.[shade.id]?.positions || motion()?.target || reported();
        if (dual && Math.abs(positions[axis] - existing[axis]) < .01) { draft = null; sync(); return; }
        lastMovedAxis = axis; localTarget = positions; draft = null; sync(); statusEl.textContent = 'Sending…';
        api.moveShade({ id: shade.id, positions }).catch(error => { statusEl.textContent = error.message; })
            .finally(() => { localTarget = null; sync(); });
    }
    function cancelDrag() {
        if (!drag) return;
        const active = drag; drag = null;
        document.removeEventListener('pointermove', onMove, true); document.removeEventListener('pointerup', onEnd, true);
        document.removeEventListener('pointercancel', onCancel, true); window.removeEventListener('blur', onCancel);
        window.removeEventListener('keydown', onDragKey, true); inner.removeEventListener('lostpointercapture', onCancel);
        inner.classList.remove('shade-window-dragging'); delete inner.dataset.dragRail;
        try { inner.releasePointerCapture(active.id); } catch { /* Pointer may already be released. */ }
    }
    function chooseAt(event) {
        if (dual && !drag.started) {
            const dy = event.clientY - drag.startY, dx = event.clientX - drag.startX;
            // Ignore taps and sideways jitter. Direction chooses a meeting edge
            // once; reversing the gesture never switches to the other motor.
            if (Math.abs(dy) < 4 || Math.abs(dy) < Math.abs(dx)) return;
            const axis = drag.axis || (dy < 0 ? 'secondary' : 'primary');
            if (!railRange(axis).movable) return;
            drag.axis = axis; drag.started = true;
            drag.offset = (drag.startY - drag.rect.top) / drag.rect.height - drag.physical[axis] / 100;
            draft = { ...selection() }; draftAxis = axis; inner.dataset.dragRail = axis;
        }
        const { rect, axis, side, offset } = drag;
        const fraction = (curtains ? (event.clientX - rect.left) / rect.width : (event.clientY - rect.top) / rect.height) - offset;
        const value = curtains ? curtainGeometry.positionAt(fraction, curtainDraw, side) : fraction * 100;
        draft[axis] = bounded(value, axis); sync();
    }
    function onMove(event) { if (drag && event.pointerId === drag.id) { event.preventDefault(); chooseAt(event); } }
    function onEnd(event) {
        if (!drag || event.pointerId !== drag.id) return;
        chooseAt(event); const { axis, started } = drag; cancelDrag();
        if (!dual || started) commit(axis); else { draft = null; sync(); }
    }
    function onCancel(event) {
        if (drag && event?.pointerId != null && event.pointerId !== drag.id) return;
        cancelDrag(); draft = null; if (root.isConnected) sync();
    }
    function onDragKey(event) {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCancel(); }
    }
    inner.addEventListener('pointerdown', event => {
        if (drag || !canEdit() || (event.pointerType !== 'touch' && event.button !== 0)) return;
        let rect = inner.getBoundingClientRect();
        if (dual) rect = { left: rect.left + inner.clientLeft, top: rect.top + inner.clientTop, width: inner.clientWidth, height: inner.clientHeight };
        const grip = event.target.closest('.motion-grip'), physical = toVisual(rendered || devicePosition());
        let axis = 'primary', handle = visual;
        if (dual) {
            if (!Number.isFinite(physical.primary) || !Number.isFinite(physical.secondary)) return;
            const y = (event.clientY - rect.top) / rect.height * 100;
            const nearest = Math.abs(y - physical.secondary) < Math.abs(y - physical.primary) ? 'secondary' : 'primary';
            // The rail's full width is draggable, but an unrelated tap on glass
            // or fabric should not reposition either edge.
            if (!grip && Math.abs(y - physical[nearest]) / 100 * rect.height > 20) return;
            axis = merged ? null : grip?.dataset.axis || nearest;
            if (axis && !railRange(axis).movable) return;
            handle = grips[merged ? 'merged' : axis];
        }
        event.preventDefault();
        if (root.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') document.activeElement.blur();
        const side = grip?.dataset.side || (event.clientX < rect.left + rect.width / 2 ? 'left' : 'right');
        let offset = 0;
        if (!dual) {
            draft = { ...selection() }; draftAxis = axis;
            if (grip && Number.isFinite(physical[axis])) {
                draft[axis] = physical[axis];
                const panels = curtainGeometry.panels(physical.primary, curtainDraw);
                const edge = curtains ? (side === 'right' ? 100 - panels.right : panels.left) / 100 : physical[axis] / 100;
                offset = (curtains ? (event.clientX - rect.left) / rect.width : (event.clientY - rect.top) / rect.height) - edge;
            }
        }
        handle.focus({ preventScroll: true });
        drag = { id: event.pointerId, rect, axis, side, offset, physical, startX: event.clientX, startY: event.clientY, started: !dual };
        inner.classList.add('shade-window-dragging');
        try { inner.setPointerCapture(event.pointerId); } catch { /* Synthetic test pointers have no capture. */ }
        document.addEventListener('pointermove', onMove, true); document.addEventListener('pointerup', onEnd, true);
        document.addEventListener('pointercancel', onCancel, true); window.addEventListener('blur', onCancel);
        window.addEventListener('keydown', onDragKey, true); inner.addEventListener('lostpointercapture', onCancel);
        if (!dual) chooseAt(event);
    });
    for (const [axis, input] of Object.entries(inputs)) {
        input.addEventListener('input', () => {
            if (!input.checkValidity() || input.value === '') return;
            draft = { ...selection() }; draftAxis = axis; draft[axis] = bounded(Number(input.value), axis); sync();
        });
        input.addEventListener('change', () => {
            if (!input.checkValidity() || input.value === '') { input.reportValidity(); return; }
            draft = { ...selection() }; draftAxis = axis; draft[axis] = bounded(Number(input.value), axis); commit(axis);
        });
        input.addEventListener('blur', () => { draft = null; sync(); });
    }
    for (const [keyAxis, handle] of Object.entries(sliders)) handle.addEventListener('keydown', event => {
        if (drag || !canEdit() || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const axis = keyAxis === 'merged' ? ['ArrowUp', 'ArrowLeft', 'Home'].includes(event.key) ? 'secondary' : 'primary' : keyAxis;
        draft = { ...selection() }; draftAxis = axis;
        const horizontalReverse = curtains && curtainDraw === 'right' && ['ArrowLeft','ArrowRight'].includes(event.key) ? -1 : 1;
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? 100 : draft[axis] + (['ArrowUp','ArrowLeft'].includes(event.key) ? -1 : 1) * horizontalReverse;
        draft[axis] = bounded(next, axis); commit(axis);
    });
    sync(); return { root, sync, ...(dual ? {
        fineActionsContainer: fineAdjustment,
        setBottomRailPosition(value) { draft = { ...selection() }; draftAxis = 'primary'; draft.primary = bounded(value, 'primary'); commit('primary'); },
        nudgeBottomRail(step) { this.setBottomRailPosition(selection().primary + step); },
        bindQuickActions(row) { quickActions = row; sync(); },
    } : {}) };
}
