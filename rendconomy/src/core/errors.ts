// A GameError is a normal "no" to a player: not enough Polygons, a cooldown, a bad amount.
// Commands catch it and show the message (privately). Any other error is a real bug.

export class GameError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'GameError';
  }
}

export const isGameError = (e: unknown): e is GameError => e instanceof GameError;
