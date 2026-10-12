import { createRoot } from 'react-dom/client'
import { App } from './App'
import { MockReminderClient } from './services/mock-reminder-client'
import { BrowserPreferenceStore } from './services/storage'
import './styles.css'

const client = new MockReminderClient(new BrowserPreferenceStore())
createRoot(document.getElementById('root')!).render(<App client={client} preview={client} />)
if (import.meta.hot) import.meta.hot.dispose(() => client.dispose())
