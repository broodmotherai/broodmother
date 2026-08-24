'use client'

import * as Context from '@radix-ui/react-context-menu'
import { useRef, type ReactNode, type RefObject } from 'react'
import { BranchRow, MenuRow, type MenuBranch, type MenuSection } from './menu'

/**
 * The same rows as the dropdown, opened by the right button on the thing they act on
 * rather than by a control that stands for it. Sections and styling are shared with
 * `Menu`; only the anchor differs, and the primitive underneath handles it.
 */
export function ContextMenu({
  label,
  sections,
  children,
}: {
  label: string
  sections: MenuSection[]
  children: ReactNode
}) {
  // The primitive restores focus a timeout after the menu closes — late enough to blur a
  // row that the selection has just turned into a field, and blur is how such a field
  // ends. A chosen row decides where focus goes; only a dismissal puts it back.
  const acted = useRef(false)
  return (
    <Context.Root>
      <Context.Trigger asChild>{children}</Context.Trigger>
      <Context.Portal>
        <Context.Content
          className="menu-surface"
          aria-label={label}
          collisionPadding={8}
          loop
          onCloseAutoFocus={(event) => {
            if (acted.current) event.preventDefault()
            acted.current = false
          }}
        >
          {sections.map((section, index) => (
            <Section key={section.heading ?? index} section={section} acted={acted} />
          ))}
        </Context.Content>
      </Context.Portal>
    </Context.Root>
  )
}

function Section({
  section,
  acted,
}: {
  section: MenuSection
  acted: RefObject<boolean>
}) {
  return (
    <div className="menu-section">
      {section.heading && (
        <Context.Label className="menu-heading">{section.heading}</Context.Label>
      )}
      {section.actions.map((entry) =>
        'sub' in entry ? (
          <Branch key={entry.id} branch={entry} acted={acted} />
        ) : (
          <Context.Item
            key={entry.id}
            className="menu-item"
            disabled={entry.disabled}
            data-danger={entry.danger || undefined}
            onSelect={() => {
              acted.current = true
              entry.onSelect()
            }}
          >
            <MenuRow action={entry} />
          </Context.Item>
        ),
      )}
    </div>
  )
}

function Branch({ branch, acted }: { branch: MenuBranch; acted: RefObject<boolean> }) {
  return (
    <Context.Sub>
      <Context.SubTrigger className="menu-item">
        <BranchRow branch={branch} />
      </Context.SubTrigger>
      <Context.Portal>
        <Context.SubContent className="menu-surface" collisionPadding={8} loop>
          {branch.sub.map((section, index) => (
            <Section key={section.heading ?? index} section={section} acted={acted} />
          ))}
        </Context.SubContent>
      </Context.Portal>
    </Context.Sub>
  )
}
