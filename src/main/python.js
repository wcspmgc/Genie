import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs'
import { app } from 'electron'

const DEBUG = true

const basePath = app.isPackaged ? process.resourcesPath : app.getAppPath()
const pythonScriptsDir = path.join(basePath, 'python_scripts')

const isWin = process.platform === 'win32'
const pythonEnvExeName = isWin ? 'python.exe' : 'python'

/** Only bundled venv — never system python (deps e.g. lancedb live in python_env only). */
function resolveBundledPythonExe() {
  const candidates = [
    path.join(basePath, 'python_env', pythonEnvExeName),
    path.join(basePath, '..', 'python_env', pythonEnvExeName),
  ]
  for (const c of candidates) {
    if (fs.existsSync(c)) return path.resolve(c)
  }
  return null
}

// chat process only (spawned on demand when user opens Chat)
let chatProcess = null

function canWriteToChild(child) {
  return Boolean(child && child.stdin && !child.stdin.destroyed && !child.stdin.writableEnded)
}

function safeWriteToChild(child, payload, tag = 'child') {
  if (!canWriteToChild(child)) {
    if (DEBUG) console.warn(`[${tag}] skip write: stdin not writable`)
    return false
  }
  try {
    child.stdin.write(payload + '\n', (err) => {
      if (err) console.error(`[${tag}] stdin write failed:`, err.message)
    })
    return true
  } catch (e) {
    console.error(`[${tag}] stdin write threw:`, e.message)
    return false
  }
}

function getPythonAndScript(scriptName) {
  const exe = getPythonExecutable()
  const scriptPath = path.join(pythonScriptsDir, scriptName)
  return { exe, scriptPath }
}

export function startChatProcess(onData) {
  if (chatProcess) return

  const { exe, scriptPath } = getPythonAndScript('chat.py')
  if (!exe) {
    console.error('[PY-CHAT] refuse spawn: no bundled python_env exe (see resolveBundledPythonExe)')
    return
  }
  console.log('[PY-CHAT] spawn chat.py script:', scriptPath, 'exe:', exe)
  chatProcess = spawn(exe, ['-u', scriptPath], { stdio: ['pipe', 'pipe', 'pipe'] })

  chatProcess.on('spawn', () => {
    console.log('[PY-CHAT] spawn event pid=', chatProcess.pid, 'killed=', chatProcess.killed)
  })
  chatProcess.on('error', (err) => {
    console.error('[PY-CHAT] child process error:', err)
  })
  chatProcess.on('exit', (code, signal) => {
    console.log('[PY-CHAT] exit event code=', code, 'signal=', signal)
  })

  let buffer = ''

  chatProcess.stdout.on('data', (data) => {
    if (DEBUG) console.log('[PY-CHAT-OUT]', data.toString().trimEnd())
    buffer += data.toString()
    const lines = buffer.split('\n')
    buffer = lines.pop()
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const json = JSON.parse(line.trim())
        if (DEBUG) console.log('[PY-CHAT]', json)
        if (onData) onData(json)
      } catch (e) {
        console.error('Parse error on line:', line, e)
      }
    }
  })

  chatProcess.stderr.on('data', (d) => {
    const t = d.toString()
    // always forward — llama.cpp + [Genie/chat] diagnostics; DEBUG only gates stdout json noise
    console.error('[PY-CHAT-STDERR]', t.trimEnd())
  })
  chatProcess.stdin.on('error', (e) => {
    console.error('[PY-CHAT-STDIN-ERR]', e.message)
  })

  chatProcess.on('close', (code, signal) => {
    console.log('[PY-CHAT-CLOSE] code=', code, 'signal=', signal, '(stdin line-read loop in chat.py ends if stdin closes)')
    chatProcess = null
  })
}

export function stopChatProcess() {
  if (chatProcess) {
    chatProcess.kill()
    chatProcess = null
  }
}

