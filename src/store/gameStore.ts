import { create } from 'zustand';
import { GameState, GameActions, Pokemon, Hint } from '../types';
import { 
  fetchAllPokemon, 
  fetchPokemonDetails, 
  fetchPokemonSpecies,
  getDailyPokemonIndex,
  isCorrectGuess,
  isValidPokemonName,
  normalizePokemonName
} from '../utils/pokemonUtils';

const useGameStore = create<GameState & GameActions>((set, get) => ({
  dailyPokemon: null,
  pokemonList: [],
  guesses: [],
  hints: [
    { type: 'ability', value: '', revealed: false },
    { type: 'generation', value: '', revealed: false },
    { type: 'type', value: [], revealed: false }
  ],
  gameStatus: 'playing',
  isLoading: false,
  error: null,
  lastPlayedDate: null,

  // Initialize the game state
  initializeGame: async () => {
    set({ isLoading: true, error: null });
    
    try {
      // Get the current date as string
      const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const lastPlayed = localStorage.getItem('lastPlayedDate');
      
      // If we already have state and it's the same day, restore previous game
      if (lastPlayed === today && localStorage.getItem('gameState')) {
        try {
          const savedState = JSON.parse(localStorage.getItem('gameState') || '{}');
          set({ 
            ...savedState,
            isLoading: false,
            lastPlayedDate: today
          });
          return;
        } catch (e) {
          console.error('Failed to parse saved game state', e);
          // Continue to initialize new game if restore fails
        }
      }
      
      // 1. Fetch all Pokémon names
      const pokemonList = await fetchAllPokemon();
      
      // 2. Get deterministic daily Pokémon
      const dailyIndex = getDailyPokemonIndex();
      const dailyPokemonName = pokemonList[dailyIndex % pokemonList.length];
      
      // 3. Fetch details for the daily Pokémon
      const dailyPokemon = await fetchPokemonDetails(dailyPokemonName);
      
      // 4. Initialize new game state
      const newState = { 
        dailyPokemon,
        pokemonList,
        guesses: [],
        hints: [
          { type: 'ability', value: '', revealed: false },
          { type: 'generation', value: '', revealed: false },
          { type: 'type', value: [], revealed: false }
        ],
        gameStatus: 'playing',
        isLoading: false,
        lastPlayedDate: today
      };
      
      set(newState);
      
      // Save initial state to localStorage
      localStorage.setItem('lastPlayedDate', today);
      localStorage.setItem('gameState', JSON.stringify({
        dailyPokemon,
        pokemonList,
        guesses: [],
        hints: newState.hints,
        gameStatus: 'playing',
        lastPlayedDate: today
      }));
    } catch (error) {
      set({ 
        error: 'Failed to initialize game. Please try again.',
        isLoading: false 
      });
    }
  },

  // Process a player's guess
  makeGuess: async (guess: string) => {
    const { 
      dailyPokemon, 
      guesses, 
      pokemonList, 
      gameStatus 
    } = get();
    
    // Skip if game not initialized or already won
    if (!dailyPokemon || gameStatus !== 'playing') {
      return false;
    }
    
    const normalizedGuess = normalizePokemonName(guess);
    
    // Check if already guessed
    if (guesses.includes(normalizedGuess)) {
      set({ error: 'You already guessed this Pokémon!' });
      return false;
    }
    
    // Validate if it's a real Pokémon
    if (!isValidPokemonName(normalizedGuess, pokemonList)) {
      set({ error: 'Not a valid Pokémon name!' });
      return false;
    }
    
    // Add to guesses
    const newGuesses = [...guesses, normalizedGuess];
    const newState = { guesses: newGuesses, error: null };
    
    // Check win condition
    if (isCorrectGuess(normalizedGuess, dailyPokemon)) {
      newState.gameStatus = 'won';
    } else if (newGuesses.length >= 10) {
      // Check loss condition - 10 incorrect guesses
      newState.gameStatus = 'lost';
    }
    
    // Save game state before updating
    set(newState);
    
    // Save to localStorage
    const today = new Date().toISOString().slice(0, 10);
    localStorage.setItem('lastPlayedDate', today);
    localStorage.setItem('gameState', JSON.stringify({
      ...get(),
      isLoading: false,
      error: null
    }));
    
    // Check if this attempt unlocks a new hint
    if (newGuesses.length === 3 || newGuesses.length === 6 || newGuesses.length === 9) {
      await get().revealHint(newGuesses.length);
    }
    
    return newState.gameStatus === 'won';
  },

  // Reveal a hint based on the attempt number
  revealHint: async (attemptNumber: number) => {
    const { dailyPokemon, hints } = get();
    
    if (!dailyPokemon) return;
    
    const newHints = [...hints];
    
    try {
      set({ isLoading: true });
      
      if (attemptNumber === 3) {
        // Reveal ability hint
        const primaryAbility = dailyPokemon.abilities?.[0]?.ability.name || 'Unknown';
        newHints[0] = { ...newHints[0], value: primaryAbility, revealed: true };
      }
      else if (attemptNumber === 6) {
        // Reveal generation hint
        if (dailyPokemon.species?.url) {
          const speciesData = await fetchPokemonSpecies(dailyPokemon.species.url);
          const generation = speciesData.generation.name;
          newHints[1] = { ...newHints[1], value: generation, revealed: true };
        }
      }
      else if (attemptNumber === 9) {
        // Reveal type hint
        const types = dailyPokemon.types?.map(t => t.type.name) || ['Unknown'];
        newHints[2] = { ...newHints[2], value: types, revealed: true };
      }
      
      set({ hints: newHints, isLoading: false });
      
      // Save updated state to localStorage
      const today = new Date().toISOString().slice(0, 10);
      localStorage.setItem('gameState', JSON.stringify({
        ...get(),
        isLoading: false,
        error: null
      }));
    } catch (error) {
      set({ 
        error: 'Failed to reveal hint. Please try again.',
        isLoading: false 
      });
    }
  },

  // Reset the game state
  resetGame: () => {
    // Only reset the game, but keep the same Pokémon (for testing purposes)
    const state = get();
    const newState = {
      guesses: [],
      hints: [
        { type: 'ability', value: '', revealed: false },
        { type: 'generation', value: '', revealed: false },
        { type: 'type', value: [], revealed: false }
      ],
      gameStatus: 'playing',
      error: null
    };
    
    set(newState);
    
    // Save to localStorage
    const today = new Date().toISOString().slice(0, 10);
    localStorage.setItem('lastPlayedDate', today);
    localStorage.setItem('gameState', JSON.stringify({
      ...get(),
      isLoading: false,
      error: null
    }));
  },
  
  // Reset the error state
  resetError: () => {
    set({ error: null });
  },
  
  // Check for a new day and refresh game if needed
  checkForNewDay: () => {
    const { lastPlayedDate } = get();
    const today = new Date().toISOString().slice(0, 10);
    
    if (lastPlayedDate !== today) {
      get().initializeGame();
    }
  }
}));

// Add a named export for the store
export { useGameStore };

export default useGameStore;
