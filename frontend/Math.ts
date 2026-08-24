/**
 * `$…$` is an equation only when the delimiters hug their content and the closer is not
 * followed by a digit — the project is full of prices, and `$289k–$1.25M` is not math.
 *
 * Both the markdown renderer and the editor's live preview ask this, so the two can never
 * disagree about what is an equation.
 */
export const isInlineMath = (body: string, after: string): boolean =>
  body.length > 0 && !/^\s|\s$/.test(body) && !/\d/.test(after)
