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

type GameStorageScope = 'guest' | `user:${string}`;

const LEGACY_GAME_STATE_KEY = 'gameState';
const LEGACY_LAST_PLAYED_DATE_KEY = 'lastPlayedDate';

function getStorageKeys(scope: GameStorageScope) {
  return {
    gameState: `wurmple_game:${scope}`,
    lastPlayedDate: `wurmple_game_last_played:${scope}`,
  };
}

function getPersistedStateSnapshot(state: GameState) {
  return {
    dailyPokemon: state.dailyPokemon,
    pokemonList: state.pokemonList,
    guesses: state.guesses,
    hints: state.hints,
    gameStatus: state.gameStatus,
    lastPlayedDate: state.lastPlayedDate,
    sessionVersion: state.sessionVersion,
    puzzleDateKey: state.puzzleDateKey,
    staleLock: state.staleLock,
    rateLimitUntil: state.rateLimitUntil,
    newlyUnlockedBalls: state.newlyUnlockedBalls,
    rejectedGuess: state.rejectedGuess,
    pendingGuess: state.pendingGuess,
  };
}

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

function getEmptyHints() {
  return [
    { type: 'ability' as const, value: '', revealed: false },
    { type: 'generation' as const, value: '', revealed: false },
    { type: 'type' as const, value: [], revealed: false },
  ];
}

let serverSyncEpoch = 0;
let activeStorageScope: GameStorageScope = 'guest';

function resolveScope(userId?: string | null): GameStorageScope {
  if (!userId) return 'guest';
  return `user:${userId}`;
}

function persistGameStateSnapshot(state: GameState) {
  const keys = getStorageKeys(activeStorageScope);
  localStorage.setItem(keys.gameState, JSON.stringify(getPersistedStateSnapshot(state)));
}

function clearScopeStorage(scope: GameStorageScope) {
  const keys = getStorageKeys(scope);
  localStorage.removeItem(keys.gameState);
  localStorage.removeItem(keys.lastPlayedDate);
  if (scope === 'guest') {
    localStorage.removeItem(LEGACY_GAME_STATE_KEY);
    localStorage.removeItem(LEGACY_LAST_PLAYED_DATE_KEY);
  }
}

