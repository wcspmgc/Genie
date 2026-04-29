import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Box, Typography, Paper, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, IconButton, Dialog, DialogTitle, DialogContent,
  DialogActions, TextField, Button, Snackbar, Alert, LinearProgress, Tooltip
} from '@mui/material'
import { Add as AddIcon, CreateNewFolder as AddFolderIcon, Delete as DeleteIcon, Edit as EditIcon } from '@mui/icons-material'
import PlayForWorkIcon from '@mui/icons-material/PlayForWork'
import fadedLogo from '../../../../resources/images/logo748morefaded.png'

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatApproxTokens(count) {
  const n = Number(count || 0)
  if (!n) return ''
  if (n < 1000) return `~${n} tok`
  const k = n / 1000
  const fixed = k >= 10 ? k.toFixed(0) : k.toFixed(1)
  return `~${fixed.replace(/\.0$/, '')}k tok`
}

const STATUS_COLORS = {
  pending: 'text.secondary',
  processing: 'primary.main',
  ready: 'success.main',
  completed: 'success.main',
  error: 'error.main'
}

function StatusCell({ status }) {
  const color = STATUS_COLORS[status] || 'text.secondary'
  const label = status === 'processing' ? 'Indexing…' : status
  return (
    <Typography component="span" sx={{ fontWeight: 'bold', color, fontSize: '0.95rem' }}>
      {label}
    </Typography>
  )
}

const MAX_FOLDER_SIZE_BYTES = 15 * 1024 ** 3

function folderBasename(path) {
  if (!path) return ''
  const parts = path.split(/[/\\]/).filter(Boolean)
  return parts.length ? parts[parts.length - 1] : path
}

const PHASE_LABEL = {
  chunking: 'Chunking',
  embedding: 'Embedding',
  writing: 'Saving'
}

// docs table: % widths, pairwise drag between cols; mins so nothing vanishes
const DOC_COL_MIN_PCT = 5
const DOC_COL_INITIAL_PCT = [18, 30, 10, 22, 20]

function HeaderResizeHandle({ onMouseDown }) {
  return (
    <Box
      onMouseDown={onMouseDown}
      role="separator"
      aria-hidden
      sx={{
        position: 'absolute',
        right: 0,
        top: 0,
        bottom: 0,
        width: 8,
        cursor: 'col-resize',
        zIndex: 1,
        touchAction: 'none',
        '&:hover': { bgcolor: 'action.hover' },
      }}
    />
  )
}

function normalizeIngestProgress(payload) {
  if (payload == null) return { phase: 'chunking', percent: 0, message: '' }
  if (typeof payload === 'string') {
    return { phase: 'chunking', percent: 50, message: payload }
  }
  return {
    phase: payload.phase || 'chunking',
    percent: typeof payload.percent === 'number' ? payload.percent : 0,
    message: payload.message || ''
  }
}

function corpusSourcePaths(sources) {
  const paths = (sources || [])
    .map((s) => (typeof s === 'string' ? s : s?.path))
    .filter(Boolean)
  if (!paths.length) return { line: '—', title: '' }
  const title = paths.join('\n')
  if (paths.length === 1) return { line: paths[0], title }
  return { line: `${paths[0]} (+${paths.length - 1} more)`, title }
}

function makeUniqueCorpusName(existingCorpora, baseName, excludeId = null) {
  const taken = new Set(
    (existingCorpora || [])
      .filter((c) => c?.id !== excludeId)
      .map((c) => String(c?.name || '').trim())
      .filter(Boolean)
  )
  const raw = String(baseName || '').trim() || 'Collection'
  if (!taken.has(raw)) return raw
  let i = 1
  while (taken.has(`${raw} (${i})`)) i += 1
  return `${raw} (${i})`
}

function formatCorpusSettings(corpus) {
  const s = corpus?.settings || {}
  const embedder = s.embedder || 'all-MiniLM-L6-v2'
  const method = s.method || 'fixed_256_o10'
  const chunkSize = Number(s.chunkSize ?? 512)
  const overlap = Number(s.overlap ?? 50)
  if (String(method).startsWith('fixed_')) return `embedder: ${embedder} | chunking: ${method}`
  return `embedder: ${embedder} | chunking: ${method} | ${chunkSize} chars ov${overlap}`
}

function LinearProgressWithLabel({ value }) {
  const v = Math.max(0, Math.min(100, Math.round(Number(value) || 0)))
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', width: '100%', minWidth: 0 }}>
      <Box sx={{ width: '100%', mr: 0.75, minWidth: 0 }}>
        <LinearProgress
          variant="determinate"
          value={v}
          sx={{
            height: 10,
            borderRadius: 999,
            bgcolor: 'action.hover',
            '& .MuiLinearProgress-bar': {
              borderRadius: 999
            }
          }}
        />
      </Box>
      <Box sx={{ minWidth: 36, flexShrink: 0 }}>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>{`${v}%`}</Typography>
      </Box>
    </Box>
  )
}

