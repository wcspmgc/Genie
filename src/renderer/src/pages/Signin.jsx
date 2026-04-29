import { useState } from 'react'
import Container from '@mui/material/Container'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'
import Stack from '@mui/material/Stack'
import Alert from '@mui/material/Alert'
import Snackbar from '@mui/material/Snackbar'
import InputAdornment from '@mui/material/InputAdornment'
import IconButton from '@mui/material/IconButton'
import Visibility from '@mui/icons-material/Visibility'
import VisibilityOff from '@mui/icons-material/VisibilityOff'
import Box from '@mui/material/Box'
import logoHero from '../../../../resources/images/logo748.png'

export default function SignIn({ onSignIn }) {
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [snackOpen, setSnackOpen] = useState(false)
  const [errorSnackOpen, setErrorSnackOpen] = useState(false)
  const [errorSnackMsg, setErrorSnackMsg] = useState('')
  const [errorSnackKey, setErrorSnackKey] = useState(0)

  const showErrorSnackbar = (msg) => {
    setErrorSnackMsg(msg)
    setErrorSnackKey((k) => k + 1)
    setErrorSnackOpen(true)
  }

  // in production this would be an email password reset
  const handleForgotPassword = () => {
    setSnackOpen(true)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (!password) {
      showErrorSnackbar('Enter your password')
      return
    }

    setLoading(true)
    const ok = await onSignIn(password)
    setLoading(false)

    if (!ok) {
      showErrorSnackbar('Wrong password')
      setPassword('')
    }
  }

  return (
    <Container maxWidth="xs" sx={{ mt: 10 }}>
      <Paper elevation={3} sx={{ p: 4 }}>
        <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
          <Box
            component="img"
            src={logoHero}
            alt=""
            sx={{ width: 'min(280px, 75vw)', height: 'auto', maxHeight: 220, display: 'block' }}
          />
        </Box>
        <Typography variant="h4" gutterBottom sx={{ textAlign: 'center' }}>
          Genie
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 3, textAlign: 'center' }}>
          Welcome back
        </Typography>

        <form onSubmit={handleSubmit}>
          <Stack spacing={2}>
            <TextField
              fullWidth
              label="Password"
              type={showPw ? 'text' : 'password'}
              value={password}
              onChange={(e) => { setPassword(e.target.value) }}
              autoFocus
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton onClick={() => setShowPw(!showPw)} edge="end" size="small">
                      {showPw ? <VisibilityOff /> : <Visibility />}
                    </IconButton>
                  </InputAdornment>
                )
              }}
            />
            <Button
              fullWidth
              variant="contained"
              size="large"
              type="submit"
              disabled={loading}
            >
              {loading ? 'Unlocking...' : 'Unlock'}
            </Button>
            <Button
              fullWidth
              size="small"
              variant="text"
              sx={{ textTransform: 'none' }}
              onClick={handleForgotPassword}
              disabled={loading}
            >
              Forgot Password
            </Button>
          </Stack>
        </form>
      </Paper>
      <Snackbar
        open={snackOpen}
        autoHideDuration={10000}
        onClose={() => setSnackOpen(false)}
        message="Recovery email sent"
      />
      <Snackbar
        key={errorSnackKey}
        open={errorSnackOpen}
        autoHideDuration={5000}
        onClose={() => setErrorSnackOpen(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={() => setErrorSnackOpen(false)} severity="error" variant="filled" sx={{ width: '100%' }}>
          {errorSnackMsg}
        </Alert>
      </Snackbar>
    </Container>
  )
}
