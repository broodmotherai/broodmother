/**
 * One agent saying something to another.
 *
 * The message lands in the recipient's thread as the prompt for a turn of theirs, answered by
 * their persona with their own hands, and their answer comes back the same way — so an
 * exchange between two agents is legible in both threads and in neither does it read as
 * something the person said.
 *
 * Nothing here waits: `send` returns as soon as the message is on its way. Waiting would mean
 * one agent's turn blocking inside a tool call for as long as another agent's whole turn,
 * which with `claude_code` on the other end is twenty minutes. The answer arrives when it
 * arrives, in the thread, which is how messaging a colleague works.
 */

import type { AgentInOrg } from '@daemon/types/api/agents'
import type { Chats } from '@daemon/features/chat/Chats'

/**
 * How far an exchange may go before it is cut. Two agents with a message tool and no counter
 * will answer each other politely until the key runs out, and every round of it is a full turn
 * with a real model. This is the whole of what stands between the app and that.
 */
export const MAX_HOPS = 4

export interface MessageDeps {
  chats: Chats
  /** Everyone in the open project, with the chart — who a name resolves to, and who reports
   *  to whom. Asked each time: agents are hired and let go while a conversation stays open. */
  roster: () => AgentInOrg[]
}

export interface Sending {
  /** The agent whose turn it is, by id. */
  from: string
  /** Who they named, as they wrote it. */
  to: string
  message: string
  /** How far into an exchange the turn doing the sending already is. */
  hops: number
}

/**
 * Says it, and answers the sender with what became of it — as text, the way an agent's hands
 * answer, because a refusal the model can read and act on beats an exception that ends its
 * turn mid-sentence.
 */
export function send(deps: MessageDeps, { from, to, message, hops }: Sending): string {
  const roster = deps.roster()
  const sender = roster.find((one) => one.id === from)
  if (!sender) return 'you are not in this project any more'

  const meant = matches(roster, to)
  if (meant.length > 1)
    return `more than one of them answers to ${to} — say which: ${meant.map((one) => one.name).join(', ')}`
  const found = meant[0]
  if (!found) {
    const others = roster.filter((one) => one.id !== from).map((one) => one.name)
    return others.length
      ? `nobody here is called ${to} — there is ${others.join(', ')}`
      : `nobody here is called ${to}, and there is nobody else in this project`
  }
  if (found.id === sender.id)
    return `you are ${sender.name} — say it in your own answer rather than to yourself`
  if (hops >= MAX_HOPS)
    return `that exchange has gone back and forth ${String(MAX_HOPS)} times — say what you have and stop`

  void deps.chats
    .deliver(found.chat, {
      text: said(sender, found, message),
      model: found.model,
      from: sender.id,
      hops: hops + 1,
    })
    .then((answer) => {
      if (!answer?.text.trim()) return
      return deps.chats.deliver(sender.chat, {
        text: said(found, sender, answer.text),
        model: sender.model,
        from: found.id,
        hops: hops + 2,
      })
    })
    // Nobody is awaiting this, so a store that fell over mid-delivery would take the daemon
    // with it rather than losing one message. Losing the message is the smaller thing.
    .catch(() => null)

  return `delivered to ${found.name} — their answer will come back to you here`
}

/**
 * Who they meant, by the name they wrote. The roster in their prompt gives whole names, so a
 * whole name is tried first; a first name on its own is what somebody writes when they are
 * writing to a colleague rather than reading off a list, and it is taken where only one person
 * answers to it. Nothing looser than that: a message delivered to the wrong colleague is worse
 * than one that comes back asking which.
 */
function matches(roster: AgentInOrg[], to: string): AgentInOrg[] {
  const asked = to.trim().toLowerCase()
  const whole = roster.filter((one) => one.name.trim().toLowerCase() === asked)
  if (whole.length) return whole
  return roster.filter((one) => one.name.trim().toLowerCase().split(/\s+/)[0] === asked)
}

/**
 * How a delivered message reads to the model on the other end. The sender is a column in the
 * store, which is what the page draws; a column is not in the context window, so it is said
 * here as well — and here only, so that anything which ever rewrites message text on its way
 * to the provider has one place to break rather than several.
 */
function said(from: AgentInOrg, to: AgentInOrg, text: string): string {
  const how =
    to.lead === from.id
      ? ' (your lead)'
      : from.lead === to.id
        ? ' (who reports to you)'
        : ''
  return `From ${from.name}${how}: ${text}`
}
