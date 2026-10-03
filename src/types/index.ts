export interface Pokemon {
  id: number;
  name: string;
  abilities?: {
    ability: {
      name: string;
      url: string;
    };
    is_hidden: boolean;
  }[];
  types?: {
    type: {
      name: string;
      url: string;
    };
  }[];
  sprites?: {
    front_default: string;
    other?: {
      'official-artwork': {
        front_default: string;
      };
    };
  };
  species?: {
    url: string;
  };
}

export interface PokemonSpecies {
  generation: {
    name: string;
    url: string;
  };
}

export type LetterResult = 'correct' | 'present' | 'absent';

export interface Hint {
  type: 'ability' | 'generation' | 'type';
  value: string | string[];
  revealed: boolean;
}

export interface GameState {
  dailyPokemon: Pokemon | null;
  pokemonList: string[];
  guesses: string[];
  // Per-letter colours aligned with `guesses`; a guess without an entry is still pending.
  guessResults: LetterResult[][];
  // Letters in the answer; known before the answer itself is for signed-in play.
  nameLength: number | null;
  hints: Hint[];
  gameStatus: 'playing' | 'won' | 'lost';
  isLoading: boolean;
  error: string | null;
  lastPlayedDate: string | null;
  sessionVersion: number | null;
  puzzleDateKey: string | null;
  isSubmitting: boolean;
  staleLock: boolean;
  rateLimitUntil: number | null;
  newlyUnlockedBalls: string[];
  rejectedGuess: string | null;
}

export interface GameActions {
  initializeGame: () => Promise<void>;
  makeGuess: (guess: string) => Promise<boolean>;
  resetGame: () => void;
  revealHint: (attemptNumber: number) => Promise<void>;
  resetError: () => void;
  selectNewPokemon: () => Promise<void>;
  checkForNewDay: (accessToken?: string | null) => void;
  initializeServerSession: (accessToken?: string) => Promise<void>;
  /** Guests on per-user days: load (or create) their server session. No-op otherwise. */
  loadGuestServerSession: () => Promise<void>;
  /** True when guesses are scored by the server (signed in, or a guest on a per-user day). */
  usesServer: () => boolean;
  submitGuessToServer: (guess: string, accessToken?: string) => Promise<boolean>;
  invalidateServerSessionSync: () => void;
  hasGuestProgress: () => boolean;
  beginMigrationGate: () => void;
  endMigrationGate: () => void;
  migrateGuestProgress: (accessToken: string) => Promise<boolean>;
  setStorageScope: (userId?: string | null) => void;
  clearScopedProgress: (userId?: string | null) => void;
  clearRateLimitLock: () => void;
  clearStaleLock: () => void;
  clearNewlyUnlockedBalls: () => void;
  clearRejectedGuess: () => void;
}
