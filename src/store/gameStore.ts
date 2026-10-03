import { create } from 'zustand';
import { GameState, GameActions, LetterResult, Pokemon } from '../types';
import {
  fetchPokemonDetails,
  fetchPokemonSpecies,
  getJSTDateKey,
  getLetterMatchResult,
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
// Longest we hold the server session back for a guest->account migration.
const MIGRATION_GATE_TIMEOUT_MS = 15000;

function getStorageKeys(scope: GameStorageScope) {
  return {
    gameState: `wurmple_game:${scope}`,
    lastPlayedDate: `wurmple_game_last_played:${scope}`,
  };
}

// Signed-in play is server-authoritative: the client never derives the answer.
function isUserScope() {
  return activeStorageScope !== 'guest';
}

function letterCount(name: string): number {
  return normalizePokemonName(name).replace(/[^a-z]/g, '').length;
}

// Persisted: no locks or rejected guesses (they must not survive a reload).
// For signed-in play the answer is only stored once the game is over.
function getPersistedStateSnapshot(state: GameState) {
  const hideAnswer = isUserScope() && state.gameStatus === 'playing';
  return {
    dailyPokemon: hideAnswer ? null : state.dailyPokemon,
    guesses: state.guesses,
    guessResults: state.guessResults,
    nameLength: state.nameLength,
    hints: state.hints,
    gameStatus: state.gameStatus,
    lastPlayedDate: state.lastPlayedDate,
    sessionVersion: state.sessionVersion,
    puzzleDateKey: state.puzzleDateKey,
    newlyUnlockedBalls: state.newlyUnlockedBalls,
  };
}

// Rebuilds state from a saved snapshot, ignoring anything stale or sensitive.
function restoreSnapshot(saved: any, userScope: boolean): Partial<GameState> {
  const status = saved.gameStatus === 'won' || saved.gameStatus === 'lost' ? saved.gameStatus : 'playing';
  const dailyPokemon: Pokemon | null =
    userScope && status === 'playing' ? null : (saved.dailyPokemon ?? null);
  const guesses: string[] = Array.isArray(saved.guesses) ? saved.guesses : [];
  let guessResults: LetterResult[][] = Array.isArray(saved.guessResults) ? saved.guessResults : [];
  if (!userScope && dailyPokemon?.name && guessResults.length !== guesses.length) {
    guessResults = guesses.map(g => getLetterMatchResult(g, dailyPokemon.name));
  }
  const nameLength = typeof saved.nameLength === 'number'
    ? saved.nameLength
    : dailyPokemon?.name ? letterCount(dailyPokemon.name) : null;
  return {
    dailyPokemon,
    guesses,
    guessResults,
    nameLength,
    hints: Array.isArray(saved.hints) && saved.hints.length === 3 ? saved.hints : getEmptyHints(),
    gameStatus: status,
    sessionVersion: typeof saved.sessionVersion === 'number' ? saved.sessionVersion : null,
    puzzleDateKey: typeof saved.puzzleDateKey === 'string' ? saved.puzzleDateKey : null,
    newlyUnlockedBalls: Array.isArray(saved.newlyUnlockedBalls) ? saved.newlyUnlockedBalls : [],
    staleLock: false,
    rateLimitUntil: null,
    rejectedGuess: null,
    isSubmitting: false,
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
// Holds the server session load while a new account imports its guest game.
let migrationGate: Promise<void> | null = null;
let releaseMigrationGate: (() => void) | null = null;
// Returns the freshest access token, so queued guesses survive a token refresh.
let accessTokenProvider: (() => string | null | undefined) | null = null;

export function setAccessTokenProvider(provider: (() => string | null | undefined) | null) {
  accessTokenProvider = provider;
}

function currentToken(fallback: string): string {
  return accessTokenProvider?.() || fallback;
}

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

// Today's guest guesses, if any, for importing into a freshly created account.
function readGuestProgress(): { guesses: string[] } | null {
  try {
    const keys = getStorageKeys('guest');
    if (localStorage.getItem(keys.lastPlayedDate) !== getJSTDateKey()) return null;
    const raw = localStorage.getItem(keys.gameState);
    if (!raw) return null;
    const guesses = JSON.parse(raw)?.guesses;
    return Array.isArray(guesses) && guesses.length > 0 ? { guesses } : null;
  } catch {
    return null;
  }
}

// Maps a server session response (get-session, submit-guess, migrate-guest)
// onto store state. The server is the only source of results and, once the
// game is over, of the answer.
function applyServerSession(state: GameState, s: any, puzzleDateKey: string): Partial<GameState> {
  const status = statusFromServer(s.completion_state);
  const serverGuesses: string[] = s.guesses ?? [];
  const patch: Partial<GameState> = {
    guesses: status === 'playing' ? withPendingGuesses(serverGuesses) : serverGuesses,
    guessResults: Array.isArray(s.results) ? s.results : state.guessResults,
    nameLength: typeof s.name_length === 'number' ? s.name_length : state.nameLength,
    hints: s.hint_flags ? mapServerHints(s.hint_flags, s.hints ?? {}) : state.hints,
    gameStatus: status,
    sessionVersion: s.version,
    puzzleDateKey,
    lastPlayedDate: puzzleDateKey,
  };
  if (status !== 'playing' && s.pokemon_name) {
    const sameId = state.dailyPokemon && state.dailyPokemon.id === s.pokemon_id;
    patch.dailyPokemon = sameId
      ? { ...state.dailyPokemon!, name: s.pokemon_name }
      : { id: s.pokemon_id ?? 0, name: s.pokemon_name };
  }
  return patch;
}

// Loads sprite/ability/type details for the current Pokémon, using the day's
// cache when it has them. A PokéAPI failure leaves the stub and is retried on
// the next restore.
async function hydratePokemonDetails(id: number, isCurrent: () => boolean, keepName?: string) {
  if (!id) return;
  const today = getJSTDateKey();
  const cacheKey = `pokemon_detail_cache_${id}_${today}`;
  let details: Pokemon | null = null;
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) details = JSON.parse(cached);
  } catch {}
  if (!details) {
    try {
      details = await fetchPokemonDetails(id);
    } catch {
      return;
    }
    try { localStorage.setItem(cacheKey, JSON.stringify(details)); } catch {}
  }
  if (!isCurrent() || useGameStore.getState().dailyPokemon?.id !== id) return;
  useGameStore.setState({ dailyPokemon: keepName ? { ...details, name: keepName } : details });
  persistGameStateSnapshot(useGameStore.getState());
}

function needsDetails(p: Pokemon | null): p is Pokemon {
  return !!p && !!p.id && (!p.abilities?.length || !p.sprites);
}

const useGameStore = create<GameState & GameActions>((set, get) => ({
  dailyPokemon: null,
  pokemonList: POKEMON_LIST,
  guesses: [],
  guessResults: [],
  nameLength: null,
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
    const isCurrent = () => epoch === initEpoch;
    set({ isLoading: true, error: null });

    try {
      const today = getJSTDateKey();
      const userScope = isUserScope();

      // The server session already loaded today's game; nothing local to add.
      if (userScope && get().puzzleDateKey === today) {
        set({ isLoading: false });
        return;
      }

      const keys = getStorageKeys(activeStorageScope);
      // Guests compute their own target locally; signed-in play never does.
      const targetId = userScope ? null : getDailyPokemonId(today, getGuestSeed());
      const migratedLegacy = migrateLegacyGuestStorage(today);
      const lastPlayed = localStorage.getItem(keys.lastPlayedDate) ?? migratedLegacy?.legacyDate ?? null;
      const savedStateRaw = localStorage.getItem(keys.gameState) ?? (migratedLegacy ? JSON.stringify(migratedLegacy.parsedState) : null);

      // Restore previous game state if it's from the same day and target
      if (lastPlayed === today && savedStateRaw) {
        try {
          const savedState = JSON.parse(savedStateRaw);
          const savedId = savedState.dailyPokemon?.id;
          if (userScope || savedId === undefined || savedId === targetId) {
            set({
              ...restoreSnapshot(savedState, userScope),
              pokemonList: POKEMON_LIST,
              isLoading: false,
              lastPlayedDate: today,
            });
            // A first-load PokéAPI failure persists a bare stub; fill it in now.
            const restored = get().dailyPokemon;
            if (needsDetails(restored)) {
              await hydratePokemonDetails(restored.id, isCurrent, userScope ? restored.name : undefined);
            }
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

      // A fresh day: drop anything still queued for yesterday's puzzle.
      pendingGuesses = [];
      submitGeneration += 1;

      if (userScope || targetId === null) {
        // The answer comes from the server session; nothing to show until then.
        set({
          dailyPokemon: null,
          pokemonList: POKEMON_LIST,
          guesses: [],
          guessResults: [],
          nameLength: null,
          hints: getEmptyHints(),
          gameStatus: 'playing',
          isLoading: false,
          lastPlayedDate: today,
          sessionVersion: null,
          puzzleDateKey: null,
          isSubmitting: false,
          staleLock: false,
          rateLimitUntil: null,
          newlyUnlockedBalls: [],
          rejectedGuess: null,
        });
        localStorage.setItem(keys.lastPlayedDate, today);
        persistGameStateSnapshot(get());
        return;
      }

      // Playable at once from the bundled name; sprite and hint data fill in
      // when the details load.
      const detailCacheKey = `pokemon_detail_cache_${targetId}_${today}`;
      const cachedDetail = localStorage.getItem(detailCacheKey);
      const dailyPokemon: Pokemon = cachedDetail ? JSON.parse(cachedDetail) : stubPokemon(targetId);

      set({
        dailyPokemon,
        pokemonList: POKEMON_LIST,
        guesses: [],
        guessResults: [],
        nameLength: letterCount(dailyPokemon.name),
        hints: getEmptyHints(),
        gameStatus: 'playing',
        isLoading: false,
        lastPlayedDate: today,
        sessionVersion: null,
        puzzleDateKey: null,
        isSubmitting: false,
        staleLock: false,
        rateLimitUntil: null,
        newlyUnlockedBalls: [],
        rejectedGuess: null,
      });

      localStorage.setItem(keys.lastPlayedDate, today);
      persistGameStateSnapshot(get());

      if (!cachedDetail) {
        await hydratePokemonDetails(targetId, isCurrent);
      }
    } catch (error) {
      if (epoch !== initEpoch) return;
      // The bundled-name stub keeps the guest game playable without details.
      if (!get().dailyPokemon && !isUserScope()) {
        set({
          error: 'Failed to sync your Pokédex. Please try again.',
          isLoading: false
        });
      } else {
        set({ isLoading: false });
      }
    }
  },

  // Guest play: guesses are scored locally against the local target.
  makeGuess: async (guess: string) => {
    const { dailyPokemon, guesses, guessResults, pokemonList, gameStatus } = get();

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
    set({
      guesses: newGuesses,
      guessResults: [...guessResults, getLetterMatchResult(normalizedGuess, dailyPokemon.name)],
      error: null,
      gameStatus: newGameStatus,
    });

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

  // Reveals progressive hints for guest play based on guess attempt count
  revealHint: async (attemptNumber: number) => {
    const { dailyPokemon, hints } = get();

    if (!dailyPokemon) return;

    const newHints = [...hints];

    try {
      set({ isLoading: true });

      // Details may be missing if PokéAPI failed earlier; try once more.
      let pokemon = dailyPokemon;
      if ((attemptNumber === 3 || attemptNumber === 9) && pokemon.id && !pokemon.abilities?.length) {
        try { pokemon = await fetchPokemonDetails(pokemon.id); } catch { /* fall back to 'Unknown' */ }
      }

      if (attemptNumber === 3) {
        // Reveal ability hint after 3rd attempt
        const primaryAbility = pokemon.abilities?.[0]?.ability.name || 'Unknown';
        newHints[0] = { ...newHints[0], value: primaryAbility, revealed: true };
      }
      else if (attemptNumber === 6) {
        // Reveal generation hint after 6th attempt (derived from the dex id)
        let generation: string | null = dailyPokemon.id ? generationForId(dailyPokemon.id) : null;
        if (!generation && dailyPokemon.species?.url) {
          generation = (await fetchPokemonSpecies(dailyPokemon.species.url)).generation.name;
        }
        newHints[1] = { ...newHints[1], value: generation ?? 'Unknown', revealed: true };
      }
      else if (attemptNumber === 9) {
        // Reveal type hint after 9th attempt
        const types = pokemon.types?.map(t => t.type.name);
        newHints[2] = { ...newHints[2], value: types?.length ? types : ['Unknown'], revealed: true };
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
      guessResults: [],
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
        nameLength: letterCount(newPokemon.name),
        isLoading: false,
        guesses: [],
        guessResults: [],
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

  // Re-initialises for a new JST day (guests locally, signed-in users also
  // reload the server session when a token is given).
  checkForNewDay: (accessToken) => {
    const { lastPlayedDate } = get();
    const today = getJSTDateKey();

    if (lastPlayedDate !== today) {
      void get().initializeGame();
      if (accessToken && isUserScope()) {
        void get().initializeServerSession(accessToken);
      }
    }
  },

  initializeServerSession: async (accessToken) => {
    const requestEpoch = serverSyncEpoch;
    const base = import.meta.env.VITE_API_URL as string;
    const puzzleDateKey = getJSTDateKey();

    const load = (async () => {
      try {
        if (migrationGate) await migrationGate;
        if (requestEpoch !== serverSyncEpoch) return;
        // get-session creates today's session (and pins its target) on first read.
        const sessRes = await fetch(
          `${base}/functions/v1/get-session?puzzle_date_key=${puzzleDateKey}`,
          { headers: { Authorization: `Bearer ${currentToken(accessToken)}` } }
        );
        if (requestEpoch !== serverSyncEpoch) return;
        if (!sessRes.ok) return;
        const s = await sessRes.json();
        if (requestEpoch !== serverSyncEpoch) return;

        set(state => applyServerSession(state, s, puzzleDateKey));
        persistGameStateSnapshot(get());
        localStorage.setItem(getStorageKeys(activeStorageScope).lastPlayedDate, puzzleDateKey);

        const pokemon = get().dailyPokemon;
        if (get().gameStatus !== 'playing' && needsDetails(pokemon)) {
          void hydratePokemonDetails(pokemon.id, () => requestEpoch === serverSyncEpoch, pokemon.name);
        }
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
    const { guesses, pokemonList, gameStatus } = get();
    const base = import.meta.env.VITE_API_URL as string;

    if (gameStatus !== 'playing' || guesses.length >= MAX_GUESSES) return false;

    const normalized = normalizePokemonName(guess);

    if (guesses.includes(normalized)) {
      set({ error: 'You already threw a ball at that one!' });
      return false;
    }
    if (!isValidPokemonName(normalized, pokemonList)) {
      set({ error: "That Pokémon isn't in your Pokédex!" });
      return false;
    }

    // Show the guess at once as pending tiles. Colours, hints and the result
    // all come from the server's reply; nothing is decided here.
    const snapshot = { guesses };
    const newGuesses = [...guesses, normalized];
    pendingGuesses.push(normalized);
    set({
      guesses: newGuesses,
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
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${currentToken(accessToken)}` },
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
          const serverStatus = statusFromServer(d.completion_state);
          if (serverStatus !== 'playing') {
            // Game over: guesses queued behind it can never be accepted.
            pendingGuesses = [];
            submitGeneration += 1;
          }
          const morePending = pendingGuesses.length > 0;

          set(state => ({
            // Later optimistic guesses stay on screen until their own reply.
            ...applyServerSession(state, d, puzzleDateKey),
            isSubmitting: morePending,
            newlyUnlockedBalls: [...state.newlyUnlockedBalls, ...(d.newly_unlocked_balls ?? [])],
          }));

          localStorage.setItem(getStorageKeys(activeStorageScope).lastPlayedDate, getJSTDateKey());
          persistGameStateSnapshot(get());

          const pokemon = get().dailyPokemon;
          if (serverStatus !== 'playing' && needsDetails(pokemon)) {
            void hydratePokemonDetails(pokemon.id, () => requestEpoch === serverSyncEpoch, pokemon.name);
          }
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
      guessResults: [],
      nameLength: null,
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

  hasGuestProgress: () => readGuestProgress() !== null,

  beginMigrationGate: () => {
    if (migrationGate) return;
    migrationGate = new Promise<void>(resolve => { releaseMigrationGate = resolve; });
    // Never leave the session load blocked if migration stalls.
    setTimeout(() => get().endMigrationGate(), MIGRATION_GATE_TIMEOUT_MS);
  },

  endMigrationGate: () => {
    releaseMigrationGate?.();
    releaseMigrationGate = null;
    migrationGate = null;
  },

  // Imports today's guest guesses into a brand-new account and adopts the
  // resulting server session. Returns true when the server accepted them.
  migrateGuestProgress: async (accessToken) => {
    const progress = readGuestProgress();
    const guestId = localStorage.getItem(GUEST_ID_KEY);
    if (!progress || !guestId) return false;

    const requestEpoch = serverSyncEpoch;
    const base = import.meta.env.VITE_API_URL as string;
    const puzzleDateKey = getJSTDateKey();
    try {
      const resp = await fetch(`${base}/functions/v1/migrate-guest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${currentToken(accessToken)}` },
        body: JSON.stringify({ puzzle_date_key: puzzleDateKey, guest_id: guestId, guesses: progress.guesses }),
      });
      if (requestEpoch !== serverSyncEpoch || !resp.ok) return false;
      const s = await resp.json();
      if (requestEpoch !== serverSyncEpoch) return false;

      set(state => applyServerSession(state, s, puzzleDateKey));
      persistGameStateSnapshot(get());
      localStorage.setItem(getStorageKeys(activeStorageScope).lastPlayedDate, puzzleDateKey);
      // The guest game now lives on the account.
      clearScopeStorage('guest');

      const pokemon = get().dailyPokemon;
      if (get().gameStatus !== 'playing' && needsDetails(pokemon)) {
        void hydratePokemonDetails(pokemon.id, () => requestEpoch === serverSyncEpoch, pokemon.name);
      }
      return true;
    } catch (err) {
      console.error('Guest migration failed:', err);
      return false;
    }
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
