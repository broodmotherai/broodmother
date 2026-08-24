import type { ApiClient } from './DataSource'
import { httpClient } from './ApiDataSource'

export const api: ApiClient = httpClient()

export type { ApiClient, Connection } from './DataSource'
