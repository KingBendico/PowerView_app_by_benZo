const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('fs');

// Path to the configuration file
const configPath = path.join(app.getPath('userData'), 'config.json');

// Function to read the configuration file
function getConfig() {
    if (!fs.existsSync(configPath)) {
        fs.writeFileSync(configPath, JSON.stringify({ ipAddress: "" }));
    }
    const config = fs.readFileSync(configPath);
    return JSON.parse(config);
}

// Function to save the configuration file
function saveConfig(config) {
    fs.writeFileSync(configPath, JSON.stringify(config));
}

const createMainWindow = () => {
    const mainWindow = new BrowserWindow({
        width: 550,
        height: 600,
        minWidth: 550,
        minHeight: 600,
        maxWidth: 550,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: true,
            contextIsolation: false,
        }
    });

    mainWindow.loadFile('index.html');
    mainWindow.setIcon('PowerView_big.ico');
    mainWindow.removeMenu();


    // Pass the IP address to the renderer process via IPC
    const config = getConfig();
    mainWindow.webContents.on('did-finish-load', () => {
        mainWindow.webContents.send('config', config);
    });
};

const createSettingsWindow = () => {
    const settingsWin = new BrowserWindow({
        width: 400,
        height: 350,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        }
    });

    settingsWin.loadFile('settings.html');
    settingsWin.removeMenu();
};

// Add IPC listeners
ipcMain.handle('get-config', () => {
    return getConfig();
});

ipcMain.on('save-ip-address', (event, ipAddress) => {
    const config = getConfig();
    config.ipAddress = ipAddress;
    saveConfig(config);

    // Optionally, you can send the updated config to the main window
    BrowserWindow.getAllWindows().forEach(mainWindow => {
        mainWindow.webContents.send('config', config);
    });
});

// Add the event listener to handle opening the settings window
ipcMain.on('open-settings-window', () => {
    createSettingsWindow();
});

app.whenReady().then(() => {
    createMainWindow();

    // Add a menu item to open the settings window
    const { Menu } = require('electron');
    const template = [
        {
            label: 'File',
            submenu: [
                {
                    label: 'Settings',
                    click: () => {
                        createSettingsWindow();
                    }
                },
                { role: 'quit' }
            ]
        }
    ];
// under-menu for file, exit etc.
    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(null);
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});
