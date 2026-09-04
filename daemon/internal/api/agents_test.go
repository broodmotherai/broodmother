package api

import (
	"net/http"
	"strings"
	"testing"
)

// A project carrying two personas, so an agent has something to wear.
func hiring(t *testing.T) *Server {
	t.Helper()
	home, _ := projectHome(t, map[string]string{
		".personas/librarian/PERSONA.md":    "---\ndescription: keeps the vault\n---\n",
		".personas/dev/reviewer/PERSONA.md": "---\ndescription: reads the diff\n---\n",
	})
	return servingIn(t, home, "")
}

func hire(t *testing.T, server *Server, name, persona string) map[string]any {
	t.Helper()
	answer := sent(t, server, http.MethodPost, "/api/agents",
		`{"name":`+quoted(name)+`,"persona":`+quoted(persona)+`,"model":"claude-opus-5","color":"#8fb8d8"}`)
	made, _ := answer["agent"].(map[string]any)
	if made == nil {
		t.Fatalf("hired %+v", answer)
	}
	return made
}

func agents(t *testing.T, server *Server, path string) []map[string]any {
	t.Helper()
	return held(t, server, path, "agents")
}

// An agent and the one conversation held with them are made together, and their folder is in the
// tree from the first message.
func TestHiresAnAgentWithATheadAndAFolder(t *testing.T) {
	server := hiring(t)
	made := hire(t, server, "Priya", "librarian")

	if made["name"] != "Priya" || made["persona"] != "librarian" || made["color"] != "#8fb8d8" {
		t.Fatalf("hired %+v", made)
	}
	if !strings.HasPrefix(made["id"].(string), "agent-") || !strings.HasPrefix(made["chat"].(string), "chat-") {
		t.Errorf("hired %+v", made)
	}
	if made["attachments"] != ".attachments/priya" {
		t.Errorf("their folder is %+v", made["attachments"])
	}
	// The thread is titled with their name once and for all, and the rail leaves it out.
	one := sent(t, server, http.MethodGet, "/api/chat?chat="+made["chat"].(string), "")
	thread, _ := one["chat"].(map[string]any)
	if thread["title"] != "Priya" {
		t.Errorf("their thread is called %+v", thread["title"])
	}
	if found := held(t, server, "/api/chats", "chats"); len(found) != 0 {
		t.Errorf("the rail carries their thread: %+v", found)
	}

	listed := agents(t, server, "/api/agents")
	if len(listed) != 1 || listed[0]["id"] != made["id"] {
		t.Fatalf("listed %+v", listed)
	}
	if listed[0]["working"] != false || listed[0]["lastAt"] != nil {
		t.Errorf("listed %+v", listed[0])
	}
}

// The persona has to be one the project carries and the model one the app serves — an agent made
// with neither would be a name that answers nothing.
func TestRefusesAnAgentThatWouldAnswerNothing(t *testing.T) {
	server := hiring(t)
	for what, body := range map[string]string{
		"no name":                `{"name":"  ","persona":"librarian","model":"claude-opus-5","color":"#8fb8d8"}`,
		"no persona":             `{"name":"Priya","persona":"","model":"claude-opus-5","color":"#8fb8d8"}`,
		"a persona nobody wrote": `{"name":"Priya","persona":"nobody","model":"claude-opus-5","color":"#8fb8d8"}`,
		"a model nobody serves":  `{"name":"Priya","persona":"librarian","model":"gpt-9","color":"#8fb8d8"}`,
		"no colour":              `{"name":"Priya","persona":"librarian","model":"claude-opus-5","color":"blue"}`,
	} {
		t.Run(what, func(t *testing.T) { refused(t, server, http.MethodPost, "/api/agents", body) })
	}
	if listed := agents(t, server, "/api/agents"); len(listed) != 0 {
		t.Errorf("hired one anyway: %+v", listed)
	}
}

// By name, and NOCASE — so `priya` and `Priya` sit together rather than in two halves.
func TestListsAgentsByName(t *testing.T) {
	server := hiring(t)
	for _, name := range []string{"Zoe", "ada", "Priya"} {
		hire(t, server, name, "librarian")
	}
	listed := agents(t, server, "/api/agents")
	var named []string
	for _, one := range listed {
		named = append(named, one["name"].(string))
	}
	if strings.Join(named, ",") != "ada,Priya,Zoe" {
		t.Errorf("listed %v", named)
	}
}

// Another model behind the same voice, and the thread carries it too — that is what a
// conversation reopened without a client's word falls back to.
func TestPutsAnotherModelBehindTheSameVoice(t *testing.T) {
	server := hiring(t)
	made := hire(t, server, "Priya", "librarian")
	refused(t, server, http.MethodPost, "/api/agent/model",
		`{"agent":`+quoted(made["id"].(string))+`,"model":"gpt-9"}`)
	// The one model this daemon serves is the one it already had, so setting it is the only
	// change that can be proved here — that it is taken, and that the thread moves with it.
	answer := sent(t, server, http.MethodPost, "/api/agent/model",
		`{"agent":`+quoted(made["id"].(string))+`,"model":"claude-opus-5"}`)
	saved, _ := answer["agent"].(map[string]any)
	if saved["model"] != "claude-opus-5" {
		t.Errorf("answers as %+v", saved["model"])
	}
	refused(t, server, http.MethodPost, "/api/agent/model", `{"agent":"agent-404","model":"claude-opus-5"}`)
}

