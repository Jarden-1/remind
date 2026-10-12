export function Toggle({ label, description, checked, onChange, disabled = false }: {
  label: string; description?: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean
}) {
  return <label className={`toggle-row ${disabled ? 'disabled' : ''}`}>
    <span className="toggle-copy"><span className="setting-label">{label}</span>{description && <span className="helper">{description}</span>}</span>
    <input type="checkbox" role="switch" checked={checked} onChange={event => onChange(event.target.checked)} disabled={disabled} />
    <span className="switch-track" aria-hidden="true"><span /></span>
  </label>
}
