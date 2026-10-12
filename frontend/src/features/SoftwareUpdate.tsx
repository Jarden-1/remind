import { useState, useSyncExternalStore } from 'react'
import { Download, RefreshCw } from 'lucide-react'
import type { UpdateClient } from '../services/desktop-client'

export function SoftwareUpdate({ client }: { client: UpdateClient }) {
  const update = useSyncExternalStore(client.subscribe, client.getUpdateSnapshot)
  const [error, setError] = useState('')
  const busy = update.status === 'checking' || update.status === 'downloading' || update.status === 'installing'
  const labels = {
    idle: '检查更新', checking: '检查中…', available: '下载更新', downloading: `下载中 ${Math.floor(update.progress)}%`,
    downloaded: '重启安装', installing: '安装中…', current: '检查更新', error: '重试', unsupported: '查看版本',
  }
  const description = update.message || (update.status === 'available' ? `新版本 ${update.version}` : update.status === 'downloaded' ? `${update.version} 已就绪，安装将重启软件` : update.status === 'current' ? '已是最新版本' : '由你决定何时更新')
  async function run(action: 'check' | 'download' | 'install' | 'releases') {
    setError('')
    try { await client.update(action) } catch { setError('操作失败，请重试') }
  }
  return <section className="settings-section software-update">
    <h2><RefreshCw size={15} />软件更新<span className="version-label">v{update.currentVersion}</span></h2>
    <div className="update-row"><span className="helper" role="status">{error || description}</span><button className="text-button" disabled={busy} onClick={() => void run(update.status === 'available' ? 'download' : update.status === 'downloaded' ? 'install' : update.status === 'unsupported' ? 'releases' : 'check')}>
      {update.status === 'available' ? <Download size={14} /> : <RefreshCw size={14} className={busy ? 'spinning' : ''} />}{labels[update.status]}</button></div>
    {update.status === 'downloading' && <progress aria-label="更新下载进度" value={update.progress} max={100} />}
    {update.status === 'error' && <button className="text-button" onClick={() => void run('releases')}>手动下载</button>}
  </section>
}
