// The message half of the store: what is said into a conversation, and the reply being written
// into it as it arrives.

package chat

import (
	"database/sql"
	"encoding/json"
	"strings"
	"unicode/utf8"
)

// titleMax is how long a conversation's name may be. The first line of what was said, cut.
const titleMax = 60

// Add writes something said into a conversation. A conversation still called what it was born as
// takes its name from the first thing a person said in it: the first thing you say is not what the
// conversation is called, but it is the best guess anybody has before the second.
func (s *Store) Add(chat, role, text string, at int64, from string) (Message, error) {
	if at == 0 {
		at = s.now()
	}
	result, err := s.db.Exec(
		`INSERT INTO messages (chat, role, text, created_at, from_agent) VALUES (?, ?, ?, ?, ?)`,
		rowID(chat), role, text, at, nullable(from))
	if err != nil {
		return Message{}, err
	}
	id, err := result.LastInsertId()
	if err != nil {
		return Message{}, err
	}
	s.db.Exec(`UPDATE chats SET updated_at = ? WHERE id = ?`, at, rowID(chat))
	if role == "user" {
		s.db.Exec(`UPDATE chats SET title = ? WHERE id = ? AND title = ?`,
			TitleOf(text), rowID(chat), NewChat)
	}
	return Message{ID: messageID(id), Role: role, Text: text, At: at, From: from}, nil
}

// SetText is the reply as it stands, rewritten as it grows — what was said and what was done to
// say it. A message saved every delta would be a write per token; the caller decides how often,
// and the last word is the one that counts.
func (s *Store) SetText(id, text string, steps []Step) {
	var held any
	if len(steps) > 0 {
		if encoded, err := json.Marshal(steps); err == nil {
			held = string(encoded)
		}
	}
	s.db.Exec(`UPDATE messages SET text = ?, steps = ? WHERE id = ?`, text, held, rowID(id))
}

// Message is one as it stands on disk, or nothing for one that is not there.
func (s *Store) Message(id string) (Message, bool) {
	var (
		row         int64
		role, text  string
		at          int64
		steps, from sql.NullString
	)
	err := s.db.QueryRow(
		`SELECT id, role, text, created_at, steps, from_agent FROM messages WHERE id = ?`, rowID(id)).
		Scan(&row, &role, &text, &at, &steps, &from)
	if err != nil {
		return Message{}, false
	}
	held := Message{ID: messageID(row), Role: role, Text: text, At: at, From: from.String}
	if steps.Valid && steps.String != "" {
		json.Unmarshal([]byte(steps.String), &held.Steps)
	}
	return held, true
}

// RemoveMessage takes one out: a reply that was asked for and never came. An empty bubble in a
// conversation reads as an answer of nothing, which is not what happened.
func (s *Store) RemoveMessage(id string) {
	s.db.Exec(`DELETE FROM messages WHERE id = ?`, rowID(id))
}

// AgentOfChat is whose conversation this is, or nothing for the page's own.
func (s *Store) AgentOfChat(chat string) (Agent, bool) {
	return scanAgent(s.db.QueryRow(
		`SELECT id, name, persona, model, color, chat, created_at FROM agents WHERE chat = ?`,
		rowID(chat)))
}

// TitleOf is the first line of what was said, cut to a name's length. An empty message keeps the
// placeholder rather than making a row with nothing in it.
func TitleOf(text string) string {
	line := strings.TrimSpace(text)
	if at := strings.IndexByte(line, '\n'); at >= 0 {
		line = line[:at]
	}
	line = strings.TrimSpace(line)
	if line == "" {
		return NewChat
	}
	// Counted in UTF-16 units on the other side, and in runes here. The two agree on everything
	// that is not an emoji, and a title cut one place along from where the browser would cut it is
	// a title, not a bug.
	if utf8.RuneCountInString(line) <= titleMax {
		return line
	}
	runes := []rune(line)
	return strings.TrimRight(string(runes[:titleMax-1]), " \t") + "…"
}

func nullable(value string) any {
	if value == "" {
		return nil
	}
	return value
}
