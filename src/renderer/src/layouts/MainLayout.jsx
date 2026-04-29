import { useState } from 'react'
import {
  Box, Drawer, List, ListItem, ListItemButton, ListItemIcon, ListItemText,
  AppBar, Toolbar, Typography, Button, Divider, IconButton, Dialog, DialogTitle,
  DialogContent, DialogActions, TextField
} from '@mui/material'
import { Edit as EditIcon, Delete as DeleteIcon } from '@mui/icons-material'
import ManageSearchIcon from '@mui/icons-material/ManageSearch'
import TuneIcon from '@mui/icons-material/Tune'
import SmartToyIcon from '@mui/icons-material/SmartToy'
import ArticleOutlinedIcon from '@mui/icons-material/ArticleOutlined'
import MapsUgcOutlinedIcon from '@mui/icons-material/MapsUgcOutlined'
import logoToolbar from '../../../../resources/images/logo.ico'

const drawerWidth = '25vw'
const MAX_CHATS = 20

const navItems = [
  { page: 'Settings', label: 'Settings', Icon: TuneIcon },
  { page: 'Documents', label: 'Documents', Icon: ArticleOutlinedIcon },
  { page: 'Models', label: 'Models', Icon: SmartToyIcon },
  { page: 'Search', label: 'Knowledge Search', Icon: ManageSearchIcon },
]

export default function MainLayout({
  children, activePage, onNavigate, onLogout,
  chatList = [], currentChatId, onSelectChat, onNewChat,
  onChatRename, onChatDelete
}) {
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameChat, setRenameChat] = useState(null)
  const [renameValue, setRenameValue] = useState('')

  const handleRenameOpen = (e, chat) => {
    e.stopPropagation()
    setRenameChat(chat)
    setRenameValue(chat.title || '')
    setRenameOpen(true)
  }

  const handleRenameClose = () => {
    setRenameOpen(false)
    setRenameChat(null)
    setRenameValue('')
  }

  const handleRenameConfirm = async () => {
    if (!renameChat || !renameValue.trim()) return
    await onChatRename?.(renameChat.id, renameValue.trim())
    handleRenameClose()
  }

  const handleDelete = (e, chat) => {
    e.stopPropagation()
    onChatDelete?.(chat.id)
  }

  const atLimit = chatList.length >= MAX_CHATS

  return (
    <Box sx={{ display: 'flex', height: '100vh' }}>
      <AppBar position="fixed" sx={{ zIndex: (theme) => theme.zIndex.drawer + 1 }}>
        <Toolbar>
          <Box
            component="img"
            src={logoToolbar}
            alt=""
            sx={{ height: 36, width: 'auto', mr: 1.5, flexShrink: 0, display: 'block' }}
          />
          <Typography variant="h6" noWrap sx={{ flexGrow: 1 }}>
            Genie
          </Typography>
          <Button color="inherit" onClick={onLogout}>Logout</Button>
        </Toolbar>
      </AppBar>

      <Drawer
        variant="permanent"
        sx={{
          width: drawerWidth,
          flexShrink: 0,
          '& .MuiDrawer-paper': { width: drawerWidth, boxSizing: 'border-box' },
        }}
      >
        <Toolbar />
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
          <List sx={{ flexShrink: 0 }}>
            {navItems.map(({ page, label, Icon }) => (
              <ListItem key={page} disablePadding>
                <ListItemButton
                  selected={activePage === page}
                  onClick={() => onNavigate(page)}
                  sx={{ py: 1.5 }}
                >
                  <ListItemIcon sx={{ minWidth: 44 }}>
                    <Icon sx={{ fontSize: 26 }} />
                  </ListItemIcon>
                  <ListItemText primary={label} primaryTypographyProps={{ variant: 'body1' }} />
                </ListItemButton>
              </ListItem>
            ))}
          </List>

          <Divider />

          <Box sx={{ px: 1, py: 1, flexShrink: 0 }}>
            <Button
              fullWidth
              variant="outlined"
              size="medium"
              startIcon={<MapsUgcOutlinedIcon sx={{ fontSize: 24 }} />}
              onClick={onNewChat}
              disabled={atLimit}
              sx={{ py: 1 }}
            >
              <Typography variant="body2"> New Chat</Typography>
            </Button>
          </Box>

          <List dense sx={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
            {chatList.map((chat) => (
              <ListItem
                key={chat.id}
                disablePadding
                secondaryAction={
                  <Box sx={{ display: 'flex', gap: 0 }}>
                    <IconButton
                      size="small"
                      onClick={(e) => handleRenameOpen(e, chat)}
                      sx={{ p: 0.5, color: 'text.secondary', opacity: 0.35, '&:hover': { opacity: 1 } }}
                    >
                      <EditIcon sx={(theme) => ({ fontSize: theme.typography.body2.fontSize })} />
                    </IconButton>
                    <IconButton
                      size="small"
                      onClick={(e) => handleDelete(e, chat)}
                      sx={{ p: 0.5, color: 'text.secondary', opacity: 0.35, '&:hover': { opacity: 1 } }}
                    >
                      <DeleteIcon sx={(theme) => ({ fontSize: theme.typography.body2.fontSize })} />
                    </IconButton>
                  </Box>
                }
              >
                <ListItemButton
                  selected={currentChatId === chat.id}
                  onClick={() => onSelectChat(chat.id)}
                  sx={{ py: 0.5, pr: 5 }}
                >
                  <ListItemText
                    primary={chat.title || chat.id}
                    primaryTypographyProps={{
                      variant: 'body2',
                      noWrap: true,
                      color: 'text.secondary',
                    }}
                  />
                </ListItemButton>
              </ListItem>
            ))}
          </List>
        </Box>
      </Drawer>

      <Dialog open={renameOpen} onClose={handleRenameClose} maxWidth="xs" fullWidth>
        <DialogTitle>Rename chat</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="Title"
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

      <Box component="main" sx={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Toolbar />
        <Box sx={{ flex: 1, minHeight: 0, minWidth: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', pt: 2, px: { xs: 1, md: 2 }, pb: 2 }}>
          {children}
        </Box>
      </Box>
    </Box>
  )
}
