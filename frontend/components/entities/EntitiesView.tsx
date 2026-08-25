'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import type { EntitySummary, KindInfo } from '@broodmother/types/api/entities'
import type { EntityKind } from '@broodmother/types/entity/schema'
import { useApp } from '@/State'
import { Icon } from '@/components/core/Icons'
import { docRoute } from '@/components/shell/ScopeTabs'

/**
 * The entities page: what this project has written down, newest first, each card naming what
 * it came from.
 *
 * Flat rather than drawn as a tree, and that is the whole argument for the shape: an ancestry
 * is a graph, and a record can come from several things at once — so a tree would mean picking
 * one parent per card and quietly hiding the rest. A card lists all of its sources instead,
 * and clicking one goes there.
 *
 * A record is an ordinary document, so nothing is edited here: the card is an index entry and
 * the document is the editor. What this page has that the tree has not is the kind, the date,
 * and the sources — the three things you sort by when you are looking for what you knew.
 */
export function EntitiesView() {
  const app = useApp()
  const router = useRouter()
  const project = app.project?.path ?? null
  const [entities, setEntities] = useState<EntitySummary[] | null>(null)
  const [kinds, setKinds] = useState<KindInfo[]>([])
  const [only, setOnly] = useState<EntityKind | null>(null)

  useEffect(() => {
    let alive = true
    setEntities(null)
    setOnly(null)
    void app.client
      .request('GET /api/entities', null)
      .then((found) => alive && setEntities(found.entities))
      .catch(() => alive && setEntities([]))
    void app.client
      .request('GET /api/entities/catalogue', null)
      .then((found) => alive && setKinds(found.kinds))
      .catch(() => null)
    return () => {
      alive = false
    }
  }, [app.client, project])

  const held = entities ?? []
  const shown = only ? held.filter((one) => one.kind === only) : held
  const count = (kind: EntityKind) => held.filter((one) => one.kind === kind).length

  return (
    <div className="chat-page entities-page">
      {/* The rail is the catalogue rather than what has been written, so a kind nothing has
          been recorded under is still visible as a kind you could record under. It is the
          chats' rail and the agents': same width, same rows, same place on the pane. */}
      <aside className="chat-history entity-rail" aria-label="Kinds">
        {/* The way to the picture, at the head of the rail: the list is where the day is
            spent — you come here to find what you knew — and the graph is where you go to
            see the shape of it, which is rarely. */}
        <div className="entity-rail-head">
          <button
            type="button"
            className="entity-graph-button"
            aria-label="Entity graph"
            data-tip="what came from what"
            onClick={() => router.push('/entities/graph')}
          >
            <Icon name="spline" />
          </button>
        </div>
        <ul>
          <li>
            <button
              type="button"
              aria-current={only === null ? 'true' : undefined}
              onClick={() => setOnly(null)}
            >
              <span className="chat-title">Everything</span>
              <span className="tasks-dim">{held.length || ''}</span>
            </button>
          </li>
          {kinds.map((one) => (
            <li key={one.kind}>
              <button
                type="button"
                title={one.note}
                aria-current={only === one.kind ? 'true' : undefined}
                onClick={() => setOnly(one.kind)}
              >
                <span className="chat-title">{one.kind}</span>
                <span className="tasks-dim">{count(one.kind) || ''}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="entity-cards" aria-label="Records">
        {entities !== null && shown.length === 0 && (
          <p className="tasks-empty">
            {held.length === 0
              ? 'Nothing recorded yet. A record is what an agent had to write down rather than merely say — ask the chat to record one, and it lands here as a document.'
              : `No ${only ?? ''} has been recorded.`}
          </p>
        )}
        {shown.map((one) => (
          <article key={one.path} className="entity-card" data-broken={one.broken ? '' : undefined}>
            <header>
              <button
                type="button"
                className="entity-name"
                onClick={() => router.push(docRoute({ root: 'project', path: one.path }))}
              >
                {one.name}
              </button>
              <span className="entity-kind">{one.kind ?? 'broken'}</span>
            </header>
            <p className="tasks-dim entity-made">
              {one.made ? one.made.replace('T', ' ').replace('Z', '') : 'undated'}
              {one.by && ` · ${one.by}`}
              {one.edited && ' · edited since'}
            </p>
            {one.broken ? (
              <p className="entity-broken">{one.broken}</p>
            ) : (
              <ul className="entity-sources">
                {one.origin && (
                  <li className="tasks-dim">where this line of work started</li>
                )}
                {one.from.map((source) => (
                  <li key={`${source.relation}:${source.target}`}>
                    <span className="entity-relation">{source.relation}</span>
                    {/* The record holds the wikilink as it was written; the daemon says
                        where that resolves to. Nothing answers to it and there is nowhere
                        to go — said as a dead link rather than a button that does nothing. */}
                    <button
                      type="button"
                      disabled={source.path === null}
                      onClick={() =>
                        source.path &&
                        router.push(docRoute({ root: 'project', path: source.path }))
                      }
                    >
                      <Icon name="file-text" />
                      {source.target}
                      {source.path === null && <span className="tasks-dim"> (missing)</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </article>
        ))}
      </section>
    </div>
  )
}
