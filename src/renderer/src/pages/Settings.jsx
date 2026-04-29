import { useState, useEffect } from 'react'
import {
  Box, Typography, TextField, Slider, Button, Paper, Divider, Alert, Snackbar,
  Stack, InputAdornment, IconButton, Dialog, DialogTitle, DialogContent,
  DialogContentText, DialogActions, Grid, FormControl, InputLabel, Select, MenuItem,
  ToggleButtonGroup, ToggleButton, Checkbox, FormControlLabel
} from '@mui/material'
import { Visibility, VisibilityOff } from '@mui/icons-material'

const CONTEXT_WINDOW_PRESETS = [
  { value: 50000, label: '50k (default, Mistral 12B)' },
  { value: 70000, label: '70k (Llama 8B)' },
  { value: 32768, label: '32k' },
]

function getContextWindowChoice(value) {
  const n = Number(value)
  return CONTEXT_WINDOW_PRESETS.some((opt) => opt.value === n) ? String(n) : 'other'
}

function getModelContextHint(name) {
  const raw = String(name || '')
  const lower = raw.toLowerCase()
  const sizeMatch = lower.match(/(\d+(?:\.\d+)?)\s*b\b/)
  const sizeB = sizeMatch ? Number(sizeMatch[1]) : null

  const looksLikeLlama = lower.includes('llama')
  const looksLikeSmallMistral = (lower.includes('mistral') || lower.includes('nemo')) && sizeB != null && sizeB < 20

  if (looksLikeLlama || looksLikeSmallMistral) return ' [context 128k]'
  return ''
}

function formatModelOptionLabel(name) {
  return `${name}${getModelContextHint(name)}`
}

