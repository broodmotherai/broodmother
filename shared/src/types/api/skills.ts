/** A reusable workflow the project carries: a folder under `.tools/.skills/` in the Claude
 *  skills format, discovered so it works whichever agent wakes up in the terminal. */
export interface Skill {
  name: string
  description: string
}

/** What the open project's `.tools/.skills/` folder carries; empty when no project is open. */
export interface GetSkills {
  request: null
  response: { skills: Skill[] }
}
