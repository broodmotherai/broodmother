export type ErrorStatus = 400 | 404 | 409

/** An error the caller can read and act on. Anything else is a 500 and a stack trace. */
export class AppError extends Error {
  readonly status: ErrorStatus = 400
}

/** The request is well formed; there is nothing open to serve it. */
export class Conflict extends AppError {
  readonly status = 409
}

export class NotFound extends AppError {
  readonly status = 404
}

/** Nothing is open to serve the request. Marker classes rather than one with a field, so a
 *  caller can tell which of the three it is without matching on a message. */
export class NoProjectError extends Conflict {}
export class NoRepoError extends Conflict {}
export class NoProfileError extends Conflict {}
