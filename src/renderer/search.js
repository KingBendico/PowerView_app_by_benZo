(function installSearch() {
    const input = document.getElementById('homeSearch'), results = document.getElementById('searchResults');
    function close() { results.hidden = true; input.setAttribute('aria-expanded','false'); }
    input.addEventListener('input', () => {
        const query = input.value.trim().toLocaleLowerCase(); results.replaceChildren();
        if (!query) { close(); return; }
        const matches = [
            ...allRooms.map(room => ({ name: room.ptName, kind: 'Room', run: () => navigateToRoomShades(room) })),
            ...allShades.map(shade => ({ name: shade.ptName, kind: 'Shade', run: () => {
                const room = allRooms.find(item => item.id === shade.roomId);
                if (!room) return; navigateToRoomShades(room);
                const tile = document.getElementById(`shade-name-${shade.id}`)?.closest('article');
                tile?.scrollIntoView({block:'center',behavior:'smooth'}); tile?.querySelector('input,button')?.focus({preventScroll:true});
            } })),
            ...allScenes.map(scene => ({ name: scene.ptName, kind: 'Run scene', run: () => activateScene(scene.id) })),
        ].filter(item => item.name.toLocaleLowerCase().includes(query)).slice(0, 10);
        for (const match of matches) {
            const button = document.createElement('button'); button.type = 'button';
            const label = document.createElement('span'); label.textContent = match.name;
            const kind = document.createElement('small'); kind.textContent = match.kind;
            button.append(label, kind); button.addEventListener('click', () => { close(); input.value=''; match.run(); }); results.appendChild(button);
        }
        if (!matches.length) { const empty = document.createElement('p'); empty.textContent='No matching rooms, shades or scenes.'; results.appendChild(empty); }
        results.hidden=false;input.setAttribute('aria-expanded','true');
    });
    input.addEventListener('keydown',event=>{
        if(event.key==='Escape'){close();input.blur();}
        if(!results.hidden && (event.key==='ArrowDown' || event.key==='Enter')){const first=results.querySelector('button');if(first){event.preventDefault();if(event.key==='Enter')first.click();else first.focus();}}
    });
    results.addEventListener('keydown',event=>{
        const buttons=[...results.querySelectorAll('button')], index=buttons.indexOf(document.activeElement);
        if(event.key==='ArrowDown' || event.key==='ArrowUp'){event.preventDefault();buttons[(index+(event.key==='ArrowDown'?1:buttons.length-1))%buttons.length]?.focus();}
        if(event.key==='Escape'){close();input.focus();}
    });
    document.addEventListener('pointerdown',event=>{if(!event.target.closest('.command-search'))close();});
    document.addEventListener('keydown',event=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'&&!uiOverlays.settingsIsOpen()&&!uiOverlays.infoIsOpen()){event.preventDefault();input.focus();input.select();}});
})();
