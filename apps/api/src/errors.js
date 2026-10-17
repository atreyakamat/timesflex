/** An error that maps directly to an HTTP status and a message that is safe to show users. */
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
