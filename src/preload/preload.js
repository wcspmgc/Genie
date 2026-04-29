import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// every invoke fires genie-ipc-trace (main logs it). never put raw passwords in the trace.
const SECRET_CHANNELS = new Set(['db-setup', 'db-unlock', 'change-password', 'delete-account'])

function summarizeArg(arg, channel) {
  if (arg == null) return arg
  if (typeof arg === 'string') {
    if (SECRET_CHANNELS.has(channel)) return `[secret len=${arg.length}]`
    if (arg.length > 400) return `${arg.slice(0, 400)}…(len=${arg.length})`
    return arg
  }
  if (typeof arg === 'number' || typeof arg === 'boolean') return arg
  if (Array.isArray(arg)) {
    if (channel === 'chat-send') {
      return {
        _arrayLen: arg.length,
        roles: arg.map((m) => ({ role: m?.role, contentLen: String(m?.content ?? '').length })),
      }
    }
    return { _arrayLen: arg.length, _first: summarizeArg(arg[0], channel) }
  }
  if (typeof arg === 'object') {
    if (channel === 'chat-send') {
      const sp = arg.system_prompt
      return {
        keys: Object.keys(arg),
        system_promptLen: typeof sp === 'string' ? sp.length : 0,
        max_tokens: arg.max_tokens,
        temperature: arg.temperature,
        top_p: arg.top_p,
        top_k: arg.top_k,
      }
    }
    try {
      const json = JSON.stringify(arg)
      if (json.length > 600) return { _keys: Object.keys(arg), _jsonLen: json.length }
      return arg
    } catch {
      return '[object]'
    }
  }
  return String(arg)
}

function invokeTraced(channel, ...args) {
  try {
    ipcRenderer.send('genie-ipc-trace', {
      channel,
      args: args.map((a) => summarizeArg(a, channel)),
    })
  } catch (_) {}
  return ipcRenderer.invoke(channel, ...args)
}

const api = {
  // chat
  sendChat: (messages, config) => invokeTraced('chat-send', messages, config),
  createChat: () => invokeTraced('chat-create'),
  renameChat: (id, title) => invokeTraced('chat-rename', id, title),
  deleteChat: (id) => invokeTraced('chat-delete', id),
  chatExportPdf: (chatId) => invokeTraced('chat-export-pdf', chatId),
  onResponse: (callback) => ipcRenderer.on('chat-reply', (_event, data) => callback(data)),
  removeResponseListener: () => ipcRenderer.removeAllListeners('chat-reply'),

  // model
  loadModel: () => invokeTraced('model-load'),
  unloadModel: () => invokeTraced('model-unload'),
  modelsGetPath: () => invokeTraced('models-get-path'),
  modelsGetEmbeddersPath: () => invokeTraced('models-get-embedders-path'),
  modelsGetPathsDetail: () => invokeTraced('models-get-paths-detail'),
  modelsListLocal: () => invokeTraced('models-list-local'),
  modelsListEmbedders: () => invokeTraced('models-list-embedders'),
  modelsDownloadDefaults: () => invokeTraced('models-download-defaults'),
  modelsAddGguf: () => invokeTraced('models-add-gguf'),
  onModelsDownloadProgress: (callback) =>
    ipcRenderer.on('models-download-progress', (_event, data) => callback(data)),
  removeModelsDownloadProgressListener: () =>
    ipcRenderer.removeAllListeners('models-download-progress'),
  modelsGetRerankersPath: () => invokeTraced('models-get-rerankers-path'),
  modelsGetRewriterPath: () => invokeTraced('models-get-rewriter-path'),
  modelsListRerankers: () => invokeTraced('models-list-rerankers'),
  modelsListRewriter: () => invokeTraced('models-list-rewriter'),

  // auth
  isSetup: () => invokeTraced('db-is-setup'),
  setup: (password) => invokeTraced('db-setup', password),
  unlock: (password) => invokeTraced('db-unlock', password),
  changePassword: (oldPw, newPw) => invokeTraced('change-password', oldPw, newPw),
  deleteAccount: (password) => invokeTraced('delete-account', password),

  // storage
  load: (type, id) => invokeTraced('db-load', type, id),
  save: (type, data, id) => invokeTraced('db-save', type, data, id),

  // documents / RAG
  openFiles: () => invokeTraced('dialog-open-files'),
  openFolder: () => invokeTraced('dialog-open-folder'),
  scanFolder: (path) => invokeTraced('documents-scan-folder', path),
  documentsGetPath: () => invokeTraced('documents-get-path'),
  retrieveQuery: (tableName, query, k, options = {}) =>
    invokeTraced('retrieve-query', tableName, query, k, options),
  corpusIngest: (corpusId) => invokeTraced('corpus-ingest', corpusId),
  onIngestProgress: (callback) => ipcRenderer.on('ingest-progress', (_e, corpusId, msg) => callback(corpusId, msg)),
  removeIngestProgressListener: () => ipcRenderer.removeAllListeners('ingest-progress'),

  // prefs (plain json, no auth)
  getPrefs: () => invokeTraced('prefs-get'),
  setPrefs: (key, val) => invokeTraced('prefs-set', key, val),
  chooseBackgroundImage: () => invokeTraced('dialog-choose-image'),
  listBackgroundImages: () => invokeTraced('background-images-list'),
  getBackgroundImageDataUrl: (filename) => invokeTraced('background-image-data-url', filename),
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI) // should htis be here? safe?
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  window.electron = electronAPI
  window.api = api
}
