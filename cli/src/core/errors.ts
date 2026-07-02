/**
 * An error whose message is meant for the user as-is: printed without a stack
 * trace, exit code 1. Everything else is a bug and gets the full stack.
 */
export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserError";
  }
}
