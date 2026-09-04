package api

import (
	"net/http"
	"strings"
	"testing"
)

func chats(t *testing.T, server *Server) []map[string]any {
	t.Helper()
	return held(t, server, "/api/chats", "chats")
}

// A conversation belongs to the project it was held in, and it is named until something is said.
func TestKeepsAConversationForTheProjectItWasHeldIn(t *testing.T) {
	home, _ := projectHome(t, nil)
	server := servingIn(t, home, "")

	if found := chats(t, server); len(found) != 0 {
		t.Fatalf("a fresh project holds %+v", found)
	}
	answer := sent(t, server, http.MethodPost, "/api/chats", `{"model":"claude-opus-5"}`)
	made, _ := answer["chat"].(map[string]any)
	if made["title"] != "New chat" || made["model"] != "claude-opus-5" {
		t.Fatalf("made %+v", made)
	}
	if messages, _ := made["messages"].([]any); len(messages) != 0 {
		t.Errorf("a new conversation holds %+v", messages)
	}
	id, _ := made["id"].(string)
	if !strings.HasPrefix(id, "chat-") {
		t.Errorf("made %q", id)
	}

	found := chats(t, server)
	if len(found) != 1 || found[0]["id"] != id {
		t.Fatalf("listed %+v", found)
	}
	// The listing draws names, so it carries no messages at all.
	if _, said := found[0]["messages"]; said {
		t.Errorf("the rail carries %+v", found[0]["messages"])
	}

	one := sent(t, server, http.MethodGet, "/api/chat?chat="+id, "")
	whole, _ := one["chat"].(map[string]any)
	if whole["id"] != id || whole["title"] != "New chat" {
		t.Errorf("read %+v", whole)
	}

	sent(t, server, http.MethodDelete, "/api/chat?chat="+id, "")
	if found := chats(t, server); len(found) != 0 {
		t.Errorf("still holds %+v", found)
	}
	refused(t, server, http.MethodGet, "/api/chat?chat="+id, "")
}

// Newest first, which is the order the rail beside a chat draws them in.
func TestListsTheConversationsNewestFirst(t *testing.T) {
	home, _ := projectHome(t, nil)
	server := servingIn(t, home, "")
	var made []string
	for range 3 {
		answer := sent(t, server, http.MethodPost, "/api/chats", `{"model":"claude-opus-5"}`)
		one, _ := answer["chat"].(map[string]any)
		id, _ := one["id"].(string)
		made = append(made, id)
	}
	found := chats(t, server)
	if len(found) != 3 {
		t.Fatalf("listed %+v", found)
	}
	// Made in the same millisecond, so the id is what breaks the tie — and it breaks it newest
	// first, the way the updated time would.
	for index, id := range []string{made[2], made[1], made[0]} {
		if found[index]["id"] != id {
			t.Errorf("listed %+v, want %v", found, []string{made[2], made[1], made[0]})
		}
	}
}

// Nowhere to work is no conversations rather than an error: an empty app is a state you are
// allowed to stand in. Making one is different — it has to belong somewhere.
func TestHoldsNoConversationsBeforeThereIsAProject(t *testing.T) {
	server := serving(t, "")
	if found := chats(t, server); len(found) != 0 {
		t.Errorf("listed %+v", found)
	}
	response, body := send(t, server, http.MethodPost, "/api/chats", `{"model":"claude-opus-5"}`, "")
	if response.StatusCode != http.StatusConflict {
		t.Errorf("answered %d: %s", response.StatusCode, body)
	}
}

// A model nobody here serves is refused rather than opened and never answered.
func TestRefusesAModelItDoesNotServe(t *testing.T) {
	home, _ := projectHome(t, nil)
	server := servingIn(t, home, "")
	for _, body := range []string{`{}`, `{"model":""}`, `{"model":"gpt-9"}`} {
		refused(t, server, http.MethodPost, "/api/chats", body)
	}
	refused(t, server, http.MethodGet, "/api/chat", "")
	refused(t, server, http.MethodGet, "/api/chat?chat=chat-404", "")
}
