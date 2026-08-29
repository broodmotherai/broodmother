/** One row of the Integrations page: a service a task can reach, and whether this profile
 *  is connected to it. Who it is connected as, never what with. */
export interface IntegrationSummary {
  id: string
  label: string
  what: string
  connect: 'device'
  /** The login this profile is connected as, or null where it is not connected. */
  connectedAs: string | null
}

/** Every service there is, connected or not — a page that listed only the connected ones
 *  would be a page you could never connect anything from. */
export interface GetIntegrations {
  request: null
  response: { integrations: IntegrationSummary[] }
}
