import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

/** Portals escape the native panel's clipping and keep the entire menu in the viewport. */
export function ChoiceMenu({ open, anchor, above, alignEnd, onClose, children }: {
  open: boolean; anchor: RefObject<HTMLDivElement | null>; above?: boolean; alignEnd?: boolean; onClose: () => void; children: ReactNode
}) {
  const menu = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: 8, top: 8 })
  useLayoutEffect(() => {
    if (!open || !menu.current || !anchor.current) return
    const place = () => {
      if (!menu.current || !anchor.current) return
      const rect = anchor.current.getBoundingClientRect(), box = menu.current.getBoundingClientRect()
      const below = rect.bottom + 6, top = rect.top - box.height - 8
      const useAbove = above ? top >= 8 : below + box.height > innerHeight - 8 && top >= 8
      setPosition({
        left: Math.max(8, Math.min(alignEnd ? rect.right - box.width : rect.left, innerWidth - box.width - 8)),
        top: Math.max(8, Math.min(useAbove ? top : below, innerHeight - box.height - 8)),
      })
    }
    place()
    const first = menu.current.querySelector<HTMLButtonElement>('[aria-checked="true"]') ?? menu.current.querySelector<HTMLButtonElement>('[role^="menuitem"]')
    first?.focus()
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true)
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  }, [open, anchor, above, alignEnd])
  if (!open) return null
  return createPortal(<div ref={menu} className="choice-menu" role="menu" data-choice style={{ position: 'fixed', left: position.left, top: position.top, right: 'auto', bottom: 'auto', maxHeight: 'calc(100dvh - 16px)', overflowY: 'auto' }} onKeyDown={event => {
    if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation() }
      anchor.current?.querySelector<HTMLButtonElement>('button')?.focus(); onClose(); return
    }
    if (event.target instanceof HTMLInputElement) return
    const buttons = [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]') ?? [])]
    let index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (event.key === 'ArrowDown') index = (index + 1) % buttons.length
    else if (event.key === 'ArrowUp') index = (index + buttons.length - 1) % buttons.length
    else if (event.key === 'Home') index = 0
    else if (event.key === 'End') index = buttons.length - 1
    else return
    event.preventDefault(); buttons[index]?.focus()
  }}>{children}</div>, document.body)
}
