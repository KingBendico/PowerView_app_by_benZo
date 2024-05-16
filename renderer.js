const { ipcRenderer } = require('electron');

let allShades = [];
let allScenes = [];
let allRooms = [];
let colors = [];
let host = "";

// Listen for the config data from the main process
ipcRenderer.on('config', (event, config) => {
    host = `http://${config.ipAddress}`;

    // Fetch initial data once the IP address is set
    fetchColors();
    fetchAllShades();
    fetchAllScenes();
    fetchAllRooms();
});

document.getElementById('settingsButton').addEventListener('click', () => {
    ipcRenderer.send('open-settings-window');
});

// Add event listener for info button
document.getElementById('infoButton').addEventListener('click', () => {
    document.getElementById('content').innerHTML = `
        <h2>PowerView app (By Benzo)</h2>
        <p>Select an option below to navigate.</p>
    `;
    document.getElementById('info').classList.remove('hidden');
});

// Fetch all colors
function fetchColors() {
    const xhr = new XMLHttpRequest();
    xhr.withCredentials = true;
    xhr.addEventListener('readystatechange', function () {
        if (this.readyState === this.DONE) {
            const response = JSON.parse(this.responseText);
            colors = response.colors;
        }
    });
    xhr.open('GET', `${host}/home/colors`);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.send();
}

// Fetch all shades at the start
function fetchAllShades() {
    const xhr = new XMLHttpRequest();
    xhr.withCredentials = true;
    xhr.addEventListener('readystatechange', function () {
        if (this.readyState === this.DONE) {
            allShades = JSON.parse(this.responseText);
        }
    });
    xhr.open('GET', `${host}/home/shades/`);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.send();
}

// Fetch all scenes at the start
function fetchAllScenes(callback) {
    const xhr = new XMLHttpRequest();
    xhr.withCredentials = true;
    xhr.addEventListener('readystatechange', function () {
        if (this.readyState === this.DONE) {
            allScenes = JSON.parse(this.responseText);
            if (callback) {
                callback();
            }
        }
    });
    xhr.open('GET', `${host}/home/scenes/`);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.send();
}

// Fetch all rooms
function fetchAllRooms(callback) {
    const xhr = new XMLHttpRequest();
    xhr.withCredentials = true;
    xhr.addEventListener('readystatechange', function () {
        if (this.readyState === this.DONE) {
            allRooms = JSON.parse(this.responseText);
            if (callback) {
                callback();
            }
        }
    });
    xhr.open('GET', `${host}/home/rooms/`);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.send();
}

// Initialize menu event listeners
document.getElementById('btn-blinds').addEventListener('click', fetchAndShowRooms);
document.getElementById('btn-scenes').addEventListener('click', fetchAndShowScenes);

// Fetch and show all rooms
function fetchAndShowRooms() {
    fetchAllRooms(function () {
        showRooms(allRooms);
    });
}

// Display the fetched rooms
function showRooms(rooms) {
    const content = document.getElementById('content');
    content.innerHTML = ''; // Clear existing content

    // Create the h2 element
    const firstTitle = document.createElement('h2');

    // Create the icon element
    const iconBlinds = document.createElement('i');
    iconBlinds.className = 'fas fa-window-maximize';

    // Append the icon and text to the h2 element
    firstTitle.appendChild(iconBlinds);
    firstTitle.appendChild(document.createTextNode(' Blinds'));

    // Append the h2 element to the content
    content.appendChild(firstTitle);

    // Add second title
    const secondTitle = document.createElement('h3');
    secondTitle.textContent = '(Grouped by Room)';
    content.appendChild(secondTitle);

    rooms.forEach(room => {
        const card = document.createElement('div');
        card.className = 'card';
        card.style.backgroundColor = colors[parseInt(room.color)] || '#FFFFFF';
        card.dataset.roomId = room.id;

        const title = document.createElement('div');
        title.className = 'card-title';
        title.textContent = room.ptName;

        card.appendChild(title);

        card.addEventListener('click', function () {
            fetchAndDisplayShadesInRoom(room.id);
        });

        content.appendChild(card);
    });
}

// Fetch and display shades within a specific room
function fetchAndDisplayShadesInRoom(roomId) {
    const xhr = new XMLHttpRequest();
    xhr.withCredentials = true;
    xhr.addEventListener('readystatechange', function () {
        if (this.readyState === this.DONE) {
            allShades = JSON.parse(this.responseText);
            displayShadesInRoom(roomId);
        }
    });
    xhr.open('GET', `${host}/home/shades/`);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.send();
}

