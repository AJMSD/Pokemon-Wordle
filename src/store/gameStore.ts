import { create } from 'zustand';
import { GameState, GameActions } from '../types';
import { 
  fetchAllPokemon, 
  fetchPokemonDetails, 
  fetchPokemonSpecies,
  getDailyPokemonIndex,
  getJSTDateKey,
  isCorrectGuess,
  isValidPokemonName,
  normalizePokemonName
} from '../utils/pokemonUtils';

function mapServerHints(
  flags: { ability: boolean; generation: boolean; type: boolean },
  hints: { ability?: string; generation?: string; types?: string[] }
) {
  return [
    { type: 'ability' as const,    value: hints.ability ?? '',    revealed: flags.ability },
    { type: 'generation' as const, value: hints.generation ?? '', revealed: flags.generation },
    { type: 'type' as const,       value: hints.types ?? [],      revealed: flags.type },
  ];
}

let serverSyncEpoch = 0;

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
  sessionVersion: null,
  puzzleDateKey: null,
  isSubmitting: false,
  staleLock: false,
  rateLimitUntil: null,
  newlyUnlockedBalls: [],
  rejectedGuess: null,

  // Loads or initializes the game state using localStorage when possible
  initializeGame: async () => {
    set({ isLoading: true, error: null });

    try {
      const today = getJSTDateKey();
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

      // Evict stale date-keyed API cache entries from previous days
      const staleKeys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith('pokemon_list_cache_') || key.startsWith('pokemon_detail_cache_')) && !key.endsWith(today)) {
          staleKeys.push(key);
        }
      }
      staleKeys.forEach(k => localStorage.removeItem(k));

      // Pokemon list — served from cache when available
      const listCacheKey = `pokemon_list_cache_${today}`;
      let pokemonList: string[];
      const cachedList = localStorage.getItem(listCacheKey);
      if (cachedList) {
        pokemonList = JSON.parse(cachedList);
      } else {
        pokemonList = await fetchAllPokemon();
        try { localStorage.setItem(listCacheKey, JSON.stringify(pokemonList)); } catch {}
      }

      const dailyIndex = getDailyPokemonIndex();
      const dailyPokemonName = pokemonList[dailyIndex % pokemonList.length];

      // Daily pokemon details — served from cache when available
      const detailCacheKey = `pokemon_detail_cache_${dailyPokemonName}_${today}`;
      let dailyPokemon;
      const cachedDetail = localStorage.getItem(detailCacheKey);
      if (cachedDetail) {
        dailyPokemon = JSON.parse(cachedDetail);
      } else {
        dailyPokemon = await fetchPokemonDetails(dailyPokemonName);
        try { localStorage.setItem(detailCacheKey, JSON.stringify(dailyPokemon)); } catch {}
      }

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
        error: 'Failed to sync your Pokédex. Please try again.',
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
      set({ error: 'You already threw a ball at that one!' });
      return false;
    }
    
    // Validate guess is a real Pokémon name
    if (!isValidPokemonName(normalizedGuess, pokemonList)) {
      set({ error: "That Pokémon isn't in your Pokédex!" });
      return false;
    }
    
    const newGuesses = [...guesses, normalizedGuess];
    let newGameStatus: 'playing' | 'won' | 'lost' = gameStatus;
    
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
    const today = getJSTDateKey();
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
        error: "Couldn't scan for clues. Try again.",
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
    const today = getJSTDateKey();
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
        error: "Couldn't load today's Pokémon. Try again.",
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
    const today = getJSTDateKey();

    if (lastPlayedDate !== today) {
      get().initializeGame();
    }
  },

  initializeServerSession: async (accessToken) => {
    const requestEpoch = serverSyncEpoch;
    const base = import.meta.env.VITE_SUPABASE_URL as string;
    try {
      const puzzleRes = await fetch(`${base}/functions/v1/get-daily-puzzle`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (requestEpoch !== serverSyncEpoch) return;
      if (!puzzleRes.ok) return;
      const { puzzle_date_key } = await puzzleRes.json();

      const sessRes = await fetch(
        `${base}/functions/v1/get-session?puzzle_date_key=${puzzle_date_key}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (requestEpoch !== serverSyncEpoch) return;
      if (!sessRes.ok) return;
      const s = await sessRes.json();
      if (requestEpoch !== serverSyncEpoch) return;

      const newStatus: GameState['gameStatus'] =
        s.completion_state === 'won' ? 'won' :
        s.completion_state === 'lost' ? 'lost' : 'playing';

      set(state => ({
        guesses: s.guesses ?? state.guesses,
        hints: s.hint_flags ? mapServerHints(s.hint_flags, s.hints ?? {}) : state.hints,
        gameStatus: state.gameStatus === 'playing' ? newStatus : state.gameStatus,
        sessionVersion: s.version,
        puzzleDateKey: puzzle_date_key,
        dailyPokemon: state.dailyPokemon && s.pokemon_name
          ? { ...state.dailyPokemon, name: s.pokemon_name }
          : state.dailyPokemon,
      }));

      if (requestEpoch !== serverSyncEpoch) return;
      localStorage.setItem('gameState', JSON.stringify({
        ...get(), isLoading: false, isSubmitting: false, error: null,
      }));
    } catch (err) {
      console.error('Server session sync failed:', err);
    }
  },

  submitGuessToServer: async (guess, accessToken) => {
    const requestEpoch = serverSyncEpoch;
    const { dailyPokemon, guesses, pokemonList, gameStatus, sessionVersion, puzzleDateKey } = get();
    const base = import.meta.env.VITE_SUPABASE_URL as string;

    if (!dailyPokemon || gameStatus !== 'playing' || !puzzleDateKey) return false;

    const normalized = normalizePokemonName(guess);

    if (guesses.includes(normalized)) {
      set({ error: 'You already threw a ball at that one!' });
      return false;
    }
    if (!isValidPokemonName(normalized, pokemonList)) {
      set({ error: "That Pokémon isn't in your Pokédex!" });
      return false;
    }

    const originalGuesses = [...guesses];
    set({ guesses: [...guesses, normalized], isSubmitting: true, error: null });

    try {
      const resp = await fetch(`${base}/functions/v1/submit-guess`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          guess: normalized,
          session_version: sessionVersion ?? 1,
          puzzle_date_key: puzzleDateKey,
        }),
      });

      if (requestEpoch !== serverSyncEpoch) return false;
      if (resp.ok) {
        const d = await resp.json();
        if (requestEpoch !== serverSyncEpoch) return false;
        const newStatus: GameState['gameStatus'] =
          d.completion_state === 'won' ? 'won' :
          d.completion_state === 'lost' ? 'lost' : 'playing';

        set({
          guesses: d.guesses,
          hints: d.hint_flags ? mapServerHints(d.hint_flags, d.hints ?? {}) : get().hints,
          gameStatus: newStatus,
          sessionVersion: d.version,
          isSubmitting: false,
          newlyUnlockedBalls: d.newly_unlocked_balls ?? [],
          dailyPokemon: get().dailyPokemon && d.pokemon_name
            ? { ...get().dailyPokemon!, name: d.pokemon_name }
            : get().dailyPokemon,
        });

        localStorage.setItem('lastPlayedDate', getJSTDateKey());
        if (requestEpoch !== serverSyncEpoch) return false;
        localStorage.setItem('gameState', JSON.stringify({
          ...get(), isLoading: false, isSubmitting: false, error: null,
        }));
        return newStatus === 'won';
      }

      if (requestEpoch !== serverSyncEpoch) return false;
      const errData = await resp.json().catch(() => ({}));
      if (resp.status === 409) {
        set({ guesses: originalGuesses, isSubmitting: false, staleLock: true, rejectedGuess: normalized });
      } else if (resp.status === 429) {
        set({
          guesses: originalGuesses,
          isSubmitting: false,
          rateLimitUntil: Date.now() + (errData.retry_after ?? 60) * 1000,
          rejectedGuess: normalized,
        });
      } else {
        set({
          guesses: originalGuesses,
          isSubmitting: false,
          error: errData.error ?? "Couldn't register that guess. Try again.",
          rejectedGuess: normalized,
        });
      }
      return false;
    } catch {
      if (requestEpoch !== serverSyncEpoch) return false;
      set({ guesses: originalGuesses, isSubmitting: false, error: 'Connection lost. Check your signal, Trainer!', rejectedGuess: normalized });
      return false;
    }
  },

  invalidateServerSessionSync: () => {
    serverSyncEpoch += 1;
    set({
      sessionVersion: null,
      puzzleDateKey: null,
      isSubmitting: false,
      staleLock: false,
      rateLimitUntil: null,
      newlyUnlockedBalls: [],
      rejectedGuess: null,
    });
  },

  clearRateLimitLock:      () => set({ rateLimitUntil: null }),
  clearStaleLock:          () => set({ staleLock: false }),
  clearNewlyUnlockedBalls: () => set({ newlyUnlockedBalls: [] }),
  clearRejectedGuess:      () => set({ rejectedGuess: null }),
}));

export { useGameStore };
export default useGameStore;
