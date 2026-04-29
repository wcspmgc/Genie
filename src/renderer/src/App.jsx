import { useState, useEffect, useRef } from 'react'
import { ThemeProvider } from '@mui/material/styles'
import CssBaseline from '@mui/material/CssBaseline'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import SignIn from './pages/SignIn'
import Signup from './pages/SignUp'
import AuthLayout from './layouts/AuthLayout'
import Chat from './pages/Chat'
import Documents from './pages/Documents'
import Models from './pages/Models'
import Search from './pages/Search'
import Settings from './pages/Settings'
import MainLayout from './layouts/MainLayout'
import { getTheme } from './theme'
import fadedLogo from '../../../resources/images/logo748faded.png'

function App() {
  const [view, setView] = useState(null)
  const [chatList, setChatList] = useState([])
  const [currentChatId, setCurrentChatId] = useState(null)
  const [userName, setUserName] = useState('')
  const [themeMode, setThemeMode] = useState('light')
  const [textSize, setTextSize] = useState('small')

  const prevViewRef = useRef(null)

  // tear down llama chat child only when leaving the Chat *page* — not on Chat component remount (Strict Mode)
  useEffect(() => {
    const prev = prevViewRef.current
    if (prev === 'Chat' && view !== 'Chat') {
      window.api.unloadModel()
    }
    prevViewRef.current = view
  }, [view])

  const applyThemeFromPrefs = async () => {
    try {
      const p = await window.api.getPrefs()
      const t = p?.theme
      if (t === 'dark' || t === 'light') setThemeMode(t)
    } catch (_) {
      // prefs are best-effort, keep default theme if read fails
    }
  }

  // figure out if this is a fresh install or returning user
  useEffect(() => {
    applyThemeFromPrefs()
    window.api.isSetup().then((setup) => {
      setView(setup ? 'SignIn' : 'SignUp')
    })
  }, [])

  const handleSignup = async (password, profile) => {
    const ok = await window.api.setup(password)
    if (!ok) return
    await applyThemeFromPrefs()

    // db is unlocked after setup, save user profile into manifest
    const manifest = await window.api.load('manifest')
    if (manifest) {
      manifest.user = profile
      await window.api.save('manifest', manifest)
      const app = manifest.settings?.appearance
      if (app) {
        setTextSize(app.textSize || 'small')
      }
    }

    setUserName(profile.name)
    setChatList([])
    setCurrentChatId(null)
    setView('Chat')
  }

  const handleLogin = async (password) => {
    const ok = await window.api.unlock(password)
    if (!ok) return false
    await applyThemeFromPrefs()

    const manifest = await window.api.load('manifest')
    if (manifest?.settings?.inference && Number(manifest.settings.inference.temperature) === 0.7) {
      manifest.settings.inference.temperature = 0.3
      await window.api.save('manifest', manifest)
    }
    const chats = manifest?.chats || []
    setUserName(manifest?.user?.name || '')
    const app = manifest?.settings?.appearance
    if (app) {
      setTextSize(app.textSize || 'small')
    }

    setChatList(chats)
    setCurrentChatId(null)
    setView('Chat')
    return true
  }

  const handleLogout = async () => {
    setChatList([])
    setCurrentChatId(null)
    setUserName('')
    const setup = await window.api.isSetup()
    setView(setup ? 'SignIn' : 'SignUp')
  }

  const handleNewChat = async () => {
    const result = await window.api.createChat()
    if (!result) return
    setChatList(result.chats)
    setCurrentChatId(result.id)
    setView('Chat')
  }

  const handleSelectChat = (id) => {
    setCurrentChatId(id)
    setView('Chat')
  }

  const handleChatCreated = async (id) => {
    const manifest = await window.api.load('manifest')
    if (manifest?.chats) setChatList(manifest.chats)
    setCurrentChatId(id)
  }

  const handleChatRename = async (id, title) => {
    const chats = await window.api.renameChat(id, title)
    if (chats) setChatList(chats)
  }

  const handleChatDelete = async (id) => {
    const chats = await window.api.deleteChat(id)
    if (!chats) return
    setChatList(chats)
    if (id === currentChatId) {
      const next = chats[0]?.id ?? null
      setCurrentChatId(next)
      setView(next ? 'Chat' : 'Chat')
    }
  }

  const handleAppearanceChange = (updates) => {
    if (updates.theme != null) setThemeMode(updates.theme)
    if (updates.textSize != null) setTextSize(updates.textSize)
  }

  if (!view) return null

  if (view === 'SignUp') {
    return (
      <ThemeProvider theme={getTheme(themeMode, textSize)}>
        <CssBaseline />
        <AuthLayout><Signup onSignup={handleSignup} /></AuthLayout>
      </ThemeProvider>
    )
  }

  if (view === 'SignIn') {
    return (
      <ThemeProvider theme={getTheme(themeMode, textSize)}>
        <CssBaseline />
        <AuthLayout><SignIn onSignIn={handleLogin} /></AuthLayout>
      </ThemeProvider>
    )
  }

  return (
    <ThemeProvider theme={getTheme(themeMode, textSize)}>
      <CssBaseline />
    <MainLayout
      activePage={view}
      onNavigate={(page) => setView(page)}
      onLogout={handleLogout}
      chatList={chatList}
      currentChatId={currentChatId}
      onSelectChat={handleSelectChat}
      onNewChat={handleNewChat}
      onChatRename={handleChatRename}
      onChatDelete={handleChatDelete}
    >
      {view === 'Chat' && (currentChatId ? (
        <Chat currentChatId={currentChatId} onChatCreated={handleChatCreated} />
      ) : (
        <Box sx={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          <Box
            component="img"
            src={fadedLogo}
            alt=""
            sx={{
              position: 'absolute',
              left: '50%',
              top: '44%',
              transform: 'translate(-50%, -50%)',
              width: { xs: 280, md: 420 },
              maxWidth: '70%',
              opacity: 0.5,
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
            <Typography color="text.secondary">Select a chat or create one</Typography>
          </Box>
        </Box>
      ))}
      {view === 'Documents' && <Documents />}
      {view === 'Models' && <Models />}
      {view === 'Search' && <Search />}
      {view === 'Settings' && (
        <Settings
          onLogout={handleLogout}
          onAppearanceChange={handleAppearanceChange}
          appearance={{ theme: themeMode, textSize }}
        />
      )}
    </MainLayout>
    </ThemeProvider>
  )
}

export default App
