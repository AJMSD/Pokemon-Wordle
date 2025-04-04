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

export interface Hint {
  type: 'ability' | 'generation' | 'type';
  value: string | string[];
  revealed: boolean;
}

export interface GameState {
  dailyPokemon: Pokemon | null;
  pokemonList: string[];
  guesses: string[];
  hints: Hint[];
  gameStatus: 'playing' | 'won' | 'lost';
  isLoading: boolean;
  error: string | null;
  lastPlayedDate: string | null;
}

export interface GameActions {
  initializeGame: () => Promise<void>;
  makeGuess: (guess: string) => Promise<boolean>;
  resetGame: () => void;
  revealHint: (attemptNumber: number) => Promise<void>;
  resetError: () => void;
  selectNewPokemon: () => Promise<void>;
  checkForNewDay: () => void;
}
