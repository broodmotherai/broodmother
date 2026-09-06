// The agent half of the store: who there is, whose thread is whose, and the chart.

package chat

import (
	"database/sql"
	"strconv"
)

// CreateAgent makes an agent and the one conversation held with them together: the thread is a
// chat row marked with the agent, titled with their name once and for all — the first thing you
// say to a person is not what the conversation is called.
func (s *Store) CreateAgent(project string, input NewAgent) (Agent, error) {
	at := s.now()
	made, err := s.db.Exec(
		`INSERT INTO chats (project, title, model, created_at, updated_at, agent) VALUES (?, ?, ?, ?, ?, 0)`,
		project, input.Name, input.Model, at, at)
	if err != nil {
		return Agent{}, err
	}
	thread, err := made.LastInsertId()
	if err != nil {
		return Agent{}, err
	}
	inserted, err := s.db.Exec(
		`INSERT INTO agents (project, name, persona, model, color, chat, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		project, input.Name, input.Persona, input.Model, input.Color, thread, at)
	if err != nil {
		return Agent{}, err
	}
	id, err := inserted.LastInsertId()
	if err != nil {
		return Agent{}, err
	}
	if _, err := s.db.Exec(`UPDATE chats SET agent = ? WHERE id = ?`, id, thread); err != nil {
		return Agent{}, err
	}
	held, _ := s.Agent(agentID(id))
	return held, nil
}

// Agents is every agent in the project, by name. NOCASE, so `priya` and `Priya` sit together
// rather than in two halves of the list.
func (s *Store) Agents(project string) []Agent {
	rows, err := s.db.Query(
		`SELECT id, name, persona, model, color, chat, created_at FROM agents
		 WHERE project = ? ORDER BY name COLLATE NOCASE, id`, project)
	if err != nil {
		return []Agent{}
	}
	defer rows.Close()
	found := []Agent{}
	for rows.Next() {
		if one, ok := scanAgent(rows); ok {
			found = append(found, one)
		}
	}
	return found
}

func (s *Store) Agent(id string) (Agent, bool) {
	rows, err := s.db.Query(
		`SELECT id, name, persona, model, color, chat, created_at FROM agents WHERE id = ?`, rowID(id))
	if err != nil {
		return Agent{}, false
	}
	defer rows.Close()
	if !rows.Next() {
		return Agent{}, false
	}
	return scanAgent(rows)
}

type scanner interface{ Scan(...any) error }

func scanAgent(rows scanner) (Agent, bool) {
	var (
		id                          int64
		name, persona, model, color string
		thread, createdAt           int64
	)
	if rows.Scan(&id, &name, &persona, &model, &color, &thread, &createdAt) != nil {
		return Agent{}, false
	}
	return Agent{
		ID: agentID(id), Name: name, Persona: persona, Model: model, Color: color,
		Chat: chatID(thread), Attachments: AttachmentsOf(name), CreatedAt: createdAt,
	}, true
}

// SetAgentModel puts another model behind the same voice. The chat row carries it too, since that
// is what a conversation reopened without a client's word falls back to.
func (s *Store) SetAgentModel(id, model string) {
	held, found := s.Agent(id)
	if !found {
		return
	}
	s.db.Exec(`UPDATE agents SET model = ? WHERE id = ?`, model, rowID(id))
	s.db.Exec(`UPDATE chats SET model = ? WHERE id = ?`, model, rowID(held.Chat))
}

// RemoveAgent takes the agent. Their conversation is removed by the caller, which is the one that
// knows a thread is a chat.
func (s *Store) RemoveAgent(id string) {
	s.db.Exec(`DELETE FROM reports WHERE agent = ? OR lead = ?`, rowID(id), rowID(id))
	s.db.Exec(`DELETE FROM agents WHERE id = ?`, rowID(id))
}

// LastSaidAt is when the last thing was said to or by them, or nothing when nothing has been.
func (s *Store) LastSaidAt(chat string) *int64 {
	var at sql.NullInt64
	if s.db.QueryRow(`SELECT MAX(created_at) FROM messages WHERE chat = ?`, rowID(chat)).Scan(&at) != nil {
		return nil
	}
	if !at.Valid {
		return nil
	}
	held := at.Int64
	return &held
}

// Unseen is how much of an agent's thread the person has not read: what the agent said, and what
// another agent delivered into it, past the mark. Never what the person typed, and never a row
// with nothing in it — an answer that only ran tools is not something to come back for, and the
// row a reply is being written into is empty until it lands, which is what keeps a badge from
// appearing the moment somebody starts talking rather than when they have finished.
func (s *Store) Unseen(id string) int {
	var count int
	err := s.db.QueryRow(
		`SELECT COUNT(*) FROM messages
		 WHERE chat = (SELECT chat FROM agents WHERE id = ?)
		   AND id > COALESCE((SELECT seen FROM agents WHERE id = ?), 0)
		   AND text != '' AND (role = 'assistant' OR from_agent IS NOT NULL)`,
		rowID(id), rowID(id)).Scan(&count)
	if err != nil {
		return 0
	}
	return count
}

// MarkSeen is the thread read up to where it stands now. The mark is the store's own idea of the
// last message rather than the caller's: a page's is a paint behind, and the difference is a badge
// of one that clicking does not clear.
func (s *Store) MarkSeen(id string) {
	s.db.Exec(`UPDATE agents SET seen =
		COALESCE((SELECT MAX(id) FROM messages WHERE messages.chat = agents.chat), 0)
		WHERE id = ?`, rowID(id))
}

// Org is every agent in the project, with who they report to and where they stand. One query
// rather than one per agent, because a board draws all of it or none.
func (s *Store) Org(project string) []Placed {
	rows, err := s.db.Query(
		`SELECT agents.id, agents.name, agents.persona, agents.model, agents.color, agents.chat,
		        agents.created_at, agents.x, agents.y, reports.lead
		 FROM agents LEFT JOIN reports ON reports.agent = agents.id
		 WHERE agents.project = ? ORDER BY agents.name COLLATE NOCASE, agents.id`, project)
	if err != nil {
		return []Placed{}
	}
	defer rows.Close()
	found := []Placed{}
	for rows.Next() {
		var (
			id                          int64
			name, persona, model, color string
			thread, createdAt           int64
			x, y, lead                  sql.NullInt64
		)
		if rows.Scan(&id, &name, &persona, &model, &color, &thread, &createdAt, &x, &y, &lead) != nil {
			continue
		}
		one := Placed{Agent: Agent{
			ID: agentID(id), Name: name, Persona: persona, Model: model, Color: color,
			Chat: chatID(thread), Attachments: AttachmentsOf(name), CreatedAt: createdAt,
		}}
		if lead.Valid {
			above := agentID(lead.Int64)
			one.Lead = &above
		}
		if x.Valid && y.Valid {
			one.Place = &Place{X: float64(x.Int64), Y: float64(y.Int64)}
		}
		found = append(found, one)
	}
	return found
}

// SetLead is who an agent reports to, or nobody. The unique index is what makes it one lead: a
// second is the same row rewritten rather than a second line into the same agent.
func (s *Store) SetLead(agent string, lead *string) {
	if lead == nil {
		s.db.Exec(`DELETE FROM reports WHERE agent = ?`, rowID(agent))
		return
	}
	s.db.Exec(`INSERT INTO reports (agent, lead) VALUES (?, ?)
		ON CONFLICT (agent) DO UPDATE SET lead = excluded.lead`, rowID(agent), rowID(*lead))
}

// PlaceAgent is where it stands. Written by a drag and by nothing else — until one, the board
// lays the agent out itself and this stays unset.
func (s *Store) PlaceAgent(agent string, x, y float64) {
	s.db.Exec(`UPDATE agents SET x = ?, y = ? WHERE id = ?`, int64(x), int64(y), rowID(agent))
}

// Clear takes what was said; the conversation stays to be said into again. The read mark goes with
// the messages: an empty thread has nothing unread in it, and a mark left pointing at a row that
// no longer exists is only waiting to be wrong.
func (s *Store) Clear(id string) {
	s.db.Exec(`DELETE FROM messages WHERE chat = ?`, rowID(id))
	s.db.Exec(`UPDATE chats SET updated_at = ? WHERE id = ?`, s.now(), rowID(id))
	s.db.Exec(`UPDATE agents SET seen = 0 WHERE chat = ?`, rowID(id))
}

func agentID(row int64) string { return "agent-" + strconv.FormatInt(row, 10) }
