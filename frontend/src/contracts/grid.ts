/**
 * The grid both boards walk — the diagram's and the task's. A drag snaps to it, the dots
 * are drawn on it, and anything laying a board out by hand moves in it, so a file written
 * from a terminal stands where a file written in the editor stands.
 */
export const GRID = 16

export const snap = (value: number) => Math.round(value / GRID) * GRID