export function sendToChatProcess(command, args = {}) {
  const payload = JSON.stringify({ command, args })
  if (!chatProcess) {
    console.error(
      '[PY-CHAT-CMD] NO CHILD — chat.py not running (open Chat / model-load first?). command=',
      command,
      'payload.length=',
      payload.length,
    )
    console.error('[PY-CHAT-CMD] payload head:', payload.slice(0, 12_000))
    return
  }
  console.log('[PY-CHAT-CMD] utf8Bytes=', Buffer.byteLength(payload, 'utf8'), 'chars=', payload.length)
  console.log('[PY-CHAT-CMD]', payload)
  const ok = safeWriteToChild(chatProcess, payload, 'PY-CHAT')
  if (!ok) console.error('[PY-CHAT-CMD] stdin write refused or failed')
}

export function isChatProcessRunning() {
  return chatProcess != null
}

// legacy names for main.js (it imports startPython, stopPython, sendToPython)
export function startPython(onData) {
  startChatProcess(onData)
}

export function stopPython() {
  stopChatProcess()
}

export function sendToPython(command, args = {}) {
  sendToChatProcess(command, args)
}

// helpers for retrieve/ingest: resolve paths to scripts and python exe
export function getRetrieveScriptPath() {
  return path.join(pythonScriptsDir, 'retrieve.py')
}

export function getIngestScriptPath() {
  return path.join(pythonScriptsDir, 'ingest.py')
}

export function getPythonExecutable() {
  const resolved = resolveBundledPythonExe()
  if (!resolved) {
    console.error(
      '[python] bundled interpreter not found; install deps into python_env. Tried:',
      path.resolve(path.join(basePath, 'python_env', pythonEnvExeName)),
      path.resolve(path.join(basePath, '..', 'python_env', pythonEnvExeName))
    )
  }
  return resolved
}

// --- Retrieve process (persistent, spawned on boot) ---
let retrieveProcess = null
let retrieveBuffer = ''
let retrieveSeq = 0
const retrievePending = new Map()

export function startRetrieveProcess(lancedbUri, onReady, envExtra = {}) {
  if (retrieveProcess) return

  const exe = getPythonExecutable()
  if (!exe) {
    console.error('[retrieve] missing python_env; retrieve.py will not start')
    return
  }
  const scriptPath = path.join(pythonScriptsDir, 'retrieve.py')
  const env = { ...process.env, LANCEDB_URI: lancedbUri, ...envExtra }
  console.log('Starting retrieve Python exe:', exe)
  console.log('Starting retrieve script:', scriptPath)
  retrieveBuffer = ''
  const child = spawn(exe, ['-u', scriptPath], { env, stdio: ['pipe', 'pipe', 'pipe'] })
  retrieveProcess = child

  child.stdout.on('data', (data) => {
    retrieveBuffer += data.toString()
    const lines = retrieveBuffer.split('\n')
    retrieveBuffer = lines.pop()
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const json = JSON.parse(line.trim())
        if (json.status === 'ready' && onReady) onReady()
        const requestId = json?.requestId
        if (requestId && retrievePending.has(requestId)) {
          const resolve = retrievePending.get(requestId)
          retrievePending.delete(requestId)
          resolve(json)
        }
      } catch (e) {
        console.error('[retrieve] parse error:', line, e)
      }
    }
  })

  child.stderr.on('data', (d) => {
    console.log('[retrieve stderr]', d.toString().trimEnd())
  })
  child.stdin.on('error', (e) => {
    console.error('[retrieve stdin]', e.message)
  })

  child.on('close', (code) => {
    console.log('[retrieve exit] code:', code)
    if (retrieveProcess === child) {
      retrieveProcess = null
      for (const resolve of retrievePending.values()) {
        resolve({ status: 'error', message: 'Process exited' })
      }
      retrievePending.clear()
    }
  })
}

export function stopRetrieveProcess() {
  if (retrieveProcess) {
    retrieveProcess.kill()
    retrieveProcess = null
  }
}

