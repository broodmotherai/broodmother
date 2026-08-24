# styles

Proprium's design system, and now the app's: `tokens.css` is the token set every surface
shares — the opal hues, the two radii, the motion vocabulary, the font roles — and
`console.css` is the palette and the two utilities (`popup-surface`, `focus-ring`) the
controls are built from.

Both are imported by `app/globals.css`, and `components/core/` is written against them. The
app's own stylesheet is imported after, so where the two ever name the same thing the app's
rule wins; today they collide on nothing.

`components/core/` is the component kit these dress. Proprium's own kit used to sit in a
`core/` beneath it; the two were folded together, and what survived of proprium's — `Avatar`,
`Collapse` and `Icon` — now stands beside broodmother's modules rather than beneath them.
