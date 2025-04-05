import { Pokemon, PokemonSpecies } from '../types';

// Normalizes Pokémon names by removing special forms, spaces, etc.
export const normalizePokemonName = (name: string): string => {
  return name
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/-mega$|-gmax$|-alola$|-galar$|-hisui$|-paldea$|-green-plumage$|-incarnate$|-f$|-m$|-shield$|-single-strike$|-normal$|-plant$|-altered$|-land$|-red-striped$|-standard$|-ordinary$|-aria$|-male$|-average$|-50$|-baile$|-midday$|-solo$|-red-meteor$|-disguised$|-amped$|-full-belly$|-family-of-four$|-zero$|-curly$|-two-segment$|-ice$/, '');
};

// Generates a consistent Pokémon index for a given day
export const getDailyPokemonIndex = (): number => {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const seed = today + "pokemonWordle"; // Salt for randomization
  
  // Use prime numbers for better hash distribution
  const PRIME1 = 7919;
  const PRIME2 = 6733;
  
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    // XOR and rotation for improved distribution
    hash = ((hash << 5) ^ (hash >> 7)) + seed.charCodeAt(i) * PRIME1;
    hash = (hash * PRIME2) & 0x7FFFFFFF; // Keep within 31-bit positive range
  }
  
  return hash % 1025; // Limit to number of Pokémon
};

// Generates a random Pokémon index (for testing)
export const getRandomPokemonIndex = (maxIndex: number): number => {
  return Math.floor(Math.random() * maxIndex);
};

// Fetches all Pokémon names from the PokéAPI
export const fetchAllPokemon = async (): Promise<string[]> => {
  try {
    const response = await fetch('https://pokeapi.co/api/v2/pokemon?limit=1025');
    const data = await response.json();
    
    // Extract and normalize the names
    return data.results.map((pokemon: { name: string }) => 
      normalizePokemonName(pokemon.name)
    );
  } catch (error) {
    console.error('Error fetching Pokémon list:', error);
    throw error;
  }
};

// Fetches detailed information for a specific Pokémon
export const fetchPokemonDetails = async (name: string): Promise<Pokemon> => {
  try {
    const response = await fetch(`https://pokeapi.co/api/v2/pokemon/${name}`);
    return await response.json();
  } catch (error) {
    console.error(`Error fetching details for ${name}:`, error);
    throw error;
  }
};

// Fetches species data for a Pokémon to get generation information
export const fetchPokemonSpecies = async (url: string): Promise<PokemonSpecies> => {
  try {
    const response = await fetch(url);
    return await response.json();
  } catch (error) {
    console.error('Error fetching Pokémon species:', error);
    throw error;
  }
};

// Checks if a guess matches the daily Pokémon
export const isCorrectGuess = (guess: string, dailyPokemon: Pokemon): boolean => {
  return normalizePokemonName(guess) === normalizePokemonName(dailyPokemon.name);
};

// Validates if a guess is a real Pokémon name
export const isValidPokemonName = (guess: string, pokemonList: string[]): boolean => {
  const normalizedGuess = normalizePokemonName(guess);
  return pokemonList.includes(normalizedGuess);
};

// Analyzes how letters in the guess match the target Pokémon name
export const getLetterMatchResult = (
  guess: string,
  target: string
): ('correct' | 'present' | 'absent')[] => {
  if (!guess || !target) return [];
  
  const normalizedGuess = normalizePokemonName(guess);
  const normalizedTarget = normalizePokemonName(target);
  
  // Create a frequency map of target letters
  const targetLetters = new Map<string, number>();
  for (const letter of normalizedTarget) {
    targetLetters.set(letter, (targetLetters.get(letter) || 0) + 1);
  }
  
  // Initialize all positions as absent
  const result = Array(normalizedGuess.length).fill('absent');
  const targetCopy = new Map(targetLetters);
  
  // First pass: mark correct positions
  for (let i = 0; i < normalizedGuess.length; i++) {
    const letter = normalizedGuess[i];
    if (i < normalizedTarget.length && letter === normalizedTarget[i]) {
      result[i] = 'correct';
      targetCopy.set(letter, targetCopy.get(letter)! - 1);
    }
  }
  
  // Second pass: mark present letters in wrong positions
  for (let i = 0; i < normalizedGuess.length; i++) {
    if (result[i] !== 'absent') continue;
    
    const letter = normalizedGuess[i];
    if (targetCopy.get(letter) && targetCopy.get(letter)! > 0) {
      result[i] = 'present';
      targetCopy.set(letter, targetCopy.get(letter)! - 1);
    }
  }
  
  return result;
};
