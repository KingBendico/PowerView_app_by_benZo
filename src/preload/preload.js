const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
    getSubnet: async () => {
        try {
            const subnet = await ipcRenderer.invoke('get-subnet');
            return subnet;
        } catch (error) {
            console.error('Error in getSubnet:', error);
        }
    },
    scanNetwork: async () => {
        try {
            const devices = await ipcRenderer.invoke('scan-network');
            return devices;
        } catch (error) {
            console.error('Error in scanNetwork:', error);
        }
    },
    stopScan: () => {
        ipcRenderer.send('stop-scan');
    },
    onDeviceFound: (callback) => {
        ipcRenderer.on('device-found', (event, device) => {
            callback(device);
        });
    },
    onScanFinished: (callback) => {
        ipcRenderer.on('scan-finished', () => {
            callback();
        });
    },
    onProgressUpdate: (callback) => {
        ipcRenderer.on('progress-update', (event, progress) => {
            callback(progress);
        });
    }
});
