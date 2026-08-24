/** What a conversation refuses: a model nobody serves, a chat that is not there, no key to
 *  speak with. Its own file so that the routes can answer 400 for one without importing the
 *  model layer, and everything under it, to find out what one is. */
export class ChatError extends Error {}
