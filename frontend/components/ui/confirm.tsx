'use client'

import type { ReactNode } from 'react'
import { Button } from './button'
import { Modal } from './modal'

/**
 * The one question the app asks twice. Everything that cannot be taken back — a project, a
 * link, a checkout, the whole home — is confirmed in this shape: what is going in the
 * title, what survives it in the description, and what it actually means underneath.
 *
 * Cancel is first because the answer that changes nothing should be the one nearest to
 * hand, and the button that goes through says what it does rather than yes.
 */
export function Confirm({
  title,
  description,
  action,
  onConfirm,
  onClose,
  children,
}: {
  title: string
  description: string
  /** What the button says, which is the gesture rather than an agreement to it. */
  action: string
  onConfirm: () => void
  onClose: () => void
  children: ReactNode
}) {
  return (
    <Modal
      title={title}
      description={description}
      size="small"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            danger
            onClick={() => {
              onConfirm()
              onClose()
            }}
          >
            {action}
          </Button>
        </>
      }
    >
      <p className="hint">{children}</p>
    </Modal>
  )
}
