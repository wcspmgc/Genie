import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import Box from '@mui/material/Box'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import CircularProgress from '@mui/material/CircularProgress'
import FormControl from '@mui/material/FormControl'
import InputLabel from '@mui/material/InputLabel'
import Select from '@mui/material/Select'
import MenuItem from '@mui/material/MenuItem'
import Checkbox from '@mui/material/Checkbox'
import FormControlLabel from '@mui/material/FormControlLabel'
import Edit from '@mui/icons-material/Edit'
import Delete from '@mui/icons-material/Delete'
import Check from '@mui/icons-material/Check'
import Close from '@mui/icons-material/Close'
import Send from '@mui/icons-material/Send'
import ContentCopy from '@mui/icons-material/ContentCopy'
import ExpandMore from '@mui/icons-material/ExpandMore'
import ExpandLess from '@mui/icons-material/ExpandLess'
import DownloadIcon from '@mui/icons-material/Download'
import Tooltip from '@mui/material/Tooltip'
import Snackbar from '@mui/material/Snackbar'
import Alert from '@mui/material/Alert'
import InputAdornment from '@mui/material/InputAdornment'
import fadedLogo from '../../../../resources/images/logo748faded.png'

const LS_LAST_CORPUS = 'genie-last-corpus-id'
const LS_USE_RAG = 'genie-use-rag'
const APPROX_CHARS_PER_TOKEN = 4
const MESSAGE_TOKEN_OVERHEAD = 12
const CONTEXT_SAFETY_MARGIN_TOKENS = 1024
const RAG_CONTEXT_MAX_TOKENS = 2400
const RAG_SNIPPET_MAX_TOKENS = 900

// same width for corpus bar, transcript, composer — keeps bubbles from stretching full window
const CHAT_COLUMN_SX = { width: '80%', minWidth: 280, alignSelf: 'center', boxSizing: 'border-box' }

function formatRetrievalMethod(method) {
  const m = String(method || '').trim().toLowerCase()
  if (m === 'bm25' || m === 'fts') return 'keyword (BM25)'
  if (m === 'hybrid') return 'hybrid'
  return 'semantic'
}

