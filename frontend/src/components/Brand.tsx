export function Brand({ small = false }: { small?: boolean }) {
  return <div className={`brand ${small ? 'brand-small' : ''}`}>
    <svg className="brand-mark" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="5" width="5" height="14" rx="2.5" fill="currentColor" />
      <rect x="14" y="5" width="5" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
    </svg><span>remind</span>
  </div>
}
