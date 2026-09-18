function defaultShadeAppearance(shade) {
    return { kind: (shade.demoOriginalKind || shade.controls.kind) === 'vertical' ? 'curtain' : 'shade', fabric: 'pleated', color: null, draw: 'split' };
}
function shadeAppearanceFor(shade) {
    return appState?.config.appearances?.[appState.connection.address]?.[shade.id] || defaultShadeAppearance(shade);
}
function openShadeAppearance(id) {
    if (document.querySelector('dialog[open]')) return;
    const shade = allShades.find(item => item.id === id);
    if (!shade) return;
    let draft = { ...shadeAppearanceFor(shade) }, reset = false;
    const dialog = document.createElement('dialog'); dialog.className = 'appearance-dialog'; dialog.id = 'shadeAppearanceDialog';
    dialog.setAttribute('aria-labelledby', 'appearanceTitle');
    dialog.innerHTML = `<form>
        <header><div><div class="page-eyebrow">MAKE IT YOURS</div><h2 id="appearanceTitle"></h2></div><button class="appearance-close" type="button" aria-label="Close appearance settings">×</button></header>
        <p class="appearance-intro">Choose how this device appears in PowerView.</p>
        <div class="appearance-preview" aria-label="Appearance preview"><div class="shade-window-inner shade-window-inner--realistic motion-window"><div class="shade-window-glass shade-window-glass--realistic"></div><div class="shade-fabric motion-fabric"></div><div class="curtain-panel curtain-left"></div><div class="curtain-panel curtain-right"></div></div></div>
        <fieldset class="covering-choice"><legend>Window covering</legend><label><input type="radio" name="covering" value="shade"> Shades / blinds</label><label><input type="radio" name="covering" value="curtain"> Curtains</label></fieldset>
        <p class="appearance-rail-note" id="appearanceRailNote" hidden></p>
        <label class="appearance-field curtain-draw-field" for="appearanceDraw">Curtain opening<select id="appearanceDraw"><option value="split">Center opening · pair</option><option value="left">Opens to the left · single curtain</option><option value="right">Opens to the right · single curtain</option></select><span class="appearance-draw-hint"></span></label>
        <label class="appearance-field" for="appearanceFabric">Fabric style<select id="appearanceFabric"><option value="pleated">Pleated</option><option value="roller">Smooth roller</option><option value="slatted">Slatted</option></select></label>
        <fieldset class="appearance-colors"><legend>Fabric color</legend><div class="fabric-swatches"></div><div class="custom-color-row"><label for="appearanceColor">Custom color</label><input type="color" id="appearanceColor"><button type="button" class="theme-fabric-color">Use theme color</button></div></fieldset>
        <p class="appearance-error" role="alert" hidden></p>
        <footer><button type="button" class="appearance-reset">Reset</button><button type="button" class="appearance-cancel">Cancel</button><button type="submit" class="appearance-save">Save appearance</button></footer>
    </form>`;
    dialog.querySelector('h2').textContent = shade.ptName;
    const preview = dialog.querySelector('.motion-window'), fabric = dialog.querySelector('#appearanceFabric'), color = dialog.querySelector('#appearanceColor'), draw = dialog.querySelector('#appearanceDraw');
    const swatches = [['Natural','#c4af92'], ['Sage','#627b69'], ['Clay','#b68471'], ['Charcoal','#465151'], ['Mist','#95a9b4']];
    for (const [name, value] of swatches) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'fabric-swatch';
        button.title = name; button.setAttribute('aria-label', name); button.dataset.color = value; button.style.backgroundColor = value;
        button.addEventListener('click', () => { draft.color = value; reset = false; update(); }); dialog.querySelector('.fabric-swatches').appendChild(button);
    }
    function update() {
        for (const radio of dialog.querySelectorAll('[name="covering"]')) radio.checked = radio.value === draft.kind;
        preview.dataset.covering = draft.kind; preview.dataset.fabric = draft.fabric; preview.dataset.draw = draft.draw;
        preview.style.setProperty('--fabric-color', draft.color || '#627b69');
        preview.querySelector('.motion-fabric').style.height = '60%';
        const panels = curtainGeometry.panels(60, draft.draw);
        for (const side of ['left', 'right']) {
            const panel = preview.querySelector(`.curtain-${side}`); panel.style.width = `${panels[side]}%`; panel.hidden = panels[side] === 0;
        }
        dialog.querySelector('.curtain-draw-field').hidden = draft.kind !== 'curtain'; draw.value = draft.draw;
        dialog.querySelector('.appearance-draw-hint').textContent = draft.draw === 'split'
            ? 'Two panels open from the center and stack at both sides.' : `One panel opens and stacks on the ${draft.draw}.`;
        fabric.value = draft.fabric; color.value = draft.color || '#627b69';
        const labels = draft.kind === 'curtain' ? ['Soft folds', 'Linen', 'Fine folds'] : ['Pleated', 'Smooth roller', 'Slatted'];
        [...fabric.options].forEach((option,index) => { option.textContent = labels[index]; });
        for (const button of dialog.querySelectorAll('.fabric-swatch')) button.setAttribute('aria-pressed', String(button.dataset.color === draft.color));
    }
    if ((shade.demoOriginalKind || shade.controls.kind) === 'dual-rail') {
        const demo = appState?.connection.status === 'demo', note = dialog.querySelector('.appearance-rail-note');
        dialog.querySelector('[value="curtain"]').disabled = !demo; note.hidden = false;
        note.textContent = demo
            ? 'Try either covering in demo. Choose Curtains for curtain controls, or Shades / blinds for both rails.'
            : 'This device has two moving rails. Fabric styles and colors are available below; curtains need a single opening control.';
        dialog.querySelector('.covering-choice').setAttribute('aria-describedby', note.id);
    }
    dialog.querySelectorAll('[name="covering"]').forEach(input => input.addEventListener('change', () => { draft.kind = input.value; reset = false; update(); }));
    fabric.addEventListener('change', () => { draft.fabric = fabric.value; reset = false; update(); });
    draw.addEventListener('change', () => { draft.draw = draw.value; reset = false; update(); });
    color.addEventListener('input', () => { draft.color = color.value; reset = false; update(); });
    dialog.querySelector('.theme-fabric-color').addEventListener('click', () => { draft.color = null; reset = false; update(); });
    dialog.querySelector('.appearance-reset').addEventListener('click', () => { draft = defaultShadeAppearance(shade); reset = true; update(); });
    for (const button of dialog.querySelectorAll('.appearance-close,.appearance-cancel')) button.addEventListener('click', () => dialog.close());
    dialog.querySelector('form').addEventListener('submit', async event => {
        event.preventDefault(); const save = dialog.querySelector('.appearance-save'); save.disabled = true;
        try { await api.setAppearance({ id, appearance: reset ? null : draft }); dialog.close(); }
        catch (error) { const message = dialog.querySelector('.appearance-error'); message.textContent = error.message; message.hidden = false; save.disabled = false; }
    });
    dialog.addEventListener('close', () => { dialog.remove(); document.getElementById(`shade-appearance-${id}`)?.focus(); });
    document.body.appendChild(dialog); update(); dialog.showModal();
}
