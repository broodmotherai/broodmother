'use client'

import { useState } from 'react'
import type { ProjectSummary } from '@/src/contracts/project'
import { Confirm, Icon, Menu, type MenuSection } from '@/components/ui'

const logo = <img className="logo" src="/logo.png" alt="" width={20} height={20} />

/** The row a second gesture drilled into, and what can be done to it. */
interface Drilled {
  project: ProjectSummary
}

/**
 * The head of the tree: which project you are in. Which repo inside it is not asked here
 * — the sidebar lists them all and clicking one is how you go there, so a second list
 * saying the same thing would be a second answer to a question already on screen. Neither
 * is the branch, which is one control at the end of the tab bar, nor the profile, which
 * reads from the foot of the same sidebar.
 */
export function ProjectMenu({
  projects,
  activePath,
  open,
  onOpenChange,
  onSelect,
  onAdd,
  onDelete,
}: {
  projects: ProjectSummary[]
  activePath: string
  /** Name of the repo the scope is in, null when it is the project. Named beside the project
   *  rather than chosen here. */
  /** Controlled, because ⌘K asks for this menu too — `Switch project` is this list, not a
   *  second surface that does the same thing. */
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (path: string) => void
  onAdd: () => void
  onDelete: (name: string) => void
}) {
  // Double-clicking a row drills into what can be done to that one, in the same surface:
  // a menu that changed under you reads better than a second menu on top.
  const [options, setOptions] = useState<Drilled | null>(null)
  const [confirming, setConfirming] = useState<Drilled | null>(null)

  const active = projects.find((project) => project.path === activePath) ?? projects[0]

  const close = () => {
    onOpenChange(false)
    setOptions(null)
  }

  const drilled = (into: Drilled): MenuSection[] => [
    {
      heading: into.project.name,
      actions: [
        {
          id: 'delete',
          label: 'Delete project…',
          icon: 'x',
          danger: true,
          onSelect: () => {
            close()
            setConfirming(into)
          },
        },
      ],
    },
  ]

  const projectSection: MenuSection = {
    // No heading over it, and no profile on the rows: a menu opened from the project it
    // names, holding a list of projects, does not need a word saying so. Which profile they
    // belong to is the section below.
    actions: projects.map((project) => ({
      id: project.path,
      label: project.name,
      selected: project.path === active?.path,
      onSelect: () => {
        close()
        if (project.path !== active?.path) onSelect(project.path)
      },
      onSecondClick: () => setOptions({ project }),
    })),
  }

  const sections: MenuSection[] = options
    ? drilled(options)
    : [
        // On a machine with no project the menu is the rows that make one, which is the
        // whole point of it opening there.
        ...(projects.length > 0 ? [projectSection] : []),
        {
          // A project is what this menu is about; a repository inside one is linked from the
          // sidebar it appears in, and from ⌘K.
          actions: [{ id: 'add', label: 'New project…', icon: 'plus', onSelect: onAdd }],
        },
      ]

  const label = options ? options.project.name : 'Where you work'

  return (
    <div className="explorer-head project">
      {/* Opens whether or not there is a project to name. A machine with none is where you
          most need the row that makes one, and hiding the menu until one exists is what
          made the first project a gate instead of a choice. */}
      <Menu
        label={label}
        sections={sections}
        anchorClass="project-anchor"
        open={open}
        onOpenChange={(next) => {
          onOpenChange(next)
          if (!next) setOptions(null)
        }}
      >
        {logo}
        <span className="name">{active?.name ?? 'No project'}</span>
        <Icon name="chevrons-up-down" />
      </Menu>

      {confirming && (
        <Confirm
          title={`Delete ${confirming.project.name}?`}
          description={`${confirming.project.path} and everything in it are removed from disk. Anything not pushed is gone with it.`}
          action="Delete Project"
          onConfirm={() => onDelete(confirming.project.name)}
          onClose={() => setConfirming(null)}
        >
          A project is a folder, so this is the folder going away — the git history inside
          it with everything else, and every repo that was in it. What you pushed is
          still on the remote, and cloning it again makes the project again. The profile it
          worked as is the folder around it and stays where it is.
        </Confirm>
      )}
    </div>
  )
}
