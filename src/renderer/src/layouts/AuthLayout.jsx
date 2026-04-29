import { useState, useEffect } from 'react'
import { Box } from '@mui/material'

export default function AuthLayout({ children }) {
  const [bg, setBg] = useState(null)
  useEffect(() => {
    window.api.getPrefs().then((p) => {
      const showBg = p?.showBg ?? true
      const bgPath = p?.bgPath || 'scificanyon.jpg'
      if (!showBg || !bgPath) {
        setBg(null)
        return
      }
      window.api.getBackgroundImageDataUrl(bgPath).then((dataUrl) => setBg(dataUrl || null))
    })
  }, [])
  return (
    <Box sx={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', ...(bg && { backgroundImage: `url(${bg})`, backgroundSize: 'cover', backgroundPosition: 'center' }) }}>
      {children}
    </Box>
  )
}
