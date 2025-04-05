import { create } from 'zustand';
import { GameState, GameActions } from '../types';
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

  // Loads or initializes the game state using localStorage when possible
  initializeGame: async () => {
    set({ isLoading: true, error: null });
    
    try {
      const today = new Date().toISOString().slice(0, 10);
      const lastPlayed = localStorage.getItem('lastPlayedDate');
      
      // Restore previous game state if it's from the same day
      if (lastPlayed === today && localStorage.getItem('gameState')) {
        try {
          const savedState = JSON.parse(localStorage.getItem('gameState') || '{}');
          set({ ...savedState, isLoading: false, lastPlayedDate: today });
          return;
        } catch (e) {
          console.error('Failed to parse saved game state', e);
        }
      }
      
      // Initialize a new game if no saved state or from a different day
      const pokemonList = await fetchAllPokemon();
      const dailyIndex = getDailyPokemonIndex();
      const dailyPokemonName = pokemonList[dailyIndex % pokemonList.length];
      const dailyPokemon = await fetchPokemonDetails(dailyPokemonName);
      
      const newState: Partial<GameState> = { 
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
      
      // Save state to localStorage
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

  // Processes a player's guess and updates game state accordingly
  makeGuess: async (guess: string) => {
    const { dailyPokemon, guesses, pokemonList, gameStatus } = get();
    
    if (!dailyPokemon || gameStatus !== 'playing') {
      return false;
    }
    
    const normalizedGuess = normalizePokemonName(guess);
    
    // Validate guess hasn't been made before
    if (guesses.includes(normalizedGuess)) {
      set({ error: 'You already guessed this Pokémon!' });
      return false;
    }
    
    // Validate guess is a real Pokémon name
    if (!isValidPokemonName(normalizedGuess, pokemonList)) {
      set({ error: 'Not a valid Pokémon name!' });
      return false;
    }
    
    const newGuesses = [...guesses, normalizedGuess];
    let newGameStatus = gameStatus;
    
    // Check win condition
    if (isCorrectGuess(normalizedGuess, dailyPokemon)) {
      newGameStatus = 'won';
    } else if (newGuesses.length >= 10) {
      // Check loss condition after 10 guesses
      newGameStatus = 'lost';
    }
    
    // Update game state
    set({ guesses: newGuesses, error: null, gameStatus: newGameStatus });
    
    // Persist to localStorage
    const today = new Date().toISOString().slice(0, 10);
    localStorage.setItem('lastPlayedDate', today);
    localStorage.setItem('gameState', JSON.stringify({
      ...get(),
      isLoading: false,
      error: null
    }));
    
    // Reveal a hint if guess count is 3, 6, or 9
    if (newGuesses.length === 3 || newGuesses.length === 6 || newGuesses.length === 9) {
      await get().revealHint(newGuesses.length);
    }
    
    return newGameStatus === 'won';
  },

  // Reveals progressive hints based on guess attempt count
  revealHint: async (attemptNumber: number) => {
    const { dailyPokemon, hints } = get();
    
    if (!dailyPokemon) return;
    
    const newHints = [...hints];
    
    try {
      set({ isLoading: true });
      
      if (attemptNumber === 3) {
        // Reveal ability hint after 3rd attempt
        const primaryAbility = dailyPokemon.abilities?.[0]?.ability.name || 'Unknown';
        newHints[0] = { ...newHints[0], value: primaryAbility, revealed: true };
      }
      else if (attemptNumber === 6) {
        // Reveal generation hint after 6th attempt
        if (dailyPokemon.species?.url) {
          const speciesData = await fetchPokemonSpecies(dailyPokemon.species.url);
          const generation = speciesData.generation.name;
          newHints[1] = { ...newHints[1], value: generation, revealed: true };
        }
      }
      else if (attemptNumber === 9) {
        // Reveal type hint after 9th attempt
        const types = dailyPokemon.types?.map(t => t.type.name) || ['Unknown'];
        newHints[2] = { ...newHints[2], value: types, revealed: true };
      }
      
      set({ hints: newHints, isLoading: false });
      
      // Update localStorage with new hints
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

  // Resets the current game while keeping the same Pokémon
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
    
    // Update localStorage with reset state
    const today = new Date().toISOString().slice(0, 10);
    localStorage.setItem('lastPlayedDate', today);
    localStorage.setItem('gameState', JSON.stringify({
      ...get(),
      isLoading: false,
      error: null
    }));
  },
  
  // Selects a new random Pokémon (primarily for testing)
  selectNewPokemon: async () => {
    set({ isLoading: true, error: null });
    
    try {
      const { pokemonList } = get();
      
      const randomIndex = Math.floor(Math.random() * pokemonList.length);
      const randomPokemonName = pokemonList[randomIndex];
      const newPokemon = await fetchPokemonDetails(randomPokemonName);
      
      set({ 
        dailyPokemon: newPokemon, 
        isLoading: false,
        guesses: [],
        hints: [
          { type: 'ability', value: '', revealed: false },
          { type: 'generation', value: '', revealed: false },
          { type: 'type', value: [], revealed: false }
        ],
        gameStatus: 'playing'
      });
    } catch (error) {
      set({ 
        error: 'Failed to select a new Pokémon. Please try again.',
        isLoading: false 
      });
    }
  },
  
  // Clears current error state
  resetError: () => {
    set({ error: null });
  },
  
  // Checks if it's a new day and resets game if needed
  checkForNewDay: () => {
    const { lastPlayedDate } = get();
    const today = new Date().toISOString().slice(0, 10);
    
    if (lastPlayedDate !== today) {
      get().initializeGame();
    }
  }
}));

export { useGameStore };
export default useGameStore;
