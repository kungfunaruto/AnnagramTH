// Error with a stable code and a Thai message for the user.
export class InputError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "InputError";
    this.code = code;
    this.details = details;
  }
}
