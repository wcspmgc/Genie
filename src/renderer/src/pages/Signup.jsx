import { useState } from 'react'
import Container from '@mui/material/Container'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'
import Stack from '@mui/material/Stack'
import Alert from '@mui/material/Alert'
import InputAdornment from '@mui/material/InputAdornment'
import IconButton from '@mui/material/IconButton'
import Visibility from '@mui/icons-material/Visibility'
import VisibilityOff from '@mui/icons-material/VisibilityOff'
import Box from '@mui/material/Box'
import logoHero from '../../../../resources/images/logo748.png'

export default function SignUp({ onSignup }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (!name.trim() || !password) {
      setError('name and password are required')
      return
    }
    if (password.length < 12 || password.length > 64) {
      setError('password must be 12-64 chars')
      return
    }
    if (password !== confirm) {
      setError('passwords dont match')
      return
    }

    await onSignup(password, { name: name.trim(), email: email.trim() })
  }

  const pwEndAdornment = (
    <InputAdornment position="end">
      <IconButton onClick={() => setShowPw(!showPw)} edge="end" size="small">
        {showPw ? <VisibilityOff /> : <Visibility />}
      </IconButton>
    </InputAdornment>
  )

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
          Create your account
        </Typography>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <form onSubmit={handleSubmit}>
          <Stack spacing={2}>
            <TextField
              fullWidth
              label="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
            <TextField
              fullWidth
              label="Email (optional)"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <TextField
              fullWidth
              label="Master Password"
              type={showPw ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              InputProps={{ endAdornment: pwEndAdornment }}
            />
            <TextField
              fullWidth
              label="Confirm Password"
              type={showPw ? 'text' : 'password'}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              InputProps={{ endAdornment: pwEndAdornment }}
            />
            <Button fullWidth variant="contained" size="large" type="submit">
              Create Account
            </Button>
          </Stack>
        </form>
      </Paper>
    </Container>
  )
}