function CorpusStatusCell({ corpus, showProgress, progress }) {
  if (showProgress && progress) {
    const { phase, percent, message } = progress
    const label = PHASE_LABEL[phase] || phase
    return (
      <Box sx={{ minWidth: 0, maxWidth: '100%', py: 0.25 }}>
        <Typography variant="body2" color="primary" display="block" noWrap title={message || label}>
          {label}{message ? ` — ${message}` : ''}
        </Typography>
        <LinearProgressWithLabel value={percent} />
      </Box>
    )
  }
  return <StatusCell status={corpus.status} />
}

export default function Documents() {
  const [corpora, setCorpora] = useState([])
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameCorpus, setRenameCorpus] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  const [snack, setSnack] = useState({ open: false, message: '', severity: 'success' })
  const [documentsPath, setDocumentsPath] = useState('')
  const [processingId, setProcessingId] = useState(null)
  const [ingestProgressById, setIngestProgressById] = useState({})
  const [docColPct, setDocColPct] = useState(() => [...DOC_COL_INITIAL_PCT])
  const docTableWrapRef = useRef(null)
  const docResizeRef = useRef(null)

  const startDocColResize = useCallback((colIndex) => (e) => {
    e.preventDefault()
    e.stopPropagation()
    docResizeRef.current = {
      colIndex,
      startX: e.clientX,
      w0: docColPct[colIndex],
      w1: docColPct[colIndex + 1],
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [docColPct])

  useEffect(() => {
    const onMove = (e) => {
      const s = docResizeRef.current
      if (!s) return
      const wrap = docTableWrapRef.current
      if (!wrap) return
      const tableW = wrap.getBoundingClientRect().width
      if (tableW < 40) return
      const dPct = ((e.clientX - s.startX) / tableW) * 100
      const pairSum = s.w0 + s.w1
      const lo = DOC_COL_MIN_PCT
      const hi = pairSum - DOC_COL_MIN_PCT
      let a = s.w0 + dPct
      a = Math.max(lo, Math.min(hi, a))
      const b = pairSum - a
      setDocColPct((prev) => {
        const next = [...prev]
        next[s.colIndex] = a
        next[s.colIndex + 1] = b
        return next
      })
    }
    const onUp = () => {
      if (docResizeRef.current) {
        docResizeRef.current = null
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  useEffect(() => {
    const load = async () => {
      const manifest = await window.api.load('manifest')
      setCorpora(manifest?.corpora || [])
      window.api.documentsGetPath().then(setDocumentsPath)
    }
    load()
  }, [])

  useEffect(() => {
    window.api.onIngestProgress((corpusId, payload) => {
      const p = normalizeIngestProgress(payload)
      setIngestProgressById((prev) => ({ ...prev, [corpusId]: p }))
    })
    return () => window.api.removeIngestProgressListener()
  }, [])

  const handleInsert = async () => {
    const files = await window.api.openFiles()
    if (files.length === 0) return

    const manifest = await window.api.load('manifest')
    if (!manifest) return

    const rag = manifest.settings?.rag || {}
    const chunkSize = rag.chunkSize ?? 512
    const overlapPct = rag.overlapPercent ?? 10
    const overlap = Math.round(chunkSize * (overlapPct / 100))
    const embedder = rag.embeddingModel ?? 'all-MiniLM-L6-v2'
    const method = rag.method ?? 'fixed_256_o10'

    manifest.corpora = manifest.corpora || []

    for (const f of files) {
      const id = `corpus-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
      manifest.corpora.push({
        id,
        name: makeUniqueCorpusName(manifest.corpora, f.name),
        tableName: `table_${id.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
        status: 'pending',
        totalSizeBytes: f.size,
        settings: { chunkSize, overlap, embedder, method },
        sources: [{ type: 'file', path: f.path, fileCount: 1, scannedAt: new Date().toISOString() }]
      })
    }

    await window.api.save('manifest', manifest)
    setCorpora(manifest.corpora)
  }

  const handleAddFolder = async () => {
    const folderPath = await window.api.openFolder()
    if (!folderPath) return
    const result = await window.api.scanFolder(folderPath)
    if (!result.ok) {
      setSnack({ open: true, message: result.error || 'Scan failed', severity: 'error' })
      return
    }
    if (result.fileCount < 1) {
      setSnack({ open: true, message: 'No valid files (need at least one accepted doc with size > 0)', severity: 'error' })
      return
    }
    const manifest = await window.api.load('manifest')
    if (!manifest) return
    manifest.corpora = manifest.corpora || []
    const id = `corpus-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    const name = makeUniqueCorpusName(manifest.corpora, folderBasename(folderPath))
    manifest.corpora.push({
      id,
      name,
      tableName: `table_${id.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
      status: 'pending',
      totalSizeBytes: result.totalSize,
      settings: {
        chunkSize: manifest.settings?.rag?.chunkSize ?? 512,
        overlap: Math.round((manifest.settings?.rag?.chunkSize ?? 512) * ((manifest.settings?.rag?.overlapPercent ?? 10) / 100)),
        embedder: manifest.settings?.rag?.embeddingModel ?? 'all-MiniLM-L6-v2',
        method: manifest.settings?.rag?.method ?? 'fixed_256_o10'
      },
      sources: [{
        type: 'folder',
        path: folderPath,
        fileCount: result.fileCount,
        scannedAt: new Date().toISOString()
      }]
    })
    await window.api.save('manifest', manifest)
    setCorpora(manifest.corpora)
    setSnack({ open: true, message: `Collection added: ${result.fileCount} files`, severity: 'success' })
  }

  const handleDelete = async (corpus) => {
    const manifest = await window.api.load('manifest')
    if (!manifest) return
    manifest.corpora = (manifest.corpora || []).filter((c) => c.id !== corpus.id)
    await window.api.save('manifest', manifest)
    setCorpora(manifest.corpora)
  }

  const handleRenameOpen = (corpus) => {
    setRenameCorpus(corpus)
    setRenameValue(corpus.name)
    setRenameOpen(true)
  }

  const handleRenameClose = () => {
    setRenameOpen(false)
    setRenameCorpus(null)
    setRenameValue('')
  }

  const handleRenameConfirm = async () => {
    if (!renameCorpus || !renameValue.trim()) return
    const manifest = await window.api.load('manifest')
    if (!manifest) return
    const c = manifest.corpora?.find((x) => x.id === renameCorpus.id)
    if (c) {
      c.name = makeUniqueCorpusName(manifest.corpora, renameValue.trim(), renameCorpus.id)
      await window.api.save('manifest', manifest)
      setCorpora(manifest.corpora)
    }
    handleRenameClose()
  }

  const handleProcess = async (corpus) => {
    setProcessingId(corpus.id)
    setIngestProgressById((prev) => ({
      ...prev,
      [corpus.id]: { phase: 'chunking', percent: 0, message: 'starting' }
    }))
    const result = await window.api.corpusIngest(corpus.id)
    setProcessingId(null)
    setIngestProgressById((prev) => {
      const next = { ...prev }
      delete next[corpus.id]
      return next
    })
    const manifest = await window.api.load('manifest')
    if (manifest) setCorpora(manifest.corpora || [])
    if (result.status === 'success') {
      setSnack({ open: true, message: `Indexed ${result.chunks ?? 0} chunks`, severity: 'success' })
    } else {
      setSnack({ open: true, message: result.message || 'Ingest failed', severity: 'error' })
    }
  }

  return (
    <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', p: 3, pl: { xs: 1.5, md: 3 }, width: '100%', minWidth: 0, position: 'relative' }}>
      <Box
        component="img"
        src={fadedLogo}
        alt=""
        sx={{
          position: 'absolute',
          left: '50%',
          top: '56%',
          transform: 'translate(-50%, -50%)',
          width: { xs: 260, md: 420 },
          maxWidth: '65%',
          opacity: 0.05,
          pointerEvents: 'none',
          userSelect: 'none',
          zIndex: 0,
        }}
      />

      <Box sx={{ position: 'relative', zIndex: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="h3">Documents</Typography>
        <Typography variant="h6">Upload files and folders to access in Chat and Search</Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button variant="outlined" size="small" startIcon={<AddIcon />} onClick={handleInsert}>
            Add file
          </Button>
          <Button variant="outlined" size="small" startIcon={<AddFolderIcon />} onClick={handleAddFolder}>
            Add folder
          </Button>
        </Box>
      </Box>
      <Typography variant="body2" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
      Each file or folder becomes one collection (one LanceDB table). Max Folder size: 15 GB. Accepted file types: .txt, .md, .html, .pdf, .docx, .rtf
      </Typography>
      <Typography variant="body2" color="text.secondary" display="block" sx={{ mb: 2.5 }}>
        App documents folder: {documentsPath || '...'}
      </Typography>

      <TableContainer ref={docTableWrapRef} component={Paper} variant="outlined" sx={{ overflowX: 'hidden' }}>
        <Table size="small" sx={{ width: '100%', tableLayout: 'fixed' }}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 'bold', width: `${docColPct[0]}%`, fontSize: '0.95rem', position: 'relative', pr: 1, boxSizing: 'border-box' }}>
                Name
                <HeaderResizeHandle onMouseDown={startDocColResize(0)} />
              </TableCell>
              <TableCell sx={{ fontWeight: 'bold', width: `${docColPct[1]}%`, fontSize: '0.95rem', position: 'relative', pr: 1, boxSizing: 'border-box' }}>
                Source
                <HeaderResizeHandle onMouseDown={startDocColResize(1)} />
              </TableCell>
              <TableCell sx={{ fontWeight: 'bold', width: `${docColPct[2]}%`, fontSize: '0.95rem', position: 'relative', pr: 1, boxSizing: 'border-box' }}>
                Size
                <HeaderResizeHandle onMouseDown={startDocColResize(2)} />
              </TableCell>
              <TableCell sx={{ fontWeight: 'bold', width: `${docColPct[3]}%`, fontSize: '0.95rem', position: 'relative', pr: 1, boxSizing: 'border-box' }}>
                Status
                <HeaderResizeHandle onMouseDown={startDocColResize(3)} />
              </TableCell>
              <TableCell sx={{ fontWeight: 'bold', width: `${docColPct[4]}%`, fontSize: '0.95rem' }} align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {corpora.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} sx={{ color: 'text.secondary', py: 4 }}>
                  No collections yet. Add a file or folder to create one.
                </TableCell>
              </TableRow>
            ) : (
              corpora.map((corpus) => {
                const src = corpusSourcePaths(corpus.sources)
                const ingesting = processingId === corpus.id
                const live = ingestProgressById[corpus.id]
                const alreadyIndexed = corpus.status === 'ready' || corpus.status === 'completed'
                return (
                <TableRow key={corpus.id} hover>
                  <TableCell sx={{ width: `${docColPct[0]}%`, fontSize: '0.95rem', boxSizing: 'border-box' }}>
                    <Typography noWrap title={corpus.name}>{corpus.name}</Typography>
                    <Typography variant="caption" color="text.secondary" title={formatCorpusSettings(corpus)}>
                      {formatCorpusSettings(corpus)}
                    </Typography>
                  </TableCell>
                  <TableCell
                    sx={{ width: `${docColPct[1]}%`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.95rem', boxSizing: 'border-box' }}
                    title={src.title || src.line}
                  >
                    {src.line}
                  </TableCell>
                  <TableCell sx={{ width: `${docColPct[2]}%`, fontSize: '0.95rem', boxSizing: 'border-box' }}>
                    <Typography variant="body2">{formatSize(corpus.totalSizeBytes ?? 0)}</Typography>
                    {corpus.approxTokens ? (
                      <Typography variant="caption" color="text.secondary">
                        {formatApproxTokens(corpus.approxTokens)}
                      </Typography>
                    ) : null}
                  </TableCell>
                  <TableCell sx={{ width: `${docColPct[3]}%`, minWidth: 0, maxWidth: '100%', boxSizing: 'border-box' }}>
                    <CorpusStatusCell
                      corpus={corpus}
                      showProgress={ingesting && !!live}
                      progress={live}
                    />
                  </TableCell>
                  <TableCell align="right" sx={{ width: `${docColPct[4]}%`, boxSizing: 'border-box' }}>
                    {!alreadyIndexed && (
                      <Tooltip title="Index this collection: load supported docs, chunk, embed, and save to LanceDB for retrieval in chat.">
                        <span>
                          <IconButton
                            size="large"
                            onClick={() => handleProcess(corpus)}
                            disabled={processingId != null}
                            aria-label="Index collection"
                            sx={{
                              width: 52,
                              height: 52,
                              mr: 0.75,
                              bgcolor: 'primary.main',
                              color: 'common.white',
                              borderRadius: '50%',
                              boxShadow: 2,
                              '&:hover': {
                                bgcolor: 'primary.dark',
                                boxShadow: 4
                              },
                              '&.Mui-disabled': {
                                bgcolor: 'action.disabledBackground',
                                color: 'action.disabled',
                                boxShadow: 'none'
                              }
                            }}
                          >
                            <PlayForWorkIcon sx={{ fontSize: 30 }} />
                          </IconButton>
                        </span>
                      </Tooltip>
                    )}
                    <IconButton size="small" onClick={() => handleRenameOpen(corpus)} title="Rename">
                      <EditIcon fontSize="small" />
                    </IconButton>
                    <IconButton size="small" onClick={() => handleDelete(corpus)} title="Delete">
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>
      </Box>
      
      <Dialog open={renameOpen} onClose={handleRenameClose} maxWidth="xs" fullWidth>
        <DialogTitle>Rename collection</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="Name"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleRenameConfirm()}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleRenameClose}>Cancel</Button>
          <Button onClick={handleRenameConfirm} variant="contained">Save</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={snack.open} autoHideDuration={4000} onClose={() => setSnack((s) => ({ ...s, open: false }))}>
        <Alert severity={snack.severity} onClose={() => setSnack((s) => ({ ...s, open: false }))}>
          {snack.message}
        </Alert>
      </Snackbar>
    </Box>
  )
}