function escapeRegex(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function renderMessageHighlights(text, query, isUser) {
  const s = String(text || '')
  const needle = String(query || '').trim()
  if (!s || !needle) return s

  const pattern = new RegExp(`(${escapeRegex(needle)})`, 'gi')
  const out = []
  let lastIndex = 0
  let match

  while ((match = pattern.exec(s)) !== null) {
    const start = match.index
    const end = pattern.lastIndex
    if (start > lastIndex) out.push(s.slice(lastIndex, start))
    out.push(
      <Box
        key={`${start}-${match[0]}`}
        component="mark"
        sx={{
          px: 0.15,
          borderRadius: 0.5,
          bgcolor: isUser ? 'warning.dark' : 'warning.light',
          color: isUser ? 'common.white' : 'text.primary',
        }}
      >
        {match[0]}
      </Box>
    )
    lastIndex = end
  }

  if (lastIndex < s.length) out.push(s.slice(lastIndex))
  return out.length ? out : s
}

function renderInlineMarkdown(text, query, isUser) {
  const s = String(text || '')
  if (!s) return ''

  const out = []
  let pos = 0
  let key = 0

  while (pos < s.length) {
    const boldOpen = s.indexOf('**', pos)
    let italicOpen = s.indexOf('*', pos)
    while (italicOpen !== -1 && (s[italicOpen + 1] === '*' || /\s/.test(s[italicOpen + 1] || ''))) {
      italicOpen = s.indexOf('*', italicOpen + 1)
    }

    const useBold = boldOpen !== -1 && (italicOpen === -1 || boldOpen <= italicOpen)
    const open = useBold ? boldOpen : italicOpen

    if (open === -1) {
      out.push(renderMessageHighlights(s.slice(pos), query, isUser))
      break
    }

    const marker = useBold ? '**' : '*'
    const start = open + marker.length
    let close = s.indexOf(marker, start)
    while (!useBold && close !== -1 && /\s/.test(s[close - 1] || '')) {
      close = s.indexOf(marker, close + 1)
    }

    if (close === -1) {
      out.push(renderMessageHighlights(s.slice(pos), query, isUser))
      break
    }

    if (open > pos) out.push(renderMessageHighlights(s.slice(pos, open), query, isUser))
    const markedText = s.slice(start, close)
    if (markedText) {
      out.push(
        <Box
          key={`${useBold ? 'bold' : 'italic'}-${key}`}
          component={useBold ? 'strong' : 'em'}
          sx={useBold ? { fontWeight: 700 } : { fontStyle: 'italic' }}
        >
          {renderMessageHighlights(markedText, query, isUser)}
        </Box>
      )
      key += 1
    }
    pos = close + marker.length
  }

  return out.length ? out : s
}

function renderMessageMarkdown(text, query, isUser) {
  const lines = String(text || '').split('\n')
  const blocks = []
  let paragraph = []
  let i = 0

  const flushParagraph = () => {
    if (!paragraph.length) return
    const content = paragraph.join('\n')
    blocks.push(
      <Box key={`p-${blocks.length}`} component="span" sx={{ display: 'block', whiteSpace: 'pre-wrap' }}>
        {renderInlineMarkdown(content, query, isUser)}
      </Box>
    )
    paragraph = []
  }

  while (i < lines.length) {
    const bullet = lines[i].match(/^\s*\*\s+(.+)$/)
    if (!bullet) {
      paragraph.push(lines[i])
      i += 1
      continue
    }

    flushParagraph()
    const items = []
    while (i < lines.length) {
      const item = lines[i].match(/^\s*\*\s+(.+)$/)
      const subitem = lines[i].match(/^\s+\+\s+(.+)$/)
      if (subitem && items.length) {
        items[items.length - 1].children.push(subitem[1])
        i += 1
        continue
      }
      if (!item) break
      items.push({ text: item[1], children: [] })
      i += 1
    }

    blocks.push(
      <Box key={`ul-${blocks.length}`} component="ul" sx={{ my: 0, pl: 2.5 }}>
        {items.map((item, idx) => (
          <Box key={`${idx}-${item.text}`} component="li">
            {renderInlineMarkdown(item.text, query, isUser)}
            {item.children.length ? (
              <Box component="ul" sx={{ my: 0, pl: 2.5 }}>
                {item.children.map((child, childIdx) => (
                  <Box key={`${childIdx}-${child}`} component="li">
                    {renderInlineMarkdown(child, query, isUser)}
                  </Box>
                ))}
              </Box>
            ) : null}
          </Box>
        ))}
      </Box>
    )
  }

  flushParagraph()
  return blocks.length ? blocks : ''
}

function estimateTokens(text) {
  const s = String(text || '')
  return Math.ceil(s.length / APPROX_CHARS_PER_TOKEN)
}

function estimateMessageTokens(msg) {
  return MESSAGE_TOKEN_OVERHEAD + estimateTokens(msg?.content || '')
}

function trimTextToApproxTokens(text, maxTokens) {
  const s = String(text || '').trim()
  const limit = Math.max(1, Number(maxTokens || 0) || 0) * APPROX_CHARS_PER_TOKEN
  if (!s || s.length <= limit) return s
  return `${s.slice(0, Math.max(0, limit - 3)).trim()}...`
}

function buildRetrievedContext(snippets, {
  maxTotalTokens = RAG_CONTEXT_MAX_TOKENS,
  maxSnippetTokens = RAG_SNIPPET_MAX_TOKENS,
} = {}) {
  const picked = []
  let used = 0
  let trimmed = false

  for (let i = 0; i < (snippets || []).length; i += 1) {
    const remaining = maxTotalTokens - used
    if (remaining <= 0) {
      trimmed = true
      break
    }

    const rawText = String(snippets[i]?.text || '').trim()
    if (!rawText) continue

    const allowed = Math.max(1, Math.min(maxSnippetTokens, remaining))
    const clipped = trimTextToApproxTokens(rawText, allowed)
    const line = `[#${i + 1}] ${clipped}`.trim()
    const cost = estimateTokens(line)
    if (!line) continue

    picked.push(line)
    used += cost
    if (clipped.length < rawText.length) trimmed = true
  }

  return {
    context: picked.join('\n\n'),
    estimatedTokens: used,
    trimmed,
  }
}

function buildSlidingHistory(messages, { contextLength, maxTokens, systemPrompt }) {
  const ctx = Math.max(2048, Number(contextLength || 0) || 0)
  const outputReserve = Math.max(256, Number(maxTokens || 0) || 0)
  const systemReserve = estimateTokens(systemPrompt) + MESSAGE_TOKEN_OVERHEAD
  const usableBudget = Math.max(
    256,
    ctx - outputReserve - systemReserve - CONTEXT_SAFETY_MARGIN_TOKENS
  )

  const picked = []
  let used = 0

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i]
    const cost = estimateMessageTokens(msg)
    const isNewest = i === messages.length - 1
    if (!isNewest && used + cost > usableBudget) break
    picked.push(msg)
    used += cost
  }

  picked.reverse()

  return {
    messages: picked,
    trimmedCount: Math.max(0, messages.length - picked.length),
    estimatedHistoryTokens: used,
    estimatedBudgetTokens: usableBudget,
  }
}

