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
  setAppearance: value => invoke('shade-appearance', value),
  getShortcuts: () => invoke('get-shortcuts'), saveShortcuts: value => invoke('save-shortcuts', value),
  getSavedControls: () => invoke('get-saved-controls'), saveControl: value => invoke('save-control', value),
  removeControl: value => invoke('remove-control', value), runControl: value => invoke('run-control', value),
  startPrivacy: value => invoke('privacy-start', value), cancelPrivacy: id => invoke('privacy-cancel', id), restorePrivacy: id => invoke('privacy-restore', id),
  onSavedControls: callback => subscribe('saved-controls-state', callback),
  setShortcutsEditing: enabled => invoke('edit-shortcuts', enabled), onShortcuts: callback => subscribe('shortcuts-state', callback),
  onState: callback => subscribe('state', callback), onNavigation: callback => subscribe('navigation', callback),
  onNotice: callback => subscribe('command-notice', callback), onProgress: callback => subscribe('scan-progress', callback),
});
