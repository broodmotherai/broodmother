# styles

Proprium's design system, and now the app's: `tokens.css` is the token set every surface
shares — the opal hues, the two radii, the motion vocabulary, the font roles — and
`console.css` is the palette and the two utilities (`popup-surface`, `focus-ring`) the
controls are built from.

Both are imported by `app/globals.css`, and `components/ui/` is written against them. The
app's own stylesheet is imported after, so where the two ever name the same thing the app's
rule wins; today they collide on nothing.

`components/ui/core/` is the component kit these dress. `ui/Button` is `core/Button`, and
`ui/Modal`'s close is its `IconButton`; the rest of `ui/` has no proprium equivalent and is
written in the same idiom instead.
