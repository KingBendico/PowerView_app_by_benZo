const { contextBridge, ipcRenderer } = require('electron');
const invoke = async (channel, value) => {
  const result = await ipcRenderer.invoke(channel, value);
  if (!result.ok) throw new Error(result.error);
  return result.value;
};
const subscribe = (channel, callback) => {
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
contextBridge.exposeInMainWorld('powerView', {
  getState: () => invoke('get-state'), getConfig: () => invoke('get-config'),
  getPrefs: () => invoke('get-prefs'), setPrefs: value => invoke('set-prefs', value),
  connect: address => invoke('connect', address), refresh: () => invoke('refresh'),
  demo: enabled => invoke('demo', enabled), validateGateway: address => invoke('validate-gateway', address),
  discover: () => invoke('discover-gateway'), interfaces: () => invoke('interfaces'),
  scan: name => invoke('scan-network', name), stopScan: () => invoke('stop-scan'),
  openSwagger: address => invoke('open-swagger', address),
  moveShade: value => invoke('move-shade', value), shadeAction: value => invoke('shade-action', value),
  roomAction: value => invoke('room-action', value), activateScene: id => invoke('activate-scene', id),
  favorite: value => invoke('favorite', value),
  onState: callback => subscribe('state', callback), onNavigation: callback => subscribe('navigation', callback),
  onNotice: callback => subscribe('command-notice', callback), onProgress: callback => subscribe('scan-progress', callback),
});