// The agent and their conversation go together; what they made is yours.
func TestRemovingAnAgentTakesTheirConversationWithThem(t *testing.T) {
	server := hiring(t)
	made := hire(t, server, "Priya", "librarian")
	id, thread := made["id"].(string), made["chat"].(string)

	sent(t, server, http.MethodDelete, "/api/agent?agent="+id, "")
	if listed := agents(t, server, "/api/agents"); len(listed) != 0 {
		t.Errorf("still listed %+v", listed)
	}
	refused(t, server, http.MethodGet, "/api/chat?chat="+thread, "")
	refused(t, server, http.MethodDelete, "/api/agent?agent="+id, "")
}

// What was said goes; the agent stays to be said to again.
func TestClearingAnAgentKeepsTheAgent(t *testing.T) {
	server := hiring(t)
	made := hire(t, server, "Priya", "librarian")
	sent(t, server, http.MethodPost, "/api/agent/clear", `{"agent":`+quoted(made["id"].(string))+`}`)
	if listed := agents(t, server, "/api/agents"); len(listed) != 1 {
		t.Errorf("cleared the agent away: %+v", listed)
	}
	refused(t, server, http.MethodPost, "/api/agent/clear", `{"agent":"agent-404"}`)
}

// A forest, one lead each — and a line that would close on itself is refused, because a chart
// asked who to escalate to would have no answer.
func TestKeepsTheChartAForest(t *testing.T) {
	server := hiring(t)
	ada := hire(t, server, "Ada", "librarian")["id"].(string)
	bo := hire(t, server, "Bo", "librarian")["id"].(string)
	cy := hire(t, server, "Cy", "librarian")["id"].(string)

	sent(t, server, http.MethodPost, "/api/agent/lead", `{"agent":`+quoted(bo)+`,"lead":`+quoted(ada)+`}`)
	sent(t, server, http.MethodPost, "/api/agent/lead", `{"agent":`+quoted(cy)+`,"lead":`+quoted(bo)+`}`)

	chart := map[string]any{}
	for _, one := range agents(t, server, "/api/agents/org") {
		chart[one["name"].(string)] = one["lead"]
	}
	if chart["Ada"] != nil || chart["Bo"] != ada || chart["Cy"] != bo {
		t.Fatalf("the chart is %+v", chart)
	}

	// Ada reporting to Cy would close the line Ada → Bo → Cy.
	said := refused(t, server, http.MethodPost, "/api/agent/lead", `{"agent":`+quoted(ada)+`,"lead":`+quoted(cy)+`}`)
	if !strings.Contains(said, "would make a loop") {
		t.Errorf("refused with %s", said)
	}
	said = refused(t, server, http.MethodPost, "/api/agent/lead", `{"agent":`+quoted(ada)+`,"lead":`+quoted(ada)+`}`)
	if !strings.Contains(said, "themselves") {
		t.Errorf("refused with %s", said)
	}
	refused(t, server, http.MethodPost, "/api/agent/lead", `{"agent":"agent-404","lead":null}`)

	// Null is how a line is dragged off.
	sent(t, server, http.MethodPost, "/api/agent/lead", `{"agent":`+quoted(cy)+`,"lead":null}`)
	for _, one := range agents(t, server, "/api/agents/org") {
		if one["name"] == "Cy" && one["lead"] != nil {
			t.Errorf("Cy still reports to %+v", one["lead"])
		}
	}
}

// Where they stand, after a drag. Until one, the board lays them out itself.
func TestRemembersWhereADragPutSomebody(t *testing.T) {
	server := hiring(t)
	id := hire(t, server, "Priya", "librarian")["id"].(string)
	if agents(t, server, "/api/agents/org")[0]["place"] != nil {
		t.Error("an agent nobody dragged has a place")
	}

	sent(t, server, http.MethodPost, "/api/agent/place", `{"agent":`+quoted(id)+`,"x":160,"y":-80}`)
	place, _ := agents(t, server, "/api/agents/org")[0]["place"].(map[string]any)
	if place == nil || place["x"] != 160.0 || place["y"] != -80.0 {
		t.Errorf("stands at %+v", place)
	}
	refused(t, server, http.MethodPost, "/api/agent/place", `{"agent":`+quoted(id)+`,"x":160}`)
	refused(t, server, http.MethodPost, "/api/agent/place", `{"agent":"agent-404","x":1,"y":2}`)
}

// Nowhere to work is nobody rather than an error, the way the conversations answer.
func TestHasNoAgentsBeforeThereIsAProject(t *testing.T) {
	server := serving(t, "")
	for _, path := range []string{"/api/agents", "/api/agents/org"} {
		if listed := agents(t, server, path); len(listed) != 0 {
			t.Errorf("%s listed %+v", path, listed)
		}
	}
	response, body := send(t, server, http.MethodPost, "/api/agents",
		`{"name":"Priya","persona":"librarian","model":"claude-opus-5","color":"#8fb8d8"}`, "")
	if response.StatusCode != http.StatusConflict {
		t.Errorf("answered %d: %s", response.StatusCode, body)
	}
}
