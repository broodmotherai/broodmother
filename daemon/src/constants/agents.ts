/** How many times a conversation may answer itself before the turn is called finished. */
export const MAX_ROUNDS = 12

/** More, because a coworker's errand is several delegations deep. */
export const COWORKER_ROUNDS = 24

/** How much of an answer is worth carrying back. Past this the model is reading a file it
 *  asked for by mistake, and paying for it by the token. */
export const MAX_ANSWER = 20_000
