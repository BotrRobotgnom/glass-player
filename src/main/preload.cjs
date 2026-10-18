const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  search: (query, sources) => ipcRenderer.invoke('search', { query, sources }),
  suggest: (query) => ipcRenderer.invoke('suggest', query),
  findOfficial: (track, target) => ipcRenderer.invoke('findOfficial', track, target),
  version: () => ipcRenderer.invoke('app:version'),
  update: {
    get: () => ipcRenderer.invoke('update:get'),
    check: () => ipcRenderer.invoke('update:check'),
    install: () => ipcRenderer.invoke('update:install'),
    setAuto: (on) => ipcRenderer.send('update:setAuto', !!on),
    changelog: (force) => ipcRenderer.invoke('changelog:get', !!force),
    onState: (cb) => ipcRenderer.on('update:state', (_e, s) => cb(s)),
  },
  reactions: {
    set: (track, value, pair) => ipcRenderer.invoke('reactions:set', track, value, pair),
    get: (kind) => ipcRenderer.invoke('reactions:get', kind),
    map: () => ipcRenderer.invoke('reactions:map'),
  },
  markBlocked: (videoId) => ipcRenderer.invoke('blocked:mark', videoId),
  history: {
    record: (track, seconds) => ipcRenderer.invoke('history:record', track, seconds),
    get: (view, limit) => ipcRenderer.invoke('history:get', view, limit),
    stats: () => ipcRenderer.invoke('history:stats'),
    remove: (trackKey) => ipcRenderer.invoke('history:remove', trackKey),
    clear: () => ipcRenderer.invoke('history:clear'),
  },
  recommend: {
    get: (force) => ipcRenderer.invoke('recommend:get', !!force),
    similar: (track, exclude) => ipcRenderer.invoke('recommend:similar', track, exclude),
  },
  playlists: {
    list: () => ipcRenderer.invoke('playlists:list'),
    get: (id) => ipcRenderer.invoke('playlists:get', id),
    create: (opts) => ipcRenderer.invoke('playlists:create', opts),
    update: (id, patch) => ipcRenderer.invoke('playlists:update', id, patch),
    remove: (id) => ipcRenderer.invoke('playlists:delete', id),
    add: (id, tracks) => ipcRenderer.invoke('playlists:add', id, tracks),
    removeTrack: (id, trackKey) => ipcRenderer.invoke('playlists:remove', id, trackKey),
    pickImage: () => ipcRenderer.invoke('playlists:pickImage'),
  },
  log: {
    write: (level, source, message, data) => ipcRenderer.send('log:write', level, source, message, data),
    setVerbose: (on) => ipcRenderer.send('log:setVerbose', !!on),
  },
  debug: {
    open: () => ipcRenderer.invoke('debug:open'),
  },
  player: {
    // current track for the tray (title, artist, position, ...)
    report: (info) => ipcRenderer.send('player:state', info),
    onCommand: (cb) => ipcRenderer.on('player:command', (_e, cmd) => cb(cmd)),
  },
  autostart: {
    get: () => ipcRenderer.invoke('autostart:get'),
    set: (on) => ipcRenderer.invoke('autostart:set', !!on),
  },
  tray: {
    setCloseToTray: (on) => ipcRenderer.send('tray:setCloseToTray', !!on),
    setLabels: (labels) => ipcRenderer.send('tray:labels', labels),
  },
  win: {
    minimize: () => ipcRenderer.invoke('win:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('win:toggleMaximize'),
    close: () => ipcRenderer.invoke('win:close'),
    alwaysOnTop: (on) => ipcRenderer.invoke('win:alwaysOnTop', on),
    getInfo: () => ipcRenderer.invoke('win:getInfo'),
    setEffect: (effect) => ipcRenderer.invoke('win:setEffect', effect),
    onMaximized: (cb) => ipcRenderer.on('win:maximized', (_e, v) => cb(v)),
  },
});
