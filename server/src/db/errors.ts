export class DatabaseNotReadyError extends Error {
  constructor(message = 'Database is not configured or reachable') {
    super(message);
    this.name = 'DatabaseNotReadyError';
  }
}
