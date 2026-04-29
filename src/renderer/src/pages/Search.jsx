import { useEffect, useMemo, useState } from 'react'
import Box from '@mui/material/Box'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import Button from '@mui/material/Button'
import SearchIcon from '@mui/icons-material/Search'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import FormControl from '@mui/material/FormControl'
import InputLabel from '@mui/material/InputLabel'
import Select from '@mui/material/Select'
import MenuItem from '@mui/material/MenuItem'
import Divider from '@mui/material/Divider'
import CircularProgress from '@mui/material/CircularProgress'
import Alert from '@mui/material/Alert'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import ContentCopy from '@mui/icons-material/ContentCopy'

function formatRetrievalMethod(method) {
  const m = String(method || '').trim().toLowerCase()
  if (m === 'bm25' || m === 'fts') return 'keyword (BM25)'
  if (m === 'hybrid') return 'hybrid'
  return 'semantic'
}

function escapeRegex(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function renderExactHighlights(text, query) {
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
          px: 0.25,
          borderRadius: 0.5,
          bgcolor: 'warning.light',
          color: 'text.primary',
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

async function copySnippetText(text) {
  const s = String(text ?? '')
  if (!s.trim()) return
  try {
    await navigator.clipboard.writeText(s)
  } catch (_) {
    /* ignore */
  }
}

function BottomBar({ input, setInput, onSearch }) {
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSearch()
    }
  }
  return (
    <Box sx={{ flexShrink: 0, width: '80%', minWidth: 280, minHeight: 52, alignSelf: 'center', display: 'flex', gap: 1, px: 2, py: 1.5, borderTop: 1, borderColor: 'divider' }}>
      <TextField
        fullWidth
        size="small"
        multiline
        rows={1}
        maxRows={4}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="search your documents..."
        sx={{ flex: 1, minWidth: 0 }}
      />
      <Button
        variant="contained"
        size="medium"
        onClick={onSearch}
        startIcon={<SearchIcon />}
        sx={{ flexShrink: 0, minWidth: 100 }}
        aria-label="Search"
      >
        Search
      </Button>
    </Box>
  )
}

