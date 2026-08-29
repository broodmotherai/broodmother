// Package apperr holds the errors a caller can read and act on. Anything else is a 500 and a
// stack trace.
//
// The daemon this is ported from declared fourteen error classes with no shared base and sorted
// them into statuses with an `instanceof` ladder in one file. The kind is that ladder made
// data: a caller still tells NoProject from NoRepo without matching on a message, and the
// status is derived rather than restated per class.
package apperr

import (
	"errors"
	"fmt"
	"net/http"
)

type Kind int

const (
	Path Kind = iota
	Repo
	Project
	Profile
	Branch
	Github
	Chat
	Task
	Canvas
	Entity
	Notebook
	BadRequest
	NotFound
	// NoProject, NoRepo and NoProfile all mean the request is well formed and there is nothing
	// open to serve it.
	NoProject
	NoRepo
	NoProfile
)

type Error struct {
	Kind    Kind
	Message string
}

func (e *Error) Error() string { return e.Message }

func (e *Error) Status() int {
	switch e.Kind {
	case NotFound:
		return http.StatusNotFound
	case NoProject, NoRepo, NoProfile:
		return http.StatusConflict
	default:
		return http.StatusBadRequest
	}
}

func newf(kind Kind, format string, args ...any) *Error {
	return &Error{Kind: kind, Message: fmt.Sprintf(format, args...)}
}

func Pathf(format string, args ...any) *Error       { return newf(Path, format, args...) }
func Repof(format string, args ...any) *Error       { return newf(Repo, format, args...) }
func Projectf(format string, args ...any) *Error    { return newf(Project, format, args...) }
func Profilef(format string, args ...any) *Error    { return newf(Profile, format, args...) }
func Branchf(format string, args ...any) *Error     { return newf(Branch, format, args...) }
func Githubf(format string, args ...any) *Error     { return newf(Github, format, args...) }
func Chatf(format string, args ...any) *Error       { return newf(Chat, format, args...) }
func Taskf(format string, args ...any) *Error       { return newf(Task, format, args...) }
func Canvasf(format string, args ...any) *Error     { return newf(Canvas, format, args...) }
func Entityf(format string, args ...any) *Error     { return newf(Entity, format, args...) }
func Notebookf(format string, args ...any) *Error   { return newf(Notebook, format, args...) }
func BadRequestf(format string, args ...any) *Error { return newf(BadRequest, format, args...) }
func NotFoundf(format string, args ...any) *Error   { return newf(NotFound, format, args...) }
func NoProjectf(format string, args ...any) *Error  { return newf(NoProject, format, args...) }
func NoRepof(format string, args ...any) *Error     { return newf(NoRepo, format, args...) }
func NoProfilef(format string, args ...any) *Error  { return newf(NoProfile, format, args...) }

// StatusOf is the one place an error becomes an HTTP status. Anything that is not ours is a
// 500, which is the truthful answer for a bug.
func StatusOf(err error) int {
	var known *Error
	if errors.As(err, &known) {
		return known.Status()
	}
	return http.StatusInternalServerError
}

// KindOf reports whether err is one of ours of the given kind.
func KindOf(err error, kind Kind) bool {
	var known *Error
	return errors.As(err, &known) && known.Kind == kind
}
