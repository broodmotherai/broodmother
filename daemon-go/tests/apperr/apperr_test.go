package apperr_test

import (
	. "github.com/broodmotherai/broodmother/daemon-go/internal/apperr"

	"errors"
	"fmt"
	"testing"
)

func TestSortsKindsIntoStatuses(t *testing.T) {
	for _, one := range []struct {
		err  *Error
		want int
	}{
		{Pathf("x"), 400},
		{NotFoundf("x"), 404},
		{NoProjectf("x"), 409},
		{NoRepof("x"), 409},
		{NoProfilef("x"), 409},
	} {
		if got := one.err.Status(); got != one.want {
			t.Errorf("%v: status %d, want %d", one.err, got, one.want)
		}
	}
}

func TestTellsTheConflictKindsApartWithoutTheMessage(t *testing.T) {
	one, two := NoProjectf("nothing open"), NoRepof("nothing open")
	if one.Status() != two.Status() {
		t.Fatal("the two conflicts answer with different statuses")
	}
	if !KindOf(one, NoProject) || KindOf(one, NoRepo) {
		t.Error("a NoProject does not read back as one")
	}
}

func TestAnythingNotOursIsAFiveHundred(t *testing.T) {
	if got := StatusOf(errors.New("a bug")); got != 500 {
		t.Errorf("status %d, want 500", got)
	}
	if got := StatusOf(fmt.Errorf("wrapped: %w", NotFoundf("gone"))); got != 404 {
		t.Errorf("a wrapped error lost its status: %d", got)
	}
}