export default function Search() {
  const [input, setInput] = useState('')
  const [corpora, setCorpora] = useState([])
  const [selectedCorpusId, setSelectedCorpusId] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [lastQuery, setLastQuery] = useState('')
  const [activeMethod, setActiveMethod] = useState('vector')
  const [activeK, setActiveK] = useState(5)
  const [rerankInfo, setRerankInfo] = useState({ requested: '', applied: false, resolved: '' })

  useEffect(() => {
    const load = async () => {
      const manifest = await window.api.load('manifest')
      const cs = (manifest?.corpora || []).filter((c) => c?.status === 'ready' && c?.tableName)
      setCorpora(cs)
      if (!selectedCorpusId && cs.length) setSelectedCorpusId(cs[0].id)
      const rag = manifest?.settings?.rag || {}
      setActiveMethod(rag.searchMethod ?? 'vector')
      setActiveK(Number(rag.numChunks ?? 30))
    }
    load()
  }, [])

  const selectedCorpus = useMemo(
    () => corpora.find((c) => c.id === selectedCorpusId) || null,
    [corpora, selectedCorpusId]
  )

  const handleSearch = async () => {
    if (!input.trim() || !selectedCorpus?.tableName || loading) return
    const trimmedQuery = input.trim()
    setErr('')
    setLoading(true)
    setResults([])
    setLastQuery(trimmedQuery)
    try {
      const manifest = await window.api.load('manifest')
      const rag = manifest?.settings?.rag || {}
      const k = Number(rag.numChunks ?? 30)
      const method = rag.searchMethod ?? 'vector'
      const rerankerModel = String(rag.rerankerModel || '').trim()
      const rerankerTopK = Math.max(1, Number(rag.rerankerTopK ?? 10) || 10)
      setActiveMethod(method)
      setActiveK(k)
      setRerankInfo({ requested: rerankerModel, applied: false, resolved: '' })
      const r = await window.api.retrieveQuery(selectedCorpus.tableName, trimmedQuery, k, {
        method,
        embedder: selectedCorpus?.settings?.embedder || rag.embeddingModel || undefined,
        rerankerModel: rerankerModel || undefined,
        rerankerTopK,
      })
      if (r?.status !== 'success') {
        setErr(r?.message || 'Search failed')
        return
      }
      setActiveMethod(r?.method || method)
      setRerankInfo({
        requested: rerankerModel,
        applied: Boolean(r?.reranked),
        resolved: String(r?.rerankerModel || ''),
      })
      setResults(Array.isArray(r.snippets) ? r.snippets : [])
    } catch (e) {
      setErr(e?.message || 'Search failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Box sx={{ flex: 1, minHeight: 0, width: '100%', minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 2, py: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <Paper variant="outlined" sx={{ p: 1.5 }}>
          <Typography variant="subtitle1" color="primary">Search</Typography>
          <Typography variant="caption" color="text.secondary" display="block">
            Choose a collection, then search.
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
            Active retrieval: {formatRetrievalMethod(activeMethod)} (k={activeK})
          </Typography>
          {rerankInfo.requested ? (
            <Typography
              variant="caption"
              color={rerankInfo.applied ? 'success.main' : 'text.secondary'}
              display="block"
            >
              {rerankInfo.applied
                ? `Last search reranked by ${rerankInfo.resolved || rerankInfo.requested}`
                : `Last search did not rerank (${rerankInfo.requested})`}
            </Typography>
          ) : null}

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 1 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Collection</InputLabel>
              <Select
                value={selectedCorpusId}
                label="Collection"
                onChange={(e) => setSelectedCorpusId(e.target.value)}
              >
                {corpora.map((c) => (
                  <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <Button
              variant="outlined"
              size="small"
              onClick={async () => {
                const manifest = await window.api.load('manifest')
                const cs = (manifest?.corpora || []).filter((c) => c?.status === 'ready' && c?.tableName)
                setCorpora(cs)
                if (!selectedCorpusId && cs.length) setSelectedCorpusId(cs[0].id)
              }}
              sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}
            >
              Refresh
            </Button>
          </Stack>
        </Paper>

        {err ? <Alert severity="error">{err}</Alert> : null}

        <Paper variant="outlined" sx={{ p: 1.5, flex: 1, minHeight: 0 }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
            <Typography variant="subtitle2">Results</Typography>
            {loading ? <CircularProgress size={18} /> : null}
          </Stack>
          <Divider sx={{ mb: 1 }} />

          {results.length === 0 ? (
            <Typography color="text.secondary" variant="body2">
              {corpora.length === 0
                ? 'No ready collections yet. Go to Collections and click the process button to index a .txt file.'
                : 'Enter a query below to search this collection.'}
            </Typography>
          ) : (
            <Stack spacing={1}>
              {results.map((r, idx) => (
                <Paper key={idx} variant="outlined" sx={{ p: 1 }}>
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
                    score: {Number(r.score ?? 0).toFixed(4)}
                  </Typography>
                  <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                    {renderExactHighlights(r.text, lastQuery)}
                  </Typography>
                  <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 0.5 }}>
                    <Tooltip title="Copy">
                      <span>
                        <IconButton
                          size="small"
                          onClick={() => copySnippetText(r.text)}
                          disabled={!String(r.text ?? '').trim()}
                          aria-label="Copy snippet"
                          sx={{ p: 0.5 }}
                        >
                          <ContentCopy sx={(theme) => ({ fontSize: theme.typography.body2.fontSize })} />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </Box>
                </Paper>
              ))}
            </Stack>
          )}
        </Paper>
      </Box>

      <BottomBar input={input} setInput={setInput} onSearch={handleSearch} />
    </Box>
  )
}
