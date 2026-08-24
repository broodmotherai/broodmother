export interface MenuItem {
  label: string
  action: () => void
  danger?: boolean
  disabled?: boolean
}

/**
 * A context menu with no library behind it: a view zone lives outside React, so the app's
 * menu primitives cannot reach it. It borrows their class names instead, which is what
 * keeps the two indistinguishable on screen.
 */
export function openMenu(
  document: Document,
  at: { x: number; y: number },
  sections: MenuItem[][],
): void {
  const surface = document.createElement('div')
  surface.className = 'menu-surface'
  surface.dataset.state = 'open'
  surface.style.position = 'fixed'
  surface.tabIndex = -1

  const rows: { element: HTMLElement; item: MenuItem }[] = []
  let active = -1

  function highlight(index: number): void {
    active = index
    rows.forEach(({ element }, one) => {
      if (one === index) element.setAttribute('data-highlighted', '')
      else element.removeAttribute('data-highlighted')
    })
  }

  function close(): void {
    document.removeEventListener('mousedown', onAway, true)
    document.removeEventListener('wheel', close, true)
    document.removeEventListener('keydown', onKey, true)
    surface.remove()
  }

  function onAway(event: MouseEvent): void {
    if (event.target instanceof Node && surface.contains(event.target)) return
    close()
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      highlight((active + step + rows.length) % rows.length)
      return
    }
    if (event.key === 'Enter' && active >= 0) {
      event.preventDefault()
      const row = rows[active]
      close()
      row?.item.action()
    }
  }

  for (const section of sections) {
    const box = document.createElement('div')
    box.className = 'menu-section'
    for (const item of section) {
      const row = document.createElement('div')
      row.className = 'menu-item'
      if (item.danger) row.setAttribute('data-danger', '')
      if (item.disabled) row.setAttribute('data-disabled', '')
      const label = document.createElement('span')
      label.className = 'menu-label'
      label.textContent = item.label
      row.appendChild(label)
      if (!item.disabled) {
        const index = rows.length
        row.addEventListener('mouseenter', () => highlight(index))
        row.addEventListener('mousedown', (event) => event.preventDefault())
        row.addEventListener('click', () => {
          close()
          item.action()
        })
        rows.push({ element: row, item })
      }
      box.appendChild(row)
    }
    surface.appendChild(box)
  }

  document.addEventListener('mousedown', onAway, true)
  document.addEventListener('wheel', close, true)
  document.addEventListener('keydown', onKey, true)

  document.body.appendChild(surface)
  surface.style.left = `${at.x}px`
  surface.style.top = `${at.y}px`
  const view = document.defaultView
  if (view) {
    const rect = surface.getBoundingClientRect()
    surface.style.left = `${Math.max(8, Math.min(at.x, view.innerWidth - rect.width - 8))}px`
    surface.style.top = `${Math.max(8, Math.min(at.y, view.innerHeight - rect.height - 8))}px`
  }
  surface.focus()
}
