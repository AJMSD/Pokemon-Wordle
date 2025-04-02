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

  // Initialize the game state
  initializeGame: async () => {
    set({ isLoading: true, error: null });
    
    try {
      // 1. Fetch all Pokémon names
      const pokemonList = await fetchAllPokemon();
      
      // 2. Get the daily Pokémon based on today's date
      const dailyIndex = getDailyPokemonIndex() % pokemonList.length;
      const dailyPokemonName = pokemonList[dailyIndex];
      
      // 3. Fetch details for the daily Pokémon
      const dailyPokemon = await fetchPokemonDetails(dailyPokemonName);
      
      // 4. Initialize game state
      set({ 
        dailyPokemon,
        pokemonList,
        isLoading: false 
      });
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
    
    // Skip if game is already over or not initialized
    if (gameStatus !== 'playing' || !dailyPokemon) {
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
    set({ guesses: newGuesses, error: null });
    
    // Check win condition
    if (isCorrectGuess(normalizedGuess, dailyPokemon)) {
      set({ gameStatus: 'won' });
      return true;
    }
    
    // Check if this attempt unlocks a new hint
    if (newGuesses.length === 3 || newGuesses.length === 6 || newGuesses.length === 9) {
      await get().revealHint(newGuesses.length);
    }
    
    // Check loss condition (10 attempts)
    if (newGuesses.length >= 10) {
      set({ gameStatus: 'lost' });
    }
    
    return false;
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
    } catch (error) {
      set({ 
        error: 'Failed to reveal hint. Please try again.',
        isLoading: false 
      });
    }
  },

  // Reset the game state
  resetGame: () => {
    set({
      guesses: [],
      hints: [
        { type: 'ability', value: '', revealed: false },
        { type: 'generation', value: '', revealed: false },
        { type: 'type', value: [], revealed: false }
      ],
      gameStatus: 'playing',
      error: null
    });
  },
  
  // Reset the error state
  resetError: () => {
    set({ error: null });
  }
}));

// Add a named export for the store
export { useGameStore };

export default useGameStore;
