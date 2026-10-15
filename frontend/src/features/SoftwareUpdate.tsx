import { useState, useSyncExternalStore } from 'react'
import { Download, RefreshCw } from 'lucide-react'
import type { UpdateClient } from '../services/desktop-client'
import type { UpdateSnapshot } from '../../../shared/desktop'

function followUp(update: UpdateSnapshot): { action: 'download' | 'install' | 'releases'; label: string } | null {
  if (update.status === 'available') return update.delivery === 'browser' ? { action: 'releases', label: '前往下载' } : { action: 'download', label: '下载更新' }
  if (update.status === 'downloading') return { action: 'download', label: `下载中 ${Math.floor(update.progress)}%` }
  if (update.status === 'downloaded') return { action: 'install', label: '重启安装' }
  if (update.status === 'installing') return { action: 'install', label: '安装中…' }
  if (update.status === 'error') return { action: 'releases', label: '手动下载' }
  if (update.status === 'unsupported') return { action: 'releases', label: '查看版本' }
  return null
}

export function SoftwareUpdate({ client }: { client: UpdateClient }) {
  const update = useSyncExternalStore(client.subscribe, client.getUpdateSnapshot)
  const [error, setError] = useState('')
  const busy = update.status === 'checking' || update.status === 'downloading' || update.status === 'installing'
  const next = followUp(update)
  const waiting = update.status === 'available' || update.status === 'downloading' || update.status === 'downloaded' || update.status === 'installing'
  const description = error || update.message || (update.status === 'checking' ? '正在检查新版本' : update.status === 'available' ? `新版本 ${update.version}` : update.status === 'downloaded' ? `${update.version} 已就绪，安装将重启软件` : update.status === 'current' ? '已是最新版本' : '由你决定下载和安装')
  async function run(action: 'check' | 'download' | 'install' | 'releases') {
    setError('')
    try { await client.update(action) } catch { setError('操作失败，请重试') }
  }
  return <section className="settings-section software-update">
    <h2><RefreshCw size={15} />软件更新{waiting && <span className="update-dot" aria-label="有可用更新" />}<span className="version-label">v{update.currentVersion}</span></h2>
    <div className="update-row">
      <span className="helper" role="status">{description}</span>
      <span className="update-actions">
        {update.status !== 'unsupported' && <button className="text-button" disabled={busy} onClick={() => void run('check')}><RefreshCw size={14} className={update.status === 'checking' ? 'spinning' : ''} />{update.status === 'checking' ? '检查中…' : '检查更新'}</button>}
        {next && <button className="text-button" disabled={busy} onClick={() => void run(next.action)}><Download size={14} />{next.label}</button>}
      </span>
    </div>
    {update.status === 'downloading' && <progress aria-label="更新下载进度" value={update.progress} max={100} />}
  </section>
}
