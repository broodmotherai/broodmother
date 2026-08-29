// Package collate is the order the browser puts names in.
//
// Half a dozen listings in this app are sorted with JavaScript's localeCompare — the profiles,
// the projects, a record's extra header keys — and one of them decides which project opens on a
// machine whose config says nothing. That order is ICU's, not byte order: `_` comes before `-`,
// both come before the digits, the digits before the letters, and a lowercase letter sits before
// its own capital rather than after every capital there is. Sorting these in Go the obvious way
// puts `Zoe` before `alice`, and the browser puts `alice` first.
//
// The whole of ICU is not worth carrying. This is exact over printable ASCII — derived from the
// implementation it has to agree with rather than guessed at — and beyond that it falls back to
// byte order, which is at least stable. A name outside ASCII is where the two still differ.
package collate

import "sort"

// order is printable ASCII as localeCompare sorts it, read off node. Case is not a difference
// here: `a` and `A` share a primary weight and are told apart afterwards, which is why `ab` sorts
// before `aB` before `Ab` — the case of an earlier letter outranks the case of a later one only
// once every letter has matched.
const order = " _-,;:!?.'\"()[]{}@*/\\&#%`^+<=>|~$0123456789aAbBcCdDeEfFgGhHiIjJkKlLmMnNoOpPqQrRsStTuUvVwWxXyYzZ"

var primary = weights()

func weights() map[byte]int {
	table := make(map[byte]int, len(order))
	at := 0
	for index := 0; index < len(order); index++ {
		c := order[index]
		// A capital shares the weight of the lowercase letter before it.
		if c >= 'A' && c <= 'Z' {
			table[c] = table[c+('a'-'A')]
			continue
		}
		at++
		table[c] = at
	}
	return table
}

// beyond is every byte the table has no place for — a control character, or one of the bytes a
// character outside ASCII is spelt with. Sorted after everything named, by its own value, so the
// order is at least stable where it is not the browser's.
func primaryOf(c byte) int {
	if weight, named := primary[c]; named {
		return weight
	}
	return len(order) + int(c)
}

func tertiaryOf(c byte) int {
	if c >= 'A' && c <= 'Z' {
		return 1
	}
	return 0
}

// Before reports whether a sorts before b.
func Before(a, b string) bool {
	if order := compare(a, b, primaryOf); order != 0 {
		return order < 0
	}
	return compare(a, b, tertiaryOf) < 0
}

func compare(a, b string, weight func(byte) int) int {
	for index := 0; index < min(len(a), len(b)); index++ {
		if left, right := weight(a[index]), weight(b[index]); left != right {
			return left - right
		}
	}
	// A name that is the start of a longer one comes first, which is what a comparison that has
	// run out of one side means.
	return len(a) - len(b)
}

// Sort puts names in the browser's order, in place.
func Sort(names []string) {
	sort.SliceStable(names, func(i, j int) bool { return Before(names[i], names[j]) })
}

// SortBy is the same for anything with a name on it.
func SortBy[T any](items []T, name func(T) string) {
	sort.SliceStable(items, func(i, j int) bool { return Before(name(items[i]), name(items[j])) })
}