export default function Settings({ onLogout, onAppearanceChange, appearance = {} }) {
  const [contextWindowMode, setContextWindowMode] = useState('50000')
  const [config, setConfig] = useState({
    inference: {
      file: 'Meta-Llama-3.1-8B-Instruct-Q6_K.gguf',
      contextLength: 50000,
      maxTokens: 1024,
      temperature: 0.3,
      topP: 0.9,
      topK: 40
    },
    rag: {
      chunkSize: 512,
      overlapPercent: 10,
      method: 'fixed_256_o10',
      searchMethod: 'vector',
      embeddingModel: 'all-MiniLM-L6-v2',
      numChunks: 30,
      rerankerModel: 'ms-marco-MiniLM-L-6-v2',
      rerankerTopK: 10,
      useRewriteQuery: false,
      rewriterModel: ''
    }
  })
  const [msg, setMsg] = useState('')
  const [rerankersList, setRerankersList] = useState([])
  const [rewriterList, setRewriterList] = useState([])
  const [llmList, setLlmList] = useState([])

  // security state
  const [userName, setUserName] = useState('')
  const [userEmail, setUserEmail] = useState('')
  const [curPw, setCurPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [showCurPw, setShowCurPw] = useState(false)
  const [showNewPw, setShowNewPw] = useState(false)
  const [pwError, setPwError] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deletePw, setDeletePw] = useState('')
  const [deleteError, setDeleteError] = useState('')
  const [showBg, setShowBg] = useState(true)
  const [bgFilename, setBgFilename] = useState('scificanyon.jpg')
  const [bgFilenames, setBgFilenames] = useState([])

  const refreshModelLists = async () => {
    const [llms, rerankers, rewriter] = await Promise.all([
      window.api.modelsListLocal(),
      window.api.modelsListRerankers(),
      window.api.modelsListRewriter()
    ])
    const rank = (f) => (f.source === 'user' ? 2 : f.source === 'app' ? 1 : 2)
    const byName = new Map()
    for (const f of llms || []) {
      const prev = byName.get(f.name)
      if (!prev || rank(f) >= rank(prev)) byName.set(f.name, f)
    }
    setLlmList(Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name)))
    setRerankersList(rerankers || [])
    setRewriterList(rewriter || [])
  }

  useEffect(() => {
    const load = async () => {
      const manifest = await window.api.load('manifest')
      if (manifest?.user) {
        setUserName(manifest.user.name || '')
        setUserEmail(manifest.user.email || '')
      }
      if (manifest?.settings) {
        const s = manifest.settings
        const inf = s.inference || {}
        const rag = s.rag || {}
        const loadedContextLength = inf.contextLength ?? 50000
        const rawTemp = inf.temperature
        const normalizedTemp = Number(rawTemp) === 0.7 ? 0.3 : rawTemp
        setConfig(prev => ({
          inference: {
            file: inf.file ?? prev.inference.file,
            contextLength: inf.contextLength ?? prev.inference.contextLength,
            maxTokens: inf.maxTokens ?? prev.inference.maxTokens,
            temperature: normalizedTemp ?? prev.inference.temperature,
            topP: inf.topP ?? prev.inference.topP,
            topK: inf.topK ?? prev.inference.topK
          },
          rag: {
            chunkSize: rag.chunkSize ?? prev.rag.chunkSize,
            overlapPercent: rag.overlapPercent ?? prev.rag.overlapPercent,
            method: rag.method ?? prev.rag.method,
            searchMethod: rag.searchMethod ?? prev.rag.searchMethod,
            embeddingModel: rag.embeddingModel ?? prev.rag.embeddingModel,
            numChunks: rag.numChunks ?? prev.rag.numChunks,
            rerankerModel: rag.rerankerModel ?? prev.rag.rerankerModel,
            rerankerTopK: rag.rerankerTopK ?? prev.rag.rerankerTopK,
            useRewriteQuery: rag.useRewriteQuery ?? prev.rag.useRewriteQuery,
            rewriterModel: rag.rewriterModel ?? prev.rag.rewriterModel
          }
        }))
        setContextWindowMode(getContextWindowChoice(loadedContextLength))
        if (Number(rawTemp) === 0.7) {
          manifest.settings = manifest.settings || {}
          manifest.settings.inference = { ...(manifest.settings.inference || {}), temperature: 0.3 }
          await window.api.save('manifest', manifest)
        }
      }
      const [prefs, list] = await Promise.all([
        window.api.getPrefs(),
        window.api.listBackgroundImages()
      ])
      setShowBg(prefs.showBg ?? true)
      setBgFilename(prefs.bgFilename ?? 'scificanyon.jpg')
      setBgFilenames(list || [])
      await refreshModelLists()
    }
    load()

    // refresh lists when user comes back after dropping files in models folders
    const onWindowFocus = () => { refreshModelLists() }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshModelLists()
    }
    window.addEventListener('focus', onWindowFocus)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('focus', onWindowFocus)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])

  const handleInferenceChange = (key, val) => {
    setConfig(prev => ({
      ...prev,
      inference: { ...prev.inference, [key]: val }
    }))
  }

  const handleRagChange = (key, val) => {
    setConfig(prev => ({
      ...prev,
      rag: { ...prev.rag, [key]: val }
    }))
  }

  const handleAppearanceChange = async (key, val) => {
    if (key === 'theme') {
      // keep theme in unsecured prefs so signin/signup can use it before unlock
      await window.api.setPrefs('theme', val)
    }
    const manifest = await window.api.load('manifest')
    if (manifest) {
      manifest.settings = manifest.settings || {}
      manifest.settings.appearance = { ...(manifest.settings.appearance || {}), [key]: val }
      await window.api.save('manifest', manifest)
    }
    if (onAppearanceChange) onAppearanceChange({ [key]: val })
    setMsg('Appearance updated')
  }

  const setShowBgPref = (v) => { window.api.setPrefs('showBg', v); setShowBg(v); setMsg('Background updated') }
  const setBgFilenamePref = (filename) => {
    window.api.setPrefs('bgPath', filename)
    setBgFilename(filename)
    setMsg('Background updated')
  }
  const handleChooseBg = async () => {
    const filename = await window.api.chooseBackgroundImage()
    if (filename) {
      setBgFilenamePref(filename)
      const list = await window.api.listBackgroundImages()
      setBgFilenames(list || [])
    }
  }

  const handleSaveInference = async () => {
    const manifest = await window.api.load('manifest')
    if (!manifest) return
    manifest.settings = manifest.settings || {}
    const prevInf = manifest.settings.inference || {}
    manifest.settings.inference = { ...prevInf, ...config.inference }
    await window.api.save('manifest', manifest)
    setMsg('Inference settings saved')
  }

  const handleSaveRag = async () => {
    const manifest = await window.api.load('manifest')
    if (!manifest) return
    manifest.settings = manifest.settings || {}
    const prevRag = manifest.settings.rag || {}
    manifest.settings.rag = { ...prevRag, ...config.rag }
    await window.api.save('manifest', manifest)
    setMsg('Retrieval settings saved')
  }

  const handleUpdateName = async () => {
    const manifest = await window.api.load('manifest')
    if (!manifest) return
    manifest.user = { ...manifest.user, name: userName.trim() }
    await window.api.save('manifest', manifest)
    setMsg('Username updated')
  }

  const handleUpdateEmail = async () => {
    const manifest = await window.api.load('manifest')
    if (!manifest) return
    manifest.user = { ...manifest.user, email: userEmail.trim() }
    await window.api.save('manifest', manifest)
    setMsg('Email updated')
  }

  const handleChangePassword = async () => {
    setPwError('')
    if (!curPw || !newPw) { setPwError('fill in all fields'); return }
    if (newPw.length < 12 || newPw.length > 64) { setPwError('new password must be 12-64 chars'); return }
    if (newPw !== confirmPw) { setPwError('new passwords don\'t match'); return }
    const ok = await window.api.changePassword(curPw, newPw)
    if (!ok) { setPwError('current password is wrong'); return }
    setCurPw(''); setNewPw(''); setConfirmPw('')
    setMsg('Password changed')
  }

  const handleDeleteAccount = async () => {
    setDeleteError('')
    if (!deletePw) { setDeleteError('enter your password'); return }
    const ok = await window.api.deleteAccount(deletePw)
    if (!ok) { setDeleteError('wrong password'); return }
    setDeleteOpen(false)
    if (onLogout) onLogout()
  }

  const pwVisToggle = (setter) => (
    <InputAdornment position="end">
      <IconButton onClick={() => setter(v => !v)} edge="end" size="small">
        {/* just toggle, icon swaps based on state in the field */}
      </IconButton>
    </InputAdornment>
  )

  return (
    <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', p: 1, pr: 2 }}>
      <Typography variant="h5" sx={{ mb: 0.5 }}>Genie Settings</Typography>

      <Grid container spacing={1.5} sx={{ flexWrap: { xs: 'wrap', md: 'nowrap' } }}>
        {/* left column: minWidth 0 so sliders/textfields don't block shrink; otherwise Security gets squeezed */}
        <Grid item xs={12} md={6} sx={(theme) => ({ flex: '0 0 100%', minWidth: '100%', [theme.breakpoints.up('md')]: { flex: '0 0 50%', maxWidth: '50%', minWidth: 0 } })}>
          <Stack spacing={1.5}>
            <Paper sx={{ p: 1.5 }}>
              <Typography variant="subtitle1" color="primary">Inference</Typography>
              <Typography variant="caption" color="textSecondary">Model + generation settings. Requires restart or reload if changed.</Typography>

              <FormControl fullWidth size="small" sx={{ mt: 1 }}>
                <InputLabel>Model Filename (.gguf)</InputLabel>
                <Select
                  value={config.inference.file}
                  label="Model Filename (.gguf)"
                  onChange={(e) => handleInferenceChange('file', e.target.value)}
                >
                  {llmList.map((f) => (
                    <MenuItem key={f.name} value={f.name}>{formatModelOptionLabel(f.name)}</MenuItem>
                  ))}
                  {!llmList.some((f) => f.name === config.inference.file) && config.inference.file ? (
                    <MenuItem value={config.inference.file}>{formatModelOptionLabel(config.inference.file)}</MenuItem>
                  ) : null}
                </Select>
              </FormControl>
              <Typography variant="caption" color="textSecondary" display="block" sx={{ mt: 0.5 }}>
                List refreshes on page load and when app window regains focus.
              </Typography>
              <Typography variant="caption" color="textSecondary" display="block" sx={{ mt: 0.25 }}>
                crude doc tokens ~= chars / 4, so whole-doc stuffing gets expensive fast and usually needs summary
              </Typography>
              <FormControl fullWidth size="small" sx={{ mt: 1 }}>
                <InputLabel>Context Window</InputLabel>
                <Select
                  value={contextWindowMode}
                  label="Context Window"
                  onChange={(e) => {
                    const next = e.target.value
                    setContextWindowMode(next)
                    if (next === 'other') return
                    handleInferenceChange('contextLength', Number(next))
                  }}
                >
                  {CONTEXT_WINDOW_PRESETS.map((opt) => (
                    <MenuItem key={opt.value} value={String(opt.value)}>{opt.label}</MenuItem>
                  ))}
                  <MenuItem value="other">Other</MenuItem>
                </Select>
              </FormControl>
              {contextWindowMode === 'other' ? (
                <TextField
                  label="Custom Context Window (n_ctx)"
                  type="number"
                  size="small"
                  fullWidth
                  sx={{ mt: 1 }}
                  value={config.inference.contextLength}
                  onChange={(e) => handleInferenceChange('contextLength', parseInt(e.target.value) || 0)}
                />
              ) : null}

              <Box sx={{ mt: 1 }}>
                <Typography variant="body2" gutterBottom>Temperature ({config.inference.temperature})</Typography>
                <Slider
                  value={config.inference.temperature}
                  min={0} max={2} step={0.1}
                  onChange={(_, v) => handleInferenceChange('temperature', v)}
                  valueLabelDisplay="auto"
                  size="small"
                />
              </Box>

              <Box sx={{ mt: 0.5 }}>
                <Typography variant="body2" gutterBottom>Top P ({config.inference.topP})</Typography>
                <Slider
                  value={config.inference.topP}
                  min={0} max={1} step={0.05}
                  onChange={(_, v) => handleInferenceChange('topP', v)}
                  valueLabelDisplay="auto"
                  size="small"
                />
              </Box>

              <Box sx={{ mt: 0.5 }}>
                <Typography variant="body2" gutterBottom>Top K ({config.inference.topK})</Typography>
                <Slider
                  value={config.inference.topK}
                  min={1} max={100} step={1}
                  onChange={(_, v) => handleInferenceChange('topK', v)}
                  valueLabelDisplay="auto"
                  size="small"
                />
              </Box>

              <TextField
                label="Max Response Tokens"
                type="number"
                fullWidth
                size="small"
                sx={{ mt: 1 }}
                value={config.inference.maxTokens}
                onChange={(e) => handleInferenceChange('maxTokens', parseInt(e.target.value) || 0)}
              />

              <Divider sx={{ my: 1 }} />

              <Button variant="contained" onClick={handleSaveInference}>
                Save & Apply
              </Button>
            </Paper>

            <Paper sx={{ p: 1.5 }}>
              <Typography variant="subtitle1" color="primary">Retrieval</Typography>
              <Typography variant="caption" color="textSecondary" display="block">Chunking, embedding, and knowledge search.</Typography>

              <Box sx={{ mt: 1 }}>
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Chunking</Typography>
                <TextField
                  label="Chunk Size"
                  type="number"
                  size="small"
                  fullWidth
                  value={config.rag.chunkSize}
                  onChange={(e) => handleRagChange('chunkSize', parseInt(e.target.value) || 512)}
                />
                <Box sx={{ mt: 0.5 }}>
                  <Typography variant="body2" gutterBottom>Overlap ({config.rag.overlapPercent}%)</Typography>
                  <Slider
                    value={config.rag.overlapPercent}
                    min={0} max={50} step={5}
                    onChange={(_, v) => handleRagChange('overlapPercent', v)}
                    valueLabelDisplay="auto"
                    size="small"
                  />
                </Box>
                <FormControl fullWidth size="small" sx={{ mt: 1 }}>
                  <InputLabel>Chunking Method</InputLabel>
                  <Select
                    value={config.rag.method}
                    label="Chunking Method"
                    onChange={(e) => handleRagChange('method', e.target.value)}
                  >
                    <MenuItem value="recursive">Recursive</MenuItem>
                    <MenuItem value="fixed_256_o10">Fixed 256 (o10)</MenuItem>
                    <MenuItem value="fixed_512_o50">Fixed 512 (o50)</MenuItem>
                  </Select>
                </FormControl>
              </Box>

              <Divider sx={{ my: 1 }} />

              <Box>
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Embedding</Typography>
                <FormControl fullWidth size="small">
                  <InputLabel>Embedding Model</InputLabel>
                  <Select
                    value={config.rag.embeddingModel}
                    label="Embedding Model"
                    onChange={(e) => handleRagChange('embeddingModel', e.target.value)}
                  >
                    <MenuItem value="all-MiniLM-L6-v2">all-MiniLM-L6-v2</MenuItem>
                    <MenuItem value="all-mpnet-base-v2">all-mpnet-base-v2</MenuItem>
                  </Select>
                </FormControl>
              </Box>

              <Divider sx={{ my: 1 }} />

              <Box>
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Retrieval</Typography>
                <FormControl fullWidth size="small" sx={{ mb: 1 }}>
                  <InputLabel>Search method</InputLabel>
                  <Select
                    value={config.rag.searchMethod ?? 'vector'}
                    label="Search method"
                    onChange={(e) => handleRagChange('searchMethod', e.target.value)}
                  >
                    <MenuItem value="vector">Semantic (vector)</MenuItem>
                    <MenuItem value="bm25">Keyword (BM25)</MenuItem>
                    <MenuItem value="hybrid">Hybrid (vector + keyword)</MenuItem>
                  </Select>
                </FormControl>
                <TextField
                  label="Chunks to Retrieve (k)"
                  type="number"
                  size="small"
                  fullWidth
                  value={config.rag.numChunks}
                  onChange={(e) => handleRagChange('numChunks', parseInt(e.target.value) || 30)}
                />
              </Box>

              <Divider sx={{ my: 1 }} />

              <Box>
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Reranker</Typography>
                <FormControl fullWidth size="small">
                  <InputLabel>Use reranker</InputLabel>
                  <Select
                    value={config.rag.rerankerModel ?? ''}
                    label="Use reranker"
                    onChange={(e) => handleRagChange('rerankerModel', e.target.value)}
                  >
                    <MenuItem value="">None</MenuItem>
                    {rerankersList.map((f) => (
                      <MenuItem key={f.name} value={f.name}>{f.name}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <Typography variant="caption" color="textSecondary" display="block" sx={{ mt: 0.5 }}>Add reranker model files to the rerankers folder.</Typography>
                <TextField
                  label="Chunks to output (top-k)"
                  type="number"
                  size="small"
                  fullWidth
                  sx={{ mt: 1 }}
                  value={config.rag.rerankerTopK ?? 10}
                  onChange={(e) => handleRagChange('rerankerTopK', parseInt(e.target.value) || 10)}
                />
              </Box>

              <Divider sx={{ my: 1 }} />

              <Box>
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Rewrite query</Typography>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={!!config.rag.useRewriteQuery}
                      onChange={(e) => handleRagChange('useRewriteQuery', e.target.checked)}
                    />
                  }
                  label="Rewrite query before retrieval"
                />
                <FormControl fullWidth size="small" sx={{ mt: 1 }}>
                  <InputLabel>Rewriter model</InputLabel>
                  <Select
                    value={config.rag.rewriterModel ?? ''}
                    label="Rewriter model"
                    onChange={(e) => handleRagChange('rewriterModel', e.target.value)}
                  >
                    <MenuItem value="">None</MenuItem>
                    {rewriterList.map((f) => (
                      <MenuItem key={f.name} value={f.name}>{f.name}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Box>

              <Divider sx={{ my: 1 }} />

              <Button variant="contained" onClick={handleSaveRag}>
                Save retrieval
              </Button>
            </Paper>
          </Stack>
        </Grid>

        {/* right column: Appearance first, Security at bottom */}
        <Grid item xs={12} md={6} sx={(theme) => ({ flex: '0 0 100%', minWidth: '100%', [theme.breakpoints.up('md')]: { flex: '0 0 50%', maxWidth: '50%', minWidth: 0 } })}>
          <Stack spacing={1.5}>
            <Paper sx={{ p: 1.5 }}>
              <Typography variant="subtitle1" color="primary" sx={{ mb: 0.5 }}>Appearance</Typography>

              <Box sx={{ mb: 1 }}>
                <Typography variant="body2" gutterBottom>Text size</Typography>
                <FormControl fullWidth size="small">
                  <Select
                    value={appearance.textSize || 'small'}
                    onChange={(e) => handleAppearanceChange('textSize', e.target.value)}
                  >
                    <MenuItem value="small">Small</MenuItem>
                    <MenuItem value="medium">Medium</MenuItem>
                    <MenuItem value="large">Large</MenuItem>
                  </Select>
                </FormControl>
              </Box>

              <Box sx={{ mb: 1 }}>
                <Typography variant="body2" gutterBottom>Theme</Typography>
                <ToggleButtonGroup
                  value={appearance.theme || 'light'}
                  exclusive
                  fullWidth
                  size="small"
                  onChange={(_, v) => v != null && handleAppearanceChange('theme', v)}
                >
                  <ToggleButton value="light"><Typography variant="body2">Light</Typography></ToggleButton>
                  <ToggleButton value="dark"><Typography variant="body2">Dark</Typography></ToggleButton>
                </ToggleButtonGroup>
              </Box>

              <FormControlLabel control={<Checkbox checked={showBg} onChange={(e) => setShowBgPref(e.target.checked)} />} label="Background image" />
              <FormControl fullWidth size="small" sx={{ mt: 0.5 }} disabled={!showBg}>
                <InputLabel>Background</InputLabel>
                <Select
                  value={bgFilename}
                  label="Background"
                  onChange={(e) => setBgFilenamePref(e.target.value)}
                >
                  {(bgFilenames.length ? bgFilenames : [bgFilename]).map((name) => (
                    <MenuItem key={name} value={name}>{name}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Button variant="outlined" fullWidth disabled={!showBg} onClick={handleChooseBg} sx={{ mt: 0.5 }}>Upload from elsewhere</Button>
            </Paper>

            <Paper sx={{ p: 1.5 }}>
              <Typography variant="subtitle1" color="primary" sx={{ mb: 0.5 }}>Security</Typography>
            <Stack spacing={1}>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                <TextField
                  label="Username"
                  fullWidth
                  size="small"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                />
                <Button variant="outlined" sx={{ minWidth: 120, whiteSpace: 'nowrap', flexShrink: 0 }} onClick={handleUpdateName}>
                  Update Name
                </Button>
              </Box>

              <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                <TextField
                  label="Recovery Email"
                  fullWidth
                  size="small"
                  value={userEmail}
                  onChange={(e) => setUserEmail(e.target.value)}
                />
                <Button variant="outlined" sx={{ minWidth: 120, whiteSpace: 'nowrap', flexShrink: 0 }} onClick={handleUpdateEmail}>
                  Update Email
                </Button>
              </Box>

              <Divider />

              <Typography variant="subtitle2">Change Password</Typography>
              <TextField
                label="Current Password"
                type={showCurPw ? 'text' : 'password'}
                fullWidth
                size="small"
                value={curPw}
                onChange={(e) => setCurPw(e.target.value)}
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton onClick={() => setShowCurPw(v => !v)} edge="end" size="small">
                        {showCurPw ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                      </IconButton>
                    </InputAdornment>
                  )
                }}
              />
              <TextField
                label="New Password"
                type={showNewPw ? 'text' : 'password'}
                fullWidth
                size="small"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton onClick={() => setShowNewPw(v => !v)} edge="end" size="small">
                        {showNewPw ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                      </IconButton>
                    </InputAdornment>
                  )
                }}
              />
              <TextField
                label="Confirm New Password"
                type={showNewPw ? 'text' : 'password'}
                fullWidth
                size="small"
                value={confirmPw}
                onChange={(e) => setConfirmPw(e.target.value)}
              />
              {pwError && <Alert severity="error">{pwError}</Alert>}
              <Button variant="contained" onClick={handleChangePassword}>Change Password</Button>

              <Divider />

              <Button variant="outlined" color="error" onClick={() => { setDeleteOpen(true); setDeletePw(''); setDeleteError('') }}>
                Delete Account
              </Button>
            </Stack>
            </Paper>
          </Stack>
        </Grid>
      </Grid>

      {/* delete confirmation modal */}
      <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete Account</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            This will permanently delete all your data including chats, documents, and encryption keys. This cannot be undone.
          </DialogContentText>
          <TextField
            label="Enter your password to confirm"
            type="password"
            fullWidth
            autoFocus
            value={deletePw}
            onChange={(e) => setDeletePw(e.target.value)}
          />
          {deleteError && <Alert severity="error" sx={{ mt: 2 }}>{deleteError}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteOpen(false)}>Cancel</Button>
          <Button color="error" variant="contained" disabled={!deletePw} onClick={handleDeleteAccount}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={!!msg} autoHideDuration={3000} onClose={() => setMsg('')}>
        <Alert severity="success">{msg}</Alert>
      </Snackbar>
    </Box>
  )
}