import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import fs from 'fs'
import { join, dirname, basename, isAbsolute } from 'path'
import { fileURLToPath } from 'url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
// logo.ico = taskbar + title bar (win/linux)
import appWindowIcon from '../../resources/images/logo.ico?asset'

// Import our new database and the python manager
import { db } from './store.js'
import { exportChatPdf } from './exportChatPdf.js'
import { startPython, stopPython, sendToPython, isChatProcessRunning, startRetrieveProcess, stopRetrieveProcess, sendToRetrieve, runIngestJob, runDownloadDefaults } from './python.js'
import defaultSettings from '../../resources/default_settings.json'

// --- Path Management ---
// Central source of truth for all file paths.
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const PATHS = {
  preload: join(__dirname, '../preload/preload.js'),
  html: join(__dirname, '../renderer/index.html'),
  icon: appWindowIcon
}

// Global reference to the window object
let mainWindow

function createWindow() {
  mainWindow = new BrowserWindow({
    title: 'Genie',
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    // win/linux taskbar; mac uses bundled icon from electron-builder mostly
    ...(process.platform !== 'darwin' ? { icon: PATHS.icon } : {}),
    webPreferences: {
      preload: PATHS.preload,
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.maximize()
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error('renderer load failed:', errorCode, errorDescription, validatedURL)
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    const rendererUrl = process.env['ELECTRON_RENDERER_URL']
    // dev cache can get weird and serve blank/nul html for localhost
    mainWindow.webContents.session.clearCache()
      .catch((e) => console.error('renderer cache clear failed:', e.message))
      .finally(() => {
        mainWindow.loadURL(rendererUrl).catch((e) => {
          console.error('renderer loadURL failed:', e.message)
        })
      })
  } else {
    mainWindow.loadFile(PATHS.html).catch((e) => {
      console.error('renderer loadFile failed:', e.message)
    })
  }
}

// This is the main entry point for the app.
app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.genie.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  const MODELS_DIR = join(app.getPath('userData'), 'models')
  const LANCEDB_URI = join(app.getPath('userData'), 'lancedb')
  const EMBEDDERS_DIR = join(app.getPath('userData'), 'embedders')
  const RERANKERS_DIR = join(app.getPath('userData'), 'rerankers')
  const REWRITER_DIR = join(app.getPath('userData'), 'rewriter')
  const DOCUMENTS_DIR = join(app.getPath('userData'), 'documents')
  const BG_IMAGES_DIR = join(app.getPath('userData'), 'backgrounds')
  const TEST_DOCUMENTS_DIR = join(__dirname, '../../resources/testdocuments')
  const ACCEPTED_DOC_EXTENSIONS = ['.txt', '.md', '.html', '.htm', '.pdf', '.docx', '.rtf']
  const BG_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp']
  const MAX_FOLDER_SIZE_BYTES = 15 * 1024 ** 3

  // bundled defaults. packaged uses process.resourcesPath/{models,embedders}.
  // dev uses app/resources/{defaultLLM,defaultembedder} first, then models/embedders if present.
  const resourcesRoot = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
  const pickExistingDir = (...candidates) => {
    for (const p of candidates) {
      if (p && fs.existsSync(p)) return p
    }
    return candidates[0]
  }
  const BUNDLED_MODELS_DIR = app.isPackaged
    ? join(resourcesRoot, 'models')
    : pickExistingDir(join(resourcesRoot, 'defaultLLM'), join(resourcesRoot, 'models'))
  const BUNDLED_EMBEDDERS_DIR = app.isPackaged
    ? join(resourcesRoot, 'embedders')
    : pickExistingDir(join(resourcesRoot, 'defaultembedder'), join(resourcesRoot, 'embedders'))
  const GENIE_EMBEDDERS_PATHS_JSON = JSON.stringify([EMBEDDERS_DIR, BUNDLED_EMBEDDERS_DIR])
  const BUNDLED_RERANKERS_DIR = app.isPackaged
    ? join(resourcesRoot, 'rerankers')
    : pickExistingDir(join(resourcesRoot, 'defaultreranker'), join(resourcesRoot, 'rerankers'))
  const GENIE_RERANKERS_PATHS_JSON = JSON.stringify([RERANKERS_DIR, BUNDLED_RERANKERS_DIR])

  function listGgufFiles(dir, source) {
    const out = []
    if (!dir || !fs.existsSync(dir)) return out
    try {
      for (const name of fs.readdirSync(dir)) {
        if (!name.toLowerCase().endsWith('.gguf')) continue
        const p = join(dir, name)
        let stat
        try {
          stat = fs.statSync(p)
        } catch (e) {
          continue
        }
        if (!stat.isFile()) continue
        out.push({ name, path: p, size: stat.size, createdAt: stat.mtime.toISOString(), source })
      }
    } catch (e) {
      console.error('listGgufFiles:', dir, e.message)
    }
    return out
  }

  function listEmbedderRoots(dir, source) {
    const out = []
    if (!dir || !fs.existsSync(dir)) return out
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const ent of entries) {
        if (!ent.isDirectory()) continue
        const p = join(dir, ent.name)
        let stat
        try {
          stat = fs.statSync(p)
        } catch (e) {
          continue
        }
        let size = 0
        const stack = [p]
        let fileCount = 0
        const maxFiles = 25000
        try {
          while (stack.length && fileCount < maxFiles) {
            const d = stack.pop()
            const inner = fs.readdirSync(d, { withFileTypes: true })
            for (const e of inner) {
              const fp = join(d, e.name)
              if (e.isFile()) {
                fileCount++
                try {
                  size += fs.statSync(fp).size
                } catch (_) {
                  /* unreadable file */
                }
              } else if (e.isDirectory()) stack.push(fp)
            }
          }
        } catch (_) {
          /* partial size */
        }
        out.push({ name: ent.name, path: p, size, createdAt: stat.mtime.toISOString(), source })
      }
    } catch (e) {
      console.error('listEmbedderRoots:', dir, e.message)
    }
    return out.sort((a, b) => a.name.localeCompare(b.name))
  }

  if (!fs.existsSync(MODELS_DIR)) fs.mkdirSync(MODELS_DIR, { recursive: true })
  if (!fs.existsSync(LANCEDB_URI)) fs.mkdirSync(LANCEDB_URI, { recursive: true })
  if (!fs.existsSync(EMBEDDERS_DIR)) fs.mkdirSync(EMBEDDERS_DIR, { recursive: true })
  if (!fs.existsSync(RERANKERS_DIR)) fs.mkdirSync(RERANKERS_DIR, { recursive: true })
  if (!fs.existsSync(REWRITER_DIR)) fs.mkdirSync(REWRITER_DIR, { recursive: true })
  if (!fs.existsSync(DOCUMENTS_DIR)) fs.mkdirSync(DOCUMENTS_DIR, { recursive: true })
  if (!fs.existsSync(BG_IMAGES_DIR)) fs.mkdirSync(BG_IMAGES_DIR, { recursive: true })

  const ensureRetrieveProcess = (reason = 'startup') => {
    console.log('[Genie/RAG] ensure retrieve process:', reason)
    startRetrieveProcess(LANCEDB_URI, () => console.log('Retrieve process ready'), {
      GENIE_EMBEDDERS_PATHS: GENIE_EMBEDDERS_PATHS_JSON,
      GENIE_RERANKERS_PATHS: GENIE_RERANKERS_PATHS_JSON
    })
  }

  // chat process on demand; retrieve process persistent from boot
  try {
    ensureRetrieveProcess('startup')
  } catch (e) {
    console.error('startRetrieveProcess:', e)
  }
  console.log("app.getPath('userData')", app.getPath('userData'))
  const defaultBgPath = join(BG_IMAGES_DIR, 'scificanyon.jpg')
  if (!fs.existsSync(defaultBgPath)) {
    const defaultBgSrc = join(__dirname, '../../resources/images/scificanyon.jpg')
    if (fs.existsSync(defaultBgSrc)) {
      try { fs.copyFileSync(defaultBgSrc, defaultBgPath) } catch (e) { console.error('seed default bg:', e.message) }
    }
  }

  // --- IPC Handlers (The App's API) ---
  // These are defined ONCE when the app is ready.

  ipcMain.on('genie-ipc-trace', (_e, payload) => {
    try {
      console.log('[Genie/IPC] preload→main invoke', JSON.stringify(payload))
    } catch (err) {
      console.log('[Genie/IPC] preload→main invoke', String(payload), err?.message)
    }
  })

  function logGenieJson(tag, obj, maxLen = 1_500_000) {
    try {
      const s = typeof obj === 'string' ? obj : JSON.stringify(obj)
      if (s.length <= maxLen) console.log(`[Genie/IPC] ${tag}`, s)
      else console.log(`[Genie/IPC] ${tag}`, s.slice(0, maxLen), `\n... [truncated, total ${s.length} chars]`)
    } catch (err) {
      console.log(`[Genie/IPC] ${tag}`, String(obj), err?.message)
    }
  }

  const PREFS_PATH = join(app.getPath('userData'), 'prefs.json')
  const defaultPrefs = () => ({ showBg: true, bgPath: 'scificanyon.jpg', theme: 'light' })
  ipcMain.handle('prefs-get', () => {
    try {
      const raw = fs.existsSync(PREFS_PATH) ? JSON.parse(fs.readFileSync(PREFS_PATH, 'utf8')) : defaultPrefs()
      const p = { ...defaultPrefs(), ...raw }
      if (raw.bgPath != null) p.bgPath = basename(raw.bgPath)
      if (typeof p.showBg !== 'boolean') p.showBg = !!p.bgPath
      p.bgFilename = p.bgPath || 'scificanyon.jpg'
      return p
    } catch (e) { console.error('prefs read:', e.message); return defaultPrefs() }
  })
  ipcMain.handle('background-image-data-url', (_, filename) => {
    if (!filename || typeof filename !== 'string') return null
    const name = basename(filename)
    if (name.includes('..')) return null
    const fullPath = join(BG_IMAGES_DIR, name)
    if (!fs.existsSync(fullPath)) return null
    const ext = name.toLowerCase().split('.').pop()
    const mime = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' }[ext] || 'application/octet-stream'
    try {
      const buf = fs.readFileSync(fullPath)
      return `data:${mime};base64,${buf.toString('base64')}`
    } catch (e) {
      console.error('bg image read:', e.message)
      return null
    }
  })
  ipcMain.handle('background-images-list', () => {
    try {
      const names = fs.readdirSync(BG_IMAGES_DIR)
      return names.filter((n) => BG_IMAGE_EXTENSIONS.some((ext) => n.toLowerCase().endsWith(ext)))
    } catch (e) { console.error('bg list:', e.message); return [] }
  })
  ipcMain.handle('dialog-choose-image', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const chosenPath = result.filePaths[0]
    const chosenDir = dirname(chosenPath)
    const chosenName = basename(chosenPath)
    let alreadyInFolder = false
    try {
      const bgDirResolved = join(fs.realpathSync(BG_IMAGES_DIR), '')
      const chosenDirResolved = join(fs.realpathSync(chosenDir), '')
      alreadyInFolder = chosenDirResolved === bgDirResolved
    } catch (e) { /* not in folder, will copy */ }
    if (alreadyInFolder) return chosenName
    const destPath = join(BG_IMAGES_DIR, chosenName)
    try {
      fs.copyFileSync(chosenPath, destPath)
      return chosenName
    } catch (e) {
      console.error('copy bg image:', e.message)
      return null
    }
  })

  ipcMain.handle('prefs-set', (_, key, val) => {
    try {
      const prefs = fs.existsSync(PREFS_PATH) ? JSON.parse(fs.readFileSync(PREFS_PATH, 'utf8')) : defaultPrefs()
      if (key === 'bgPath' && val && (isAbsolute(val) || val.startsWith('file:'))) prefs[key] = basename(val.replace(/^file:\/\//i, ''))
      else prefs[key] = val
      fs.writeFileSync(PREFS_PATH, JSON.stringify(prefs))
      return true
    } catch (e) { console.error('prefs write:', e.message); return false }
  })

  // Check if the database has been set up yet
  ipcMain.handle('db-is-setup', () => {
    return db.isSetup()
  })
  
  // first time setup - creates master key + empty manifest + userData dirs (including lancedb)
  // manifest.settings is a full copy of resources/default_settings.json (inference.file + modelDefaults = default LLM name matching bundled defaultLLM/)
  ipcMain.handle('db-setup', (event, password) => {
    const success = db.setup(password)
    if (success) {
      db.save('manifest', {
        user: {},
        settings: { ...defaultSettings },
        chats: [],
        corpora: []
      })
      if (!fs.existsSync(LANCEDB_URI)) fs.mkdirSync(LANCEDB_URI, { recursive: true })
      ensureRetrieveProcess('db-setup')
    }
    return success
  })

  // login - decrypt DEK with password
  ipcMain.handle('db-unlock', (event, password) => {
    if (!db.isSetup()) return false
    const ok = db.unlock(password)
    if (ok) ensureRetrieveProcess('db-unlock')
    return ok
  })

  function forwardChatReply(data) {
    try {
      console.log('[Genie/IPC] main→renderer chat-reply', JSON.stringify(data))
    } catch (e) {
      console.log('[Genie/IPC] main→renderer chat-reply', data, e?.message)
    }
    if (mainWindow) mainWindow.webContents.send('chat-reply', data)
  }

  // one JSON line to chat.py's stdin; same manifest inference as model-load ipc
  function sendChatModelLoadToPython() {
    let modelName = defaultSettings?.inference?.file || 'Meta-Llama-3.1-8B-Instruct-Q6_K.gguf'
    let ctxLength = defaultSettings?.inference?.contextLength ?? 50000
    if (!db.isLocked()) {
      try {
        const manifest = db.load('manifest')
        const inf = manifest?.settings?.inference
        if (inf?.file) modelName = inf.file
        if (inf?.contextLength != null) ctxLength = Number(inf.contextLength)
      } catch (e) {
        console.error('model-load manifest:', e.message)
      }
    }
    const modelsSearchDirs = [MODELS_DIR, BUNDLED_MODELS_DIR]
    console.log('Loading model:', modelName, 'ctx', ctxLength)
    sendToPython('load_model', {
      model_name: modelName,
      models_search_dirs: modelsSearchDirs,
      n_ctx: ctxLength,
      n_gpu_layers: -1
    })
  }

  // load llama model - called when user opens chat; start chat process on first use
  ipcMain.handle('model-load', async () => {
    try {
      if (!isChatProcessRunning()) {
        startPython(forwardChatReply)
      }
      sendChatModelLoadToPython()
    } catch (e) {
      console.error('model-load:', e)
    }
  })

  // free ram/vram when user leaves chat; stop chat process
  ipcMain.handle('model-unload', () => {
    console.log('Unloading model')
    sendToPython('unload_model', {})
    stopPython()
  })

  // send full message history to python for multi-turn chat
  ipcMain.handle('chat-send', (event, messages, config) => {
    const body = { messages, ...(config && typeof config === 'object' ? config : {}) }
    const locked = db.isLocked()
    let childUp = isChatProcessRunning()
    console.log('[Genie/IPC] chat-send handler', {
      locked,
      chatChildRunning: childUp,
      chatPid: childUp ? 'see [PY-CHAT] spawn log' : null,
      messageCount: Array.isArray(messages) ? messages.length : String(messages),
      configKeys: config && typeof config === 'object' ? Object.keys(config) : config,
    })
    if (locked) {
      console.warn('[Genie/IPC] chat-send SKIPPED — store still locked (sign in / unlock)')
      return null
    }
    if (!childUp) {
      console.warn(
        '[Genie/IPC] chat-send: chat.py missing — spawning + queue load_model then chat (same stdin order)',
      )
      startPython(forwardChatReply)
      sendChatModelLoadToPython()
      childUp = isChatProcessRunning()
      if (!childUp) {
        console.error('[Genie/IPC] chat-send: still no child after startPython (python_exe missing?)')
        return null
      }
    }
    logGenieJson('chat-send exact body JSON → python args', body)
    sendToPython('chat', body)
  })

  // RAG: retrieve snippets from a corpus table. tableName from manifest (chat.corpusId -> corpus.tableName)
  ipcMain.handle('retrieve-query', async (_, tableName, query, k = 5, options = {}) => {
    try {
      if (!tableName || !query) return { status: 'error', message: 'tableName and query required' }
      const method = options?.method || options?.searchMethod || undefined
      const embedder = options?.embedder || options?.embeddingModel || undefined
      const rerankerModel = options?.rerankerModel || options?.reranker || undefined
      const rerankerTopK = options?.rerankerTopK || options?.rerankTopK || undefined
      const vectorMetric = options?.vectorMetric || options?.vector_metric || undefined
      ensureRetrieveProcess('retrieve-query')
      console.log('[Genie/RAG] retrieve-query ipc → retrieve.py', {
        tableName,
        k,
        method,
        embedder,
        rerankerModel,
        rerankerTopK,
        vectorMetric,
        queryChars: typeof query === 'string' ? query.length : 0,
      })
      const result = await sendToRetrieve({
        command: 'retrieve',
        tableName,
        query,
        k,
        method,
        embedder,
        rerankerModel,
        rerankerTopK,
        vectorMetric,
      })
      console.log('[Genie/RAG] retrieve-query ←', result?.status, 'snippets=', result?.snippets?.length ?? 0, result?.message || '')
      return result
    } catch (e) {
      console.error('retrieve-query:', e)
      return { status: 'error', message: e?.message || 'Retrieve failed' }
    }
  })

  // Ingest: run ephemeral ingest for a corpus. Sets corpus status processing -> ready/error.
  ipcMain.handle('corpus-ingest', async (_, corpusId) => {
    try {
      if (db.isLocked()) return { status: 'error', message: 'Store locked' }
      let manifest = migrateManifestToCorpora(db.load('manifest'))
      if (!manifest) return { status: 'error', message: 'No manifest' }
      const corpus = (manifest.corpora || []).find((c) => c.id === corpusId)
      if (!corpus) return { status: 'error', message: 'Corpus not found' }
      const paths = (corpus.sources || []).map((s) => (typeof s === 'string' ? s : s.path)).filter(Boolean)
      if (!paths.length) return { status: 'error', message: 'No sources' }

      corpus.status = 'processing'
      db.save('manifest', manifest)

      const job = {
        sources: paths,
        tableName: corpus.tableName,
        settings: {
          chunkSize: corpus.settings?.chunkSize ?? 512,
          overlap: corpus.settings?.overlap ?? 50,
          embedder: corpus.settings?.embedder ?? 'all-MiniLM-L6-v2',
          method: corpus.settings?.method ?? manifest?.settings?.rag?.method ?? 'fixed_256_o10'
        }
      }

      const onProgress = (payload) => {
        if (mainWindow) mainWindow.webContents.send('ingest-progress', corpusId, payload)
      }

      const result = await runIngestJob(LANCEDB_URI, job, onProgress, {
        GENIE_EMBEDDERS_PATHS: GENIE_EMBEDDERS_PATHS_JSON
      })
      manifest = db.load('manifest')
      const c = manifest?.corpora?.find((x) => x.id === corpusId)
      if (c) {
        c.status = result.status === 'success' ? 'ready' : 'error'
        if (result.status === 'success' && result.approxTokens != null) {
          c.approxTokens = Number(result.approxTokens)
        }
        db.save('manifest', manifest)
      }
      return result
    } catch (e) {
      console.error('corpus-ingest:', e)
      return { status: 'error', message: e?.message || 'Ingest failed' }
    }
  })

  // rename chat title in manifest
  ipcMain.handle('chat-rename', (event, id, title) => {
    if (db.isLocked()) return null
    const manifest = db.load('manifest') || { chats: [] }
    const chat = manifest.chats?.find((c) => c.id === id)
    if (!chat) return manifest.chats || []
    chat.title = title
    chat.lastModified = new Date().toISOString()
    db.save('manifest', manifest)
    return manifest.chats
  })

  // delete chat from manifest and remove chat file
  ipcMain.handle('chat-delete', (event, id) => {
    if (db.isLocked()) return null
    const manifest = db.load('manifest') || { chats: [] }
    manifest.chats = (manifest.chats || []).filter((c) => c.id !== id)
    db.save('manifest', manifest)
    const chatPath = join(app.getPath('userData'), 'chats', `${id}.json.enc`)
    try {
      if (fs.existsSync(chatPath)) fs.unlinkSync(chatPath)
    } catch (e) {
      console.error('chat delete file failed:', e.message)
    }
    return manifest.chats
  })

  // create a new chat, add it to manifest, return { id, chats }
  ipcMain.handle('chat-create', () => {
    if (db.isLocked()) return null
    const id = Date.now().toString()
    db.save('chat', { id, messages: [] }, id)

    const manifest = migrateManifestToCorpora(db.load('manifest') || { chats: [], corpora: [] })
    manifest.chats = manifest.chats || []
    manifest.chats.push({ id, title: 'New Chat', corpusId: null, lastModified: new Date().toISOString() })
    db.save('manifest', manifest)
    return { id, chats: manifest.chats }
  })

  function safePdfBasename(title) {
    const base = String(title || 'chat').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'chat'
    return base.slice(0, 120)
  }

  ipcMain.handle('chat-export-pdf', async (event, chatId) => {
    if (db.isLocked()) return { ok: false, error: 'locked' }
    if (!chatId || typeof chatId !== 'string') return { ok: false, error: 'no chat' }
    const manifest = db.load('manifest') || { chats: [] }
    const meta = manifest.chats?.find((c) => c.id === chatId)
    const data = db.load('chat', chatId)
    if (!data?.messages?.length) return { ok: false, error: 'empty' }
    const defaultName = `${safePdfBasename(meta?.title)}.pdf`
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Export chat as PDF',
      defaultPath: defaultName,
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (canceled || !filePath) return { ok: false, error: 'canceled' }
    try {
      await exportChatPdf(
        { title: meta?.title || 'Chat', messages: data.messages },
        filePath
      )
      return { ok: true, path: filePath }
    } catch (e) {
      console.error('chat-export-pdf:', e)
      return { ok: false, error: e?.message || 'export failed' }
    }
  })

  // file picker for documents - returns [{ path, name, size }], size in bytes
  ipcMain.handle('dialog-open-files', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      defaultPath: fs.existsSync(TEST_DOCUMENTS_DIR) ? TEST_DOCUMENTS_DIR : DOCUMENTS_DIR,
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Documents', extensions: ACCEPTED_DOC_EXTENSIONS.map(ext => ext.slice(1)) }]
    })
    if (result.canceled) return []
    const files = []
    for (const p of result.filePaths) {
      try {
        const stat = fs.statSync(p)
        files.push({ path: p, name: basename(p), size: stat.size })
      } catch (e) {
        console.error('stat failed for', p, e.message)
      }
    }
    return files
  })

  ipcMain.handle('dialog-open-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      defaultPath: fs.existsSync(TEST_DOCUMENTS_DIR) ? TEST_DOCUMENTS_DIR : DOCUMENTS_DIR,
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  // recursive scan folder for accepted doc types; early exit if over max size
  ipcMain.handle('documents-scan-folder', (_, folderPath) => {
    if (!folderPath || typeof folderPath !== 'string') {
      return { ok: false, error: 'No folder path' }
    }
    let totalSize = 0
    let fileCount = 0
    try {
      function walk(dir) {
        const entries = fs.readdirSync(dir, { withFileTypes: true })
        for (const ent of entries) {
          const full = join(dir, ent.name)
          if (ent.isDirectory()) {
            walk(full)
            if (totalSize > MAX_FOLDER_SIZE_BYTES) return
          } else if (ent.isFile()) {
            const ext = (ent.name.indexOf('.') >= 0 ? '.' + ent.name.split('.').pop() : '').toLowerCase()
            if (ACCEPTED_DOC_EXTENSIONS.includes(ext)) {
              try {
                const stat = fs.statSync(full)
                if (stat.size > 0) {
                  totalSize += stat.size
                  fileCount += 1
                  if (totalSize > MAX_FOLDER_SIZE_BYTES) return
                }
              } catch (e) { /* skip unreadable */ }
            }
          }
        }
      }
      walk(folderPath)
      if (totalSize > MAX_FOLDER_SIZE_BYTES) {
        return { ok: false, error: 'Folder exceeds 15 GB limit' }
      }
      return { ok: true, totalSize, fileCount }
    } catch (e) {
      return { ok: false, error: e.message || 'Scan failed' }
    }
  })

  ipcMain.handle('models-get-path', () => MODELS_DIR)
  ipcMain.handle('models-get-embedders-path', () => EMBEDDERS_DIR)
  ipcMain.handle('models-get-paths-detail', () => ({
    userModels: MODELS_DIR,
    bundledModels: BUNDLED_MODELS_DIR,
    userEmbedders: EMBEDDERS_DIR,
    bundledEmbedders: BUNDLED_EMBEDDERS_DIR
  }))

  function getModelDefaultsPayload() {
    const m = defaultSettings?.modelDefaults || {}
    return {
      llm_repo: m.llmHfRepo || 'bartowski/Meta-Llama-3.1-8B-Instruct-GGUF',
      llm_file: m.llmFilename || 'Meta-Llama-3.1-8B-Instruct-Q6_K.gguf',
      embedder_repo: m.embedderHfRepo || 'sentence-transformers/all-MiniLM-L6-v2',
      embedder_folder: m.embedderFolderName || 'all-MiniLM-L6-v2'
    }
  }

  // skip HF llm download if a Meta-Llama-3.1-ish Q6_K gguf is already present (Q6_K or Q6_K_M filename)
  function hasQ6KMetaLlamaGguf() {
    for (const dir of [MODELS_DIR, BUNDLED_MODELS_DIR]) {
      for (const f of listGgufFiles(dir, 'scan')) {
        const n = f.name.toLowerCase()
        if (!n.includes('q6_k')) continue
        if (n.includes('llama') || n.includes('meta') || n.includes('8b')) return true
      }
    }
    return false
  }

  function hasNonemptyMiniLmFolder(folderCanon) {
    const want = String(folderCanon || 'all-MiniLM-L6-v2').toLowerCase()
    for (const base of [EMBEDDERS_DIR, BUNDLED_EMBEDDERS_DIR]) {
      if (!fs.existsSync(base)) continue
      let names
      try {
        names = fs.readdirSync(base)
      } catch (_) {
        continue
      }
      for (const name of names) {
        if (name.toLowerCase() !== want) continue
        const p = join(base, name)
        try {
          if (!fs.statSync(p).isDirectory()) continue
          if (fs.readdirSync(p).length > 0) return true
        } catch (_) {
          /* skip */
        }
      }
    }
    return false
  }

  function sendModelsDownloadProgress(payload) {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('models-download-progress', payload)
      }
    } catch (e) {
      console.error('sendModelsDownloadProgress', e.message)
    }
  }

  ipcMain.handle('models-download-defaults', async () => {
    const defs = getModelDefaultsPayload()
    const skipLlm = hasQ6KMetaLlamaGguf()
    const skipEmb = hasNonemptyMiniLmFolder(defs.embedder_folder)
    if (skipLlm && skipEmb) {
      return {
        ok: true,
        skipped: true,
        message: 'Meta Llama-style Q6_K GGUF and MiniLM embedder folder already present (user data, bundled defaultLLM, or defaultembedder).'
      }
    }
    sendModelsDownloadProgress({
      active: true,
      percent: 0,
      phase: 'start',
      message: 'Starting…'
    })
    const pyPayload = {
      models_dir: MODELS_DIR,
      embedders_dir: EMBEDDERS_DIR,
      skip_llm: skipLlm,
      skip_embedder: skipEmb,
      ...defs
    }
    const result = await runDownloadDefaults(pyPayload, (j) => {
      sendModelsDownloadProgress({
        active: true,
        percent: typeof j.percent === 'number' ? j.percent : 0,
        phase: j.phase || '',
        message: j.message || ''
      })
    })
    sendModelsDownloadProgress({ active: false, percent: 100, phase: '', message: '' })
    if (result.ok) {
      return {
        ok: true,
        skipped: false,
        message: 'Download finished.',
        downloaded: { llm: !skipLlm, embedder: !skipEmb }
      }
    }
    return { ok: false, message: result.error || 'Download failed' }
  })

  ipcMain.handle('models-add-gguf', async () => {
    const win = BrowserWindow.getFocusedWindow() || mainWindow
    const r = await dialog.showOpenDialog(win, {
      title: 'Add GGUF model',
      properties: ['openFile'],
      filters: [{ name: 'GGUF', extensions: ['gguf'] }]
    })
    if (r.canceled || !r.filePaths?.length) {
      return { ok: false, canceled: true }
    }
    const src = r.filePaths[0]
    const fname = basename(src)
    const dest = join(MODELS_DIR, fname)
    if (fs.existsSync(dest)) {
      return { ok: false, message: `Already in models folder: ${fname}` }
    }
    try {
      await fs.promises.copyFile(src, dest)
      return { ok: true, path: dest, name: fname }
    } catch (e) {
      return { ok: false, message: e.message || 'Copy failed' }
    }
  })
  ipcMain.handle('models-list-local', () => {
    try {
      const u = listGgufFiles(MODELS_DIR, 'user')
      const b = listGgufFiles(BUNDLED_MODELS_DIR, 'app')
      return [...u, ...b].sort((a, b) => a.name.localeCompare(b.name))
    } catch (e) {
      console.error('models-list-local:', e.message)
      return []
    }
  })
  ipcMain.handle('models-list-embedders', () => {
    try {
      const u = listEmbedderRoots(EMBEDDERS_DIR, 'user')
      const b = listEmbedderRoots(BUNDLED_EMBEDDERS_DIR, 'app')
      return [...u, ...b].sort((a, b) => a.name.localeCompare(b.name))
    } catch (e) {
      console.error('models-list-embedders:', e.message)
      return []
    }
  })
  ipcMain.handle('models-get-rerankers-path', () => RERANKERS_DIR)
  ipcMain.handle('models-get-rewriter-path', () => REWRITER_DIR)
  ipcMain.handle('documents-get-path', () => DOCUMENTS_DIR)
  ipcMain.handle('models-list-rerankers', () => {
    try {
      const u = listEmbedderRoots(RERANKERS_DIR, 'user')
      const b = listEmbedderRoots(BUNDLED_RERANKERS_DIR, 'app')
      return [...u, ...b].sort((a, b) => a.name.localeCompare(b.name))
    } catch (e) {
      console.error('models-list-rerankers:', e.message)
      return []
    }
  })
  ipcMain.handle('models-list-rewriter', () => {
    try {
      const names = fs.readdirSync(REWRITER_DIR)
      const files = []
      for (const name of names) {
        const p = join(REWRITER_DIR, name)
        const stat = fs.statSync(p)
        if (stat.isFile()) files.push({ name, path: p, size: stat.size, createdAt: stat.mtime.toISOString() })
      }
      return files
    } catch (e) {
      console.error('models-list-rewriter:', e.message)
      return []
    }
  })

  // migrate legacy documents/folders to corpora once
  function migrateManifestToCorpora(manifest) {
    if (!manifest) return manifest
    const hasLegacy = (manifest.documents && manifest.documents.length > 0) ||
      (manifest.folders && manifest.folders.length > 0)
    if (!hasLegacy) return manifest
    const corpora = manifest.corpora || []
    for (const doc of manifest.documents || []) {
      corpora.push({
        id: doc.id,
        name: doc.name || 'Document',
        tableName: `table_${doc.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
        status: doc.status === 'completed' ? 'ready' : (doc.status || 'pending'),
        totalSizeBytes: doc.size || 0,
        settings: {
          chunkSize: doc.chunking?.chunkSize ?? 512,
          overlap: doc.chunking?.overlap ?? 50,
          embedder: doc.embedder || 'all-MiniLM-L6-v2'
        },
        sources: [{ type: 'file', path: doc.path, fileCount: 1, scannedAt: new Date().toISOString() }]
      })
    }
    for (const folder of manifest.folders || []) {
      corpora.push({
        id: folder.id,
        name: folder.name || 'Folder',
        tableName: `table_${folder.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
        status: folder.status === 'completed' ? 'ready' : (folder.status || 'pending'),
        totalSizeBytes: folder.totalSize || 0,
        settings: {
          chunkSize: 512,
          overlap: 50,
          embedder: 'all-MiniLM-L6-v2'
        },
        sources: [{
          type: 'folder',
          path: folder.path,
          fileCount: folder.fileCount || 0,
          scannedAt: folder.scannedAt || new Date().toISOString()
        }]
      })
    }
    manifest.corpora = corpora
    delete manifest.documents
    delete manifest.folders
    db.save('manifest', manifest)
    return manifest
  }

  ipcMain.handle('db-load', (event, type, id) => {
    if (db.isLocked()) return null
    const data = db.load(type, id)
    if (type === 'manifest' && data) return migrateManifestToCorpora(data)
    return data
  })
  
  // Save manifest or a specific chat
  ipcMain.handle('db-save', (event, type, data, id) => {
    if (db.isLocked()) return null // Security check
    return db.save(type, data, id)
  })


  // re-encrypt DEK with new password, verify old one first
  ipcMain.handle('change-password', (event, oldPw, newPw) => {
    return db.changePassword(oldPw, newPw)
  })

  // verify pw then wipe everything
  ipcMain.handle('delete-account', (event, password) => {
    if (!db.unlock(password)) return false
    stopPython()
    stopRetrieveProcess()
    db.deleteAll()
    return true
  })

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  stopPython()
  stopRetrieveProcess()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})