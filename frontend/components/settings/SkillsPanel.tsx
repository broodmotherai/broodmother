'use client'

import { useEffect, useState } from 'react'
import { SKILLS_DIR } from '@daemon/constants/files'
import type { Skill } from '@broodmother/types/api/skills'
import { useApp } from '@/State'
import { Button } from '@/components/core/Button'
import { Icon } from '@/components/core/Icons'
import { Modal } from '@/components/core/Modal'
import PanelTable, { PanelRow } from '@/components/panels/PanelTable'
import { render } from '@/src/markdown/Render'
import { Hint, Panel } from './Layout'

/**
 * What the open project carries under `.tools/.skills/`, and what each one says it is for.
 * A skill is read rather than run from here — running one takes a shell, and the terminal
 * below is where that happens — so a row opens its SKILL.md whole.
 */
export function SkillsPanel() {
  const app = useApp()
  const [skills, setSkills] = useState<Skill[]>([])
  const [reading, setReading] = useState<Skill | null>(null)
  const [body, setBody] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void app.client
      .request('GET /api/skills', null)
      .then((result) => alive && setSkills(result.skills))
      .catch(() => null)
    return () => {
      alive = false
    }
  }, [app.client, app.project])

  const read = (skill: Skill) => {
    setReading(skill)
    setBody(null)
  }

  useEffect(() => {
    if (!reading) return
    let alive = true
    void app.client
      .request('GET /api/doc', {
        root: 'project',
        path: `${SKILLS_DIR}/${reading.name}/SKILL.md`,
      })
      .then((result) => alive && setBody(result.markdown))
      .catch(() => alive && setBody('*its SKILL.md could not be read*'))
    return () => {
      alive = false
    }
  }, [app.client, reading])

  return (
    <Panel>
      <Hint>
        The workflows this project carries, one folder per skill under{' '}
        <code>{SKILLS_DIR}/</code> — a SKILL.md saying when to reach for it, and the scripts
        beside it that do the work. An agent is told the list; it reads the one it needs.
      </Hint>

      <PanelTable empty="No skills in this project yet.">
        {skills.map((skill) => (
          <PanelRow
            key={skill.name}
            fill
            icon={<Icon name="zap" />}
            label={skill.name}
            hint={skill.description}
            actions={<Button onClick={() => read(skill)}>Read</Button>}
          />
        ))}
      </PanelTable>

      {reading && (
        <Modal title={reading.name} size="large" onClose={() => setReading(null)}>
          <div
            className="broodmother-reading"
            dangerouslySetInnerHTML={{ __html: render(body ?? '*reading…*') }}
          />
        </Modal>
      )}
    </Panel>
  )
}
