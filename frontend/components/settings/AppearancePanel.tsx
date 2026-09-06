'use client'

import { useApp } from '@/State'
import { Icon } from '@/components/core/Icons'
import { Row } from '@/components/core/Row'
import type { Theme } from '@/styles/themes/Theme'
import { THEMES } from '@/styles/themes/Themes'
import { Caption, Panel } from './Layout'

/**
 * A theme shown as what it does rather than as the colours it holds: the page's own ground
 * with the tree lifted off it, two lines of type across it and the accent that tints
 * whatever commits a screen. A row of bare swatches would put the same five hexes beside
 * both names and say nothing about either — what you are choosing between is a window, and
 * this is the smallest thing that looks like one.
 */
function Preview({ theme }: { theme: Theme }) {
  return (
    <span
      aria-hidden
      className="flex h-9 w-14 shrink-0 items-stretch overflow-hidden rounded-[var(--row-radius)] border"
      style={{ background: theme.scale['sand-200'], borderColor: theme.scale['sand-400'] }}
    >
      <span className="w-1/3" style={{ background: theme.scale['sand-100'] }} />
      <span className="flex flex-1 flex-col justify-center gap-[3px] px-[5px]">
        <span className="h-[3px] rounded-full" style={{ background: theme.scale.ink }} />
        <span
          className="h-[3px] w-2/3 rounded-full"
          style={{ background: theme.scale['ink-faint'] }}
        />
        <span className="h-[3px] w-1/3 rounded-full" style={{ background: theme.hue.violet }} />
      </span>
    </span>
  )
}

/**
 * What the app is drawn in. A list rather than a dropdown: there are two of them, they are
 * the kind of thing you pick by looking at, and a menu would hide both behind the name of
 * one.
 *
 * The click is the whole of it — there is no Save under this the way there is under the
 * account. A theme is switched rather than typed, and the reply that stores it is what
 * repaints the window, so a button between the two would only be somewhere to forget.
 */
export function AppearancePanel() {
  const app = useApp()
  if (!app.profile) return null
  const chosen = app.profile.appearance.theme

  return (
    <Panel>
      <Caption
        name="Theme"
        hint="The chrome, the editor, the terminal and the boards. It is yours rather than the project's, so it follows you between them."
      >
        <div className="flex flex-col gap-px">
          {THEMES.map((theme) => (
            <Row
              key={theme.id}
              aria-selected={theme.id === chosen}
              onClick={() => void app.setAppearance(theme.id)}
              /* The fill the settings rail marks its own chosen row with, so being on a
                 theme reads the same as being on a section. */
              className="aria-selected:bg-[var(--active)]!"
            >
              <Preview theme={theme} />
              {theme.name}
              {theme.id === chosen && (
                <Icon name="check" className="ml-auto size-[0.9rem]! text-[var(--faint)]" />
              )}
            </Row>
          ))}
        </div>
      </Caption>
    </Panel>
  )
}
