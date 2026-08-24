"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CHAT_PROVIDERS,
  DEFAULT_CHAT_MODEL,
  canChat,
  providerOf,
  type ChatSummary,
} from "@/src/contracts/api/chat";
import type {
  CoworkerSummary,
  NewCoworker,
} from "@/src/contracts/api/coworkers";
import { useApp } from "@/state";
import { ChatHistory } from "./history";
import { ChatThread } from "./thread";
import { Composer } from "./composer";
import { CoworkerHeader, CoworkerView } from "./coworker";
import { NewCoworkerDialog } from "./new-coworker";
import { useConversation } from "./conversation";

/** Who serves a model, in the words the notice uses. */
function label(model: string): string {
  const provider = providerOf(model);
  return (
    CHAT_PROVIDERS.find((one) => one.id === provider)?.label ?? "That provider"
  );
}

/** What is on screen: one of the page's own conversations, or a coworker's thread. Nothing is
 *  a new conversation waiting for its first line. */
export type Opened =
  { kind: "chat"; id: string } | { kind: "coworker"; id: string };

/**
 * The chat page: the conversations this project has had, the coworkers it has, the one you are
 * in, and the box you say the next thing into.
 *
 * Everything here is per-project, because that is where the conversations are kept — moving
 * project is arriving somewhere else, and the page asks again when you do.
 */
export function ChatView() {
  const app = useApp();
  const project = app.project?.path ?? null;
  const [chats, setChats] = useState<ChatSummary[] | null>(null);
  const [coworkers, setCoworkers] = useState<CoworkerSummary[]>([]);
  const [open, setOpen] = useState<Opened | null>(null);
  const [model, setModel] = useState(DEFAULT_CHAT_MODEL);
  const [hiring, setHiring] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  /** Bumped when a thread is emptied, so the view over it is made again and reads it again. */
  const [cleared, setCleared] = useState(0);

  /** Whether this profile can speak with the model that is picked. Read off the profile
   *  rather than asked of the server, so connecting a provider in Settings lights the page
   *  up without it having to ask again. */
  const ready = canChat(model, app.profile?.models ?? []);

  const list = useCallback(async () => {
    const answer = await app.client
      .request("GET /api/chats", null)
      .catch(() => null);
    if (!answer) return null;
    setChats(answer.chats);
    return answer.chats;
  }, [app.client]);

  const listCoworkers = useCallback(async () => {
    const answer = await app.client
      .request("GET /api/coworkers", null)
      .catch(() => null);
    if (answer) setCoworkers(answer.coworkers);
  }, [app.client]);

  const conversation = useConversation({
    open: open?.kind === "chat" ? open.id : null,
    model,
    // A conversation is named after the first thing said in it, so the rail is a step
    // behind until the answer to that first thing arrives.
    onDone: () => void list(),
  });

  // Which conversations there are, asked again when the project changes under the page.
  useEffect(() => {
    let alive = true;
    setChats(null);
    setCoworkers([]);
    setOpen(null);
    void listCoworkers();
    void list().then((found) => {
      if (alive && found)
        setOpen(found[0] ? { kind: "chat", id: found[0].id } : null);
    });
    return () => {
      alive = false;
    };
  }, [list, listCoworkers, project]);

  /** Said into the conversation that is open, or into a new one made to hold it — which is
   *  what "New chat" leaves you in front of, and what the app opens on. */
  const send = (text: string) => {
    setFailed(null);
    if (conversation.send(text) === "sent" || open) return;
    void app.client
      .request("POST /api/chats", { model })
      .then((answer) => {
        setChats((all) => [answer.chat, ...(all ?? [])]);
        setOpen({ kind: "chat", id: answer.chat.id });
      })
      .catch(() => {
        conversation.drop();
        setFailed("could not open a conversation");
      });
  };

  const start = () => {
    setOpen(null);
    setFailed(null);
  };

  const forget = (id: string) => {
    void app.client
      .request("DELETE /api/chat", { chat: id })
      .then(() => list())
      .then((left) => {
        if (open?.kind === "chat" && id === open.id)
          setOpen(left?.[0] ? { kind: "chat", id: left[0].id } : null);
      })
      .catch(() => setFailed("could not delete that conversation"));
  };

  const hire = async (input: NewCoworker): Promise<string | null> => {
    try {
      const { coworker } = await app.client.request(
        "POST /api/coworkers",
        input,
      );
      await listCoworkers();
      setOpen({ kind: "coworker", id: coworker.id });
      return null;
    } catch (error) {
      return error instanceof Error
        ? error.message
        : "could not make a coworker";
    }
  };

  const clearCoworker = (id: string) => {
    void app.client
      .request("POST /api/coworker/clear", { coworker: id })
      // The thread is the same place emptied: the view over it is made again to read it again.
      .then(() => setCleared((held) => held + 1))
      .catch(() => setFailed("could not clear that conversation"));
  };

  const fireCoworker = (id: string) => {
    void app.client
      .request("DELETE /api/coworker", { coworker: id })
      .then(() => listCoworkers())
      .then(() => {
        if (open?.kind === "coworker" && open.id === id) setOpen(null);
      })
      .catch(() => setFailed("could not remove that coworker"));
  };

  const coworker =
    open?.kind === "coworker"
      ? (coworkers.find((one) => one.id === open.id) ?? null)
      : null;

  return (
    <div className="chat-page">
      {coworker && (
        <CoworkerHeader
          coworker={coworker}
          working={app.coworkersWorking[coworker.id] ?? coworker.working}
        />
      )}
      <div className="chat-body">
        <ChatHistory
          chats={chats ?? []}
          coworkers={coworkers.map((one) => ({
            ...one,
            working: app.coworkersWorking[one.id] ?? one.working,
          }))}
          open={open}
          onOpen={setOpen}
          onNew={start}
          onDelete={forget}
          onNewCoworker={() => setHiring(true)}
          onClearCoworker={clearCoworker}
          onDeleteCoworker={fireCoworker}
        />
        {coworker ? (
          <CoworkerView
            key={`${coworker.id}:${String(cleared)}`}
            coworker={coworker}
            error={failed}
          />
        ) : (
          <section className="chat-main" aria-label="Conversation">
            {!ready && (
              <p className="chat-notice">
                {label(model)} is not connected. Add a key for it under Profile
                in Settings.
              </p>
            )}
            <ChatThread
              messages={conversation.chat?.messages ?? []}
              reply={conversation.reply}
              error={failed ?? conversation.failed}
            />
            <Composer
              model={model}
              connected={app.profile?.models ?? []}
              onModel={setModel}
              onSend={send}
              onStop={conversation.stop}
              replying={conversation.reply !== null}
              disabled={!ready}
              accent={app.profile?.color ?? null}
            />
          </section>
        )}
      </div>
      {hiring && (
        <NewCoworkerDialog onCreate={hire} onClose={() => setHiring(false)} />
      )}
    </div>
  );
}