// Display the shades for a particular room
function displayShadesInRoom(roomId) {
    const filteredShades = allShades.filter(shade => shade.roomId === roomId);
    const room = allRooms.find(room => room.id === roomId);
    const content = document.getElementById('content');

    if (room) {
        content.innerHTML = `<h2>${room.ptName} blinds</h2>`;
    } else {
        content.innerHTML = `<h2>Shades in Room</h2>`;
    }

    filteredShades.forEach(shade => {
        const card = document.createElement('div');
        card.className = 'card';
        const title = document.createElement('div');
        title.className = 'card-title';
        title.textContent = shade.ptName;

        // Primary slider
        const primaryContainer = document.createElement('div');
        primaryContainer.className = 'slider-container';
        const primaryLabel = document.createElement('label');
        primaryLabel.textContent = 'Primary: ';
        const primarySlider = document.createElement('input');
        primarySlider.type = 'range';
        primarySlider.min = '0';
        primarySlider.max = '100';
        primarySlider.step = '1';
        primarySlider.value = (shade.positions.primary * 100).toFixed(0);
        const primaryValue = document.createElement('span');
        primaryValue.textContent = `${primarySlider.value}%`;

        // Update displayed value dynamically
        primarySlider.addEventListener('input', function () {
            primaryValue.textContent = `${this.value}%`;
        });

        // Send the update when the user stops moving the slider
        primarySlider.addEventListener('change', function () {
            const primaryVal = parseInt(this.value);
            updateShadePosition(shade.id, primaryVal, secondarySlider ? parseInt(secondarySlider.value) : 0);
        });

        primaryContainer.appendChild(primaryLabel);
        primaryContainer.appendChild(primarySlider);
        primaryContainer.appendChild(primaryValue);

        card.appendChild(title);
        card.appendChild(primaryContainer);

        // Secondary slider (if applicable)
        let secondarySlider = null;
        if (shade.type === 8) {
            const secondaryContainer = document.createElement('div');
            secondaryContainer.className = 'slider-container';
            const secondaryLabel = document.createElement('label');
            secondaryLabel.textContent = 'Secondary: ';
            secondarySlider = document.createElement('input');
            secondarySlider.min = '0';
            secondarySlider.max = '100';
            secondarySlider.step = '1';
            secondarySlider.type = 'range';
            secondarySlider.value = (shade.positions.secondary * 100).toFixed(0);
            const secondaryValue = document.createElement('span');
            secondaryValue.textContent = `${secondarySlider.value}%`;

            secondarySlider.addEventListener('input', function () {
                secondaryValue.textContent = `${this.value}%`;
            });

            // Send the update when the user stops moving the slider
            secondarySlider.addEventListener('change', function () {
                const primaryVal = parseInt(primarySlider.value);
                const secondaryVal = parseInt(this.value);
                updateShadePosition(shade.id, primaryVal, secondaryVal);
            });

            secondaryContainer.appendChild(secondaryLabel);
            secondaryContainer.appendChild(secondarySlider);
            secondaryContainer.appendChild(secondaryValue);

            card.appendChild(secondaryContainer);
        }

        content.appendChild(card);
    });
}

// Function to send the shade update to the API
function updateShadePosition(shadeId, primaryValue, secondaryValue) {
    const payload = {
        positions: {
            primary: primaryValue / 100,
            secondary: secondaryValue / 100,
        },
    };
    const xhr = new XMLHttpRequest();
    xhr.withCredentials = true;
    xhr.addEventListener('readystatechange', function () {
        if (this.readyState === this.DONE) {
            console.log(`Updated shade ${shadeId}: ${this.responseText}`);
            const shade = allShades.find(shade => shade.id === shadeId);
            if (shade) {
                shade.positions.primary = payload.positions.primary;
                shade.positions.secondary = payload.positions.secondary;
            }
        }
    });
    xhr.open('PUT', `${host}/home/shades/positions?ids=${shadeId}`);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.send(JSON.stringify(payload));
}

let activeSceneIds = [];

function fetchActiveScenes(callback) {
    const xhr = new XMLHttpRequest();
    xhr.withCredentials = true;

    xhr.addEventListener('readystatechange', function () {
        if (this.readyState === this.DONE) {
            // Parse the response to get the active scenes
            const activeScenes = JSON.parse(this.responseText);
            activeSceneIds = activeScenes.map(scene => scene.id);
            if (callback) callback();
        }
    });

    xhr.open('GET', `${host}/home/scenes/active`);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.send(JSON.stringify(false));
}

