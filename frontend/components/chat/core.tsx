"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CHAT_PROVIDERS,
  DEFAULT_CHAT_MODEL,
  canChat,
  providerOf,
  type ChatSummary,
} from "@/src/contracts/api/chat";
import { useApp } from "@/state";
import { ChatHistory } from "./history";
import { ChatThread } from "./thread";
import { Composer } from "./composer";
import { useConversation } from "./conversation";

/** Who serves a model, in the words the notice uses. */
function label(model: string): string {
  const provider = providerOf(model);
  return (
    CHAT_PROVIDERS.find((one) => one.id === provider)?.label ?? "That provider"
  );
}

/**
 * The chat page: the conversations this project has had, the one you are in, and the box you
 * say the next thing into. Nothing open is a new conversation waiting for its first line.
 *
 * The people are not here — they have a tab of their own, beside this one. A conversation is
 * a thing you had; a coworker is somebody who is there whether or not you said anything today,
 * and the two never sorted together in one list.
 *
 * Everything here is per-project, because that is where the conversations are kept — moving
 * project is arriving somewhere else, and the page asks again when you do.
 */
export function ChatView() {
  const app = useApp();
  const project = app.project?.path ?? null;
  const [chats, setChats] = useState<ChatSummary[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [model, setModel] = useState(DEFAULT_CHAT_MODEL);
  const [failed, setFailed] = useState<string | null>(null);

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

  const conversation = useConversation({
    open,
    model,
    // A conversation is named after the first thing said in it, so the rail is a step
    // behind until the answer to that first thing arrives.
    onDone: () => void list(),
  });

  // Which conversations there are, asked again when the project changes under the page.
  useEffect(() => {
    let alive = true;
    setChats(null);
    setOpen(null);
    void list().then((found) => {
      if (alive && found) setOpen(found[0]?.id ?? null);
    });
    return () => {
      alive = false;
    };
  }, [list, project]);

  /** Said into the conversation that is open, or into a new one made to hold it — which is
   *  what "New chat" leaves you in front of, and what the app opens on. */
  const send = (text: string) => {
    setFailed(null);
    if (conversation.send(text) === "sent" || open) return;
    void app.client
      .request("POST /api/chats", { model })
      .then((answer) => {
        setChats((all) => [answer.chat, ...(all ?? [])]);
        setOpen(answer.chat.id);
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
        if (id === open) setOpen(left?.[0]?.id ?? null);
      })
      .catch(() => setFailed("could not delete that conversation"));
  };

  return (
    <div className="chat-page">
      <div className="chat-body">
        <ChatHistory
          chats={chats ?? []}
          open={open}
          onOpen={setOpen}
          onNew={start}
          onDelete={forget}
        />
        <section className="chat-main" aria-label="Conversation">
          {!ready && (
            <p className="chat-notice">
              {label(model)} is not connected. Add a key for it under Profile in
              Settings.
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
      </div>
    </div>
  );
}
