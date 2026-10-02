import { create } from 'zustand';
import { GameState, GameActions, Hint, Pokemon } from '../types';
import {
  fetchPokemonDetails,
  fetchPokemonSpecies,
  getJSTDateKey,
  isCorrectGuess,
  isValidPokemonName,
  normalizePokemonName
} from '../utils/pokemonUtils';
import { generationForId, getDailyPokemonId } from '../logic/dailyTarget';
import { POKEMON_NAMES } from '../data/pokemonNames';

type GameStorageScope = 'guest' | `user:${string}`;

const LEGACY_GAME_STATE_KEY = 'gameState';
const LEGACY_LAST_PLAYED_DATE_KEY = 'lastPlayedDate';
const GUEST_ID_KEY = 'wurmple_guest_id';
const MAX_GUESSES = 10;
const POKEMON_LIST = POKEMON_NAMES as string[];

function getStorageKeys(scope: GameStorageScope) {
  return {
    gameState: `wurmple_game:${scope}`,
    lastPlayedDate: `wurmple_game_last_played:${scope}`,
  };
}

function getPersistedStateSnapshot(state: GameState) {
  return {
    dailyPokemon: state.dailyPokemon,
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

// Hints the client can reveal on its own, so an optimistic guess shows them at once.
function revealLocalHints(hints: Hint[], guessCount: number, pokemon: Pokemon): Hint[] {
  return hints.map(hint => {
    if (hint.revealed) return hint;
    if (hint.type === 'ability' && guessCount >= 3) {
      const ability = pokemon.abilities?.[0]?.ability.name;
      return ability ? { ...hint, value: ability, revealed: true } : hint;
    }
    if (hint.type === 'generation' && guessCount >= 6 && pokemon.id) {
      return { ...hint, value: generationForId(pokemon.id), revealed: true };
    }
    if (hint.type === 'type' && guessCount >= 9) {
      const types = pokemon.types?.map(t => t.type.name);
      return types?.length ? { ...hint, value: types, revealed: true } : hint;
    }
    return hint;
  });
}

function statusFromServer(state: string): GameState['gameStatus'] {
  return state === 'won' ? 'won' : state === 'lost' ? 'lost' : 'playing';
}

let serverSyncEpoch = 0;
let activeStorageScope: GameStorageScope = 'guest';
// Bumped by initializeGame so a slow detail fetch can't land in a newer game.
let initEpoch = 0;
// In-flight server session load; early guesses wait on it instead of failing.
let serverInitPromise: Promise<void> | null = null;
// Optimistic guesses not yet confirmed, in submit order. Requests run one at
// a time on submitChain so each carries the version the previous one returned.
let pendingGuesses: string[] = [];
let submitChain: Promise<unknown> = Promise.resolve();
// Bumped on rollback so queued guesses built on the rolled-back state are dropped.
let submitGeneration = 0;

function getGuestSeed(): string {
  let id = localStorage.getItem(GUEST_ID_KEY);
  if (!id) {
    id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    try { localStorage.setItem(GUEST_ID_KEY, id); } catch {}
  }
  return id;
}

// Stable per-identity seed for the daily target: auth user id or local guest id.
function seedFor(scope: GameStorageScope): string {
  return scope === 'guest' ? getGuestSeed() : scope.slice('user:'.length);
}

// Playable stand-in until PokéAPI details arrive: colours only need the name.
function stubPokemon(id: number): Pokemon {
  return { id, name: POKEMON_NAMES[id - 1] ?? '' };
}

// Server guesses plus any optimistic ones it hasn't confirmed yet.
function withPendingGuesses(serverGuesses: string[]): string[] {
  return [...serverGuesses, ...pendingGuesses.filter(g => !serverGuesses.includes(g))];
}

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
  pokemonList: POKEMON_LIST,
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
    const epoch = ++initEpoch;
    set({ isLoading: true, error: null });

    try {
      const today = getJSTDateKey();
      const keys = getStorageKeys(activeStorageScope);
      const targetId = getDailyPokemonId(today, seedFor(activeStorageScope));
      const migratedLegacy = migrateLegacyGuestStorage(today);
      const lastPlayed = localStorage.getItem(keys.lastPlayedDate) ?? migratedLegacy?.legacyDate ?? null;
      const savedStateRaw = localStorage.getItem(keys.gameState) ?? (migratedLegacy ? JSON.stringify(migratedLegacy.parsedState) : null);

      // Restore previous game state if it's from the same day and target
      if (lastPlayed === today && savedStateRaw) {
        try {
          const savedState = JSON.parse(savedStateRaw);
          const savedId = savedState.dailyPokemon?.id;
          if (savedId === undefined || savedId === targetId) {
            set({ ...savedState, pokemonList: POKEMON_LIST, isLoading: false, lastPlayedDate: today });
            return;
          }
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

      // Playable at once from the bundled name; sprite and hint data fill in
      // when the details load.
      const detailCacheKey = `pokemon_detail_cache_${targetId}_${today}`;
      const cachedDetail = localStorage.getItem(detailCacheKey);
      const dailyPokemon: Pokemon = cachedDetail ? JSON.parse(cachedDetail) : stubPokemon(targetId);

      set({
        dailyPokemon,
        pokemonList: POKEMON_LIST,
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
      });

      localStorage.setItem(keys.lastPlayedDate, today);
      persistGameStateSnapshot(get());

      if (!cachedDetail) {
        const details = await fetchPokemonDetails(targetId);
        try { localStorage.setItem(detailCacheKey, JSON.stringify(details)); } catch {}
        if (epoch !== initEpoch || get().dailyPokemon?.id !== targetId) return;
        set({ dailyPokemon: details });
        persistGameStateSnapshot(get());
      }
    } catch (error) {
      if (epoch !== initEpoch) return;
      // The bundled-name stub keeps the game playable without details.
      if (!get().dailyPokemon) {
        set({
          error: 'Failed to sync your Pokédex. Please try again.',
          isLoading: false
        });
      }
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
    const base = import.meta.env.VITE_API_URL as string;
    const puzzleDateKey = getJSTDateKey();

    const load = (async () => {
      try {
        // get-session creates today's session (and pins its target) on first read.
        const sessRes = await fetch(
          `${base}/functions/v1/get-session?puzzle_date_key=${puzzleDateKey}`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (requestEpoch !== serverSyncEpoch) return;
        if (!sessRes.ok) return;
        const s = await sessRes.json();
        if (requestEpoch !== serverSyncEpoch) return;

        set(state => ({
          guesses: withPendingGuesses(s.guesses ?? []),
          hints: s.hint_flags ? mapServerHints(s.hint_flags, s.hints ?? {}) : state.hints,
          gameStatus: state.gameStatus === 'playing' ? statusFromServer(s.completion_state) : state.gameStatus,
          sessionVersion: s.version,
          puzzleDateKey,
          dailyPokemon: state.dailyPokemon && s.pokemon_name
            ? { ...state.dailyPokemon, name: s.pokemon_name }
            : state.dailyPokemon,
        }));

        persistGameStateSnapshot(get());
      } catch (err) {
        console.error('Server session sync failed:', err);
      }
    })();

    serverInitPromise = load;
    await load;
    if (serverInitPromise === load) serverInitPromise = null;
  },

  submitGuessToServer: async (guess, accessToken) => {
    const requestEpoch = serverSyncEpoch;
    const generation = submitGeneration;
    const { dailyPokemon, guesses, pokemonList, gameStatus, hints } = get();
    const base = import.meta.env.VITE_API_URL as string;

    if (!dailyPokemon || gameStatus !== 'playing') return false;

    const normalized = normalizePokemonName(guess);

    if (guesses.includes(normalized)) {
      set({ error: 'You already threw a ball at that one!' });
      return false;
    }
    if (!isValidPokemonName(normalized, pokemonList)) {
      set({ error: "That Pokémon isn't in your Pokédex!" });
      return false;
    }

    // Optimistic: the client knows the target, so show the coloured row,
    // hints and result now and reconcile when the server answers.
    const snapshot = { guesses, hints, gameStatus };
    const newGuesses = [...guesses, normalized];
    const optimisticStatus: GameState['gameStatus'] =
      isCorrectGuess(normalized, dailyPokemon) ? 'won' :
      newGuesses.length >= MAX_GUESSES ? 'lost' : 'playing';
    pendingGuesses.push(normalized);
    set({
      guesses: newGuesses,
      hints: revealLocalHints(hints, newGuesses.length, dailyPokemon),
      gameStatus: optimisticStatus,
      isSubmitting: true,
      error: null,
    });

    // Undo this guess and everything queued after it.
    const rollback = (patch: Partial<GameState>) => {
      submitGeneration += 1;
      pendingGuesses = [];
      set({ ...snapshot, isSubmitting: false, rejectedGuess: normalized, ...patch });
      persistGameStateSnapshot(get());
      return false;
    };

    const send = async (): Promise<boolean> => {
      // A sign-out or an earlier rollback already discarded this guess.
      const discarded = () => requestEpoch !== serverSyncEpoch || generation !== submitGeneration;
      if (discarded()) return false;

      if (!get().puzzleDateKey && serverInitPromise) await serverInitPromise;
      if (discarded()) return false;
      const { sessionVersion, puzzleDateKey } = get();
      if (!puzzleDateKey) {
        return rollback({ error: "Couldn't reach the Pokédex server. Try again." });
      }

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

        if (discarded()) return false;
        if (resp.ok) {
          const d = await resp.json();
          if (discarded()) return false;
          pendingGuesses = pendingGuesses.filter(g => g !== normalized);
          const morePending = pendingGuesses.length > 0;
          const serverStatus = statusFromServer(d.completion_state);

          set(state => {
            const serverHints = d.hint_flags ? mapServerHints(d.hint_flags, d.hints ?? {}) : state.hints;
            return {
              // Later optimistic guesses stay on screen until their own reply.
              guesses: withPendingGuesses(d.guesses),
              hints: morePending
                ? state.hints.map((h, i) => (h.revealed ? h : serverHints[i]))
                : serverHints,
              gameStatus: morePending ? state.gameStatus : serverStatus,
              sessionVersion: d.version,
              isSubmitting: morePending,
              newlyUnlockedBalls: [...state.newlyUnlockedBalls, ...(d.newly_unlocked_balls ?? [])],
              dailyPokemon: state.dailyPokemon && d.pokemon_name
                ? { ...state.dailyPokemon, name: d.pokemon_name }
                : state.dailyPokemon,
            };
          });

          const keys = getStorageKeys(activeStorageScope);
          localStorage.setItem(keys.lastPlayedDate, getJSTDateKey());
          persistGameStateSnapshot(get());
          return serverStatus === 'won';
        }

        const errData = await resp.json().catch(() => ({}));
        if (discarded()) return false;
        if (resp.status === 409) return rollback({ staleLock: true });
        if (resp.status === 429) {
          return rollback({ rateLimitUntil: Date.now() + (errData.retry_after ?? 60) * 1000 });
        }
        return rollback({ error: errData.error ?? "Couldn't register that guess. Try again." });
      } catch {
        if (discarded()) return false;
        return rollback({ error: 'Connection lost. Check your signal, Trainer!' });
      }
    };

    const result = submitChain.then(send, send);
    submitChain = result.catch(() => undefined);
    return result;
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
    });
    pendingGuesses = [];
    submitGeneration += 1;
    serverInitPromise = null;
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
