/** A voice the project carries: a folder under `personas/` whose PERSONA.md body joins the
 *  agent's system prompt when a task's Claude node wears it. */
export interface Persona {
  name: string
  description: string
}

/** What the open project's `personas/` folder carries; empty when no project is open. */
export interface GetPersonas {
  request: null
  response: { personas: Persona[] }
}
