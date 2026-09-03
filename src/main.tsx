import '@fontsource/barlow-condensed/500.css'
import '@fontsource/barlow-condensed/600.css'
import '@fontsource/barlow-condensed/700.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import '@fontsource/ibm-plex-mono/600.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { OutputView } from './OutputView'
import './styles.css'

const parameters = new URLSearchParams(window.location.search)
const outputMode = parameters.get('view') === 'output'

createRoot(document.getElementById('root')!).render(
  <StrictMode>{outputMode ? <OutputView /> : <App />}</StrictMode>,
)
