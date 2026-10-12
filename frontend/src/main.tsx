import { createRoot } from 'react-dom/client'
import { App } from './App'
import { MockReminderClient } from './services/mock-reminder-client'
import { BrowserPreferenceStore } from './services/storage'
import { DesktopClient } from './services/desktop-client'
import type { DesktopView } from '../../shared/desktop'
import './styles.css'

const root = createRoot(document.getElementById('root')!)
async function launch() {
  if (window.remind) {
    document.documentElement.dataset.desktop = 'true'
    const client = await DesktopClient.connect(window.remind)
    const params = new URLSearchParams(location.search)
    const view = params.get('view') as DesktopView
    root.render(<App client={client} updates={client} shell={view === 'panel' ? client : undefined} desktopView={view} desktopSound={params.get('sound') === '1'} />)
    if (import.meta.hot) import.meta.hot.dispose(() => client.dispose())
  } else {
    const client = new MockReminderClient(new BrowserPreferenceStore())
    root.render(<App client={client} preview={client} />)
    if (import.meta.hot) import.meta.hot.dispose(() => client.dispose())
  }
}
void launch().catch(() => root.render(<main className="connection-error"><p>连接失败</p><button className="button primary" onClick={() => location.reload()}>重新连接</button></main>))