function BottomBar({ input, setInput, onSend, isModelReady, isStreaming }) {
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend() }
  }
  return (
    <Box sx={{ flexShrink: 0, minHeight: 52, display: 'flex', gap: 1, px: 2, py: 1.5, borderTop: 1, borderColor: 'divider', ...CHAT_COLUMN_SX }}>
      <TextField
        fullWidth
        size="small"
        multiline
        rows={1}
        maxRows={4}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={isModelReady ? 'model loaded - type a message...' : 'model loading...'}
        disabled={isStreaming}
        sx={{ flex: 1, minWidth: 0 }}
      />
      <Button
        variant="contained"
        size="medium"
        onClick={onSend}
        disabled={!isModelReady || isStreaming}
        startIcon={isStreaming ? <CircularProgress size={20} color="inherit" /> : <Send />}
        sx={{ flexShrink: 0, minWidth: 100 }}
        aria-label="Send message"
      >
        {isStreaming ? 'Generating' : 'Send'}
      </Button>
    </Box>
  )
}

async function persistChatCorpusId(chatId, corpusId) {
  if (!chatId) return
  const manifest = await window.api.load('manifest')
  const chat = manifest?.chats?.find((c) => c.id === chatId)
  if (!chat) return
  chat.corpusId = corpusId || null
  chat.lastModified = new Date().toISOString()
  await window.api.save('manifest', manifest)
}

