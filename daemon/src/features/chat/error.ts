import { AppError } from '@daemon/types/error'

/** Its own file so a route can answer 400 for a chat without importing the model layer. */
export class ChatError extends AppError {}