function migrateLegacyGuestStorage(today: string) {
  if (activeStorageScope !== 'guest') return null;
  const legacyDate = localStorage.getItem(LEGACY_LAST_PLAYED_DATE_KEY);
  const legacyStateRaw = localStorage.getItem(LEGACY_GAME_STATE_KEY);
  if (!legacyDate || !legacyStateRaw) return null;
  localStorage.removeItem(LEGACY_GAME_STATE_KEY);
  localStorage.removeItem(LEGACY_LAST_PLAYED_DATE_KEY);
  if (legacyDate !== today) return null;
  try {
    const parsedState = JSON.parse(legacyStateRaw);
    const guestKeys = getStorageKeys('guest');
    localStorage.setItem(guestKeys.lastPlayedDate, legacyDate);
    localStorage.setItem(guestKeys.gameState, JSON.stringify(parsedState));
    return { legacyDate, parsedState };
  } catch (e) {
    console.error('Failed to parse legacy guest game state', e);
    return null;
  }
}

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
  pendingGuess: null,

  // Loads or initializes the game state using localStorage when possible
  initializeGame: async () => {
    set({ isLoading: true, error: null });

    try {
      const today = getJSTDateKey();
      const keys = getStorageKeys(activeStorageScope);
      const migratedLegacy = migrateLegacyGuestStorage(today);
      const lastPlayed = localStorage.getItem(keys.lastPlayedDate) ?? migratedLegacy?.legacyDate ?? null;
      const savedStateRaw = localStorage.getItem(keys.gameState) ?? (migratedLegacy ? JSON.stringify(migratedLegacy.parsedState) : null);

      // Restore previous game state if it's from the same day
      if (lastPlayed === today && savedStateRaw) {
        try {
          const savedState = JSON.parse(savedStateRaw);
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
        hints: getEmptyHints(),
        gameStatus: 'playing',
        isLoading: false,
        lastPlayedDate: today,
        sessionVersion: null,
        puzzleDateKey: null,
        staleLock: false,
        rateLimitUntil: null,
        newlyUnlockedBalls: [],
        rejectedGuess: null,
        pendingGuess: null,
      };

      set(newState);

      // Save state to localStorage
      localStorage.setItem(keys.lastPlayedDate, today);
      localStorage.setItem(keys.gameState, JSON.stringify({
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
    const keys = getStorageKeys(activeStorageScope);
    localStorage.setItem(keys.lastPlayedDate, today);
    persistGameStateSnapshot(get());

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
      persistGameStateSnapshot(get());
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
      hints: getEmptyHints(),
      gameStatus: 'playing',
      error: null
    });
    
    // Update localStorage with reset state
    const today = getJSTDateKey();
    const keys = getStorageKeys(activeStorageScope);
    localStorage.setItem(keys.lastPlayedDate, today);
    persistGameStateSnapshot(get());
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
        hints: getEmptyHints(),
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
        guesses: s.guesses ?? [],
        hints: s.hint_flags ? mapServerHints(s.hint_flags, s.hints ?? {}) : state.hints,
        gameStatus: state.gameStatus === 'playing' ? newStatus : state.gameStatus,
        sessionVersion: s.version,
        puzzleDateKey: puzzle_date_key,
        dailyPokemon: state.dailyPokemon && s.pokemon_name
          ? { ...state.dailyPokemon, name: s.pokemon_name }
          : state.dailyPokemon,
      }));

      if (requestEpoch !== serverSyncEpoch) return;
      persistGameStateSnapshot(get());
    } catch (err) {
      console.error('Server session sync failed:', err);
    }
  },

  submitGuessToServer: async (guess, accessToken) => {
    const requestEpoch = serverSyncEpoch;
    const { dailyPokemon, guesses, pokemonList, gameStatus, sessionVersion, puzzleDateKey, isSubmitting } = get();
    const base = import.meta.env.VITE_SUPABASE_URL as string;

    if (isSubmitting || !dailyPokemon || gameStatus !== 'playing' || !puzzleDateKey) return false;

    const normalized = normalizePokemonName(guess);

    if (guesses.includes(normalized)) {
      set({ error: 'You already threw a ball at that one!' });
      return false;
    }
    if (!isValidPokemonName(normalized, pokemonList)) {
      set({ error: "That Pokémon isn't in your Pokédex!" });
      return false;
    }

    set({ isSubmitting: true, pendingGuess: normalized, error: null });

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
          pendingGuess: null,
          newlyUnlockedBalls: d.newly_unlocked_balls ?? [],
          dailyPokemon: get().dailyPokemon && d.pokemon_name
            ? { ...get().dailyPokemon!, name: d.pokemon_name }
            : get().dailyPokemon,
        });

        const keys = getStorageKeys(activeStorageScope);
        localStorage.setItem(keys.lastPlayedDate, getJSTDateKey());
        if (requestEpoch !== serverSyncEpoch) return false;
        persistGameStateSnapshot(get());
        return newStatus === 'won';
      }

      if (requestEpoch !== serverSyncEpoch) return false;
      const errData = await resp.json().catch(() => ({}));
      if (resp.status === 409) {
        set({ isSubmitting: false, pendingGuess: null, staleLock: true, rejectedGuess: normalized });
      } else if (resp.status === 429) {
        set({
          isSubmitting: false,
          pendingGuess: null,
          rateLimitUntil: Date.now() + (errData.retry_after ?? 60) * 1000,
          rejectedGuess: normalized,
        });
      } else {
        set({
          isSubmitting: false,
          pendingGuess: null,
          error: errData.error ?? "Couldn't register that guess. Try again.",
          rejectedGuess: normalized,
        });
      }
      return false;
    } catch {
      if (requestEpoch !== serverSyncEpoch) return false;
      set({ isSubmitting: false, pendingGuess: null, error: 'Connection lost. Check your signal, Trainer!', rejectedGuess: normalized });
      return false;
    }
  },

  invalidateServerSessionSync: () => {
    serverSyncEpoch += 1;
    set({
      guesses: [],
      hints: getEmptyHints(),
      gameStatus: 'playing',
      error: null,
      sessionVersion: null,
      puzzleDateKey: null,
      isSubmitting: false,
      staleLock: false,
      rateLimitUntil: null,
      newlyUnlockedBalls: [],
      rejectedGuess: null,
      pendingGuess: null,
    });
    clearScopeStorage(activeStorageScope);
  },

  setStorageScope: (userId?: string | null) => {
    activeStorageScope = resolveScope(userId);
  },

  clearScopedProgress: (userId?: string | null) => {
    clearScopeStorage(resolveScope(userId));
  },

  clearRateLimitLock:      () => set({ rateLimitUntil: null }),
  clearStaleLock:          () => set({ staleLock: false }),
  clearNewlyUnlockedBalls: () => set({ newlyUnlockedBalls: [] }),
  clearRejectedGuess:      () => set({ rejectedGuess: null }),
}));

export { useGameStore };
export default useGameStore;
