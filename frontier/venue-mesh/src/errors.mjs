export class VenueMeshError extends TypeError {
  constructor(code, message) {
    super(message);
    this.name = 'VenueMeshError';
    this.code = code;
  }
}

export function fail(code, message) {
  throw new VenueMeshError(code, message);
}
