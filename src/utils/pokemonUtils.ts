import { Pokemon, PokemonSpecies } from '../types';

// Normalizes Pokémon names by removing special forms, spaces, etc.
export const normalizePokemonName = (name: string): string => {
  return name
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/-mega$|-gmax$|-alola$|-galar$|-hisui$|-paldea$|-green-plumage$|-incarnate$|-f$|-m$|-shield$|-single-strike$|-normal$|-plant$|-altered$|-land$|-red-striped$|-standard$|-ordinary$|-aria$|-male$|-average$|-50$|-baile$|-midday$|-solo$|-red-meteor$|-disguised$|-amped$|-full-belly$|-family-of-four$|-zero$|-curly$|-two-segment$|-ice$/, '');
};

export function getJSTDateKey(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

// Fetches detailed information for a specific Pokémon
export const fetchPokemonDetails = async (idOrName: number | string): Promise<Pokemon> => {
  try {
    const response = await fetch(`https://pokeapi.co/api/v2/pokemon/${idOrName}`);
    if (!response.ok) throw new Error(`PokéAPI ${response.status}`);
    return await response.json();
  } catch (error) {
    console.error(`Error fetching details for ${idOrName}:`, error);
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