function fetchAndShowScenes() {
    fetchActiveScenes(() => {
        fetchAllScenes(function () {
            fetchAllRooms(displayScenesByRoom);
        });
    });
}

// Display scenes grouped by rooms
function displayScenesByRoom() {
    const content = document.getElementById('content');
    content.innerHTML = ''; // Clear existing content

    // Create the h2 element
    const firstTitle = document.createElement('h2');

    // Create the icon element
    const icon = document.createElement('i');
    icon.className = 'fa-solid fa-play';

    // Append the icon and text to the h2 element
    firstTitle.appendChild(icon);
    firstTitle.appendChild(document.createTextNode(' Scenes'));

    // Append the h2 element to the content
    content.appendChild(firstTitle);

    // Add second title
    const secondTitle = document.createElement('h3');
    secondTitle.textContent = '(Grouped by Room)';
    content.appendChild(secondTitle);

    const scenesByRoom = {};

    // Initialize mapping of rooms to their scenes using room.id
    allRooms.forEach(room => {
        scenesByRoom[room.id] = {
            name: room.ptName,
            color: colors[parseInt(room.color)] || '#FFFFFF',
            scenes: [],
        };
    });

    // Assign each scene to its respective rooms
    allScenes.forEach(scene => {
        scene.roomIds.forEach(roomId => {
            if (scenesByRoom[roomId]) {
                scenesByRoom[roomId].scenes.push(scene);
            }
        });
    });

    // Display scenes grouped by rooms using the original order from `allRooms`
    allRooms.forEach(room => {
        const roomInfo = scenesByRoom[room.id];
        if (!roomInfo) return;

        // Create and style the room section
        const roomSection = document.createElement('div');
        roomSection.className = 'card';
        roomSection.style.backgroundColor = roomInfo.color;

        // Add the room title
        const roomTitle = document.createElement('div');
        roomTitle.className = 'card-title';
        roomTitle.textContent = roomInfo.name;
        roomSection.appendChild(roomTitle);

        // Create a container for scenes
        const scenesContainer = document.createElement('div');
        scenesContainer.className = 'scene-content';
        scenesContainer.style.display = 'none';

        // Add each scene to the scenes container
        roomInfo.scenes.forEach(scene => {
            const sceneCard = document.createElement('div');
            sceneCard.className = 'card scene-card';

            // Highlight if the scene is active
            if (activeSceneIds.includes(scene.id)) {
                sceneCard.classList.add('active-scene'); // Assuming this class provides a highlight effect
            }

            const sceneTitle = document.createElement('div');
            sceneTitle.className = 'card-title';
            sceneTitle.textContent = scene.ptName;

            const activateButton = document.createElement('button');
            activateButton.textContent = 'Activate Scene';
            activateButton.addEventListener('click', (event) => {
                activateScene(scene.id);
                event.stopPropagation();
            });
            activateButton.classList.add('button-4');

            // Construct the scene card
            sceneCard.appendChild(sceneTitle);
            sceneCard.appendChild(activateButton);

            // Append the scene card to the scenes container
            scenesContainer.appendChild(sceneCard);
        });

        // Append the scenes container to the room section
        roomSection.appendChild(scenesContainer);

        // Click event to toggle display of scenes
        roomSection.addEventListener('click', () => {
            scenesContainer.style.display = scenesContainer.style.display === 'none' ? 'block' : 'none';
        });

        // Append the room section to the main content
        content.appendChild(roomSection);
    });
}

// Activate a particular scene
function activateScene(sceneId) {
    const xhr = new XMLHttpRequest();
    xhr.withCredentials = true;
    xhr.addEventListener('readystatechange', function () {
        if (this.readyState === this.DONE) {
            console.log(`Activated scene ${sceneId}: ${this.responseText}`);
        }
    });
    xhr.open('PUT', `${host}/${sceneId}/activate`);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.send();
}

document.addEventListener('DOMContentLoaded', function () {
    let lastScrollTop = 0; // Variable to store the last scroll position.
    const navbar = document.querySelector('.bottom-nav'); // Reference to the bottom navigation bar.

    window.addEventListener('scroll', function () {
        let scrollTop = window.pageYOffset || document.documentElement.scrollTop; // Get the current scroll position.

        if (scrollTop > lastScrollTop) {
            // Scrolling down
            navbar.style.bottom = '-100px'; // Move the navbar out of view
        } else {
            // Scrolling up
            navbar.style.bottom = '0'; // Move the navbar back into view
        }
        lastScrollTop = scrollTop; // Update the last scroll position.
    }, false);
});