export default function ChatPage({ currentChatId, onChatCreated }) {
  // --- state ---
  const [messages, setMessages] = useState([])           // chat messages (user + assistant)
  const [input, setInput] = useState('')                  // current input field value
  const [isStreaming, setIsStreaming] = useState(false)  // true while llm is generating
  const [isModelReady, setIsModelReady] = useState(false) // true when model loaded
  const [editingMessage, setEditingMessage] = useState(null) // { id, content } when editing, else null
  const [streamingThought, setStreamingThought] = useState('') // invisible buffer for thought tokens, never rendered
  const [readyCorpora, setReadyCorpora] = useState([])
  const [selectedCorpusId, setSelectedCorpusId] = useState('')
  const [useRag, setUseRag] = useState(() => localStorage.getItem(LS_USE_RAG) !== '0')
  const [messageSearch, setMessageSearch] = useState('')
  const [ragChunksById, setRagChunksById] = useState({})
  const [openChunksByMessageId, setOpenChunksByMessageId] = useState({})
  const [snack, setSnack] = useState({ open: false, message: '', severity: 'info' })
  const [inferenceInfo, setInferenceInfo] = useState({ contextLength: 50000, maxTokens: 1024 })
  const [lastRagInfo, setLastRagInfo] = useState({ requested: '', applied: false, resolved: '', method: '' })
  const [configuredSearchMethod, setConfiguredSearchMethod] = useState('vector')

  // --- refs ---
  const messagesRef = useRef(messages)
  const chatIdRef = useRef(currentChatId)
  const ragChunksRef = useRef(ragChunksById)
  const activeSelectedCorpus = readyCorpora.find((c) => c.id === selectedCorpusId) || null

  const showSnack = useCallback((message, severity = 'info') => {
    setSnack({ open: true, message, severity })
  }, [])

  // keep refs in sync so the ipc callback always has fresh values
  useEffect(() => { messagesRef.current = messages }, [messages])
  useEffect(() => { chatIdRef.current = currentChatId }, [currentChatId])
  useEffect(() => { ragChunksRef.current = ragChunksById }, [ragChunksById])

  const transcriptTokens = useMemo(
    () => messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0),
    [messages]
  )

  const slidingWindowInfo = useMemo(
    () => buildSlidingHistory(
      messages.map(({ role, content }) => ({ role, content })),
      {
        contextLength: inferenceInfo.contextLength,
        maxTokens: inferenceInfo.maxTokens,
        systemPrompt: 'You are a helpful assistant.',
      }
    ),
    [messages, inferenceInfo.contextLength, inferenceInfo.maxTokens]
  )

  const refreshCorpusBar = useCallback(async () => {
    const manifest = await window.api.load('manifest')
    const ready = (manifest?.corpora || []).filter((c) => c?.status === 'ready' && c?.tableName)
    setReadyCorpora(ready)
    const inf = manifest?.settings?.inference || {}
    const rag = manifest?.settings?.rag || {}
    setInferenceInfo({
      contextLength: Math.max(2048, Number(inf.contextLength ?? 50000) || 50000),
      maxTokens: Math.max(256, Number(inf.maxTokens ?? 1024) || 1024),
    })
    setConfiguredSearchMethod(rag.searchMethod ?? 'vector')
    const chatId = chatIdRef.current
    const chat = chatId ? manifest?.chats?.find((c) => c.id === chatId) : null
    let nextId = chat?.corpusId || ''
    if (nextId && !ready.some((c) => c.id === nextId)) nextId = ''
    if (!nextId) {
      const last = localStorage.getItem(LS_LAST_CORPUS)
      if (last && ready.some((c) => c.id === last)) nextId = last
    }
    if (!nextId && ready.length) nextId = ready[0].id
    setSelectedCorpusId(nextId)
  }, [])

  useEffect(() => {
    refreshCorpusBar()
  }, [currentChatId, refreshCorpusBar])

  useEffect(() => {
    const onFocus = () => { refreshCorpusBar() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refreshCorpusBar])

  // load messages when switching chats
  useEffect(() => {
    if (!currentChatId) {
      setMessages([])
      setEditingMessage(null)
      setRagChunksById({})
      setOpenChunksByMessageId({})
      return
    }
    window.api.load('chat', currentChatId).then((data) => {
      setEditingMessage(null)
      if (data && data.messages) {
        setMessages(data.messages)
      } else {
        setMessages([])
      }
      setRagChunksById(data?.ragChunks || {})
      setOpenChunksByMessageId({})
    })
  }, [currentChatId])

  // mount: load model + listen.
  // dont call unloadModel in cleanup — React 18 Strict Mode runs cleanup then remounts and would kill chat.py
  // while the UI still shows isModelReady. Unload only when leaving Chat in App.jsx (view !== 'Chat').
  useEffect(() => {
    window.api.loadModel()

    window.api.onResponse((data) => {
      if (data.status === 'error') {
        console.error('[Genie/UI] chat/python error', data.message || data)
        setIsStreaming(false)
        setStreamingThought('')
        setMessages((prev) => {
          const i = prev.length - 1
          const last = prev[i]
          if (last?.role !== 'assistant') return prev
          if (!String(last.content || '').trim()) return prev.slice(0, -1)
          return prev
        })
        setIsModelReady(false)
        showSnack(data.message || 'Model/chat error', 'error')
        return
      }
      // model loaded
      if (data.status === 'success' && data.message?.includes('Loaded')) {
        setIsModelReady(true)
      }
      // model unloaded
      if (data.status === 'success' && data.message?.includes('unloaded')) {
        setIsModelReady(false)
      }
      // streaming token
      if (data.status === 'stream') {
        const part = data.part || 'message'
        if (part === 'thought') {
          setStreamingThought((prev) => prev + (data.chunk || ''))
        } else {
          setMessages((prev) => {
            const i = prev.length - 1
            const last = prev[i]
            if (!last || last.role !== 'assistant') return prev
            const chunk = data.chunk || ''
            if (!chunk) return prev
            const next = [...prev]
            next[i] = { ...last, content: (last.content || '') + chunk }
            return next
          })
        }
      }
      // stream done, save chat (strip thought from persisted messages)
      if (data.status === 'success' && data.response !== undefined) {
        setIsStreaming(false)
        setStreamingThought('')
        const prev = messagesRef.current
        const updated = prev.map((m, i) => {
          if (i === prev.length - 1 && m.role === 'assistant') {
            const out = { ...m, content: data.response }
            if (data.model) out.model = data.model
            if (data.thought) out.thought = data.thought
            return out
          }
          return { ...m }
        })
        setMessages(updated)
        saveChat(updated)
      }
    })

    return () => {
      window.api.removeResponseListener()
    }
  }, [])

  const handleSend = async () => {
    console.log('[Genie/UI] handleSend enter', {
      inputLen: input.trim().length,
      isModelReady,
      isStreaming,
      currentChatId,
    })
    if (!input.trim() || !isModelReady || isStreaming) {
      console.log('[Genie/UI] handleSend bail', {
        emptyInput: !input.trim(),
        notReady: !isModelReady,
        streaming: isStreaming,
      })
      return
    }

    let chatId = currentChatId

    // first message in a brand new chat
    if (!chatId) {
      const result = await window.api.createChat()
      if (!result) {
        console.warn('[Genie/UI] createChat returned falsy — not sending to model')
        return
      }
      chatId = result.id
      chatIdRef.current = result.id
      if (onChatCreated) onChatCreated(result.id)
    }

    const userMsg = { id: crypto.randomUUID(), role: 'user', content: input }
    const assistantMsg = { id: crypto.randomUUID(), role: 'assistant', content: '' }

    // build prompt config from manifest (inference + rag)
    const manifest = await window.api.load('manifest')
    const inf = manifest?.settings?.inference || {}
    const rag = manifest?.settings?.rag || {}

    const maxTokens = Number(inf.maxTokens ?? 1024)
    const temperature = Number(inf.temperature ?? 0.3)
    const topP = Number(inf.topP ?? 0.9)
    const topK = Math.min(100, Math.max(1, Math.round(Number(inf.topK ?? 40))))
    const contextLength = Math.max(2048, Number(inf.contextLength ?? 50000) || 50000)

    const k = Number(rag.numChunks ?? 30)
    const searchMethod = rag.searchMethod ?? 'vector'
    const rerankerModel = String(rag.rerankerModel || '').trim()
    const rerankerTopK = Math.max(1, Number(rag.rerankerTopK ?? 10) || 10)
    const selectedCorpus = (manifest?.corpora || []).find(
      (c) => c.id === selectedCorpusId && c?.status === 'ready' && c?.tableName
    ) || null
    const activeCorpusId = selectedCorpus?.id || ''

    await persistChatCorpusId(chatId, activeCorpusId)

    // RAG: optional; gated by "Use RAG" + collection dropdown (not only manifest chat.corpusId)
    let systemPrompt = 'You are a helpful assistant.'
    let retrievedChunkIds = []
    let ragApplied = false
    setLastRagInfo({ requested: rerankerModel, applied: false, resolved: '', method: searchMethod })
    try {
      if (useRag && activeCorpusId) {
        const corpus = selectedCorpus
        console.log('[Genie/UI] RAG send path', {
          corpusId: activeCorpusId,
          corpusStatus: corpus?.status,
          tableName: corpus?.tableName,
          embedder: corpus?.settings?.embedder || rag.embeddingModel || '',
            rerankerModel,
            rerankerTopK,
          k,
          searchMethod,
        })
        if (corpus?.status === 'ready' && corpus?.tableName) {
          const r = await window.api.retrieveQuery(corpus.tableName, userMsg.content, k, {
            method: searchMethod,
            embedder: corpus?.settings?.embedder || rag.embeddingModel || undefined,
            rerankerModel: rerankerModel || undefined,
            rerankerTopK,
          })
          console.log('[Genie/UI] RAG retrieveQuery', r?.status, 'snippets', r?.snippets?.length, r?.message || '')
          setLastRagInfo({
            requested: rerankerModel,
            applied: Boolean(r?.reranked),
            resolved: String(r?.rerankerModel || ''),
            method: String(r?.method || searchMethod || ''),
          })
          if (r?.status === 'success' && Array.isArray(r.snippets) && r.snippets.length) {
            const retrievedAt = new Date().toISOString()
            const chunkStore = { ...ragChunksRef.current }
            retrievedChunkIds = r.snippets.map((s, i) => {
              const chunkId = `chunk-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`
              chunkStore[chunkId] = {
                id: chunkId,
                text: String(s.text || ''),
                score: Number(s.score ?? 0),
                corpusId: activeCorpusId,
                query: userMsg.content,
                retrievedAt,
              }
              return chunkId
            })
            ragChunksRef.current = chunkStore
            setRagChunksById(chunkStore)
            const ragContext = buildRetrievedContext(r.snippets)
            console.log('[Genie/UI] RAG context budget', {
              snippets: r.snippets.length,
              estimatedTokens: ragContext.estimatedTokens,
              trimmed: ragContext.trimmed,
            })
            if (ragContext.context) {
              ragApplied = true
              systemPrompt =
                'You are a helpful assistant.\n\n' +
                'Use the following retrieved context if it is relevant. If it is not relevant, ignore it.\n\n' +
                'Retrieved context:\n' +
                ragContext.context
            } else {
              console.warn('[Genie/UI] RAG snippets were empty after trimming')
              showSnack('RAG returned unusable chunk text for that message', 'warning')
            }
          } else if (r?.status !== 'success') {
            console.warn('[Genie/UI] RAG retrieve failed, sending chat without context', r?.message || r)
            showSnack(`RAG retrieval failed: ${r?.message || 'chat sent without document context'}`, 'warning')
          } else {
            console.warn('[Genie/UI] RAG returned no snippets for selected collection')
            showSnack('RAG found no matching chunks for that message', 'warning')
          }
        }
      }
    } catch (e) {
      console.warn('[Genie/UI] RAG branch failed (chat continues without context)', e?.message || e)
      showSnack(`RAG error: ${e?.message || 'chat sent without document context'}`, 'warning')
    }

    if (activeCorpusId) {
      localStorage.setItem(LS_LAST_CORPUS, activeCorpusId)
    }
    if (ragApplied && retrievedChunkIds.length) {
      userMsg.rag = { enabled: true, corpusId: activeCorpusId, chunkIds: retrievedChunkIds }
    }

    setMessages((prev) => [...prev, userMsg, assistantMsg])
    setIsStreaming(true)
    setStreamingThought('')
    setInput('')

    const config = { max_tokens: maxTokens, temperature, top_p: topP, top_k: topK, system_prompt: systemPrompt }
    const rawHistory = [...messages, userMsg].map(({ role, content }) => ({ role, content }))
    const historyWindow = buildSlidingHistory(rawHistory, {
      contextLength,
      maxTokens,
      systemPrompt,
    })
    const historyForLLM = historyWindow.messages
    console.log('[Genie/UI] sendChat', {
      contextLength,
      rawHistoryLen: rawHistory.length,
      historyLen: historyForLLM.length,
      trimmedCount: historyWindow.trimmedCount,
      estimatedHistoryTokens: historyWindow.estimatedHistoryTokens,
      estimatedBudgetTokens: historyWindow.estimatedBudgetTokens,
      lastMsg: historyForLLM[historyForLLM.length - 1],
      systemPromptLen: systemPrompt.length,
      config: { ...config, system_prompt: `[${systemPrompt.length} chars]` },
    })
    try {
      await window.api.sendChat(historyForLLM, config)
    } catch (e) {
      console.error('[Genie/UI] sendChat invoke failed', e)
      setIsStreaming(false)
    }
  }

  const saveChat = (msgs, chunks = ragChunksRef.current) => {
    const id = chatIdRef.current
    if (!id) return
    const toSave = msgs.map(({ id: mid, role, content, model, rag }) => {
      const m = { id: mid, role, content }
      if (role === 'assistant' && model) m.model = model
      if (rag) m.rag = rag
      return m
    })
    window.api.save('chat', { id, messages: toSave, ragChunks: chunks }, id)
  }

  const handleDelete = (msg) => {
    if (isStreaming) return
    setMessages((prev) => {
      const next = prev.filter((m) => m.id !== msg.id)
      saveChat(next)
      return next
    })
  }

  const handleEdit = (msg) => {
    if (isStreaming) return
    setEditingMessage({ id: msg.id, content: msg.content })
  }

  const handleEditConfirm = () => {
    if (!editingMessage) return
    setMessages((prev) => {
      const next = prev.map((m) =>
        m.id === editingMessage.id ? { ...m, content: editingMessage.content } : m
      )
      saveChat(next)
      return next
    })
    setEditingMessage(null)
  }

  const handleEditCancel = () => {
    setEditingMessage(null)
  }

  const handleCorpusSelect = async (corpusId) => {
    setSelectedCorpusId(corpusId)
    if (corpusId) localStorage.setItem(LS_LAST_CORPUS, corpusId)
    else localStorage.removeItem(LS_LAST_CORPUS)
    await persistChatCorpusId(chatIdRef.current, corpusId)
  }

  const handleUseRagChange = (checked) => {
    setUseRag(checked)
    localStorage.setItem(LS_USE_RAG, checked ? '1' : '0')
  }

  const copyMessageText = async (msg) => {
    const raw = editingMessage?.id === msg.id ? editingMessage.content : msg.content
    const text = String(raw ?? '').trim()
    if (!text) return
    try {
      await navigator.clipboard.writeText(String(raw ?? ''))
    } catch (_) {
      /* ignore */
    }
  }

  const getChunksForMessage = (msg) => {
    const ids = msg?.rag?.chunkIds || []
    return ids.map((id) => ragChunksById[id]).filter(Boolean)
  }

  const toggleChunks = (msgId) => {
    setOpenChunksByMessageId((prev) => ({ ...prev, [msgId]: !prev[msgId] }))
  }

  const handleDownloadChat = async () => {
    if (messages.length < 1 || !currentChatId || isStreaming) return
    const msgsForSave = editingMessage
      ? messages.map((m) =>
          m.id === editingMessage.id ? { ...m, content: editingMessage.content } : m
        )
      : messages
    saveChat(msgsForSave)
    const r = await window.api.chatExportPdf(currentChatId)
    if (!r?.ok && r?.error && r.error !== 'canceled') console.error('export pdf:', r.error)
  }

  return (
    <Box sx={{ flex: 1, minHeight: 0, width: '100%', minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Box
        sx={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          px: 2,
          py: 1,
          borderBottom: 1,
          borderColor: 'divider',
          ...CHAT_COLUMN_SX,
        }}
      >
        <Tooltip title="Export chat as PDF">
          <span>
            <IconButton
              size="small"
              onClick={handleDownloadChat}
              aria-label="Export chat as PDF"
              sx={{ flexShrink: 0 }}
              disabled={isStreaming}
            >
              <DownloadIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <FormControl size="small" sx={{ width: { xs: '58%', md: '40%' }, minWidth: 180 }}>
          <InputLabel id="chat-corpus-label">Collection</InputLabel>
          <Select
            labelId="chat-corpus-label"
            label="Collection"
            value={activeSelectedCorpus?.id || ''}
            onChange={(e) => handleCorpusSelect(e.target.value)}
            disabled={isStreaming}
          >
            <MenuItem value="">
              <em>None</em>
            </MenuItem>
            {readyCorpora.map((c) => (
              <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <Tooltip title="add Document snippets from collection to prompt for LLM">
          <Box component="span" sx={{ display: 'inline-flex' }}>
            <FormControlLabel
              sx={{ flexShrink: 0, m: 0 }}
              control={(
                <Checkbox
                  checked={Boolean(activeSelectedCorpus && useRag)}
                  disabled={!activeSelectedCorpus || isStreaming}
                  onChange={(e) => handleUseRagChange(e.target.checked)}
                  size="small"
                />
              )}
              label="Use RAG"
            />
          </Box>
        </Tooltip>
        <Box
          sx={{
            ml: 'auto',
            display: { xs: 'none', md: 'flex' },
            flexDirection: 'column',
            alignItems: 'flex-end',
            gap: 0.5,
            minWidth: 220,
          }}
        >
          <TextField
            size="small"
            placeholder="Search messages..."
            value={messageSearch}
            onChange={(e) => setMessageSearch(e.target.value)}
            sx={{ width: 220 }}
            InputProps={{
              endAdornment: messageSearch ? (
                <InputAdornment position="end">
                  <IconButton size="small" onClick={() => setMessageSearch('')} aria-label="Clear message search">
                    <Close fontSize="small" />
                  </IconButton>
                </InputAdornment>
              ) : null,
            }}
          />
          <Tooltip
            title={
              `Approx only. Transcript counts saved user/assistant messages. ` +
              `Window shows the estimated history currently fitting inside context. ` +
              (useRag && activeSelectedCorpus ? 'RAG can shrink the real window further on send.' : '')
            }
          >
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', minWidth: 170 }}>
              <Typography variant="caption" color="text.secondary">
                ~{transcriptTokens.toLocaleString()} tok transcript
              </Typography>
              <Typography variant="caption" color="text.secondary">
                ~{slidingWindowInfo.estimatedHistoryTokens.toLocaleString()} in window
              </Typography>
              {useRag && activeSelectedCorpus ? (
                <Typography variant="caption" color="text.secondary">
                  retrieval: {formatRetrievalMethod(lastRagInfo.method || configuredSearchMethod)}
                </Typography>
              ) : null}
              {lastRagInfo.requested ? (
                <Typography variant="caption" color={lastRagInfo.applied ? 'success.main' : 'text.secondary'}>
                  {lastRagInfo.applied
                    ? `reranked: ${lastRagInfo.resolved || lastRagInfo.requested}`
                    : `reranker idle: ${lastRagInfo.requested}`}
                </Typography>
              ) : null}
            </Box>
          </Tooltip>
        </Box>
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, minWidth: 0, overflowY: 'auto', px: 2, display: 'flex', flexDirection: 'column-reverse', ...CHAT_COLUMN_SX }}>
        {messages.length === 0 ? (
          <Box sx={{ flex: 1, position: 'relative', minHeight: 0, overflow: 'hidden' }}>
            <Box
              component="img"
              src={fadedLogo}
              alt=""
              sx={{
                position: 'absolute',
                left: '50%',
                top: '44%',
                transform: 'translate(-50%, -50%)',
                width: { xs: 260, md: 380 },
                maxWidth: '65%',
                opacity: 0.1,
                pointerEvents: 'none',
                userSelect: 'none',
              }}
            />
            <Box
              sx={{
                position: 'absolute',
                left: '50%',
                top: '68%',
                transform: 'translateX(-50%)',
                width: '100%',
                textAlign: 'center',
                px: 2,
              }}
            >
              <Typography color="text.secondary">
                {isModelReady ? 'type a message to start' : 'model loading in background...'}
              </Typography>
            </Box>
          </Box>
        ) : (
          [...messages].reverse().map((msg) => {
            const linkedChunks = getChunksForMessage(msg)
            const canShowChunks = msg.role === 'user' && linkedChunks.length > 0
            const chunksOpen = Boolean(openChunksByMessageId[msg.id])
            return (
            <Box
              key={msg.id}
              sx={{
                display: 'flex',
                width: '100%',
                alignItems: 'flex-end',
                py: 0.5,
                flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
              }}
            >
              <Box
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
                  width: 'fit-content',
                  maxWidth: '75%',
                  '&:hover .message-actions': { opacity: 1 },
                }}
              >
                <Box
                  sx={{
                    px: 2,
                    py: 1.5,
                    borderRadius: 2,
                    overflowWrap: 'break-word',
                    ...(msg.role === 'user'
                      ? { bgcolor: 'primary.main', color: 'primary.contrastText' }
                      : { bgcolor: 'action.hover', color: 'text.primary' }),
                  }}
                >
                  {editingMessage?.id === msg.id ? (
                    <TextField
                      multiline
                      variant="standard"
                      value={editingMessage.content}
                      onChange={(e) => {
                        setEditingMessage((prev) => (prev ? { ...prev, content: e.target.value } : null))
                      }}
                      InputProps={{ disableUnderline: true }}
                      sx={(theme) => ({
                        width: '100%',
                        minWidth: 0,
                        '& .MuiInputBase-root': { padding: 0, margin: 0 },
                        '& .MuiInputBase-input': {
                          ...theme.typography.body2,
                          whiteSpace: 'pre-wrap',
                          overflowWrap: 'break-word',
                          wordBreak: 'break-word',
                          padding: 0,
                          margin: 0,
                          fieldSizing: 'content',
                          resize: 'none',
                        },
                      })}
                      autoFocus
                    />
                  ) : (
                    <Typography
                      component="div"
                      variant="body2"
                      sx={{
                        whiteSpace: 'pre-wrap',
                        overflowWrap: 'break-word',
                        wordBreak: 'break-word',
                      }}
                    >
                      {renderMessageMarkdown(msg.content, messageSearch, msg.role === 'user')}
                    </Typography>
                  )}
                </Box>
                {!isStreaming && (
                  <Box
                    className="message-actions"
                    sx={{
                      display: 'flex',
                      gap: 0.5,
                      mt: 0.5,
                      alignSelf: msg.role === 'assistant' ? 'flex-end' : undefined,
                      opacity: editingMessage?.id === msg.id ? 1 : 0,
                      transition: 'opacity 0.15s',
                    }}
                  >
                    {editingMessage?.id === msg.id ? (
                      <>
                        <IconButton size="small" onClick={handleEditConfirm} sx={{ p: 0.5 }} aria-label="Confirm">
                          <Check sx={(theme) => ({ fontSize: theme.typography.body2.fontSize })} />
                        </IconButton>
                        <IconButton size="small" onClick={handleEditCancel} sx={{ p: 0.5 }} aria-label="Cancel">
                          <Close sx={(theme) => ({ fontSize: theme.typography.body2.fontSize })} />
                        </IconButton>
                        <Tooltip title="Copy">
                          <span>
                            <IconButton
                              size="small"
                              onClick={() => copyMessageText(msg)}
                              sx={{ p: 0.5 }}
                              aria-label="Copy message"
                              disabled={!editingMessage?.content?.trim()}
                            >
                              <ContentCopy sx={(theme) => ({ fontSize: theme.typography.body2.fontSize })} />
                            </IconButton>
                          </span>
                        </Tooltip>
                      </>
                    ) : (
                      <>
                        {canShowChunks && (
                          <Button
                            size="small"
                            onClick={() => toggleChunks(msg.id)}
                            sx={{ p: 0.5, minWidth: 'auto', textTransform: 'none' }}
                            endIcon={chunksOpen ? <ExpandLess /> : <ExpandMore />}
                          >
                            {chunksOpen ? 'Hide chunks' : 'Show chunks'}
                          </Button>
                        )}
                        <IconButton
                          size="small"
                          onClick={() => handleEdit(msg)}
                          sx={{ p: 0.5 }}
                          aria-label="Edit"
                        >
                          <Edit sx={(theme) => ({ fontSize: theme.typography.body2.fontSize })} />
                        </IconButton>
                        <Tooltip title="Copy">
                          <span>
                            <IconButton
                              size="small"
                              onClick={() => copyMessageText(msg)}
                              sx={{ p: 0.5 }}
                              aria-label="Copy message"
                              disabled={!(editingMessage?.id === msg.id ? editingMessage.content : msg.content)?.trim()}
                            >
                              <ContentCopy sx={(theme) => ({ fontSize: theme.typography.body2.fontSize })} />
                            </IconButton>
                          </span>
                        </Tooltip>
                        <IconButton
                          size="small"
                          onClick={() => handleDelete(msg)}
                          sx={{ p: 0.5 }}
                          aria-label="Delete"
                        >
                          <Delete sx={(theme) => ({ fontSize: theme.typography.body2.fontSize })} />
                        </IconButton>
                      </>
                    )}
                  </Box>
                )}
                {canShowChunks && chunksOpen && (
                  <Box
                    sx={{
                      mt: 0.5,
                      width: '100%',
                      maxWidth: 980,
                      maxHeight: 520,
                      overflowY: 'auto',
                      border: 1,
                      borderColor: 'divider',
                      borderRadius: 2,
                      bgcolor: 'background.paper',
                      p: 1.25,
                    }}
                  >
                    {linkedChunks.map((chunk, idx) => (
                      <Box
                        key={chunk.id || idx}
                        sx={{
                          mb: idx === linkedChunks.length - 1 ? 0 : 1.25,
                          p: 1,
                          border: 1,
                          borderColor: 'divider',
                          borderRadius: 1.5,
                          bgcolor: 'action.hover',
                        }}
                      >
                        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
                          chunk #{idx + 1} • score {Number(chunk.score ?? 0).toFixed(4)}
                        </Typography>
                        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                          {chunk.text}
                        </Typography>
                      </Box>
                    ))}
                  </Box>
                )}
              </Box>
            </Box>
          )})
        )}
      </Box>

      <BottomBar
        input={input}
        setInput={setInput}
        onSend={handleSend}
        isModelReady={isModelReady}
        isStreaming={isStreaming}
      />
      <Snackbar
        open={snack.open}
        autoHideDuration={7000}
        onClose={() => setSnack((s) => ({ ...s, open: false }))}
      >
        <Alert
          severity={snack.severity}
          onClose={() => setSnack((s) => ({ ...s, open: false }))}
          variant="filled"
          sx={{ width: '100%' }}
        >
          {snack.message}
        </Alert>
      </Snackbar>
    </Box>
  )
}