export function sendToRetrieve(payload) {
  return new Promise((resolve) => {
    if (!retrieveProcess) {
      resolve({ status: 'error', message: 'Retrieve process not running' })
      return
    }
    if (!canWriteToChild(retrieveProcess)) {
      resolve({ status: 'error', message: 'Retrieve process not writable' })
      return
    }
    const requestId = `retrieve-${Date.now()}-${++retrieveSeq}`
    retrievePending.set(requestId, resolve)
    console.log('[retrieve] write stdin', {
      requestId,
      command: payload.command,
      tableName: payload.tableName,
      k: payload.k,
      method: payload.method,
      embedder: payload.embedder,
      vectorMetric: payload.vectorMetric,
      queryChars: typeof payload.query === 'string' ? payload.query.length : 0,
    })
    const ok = safeWriteToChild(retrieveProcess, JSON.stringify({ ...payload, requestId }), 'retrieve')
    if (!ok) {
      retrievePending.delete(requestId)
      resolve({ status: 'error', message: 'Retrieve write failed' })
    }
  })
}

// --- Ingest process (ephemeral, spawn per job) ---
export function runIngestJob(lancedbUri, job, onProgress, envExtra = {}) {
  return new Promise((resolve) => {
    let resolved = false
    const done = (result) => {
      if (resolved) return
      resolved = true
      resolve(result)
    }

    const exe = getPythonExecutable()
    if (!exe) {
      done({ status: 'error', message: 'Bundled python_env not found; cannot run ingest' })
      return
    }
    const scriptPath = path.join(pythonScriptsDir, 'ingest.py')
    const env = { ...process.env, LANCEDB_URI: lancedbUri, ...envExtra }
    const child = spawn(exe, ['-u', scriptPath], { env, stdio: ['pipe', 'pipe', 'pipe'] })

    let stdout = ''
    child.stdout.on('data', (data) => {
      stdout += data.toString()
      const lines = stdout.split('\n')
      stdout = lines.pop()
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const json = JSON.parse(line.trim())
          if (onProgress && json.status === 'progress') onProgress(json)
          if (json.status === 'success' || json.status === 'error') done(json)
        } catch (e) {
          console.error('[ingest] parse:', line, e)
        }
      }
    })

    child.stderr.on('data', (d) => console.log('[ingest stderr]', d.toString().trimEnd()))

    child.on('close', (code) => {
      if (!resolved) done({ status: 'error', message: `Process exited with code ${code}` })
    })

    child.stdin.write(JSON.stringify(job) + '\n')
    child.stdin.end()
  })
}

/** HF downloads for Models page; stdin json matches download_defaults.py */
export function runDownloadDefaults(payload, onProgress) {
  return new Promise((resolve) => {
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      resolve(result)
    }

    const exe = getPythonExecutable()
    const scriptPath = path.join(pythonScriptsDir, 'download_defaults.py')
    if (!fs.existsSync(scriptPath)) {
      finish({ type: 'done', ok: false, error: 'download_defaults.py not found' })
      return
    }
    if (!exe) {
      finish({ type: 'done', ok: false, error: 'Bundled python_env not found' })
      return
    }

    const child = spawn(exe, ['-u', scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env }
    })

    let buf = ''
    child.stdout.on('data', (data) => {
      buf += data.toString()
      const lines = buf.split('\n')
      buf = lines.pop() || ''
      for (const line of lines) {
        const t = line.trim()
        if (!t) continue
        try {
          const j = JSON.parse(t)
          if (j.type === 'progress' && onProgress) onProgress(j)
          if (j.type === 'done') finish(j)
        } catch (e) {
          console.error('[download_defaults] bad line:', t, e)
        }
      }
    })

    child.stderr.on('data', (d) => {
      console.log('[download_defaults stderr]', d.toString().trimEnd())
    })
    child.on('error', (err) => {
      finish({ type: 'done', ok: false, error: err.message })
    })
    child.on('close', (code) => {
      if (!settled) {
        finish({ type: 'done', ok: false, error: `python exited ${code}` })
      }
    })

    try {
      child.stdin.write(JSON.stringify(payload), 'utf8')
      child.stdin.end()
    } catch (e) {
      finish({ type: 'done', ok: false, error: e.message })
    }
  })
}
