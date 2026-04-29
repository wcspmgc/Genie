import { createTheme } from '@mui/material/styles'

const fontFamily = '"Inter", "Roboto", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'

const baseTypography = {
  fontFamily,
  h1: { fontSize: '2.5rem', fontWeight: 600 },
  h2: { fontSize: '2rem', fontWeight: 600 },
  h3: { fontSize: '1.75rem', fontWeight: 600 },
  h4: { fontSize: '1.5rem', fontWeight: 600 },
  h5: { fontSize: '1.25rem', fontWeight: 600 },
  h6: { fontSize: '1rem', fontWeight: 600 },
  subtitle1: { fontSize: '0.95rem', fontWeight: 500 },
  subtitle2: { fontSize: '0.875rem', fontWeight: 500 },
  body1: { fontSize: '1rem', lineHeight: 1.6 },
  body2: { fontSize: '0.875rem', lineHeight: 1.6 },
  caption: { fontSize: '0.75rem' },
}

const SCALE_FACTORS = { small: 1, medium: 1.15, large: 2}

function scaleTypography(typography, factor) {
  if (factor === 1) return typography
  const scaled = { ...typography }
  for (const key of Object.keys(scaled)) {
    if (typeof scaled[key] === 'object' && scaled[key]?.fontSize) {
      const match = String(scaled[key].fontSize).match(/^([\d.]+)rem$/)
      if (match) {
        scaled[key] = { ...scaled[key], fontSize: `${(parseFloat(match[1]) * factor).toFixed(2)}rem` }
      }
    }
  }
  return scaled
}

const typography = baseTypography

export const themeDark = createTheme({
  typography,
  palette: {
    mode: 'dark',
    primary: { main: '#6988e6' },
    background: {
      default: '#1b1b1f',
      paper: '#222222',
    },
    text: {
      primary: 'rgba(255, 255, 245, 0.86)',
      secondary: 'rgba(235, 235, 245, 0.6)',
      disabled: 'rgba(235, 235, 245, 0.38)',
    },
    divider: 'rgba(255, 255, 255, 0.12)',
    action: { hover: 'rgba(255, 255, 255, 0.08)' },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: (theme) => ({
        body: {
          '& *::-webkit-scrollbar': { width: 12, height: 12 },
          '& *::-webkit-scrollbar-button': { display: 'none' },
          '& *::-webkit-scrollbar-track': { background: 'transparent' },
          '& *::-webkit-scrollbar-thumb': {
            background: theme.palette.divider,
            borderRadius: 6,
          },
        },
      }),
    },
  },
})

export const themeLight = createTheme({
  typography,
  palette: {
    mode: 'light',
    primary: { main: '#5c6bc0' },
    background: {
      default: '#f8f8f8',
      paper: '#ffffff',
    },
    text: {
      primary: 'rgba(0, 0, 0, 0.87)',
      secondary: 'rgba(0, 0, 0, 0.6)',
      disabled: 'rgba(0, 0, 0, 0.38)',
    },
    divider: 'rgba(0, 0, 0, 0.12)',
    action: { hover: 'rgba(0, 0, 0, 0.04)' },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: (theme) => ({
        body: {
          '& *::-webkit-scrollbar': { width: 12, height: 12 },
          '& *::-webkit-scrollbar-button': { display: 'none' },
          '& *::-webkit-scrollbar-track': { background: 'transparent' },
          '& *::-webkit-scrollbar-thumb': {
            background: theme.palette.divider,
            borderRadius: 6,
          },
        },
      }),
    },
  },
})

export const getTheme = (mode, textSize = 'small') => {
  const factor = SCALE_FACTORS[textSize] ?? 1
  const base = mode === 'light' ? themeLight : themeDark
  if (factor === 1) return base
  return createTheme({
    ...base,
    typography: scaleTypography(base.typography, factor),
  })
}
