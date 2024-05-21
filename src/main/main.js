const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const os = require('os');
const ping = require('ping');
const arp = require('node-arp');
const fs = require('fs');

let mainWindow;
let settingsWin;
let stopScanFlag = false;

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

// Load and parse OUI text file
const ouiFilePath = path.join('resources/oui.txt');

if (!fs.existsSync(ouiFilePath)) {
    console.error('oui.txt file not found');
    process.exit(1);
}

const ouiFileContent = fs.readFileSync(ouiFilePath, 'utf8');
const macVendors = {};

const lines = ouiFileContent.split('\n');
lines.forEach(line => {
    const trimmedLine = line.trim();
    if (trimmedLine.length === 0) {
        return;
    }
    const match = trimmedLine.match(/^([0-9A-F]{2}-[0-9A-F]{2}-[0-9A-F]{2})\s+\(hex\)\s+(.+)$/i);
    const base16Match = trimmedLine.match(/^([0-9A-F]{6})\s+\(base 16\)\s+(.+)$/i);
    if (match) {
        const macPrefixHyphen = match[1];
        const macPrefixColon = macPrefixHyphen.replace(/-/g, ':');
        const vendorName = match[2].trim();
        macVendors[macPrefixHyphen] = vendorName;
        macVendors[macPrefixColon] = vendorName;
    } else if (base16Match) {
        const macPrefixBase16 = base16Match[1].match(/.{1,2}/g).join(':');
        const macPrefixHyphen = macPrefixBase16.replace(/:/g, '-');
        const vendorName = base16Match[2].trim();
        macVendors[macPrefixBase16] = vendorName;
        macVendors[macPrefixHyphen] = vendorName;
    }
});

function createMainWindow() {
    mainWindow = new BrowserWindow({
        width: 650,
        height: 680,
        minWidth: 650,
        minHeight: 680,
        maxWidth: 650,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: true,
            contextIsolation: false,
        }
    });

    mainWindow.loadFile('views/index.html');
    mainWindow.setIcon('assets/PowerView_big.ico');
    mainWindow.removeMenu();

    // Pass the IP address to the renderer process via IPC
    const config = getConfig();
    mainWindow.webContents.on('did-finish-load', () => {
        mainWindow.webContents.send('config', config);
    });

    // Close settings window when main window is closed
    mainWindow.on('closed', () => {
        if (settingsWin) {
            settingsWin.close();
        }
        mainWindow = null;
    });
}

function createSettingsWindow() {
    if (settingsWin) {
        settingsWin.focus();
        return;
    }

    settingsWin = new BrowserWindow({
        width: 550,
        height: 550,
        maxWidth: 550,
        minHeight: 550,
        maxHeight: 550,
        minWidth: 550,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        }
    });

    settingsWin.loadFile('views/settings.html');
    settingsWin.removeMenu();
    settingsWin.setIcon('assets/PowerView_big.ico');
    settingsWin.resizable = false;

    // Handle settings window close event
    settingsWin.on('closed', () => {
        settingsWin = null;
    });
}

function getLocalSubnet() {
    const interfaces = os.networkInterfaces();
    for (let name of Object.keys(interfaces)) {
        for (let iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                const subnet = iface.address.split('.').slice(0, 3).join('.');
                return subnet;
            }
        }
    }
    throw new Error('No valid network interface found');
}

async function pingHosts(subnet, sender) {
    const promises = [];
    const total = 255;
    for (let i = 1; i <= total; i++) {
        if (stopScanFlag) {
            console.log('Scan stopped');
            break;
        }
        const host = `${subnet}.${i}`;
        promises.push(pingHost(host, sender, i, total));
    }
    const devices = await Promise.all(promises);
    sender.send('scan-finished');  // Notify the renderer process that the scan is finished
    return devices.filter(device => device !== null && device.name.includes("Hunter Douglas"));  // Filter out non-Hunter Douglas devices
}

async function pingHost(host, sender, current, total) {
    try {
        const res = await ping.promise.probe(host, { timeout: 1 });
        if (res.alive) {
            const device = await resolveDeviceName(host);
            sender.send('device-found', device);
            return device;
        }
    } catch (error) {
        console.error(`Error pinging ${host}:`, error);
    }
    sender.send('progress-update', { current, total });  // Send progress update
    return null;  // Return null for unsuccessful pings
}

function resolveDeviceName(ip) {
    return new Promise((resolve) => {
        arp.getMAC(ip, (err, mac) => {
            if (err) {
                resolve({ ip, name: 'Unknown' });
            } else {
                const vendor = getVendorFromMAC(mac);
                resolve({ ip, name: `${mac} (${vendor})` });
            }
        });
    });
}

function getVendorFromMAC(mac) {
    const macPrefix = mac.toUpperCase().slice(0, 8).replace(/:/g, '-');
    const vendor = macVendors[macPrefix] || 'Unknown Vendor';
    return vendor;
}

ipcMain.handle('get-subnet', async () => {
    try {
        const subnet = getLocalSubnet();
        return subnet;
    } catch (error) {
        console.error('Error getting subnet:', error);
        return { error: error.message };
    }
});

ipcMain.handle('scan-network', async (event) => {
    stopScanFlag = false;  // Reset stop flag at the start of the scan
    try {
        const subnet = getLocalSubnet();
        const devices = await pingHosts(subnet, event.sender);
        return devices;
    } catch (error) {
        console.error('Error scanning network:', error);
        return { error: error.message };
    }
});

ipcMain.on('stop-scan', () => {
    stopScanFlag = true;  // Set stop flag to true when stop scan is requested
});

app.whenReady().then(() => {
    createMainWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createMainWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

ipcMain.handle('get-config', () => {
    return getConfig();
});

ipcMain.on('save-ip-address', (event, ipAddress) => {
    const config = getConfig();
    config.ipAddress = ipAddress;
    saveConfig(config);

    BrowserWindow.getAllWindows().forEach(mainWindow => {
        mainWindow.webContents.send('config', config);
    });
});

ipcMain.on('open-settings-window', () => {
    createSettingsWindow();
});
