import { useState, useEffect } from 'react'
import {
  Box, Typography, Paper, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Button, LinearProgress, Snackbar, Alert
} from '@mui/material'
import { Add as AddIcon, Refresh as RefreshIcon } from '@mui/icons-material'

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 ** 3)).toFixed(1)} GB`
}

function formatDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

/** parent of …/models or …/embedders → Electron userData root */
function userDataRootFromChildDir(absPath, childFolderName) {
  if (!absPath) return ''
  const parts = absPath.replace(/[/\\]+$/, '').split(/[/\\]/).filter(Boolean)
  const last = parts[parts.length - 1]
  if (!last || last.toLowerCase() !== String(childFolderName).toLowerCase()) return ''
  parts.pop()
  return parts.join(absPath.includes('\\') ? '\\' : '/')
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
            '& .MuiLinearProgress-bar': { borderRadius: 999 }
          }}
        />
      </Box>
      <Box sx={{ minWidth: 36, flexShrink: 0 }}>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>{`${v}%`}</Typography>
      </Box>
    </Box>
  )
}

export default function Models() {
  const [modelsPath, setModelsPath] = useState('')
  const [embeddersPath, setEmbeddersPath] = useState('')
  const [pathsDetail, setPathsDetail] = useState(null)
  const [llms, setLlms] = useState([])
  const [embedders, setEmbedders] = useState([])
  const [downloadBusy, setDownloadBusy] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState(null)
  const [snack, setSnack] = useState({ open: false, message: '', severity: 'success' })

  const refreshModels = () => {
    window.api.modelsListLocal().then(setLlms)
    window.api.modelsListEmbedders().then(setEmbedders)
  }

  useEffect(() => {
    window.api.modelsGetPath().then(setModelsPath)
    window.api.modelsGetEmbeddersPath().then(setEmbeddersPath)
    window.api.modelsGetPathsDetail().then(setPathsDetail)
    refreshModels()

    const onWindowFocus = () => refreshModels()
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshModels()
    }
    window.addEventListener('focus', onWindowFocus)
    document.addEventListener('visibilitychange', onVisibilityChange)

    window.api.onModelsDownloadProgress((data) => {
      if (!data?.active) {
        setDownloadProgress(null)
        return
      }
      setDownloadProgress({
        percent: data.percent ?? 0,
        phase: data.phase || '',
        message: data.message || ''
      })
    })

    return () => {
      window.removeEventListener('focus', onWindowFocus)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.api.removeModelsDownloadProgressListener()
    }
  }, [])

  const handleDownloadDefaults = async () => {
    setDownloadBusy(true)
    // progress only from main once a real download starts (skipped = no bar, no layout flash)
    try {
      const res = await window.api.modelsDownloadDefaults()
      if (res?.skipped) {
        setSnack({ open: true, message: res.message || 'Already have defaults.', severity: 'info' })
      } else if (res?.ok) {
        setSnack({ open: true, message: res.message || 'Done.', severity: 'success' })
        refreshModels()
      } else {
        setSnack({ open: true, message: res?.message || 'Download failed', severity: 'error' })
      }
    } catch (e) {
      setSnack({ open: true, message: e.message || 'Download error', severity: 'error' })
    } finally {
      setDownloadBusy(false)
      setDownloadProgress(null)
    }
  }

  const handleAddGguf = async () => {
    try {
      const res = await window.api.modelsAddGguf()
      if (res?.canceled) return
      if (res?.ok) {
        setSnack({ open: true, message: `Added ${res.name}`, severity: 'success' })
        refreshModels()
      } else {
        setSnack({ open: true, message: res?.message || 'Could not add model', severity: 'error' })
      }
    } catch (e) {
      setSnack({ open: true, message: e.message || 'Add failed', severity: 'error' })
    }
  }

  const phaseLabel = (p) => {
    if (p === 'llm') return 'LLM'
    if (p === 'embedder') return 'Embedder'
    if (p === 'done') return 'Done'
    return p || ''
  }

  const userModelsDir = pathsDetail?.userModels || modelsPath || ''
  const userEmbedDir = pathsDetail?.userEmbedders || embeddersPath || ''
  const userDataRoot =
    userDataRootFromChildDir(userModelsDir, 'models') ||
    userDataRootFromChildDir(userEmbedDir, 'embedders') ||
    ''

  return (
    <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', p: 3, pl: { xs: 1.5, md: 3 }, width: '100%', minWidth: 0 }}>
      <Typography variant="h5" sx={{ mb: 2 }}>Models</Typography>

      <Box
        sx={{
          display: 'flex',
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 1.5,
          mb: 1,
        }}
      >
        <Button
          variant="text"
          size="medium"
          startIcon={<RefreshIcon sx={{ fontSize: '1.35rem' }} />}
          onClick={refreshModels}
          sx={{
            flex: { xs: '1 1 auto', sm: '0 1 auto' },
            py: 1.1,
            px: 2,
            fontSize: '0.95rem',
            textTransform: 'none',
          }}
        >
          Refresh lists
        </Button>
        <Button
          variant="outlined"
          size="medium"
          startIcon={<AddIcon sx={{ fontSize: '1.35rem' }} />}
          onClick={handleAddGguf}
          sx={{
            flex: { xs: '1 1 auto', sm: '0 1 20%' },
            width: { xs: 'auto', sm: 'auto' },
            maxWidth: { xs: '100%', sm: '22%' },
            minWidth: { sm: 150 },
            py: 1.1,
            px: 2,
            fontSize: '0.95rem',
            textTransform: 'none',
          }}
        >
          Add GGUF
        </Button>
        <Button
          variant="contained"
          size="medium"
          disabled={downloadBusy}
          onClick={handleDownloadDefaults}
          sx={{
            flex: { xs: '1 1 auto', sm: '0 1 20%' },
            width: { xs: 'auto', sm: 'auto' },
            maxWidth: { xs: '100%', sm: '22%' },
            minWidth: { sm: 150 },
            py: 1.1,
            px: 2,
            fontSize: '0.95rem',
            textTransform: 'none',
          }}
        >
          Download defaults
        </Button>

        <Box
          sx={{
            flex: { xs: '1 1 100%', sm: '1 1 0' },
            minWidth: { xs: '100%', sm: 160 },
            maxWidth: { xs: '100%', sm: 'min(420px, 100%)' },
            alignSelf: 'center',
          }}
        >
          {downloadProgress ? (
            <Box sx={{ width: '100%', minWidth: 0, py: 0.25 }}>
              <Typography
                variant="caption"
                color="primary"
                display="block"
                noWrap
                title={downloadProgress.message || ''}
                sx={{ mb: 0.35, lineHeight: 1.2 }}
              >
                {`${phaseLabel(downloadProgress.phase)}${downloadProgress.message ? ` — ${downloadProgress.message}` : ''}`}
              </Typography>
              <LinearProgressWithLabel value={downloadProgress.percent ?? 0} />
            </Box>
          ) : null}
        </Box>
      </Box>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 2 }}>
        Default LLM: bartowski/Meta-Llama-3.1-8B-Instruct-GGUF/Meta-Llama-3.1-8B-Instruct-Q6_K.gguf, default embedder: sentence-transformers/all-MiniLM-L6-v2 (22M)
      </Typography>

      <Paper variant="outlined" sx={{ mb: 3 }}>
        <Typography variant="subtitle1" color="primary" sx={{ p: 1.5, pb: 0 }}>LLMs (Chat)</Typography>
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small" sx={{ width: '100%', tableLayout: 'fixed', minWidth: 400 }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 'bold', width: '18%' }}>Name</TableCell>
                <TableCell sx={{ fontWeight: 'bold', width: '10%' }}>Source</TableCell>
                <TableCell sx={{ fontWeight: 'bold', width: '42%' }}>Path</TableCell>
                <TableCell sx={{ fontWeight: 'bold', width: '15%' }}>Size</TableCell>
                <TableCell sx={{ fontWeight: 'bold', width: '15%' }}>Date Created</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {llms.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} sx={{ color: 'text.secondary', py: 4 }}>
                    <Typography variant="body2">
                      No .gguf files yet. Add a model, download defaults, or place files in your models folder
                      {' '}
                      <Box component="span" sx={{ fontFamily: 'monospace', fontSize: '0.8rem', wordBreak: 'break-all' }}>
                        {userModelsDir || '…'}
                      </Box>
                      {userDataRoot ? (
                        <>
                          {' '}
                          (user data:
                          {' '}
                          <Box component="span" sx={{ fontFamily: 'monospace', fontSize: '0.8rem', wordBreak: 'break-all' }}>
                            {userDataRoot}
                          </Box>
                          )
                        </>
                      ) : null}
                      . Bundled app folder:
                      {' '}
                      <Box component="span" sx={{ fontFamily: 'monospace', fontSize: '0.8rem', wordBreak: 'break-all' }}>
                        {pathsDetail?.bundledModels || '…'}
                      </Box>
                      .
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                llms.map((f) => (
                  <TableRow key={`${f.source || ''}-${f.name}-${f.path}`}>
                    <TableCell><Typography variant="body2" sx={{ fontFamily: 'monospace' }}>{f.name}</Typography></TableCell>
                    <TableCell><Typography variant="body2" color="text.secondary">{f.source === 'app' ? 'app' : 'user'}</Typography></TableCell>
                    <TableCell><Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.path}>{f.path}</Typography></TableCell>
                    <TableCell><Typography variant="body2">{formatSize(f.size)}</Typography></TableCell>
                    <TableCell><Typography variant="body2" color="text.secondary">{formatDate(f.createdAt)}</Typography></TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
        <Typography variant="body2" color="text.secondary" sx={{ px: 1.5, pb: 1.5 }}>
          User data: {pathsDetail?.userModels || modelsPath || '…'} — bundled defaults: {pathsDetail?.bundledModels || '…'}
        </Typography>
      </Paper>

      <Paper variant="outlined" sx={{ mb: 3 }}>
        <Typography variant="subtitle1" color="primary" sx={{ p: 1.5, pb: 0 }}>Embedders (retrieval)</Typography>
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small" sx={{ width: '100%', tableLayout: 'fixed', minWidth: 400 }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 'bold', width: '18%' }}>Name</TableCell>
                <TableCell sx={{ fontWeight: 'bold', width: '10%' }}>Source</TableCell>
                <TableCell sx={{ fontWeight: 'bold', width: '42%' }}>Path</TableCell>
                <TableCell sx={{ fontWeight: 'bold', width: '15%' }}>Size</TableCell>
                <TableCell sx={{ fontWeight: 'bold', width: '15%' }}>Date Created</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {embedders.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} sx={{ color: 'text.secondary', py: 4 }}>
                    <Typography variant="body2">
                      No embedder folders yet. Download defaults or copy a sentence-transformers snapshot into
                      {' '}
                      <Box component="span" sx={{ fontFamily: 'monospace', fontSize: '0.8rem', wordBreak: 'break-all' }}>
                        {userEmbedDir || '…'}
                      </Box>
                      {userDataRoot ? (
                        <>
                          {' '}
                          (user data:
                          {' '}
                          <Box component="span" sx={{ fontFamily: 'monospace', fontSize: '0.8rem', wordBreak: 'break-all' }}>
                            {userDataRoot}
                          </Box>
                          )
                        </>
                      ) : null}
                      .
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                embedders.map((f) => (
                  <TableRow key={`${f.source || ''}-${f.name}-${f.path}`}>
                    <TableCell><Typography variant="body2" sx={{ fontFamily: 'monospace' }}>{f.name}</Typography></TableCell>
                    <TableCell><Typography variant="body2" color="text.secondary">{f.source === 'app' ? 'app' : 'user'}</Typography></TableCell>
                    <TableCell><Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.path}>{f.path}</Typography></TableCell>
                    <TableCell><Typography variant="body2">{formatSize(f.size)}</Typography></TableCell>
                    <TableCell><Typography variant="body2" color="text.secondary">{formatDate(f.createdAt)}</Typography></TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
        <Typography variant="body2" color="text.secondary" sx={{ px: 1.5, pb: 1.5 }}>
          User data: {pathsDetail?.userEmbedders || embeddersPath || '…'} — bundled defaults: {pathsDetail?.bundledEmbedders || '…'}
        </Typography>
      </Paper>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        LLMs: user {pathsDetail?.userModels || modelsPath || '…'} · app {pathsDetail?.bundledModels || '…'} — Embedders: user {pathsDetail?.userEmbedders || embeddersPath || '…'} · app {pathsDetail?.bundledEmbedders || '…'}
      </Typography>

      <Snackbar open={snack.open} autoHideDuration={6000} onClose={() => setSnack((s) => ({ ...s, open: false }))}>
        <Alert severity={snack.severity} onClose={() => setSnack((s) => ({ ...s, open: false }))} sx={{ width: '100%' }}>
          {snack.message}
        </Alert>
      </Snackbar>
    </Box>
  )
}
