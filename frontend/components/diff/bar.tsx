'use client'

import { useState } from 'react'
import type { Branch } from '@/branch'
import type { DiffBasis } from '@/git'
import { Icon, Menu, type IconName, type MenuSection } from '@/components/ui'
import { Track, TrackButton, TRACK_CONTROL } from '../layout'

/** Under this the whole list is on the surface already, and a field over it is chrome. */
const SEARCHABLE = 8

/**
 * Each basis as a glyph, the name it goes by, and what it means said in full. The button
 * wears the glyph; the words are the tooltip and the name assistive tech reads, because a
 * sentence sitting in a bar of controls reads as a paragraph rather than a switch.
 *
 * `arrow-left-right` is this held against that, `fork` is the commit the two grew out of.
 */
const BASIS: Record<DiffBasis, { icon: IconName; label: string; title: string }> = {
  now: {
    icon: 'arrow-left-right',
    label: 'as they stand',
    title:
      'As they stand — every difference between the two branches, including what the other one has done since you left it. Click to compare from where they parted instead.',
  },
  split: {
    icon: 'fork',
    label: 'since they parted',
    title:
      'Since they parted — only what this branch has done, which is the difference a pull request shows. Click to compare the branches as they stand instead.',
  },
}

/**
 * What a comparison is between, said in the one place it can be changed. The selector in
 * the bar above is the branch you are standing in and the one here is what it is being
 * held against — which is a sentence rather than two identical controls, because two of
 * those side by side ask you to work out which is which.
 *
 * The comparison is between the branches whole. Neither side is a commit, and nothing here
 * asks you to pick one.
 */
export function DiffBar({
  current,
  against,
  basis,
  branches,
  files,
  onAgainst,
  onBasis,
  onClose,
}: {
  /** The branch you are on, which is what the selector above says. */
  current: string
  against: string
  /** Which two points the comparison is between. */
  basis: DiffBasis
  branches: Branch[]
  /** How many paths the two disagree about. */
  files: number
  onAgainst: (name: string) => void
  onBasis: (basis: DiffBasis) => void
  onClose: () => void
}) {
  const [open, setOpen] = useState(false)

  // Every branch but the one you are on: a branch held against itself is a blank pane and
  // a question about what went wrong.
  const others = branches.filter((branch) => branch.name !== current)

  const sections: MenuSection[] = [
    {
      heading: 'compare against',
      search: others.length > SEARCHABLE ? 'search branches' : undefined,
      actions: others.map((branch) => ({
        id: branch.name,
        label: branch.name,
        selected: branch.name === against,
        onSelect: () => {
          setOpen(false)
          if (branch.name !== against) onAgainst(branch.name)
        },
      })),
    },
  ]

  return (
    /* A track of its own under the strip, on the raised material: what it says is about the
       pane beneath it. Its controls are the ones in the track above by the same rule, so
       the two rows cannot disagree by a pixel. */
    <Track ground label="Comparison">
      <p className="diff-copy">
        Comparing <strong>{current}</strong>, the branch selected above, against
      </p>
      <Menu
        label="Compare against"
        anchorLabel="Compare against"
        sections={sections}
        anchorClass={`${TRACK_CONTROL} branch-anchor`}
        open={open}
        onOpenChange={setOpen}
      >
        <Icon name="compare" />
        <span className="name">{against}</span>
        <Icon name="chevrons-up-down" />
      </Menu>
      {/* The end of the sentence, and the one thing in the bar that changes what is being
          asked rather than who it is being asked about. It shows the basis it is on rather
          than the one it would move to: this is a statement about what you are looking at,
          and it is beside the branch the statement is about. */}
      <TrackButton
        shape="icon"
        aria-label={BASIS[basis].label}
        aria-describedby="diff-basis-tip"
        aria-pressed={basis === 'split'}
        data-tip={BASIS[basis].title}
        onClick={() => onBasis(basis === 'now' ? 'split' : 'now')}
      >
        <Icon name={BASIS[basis].icon} />
      </TrackButton>
      {/* The tip is hover's copy of the words; this one is the screen reader's. */}
      <span id="diff-basis-tip" className="sr-only">
        {BASIS[basis].title}
      </span>
      <span className="diff-count">
        {files === 1 ? '1 file differs' : `${files} files differ`}
      </span>
      <TrackButton onClick={onClose}>done</TrackButton>
    </Track>
  )
}
