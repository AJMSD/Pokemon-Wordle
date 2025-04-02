// Try different import syntax
// import * as CryptoJS from 'crypto-js';
import { Pokemon, PokemonSpecies } from '../types';

// Normalize Pokémon names for comparison (lowercase, remove special forms)
export const normalizePokemonName = (name: string): string => {
  return name
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/-mega$|-gmax$|-alola$|-galar$|-hisui$|-paldea$|-green-plumage$|-incarnate$/, '');
};

// Simple hash function for deterministic Pokemon selection
const simpleHash = (str: string): number => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
};

// Get a deterministic Pokémon for the day using simple hash
export const getDailyPokemonIndex = (): number => {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  console.log(today);
  return simpleHash(today);
};

// Get a random Pokémon index
export const getRandomPokemonIndex = (maxIndex: number): number => {
  return Math.floor(Math.random() * maxIndex);
};

// Fetch all Pokémon names
export const fetchAllPokemon = async (): Promise<string[]> => {
  try {
    const response = await fetch('https://pokeapi.co/api/v2/pokemon?limit=1025');
    const data = await response.json();
    
    // Extract just the names and normalize them
    return data.results.map((pokemon: { name: string }) => 
      normalizePokemonName(pokemon.name)
    );
  } catch (error) {
    console.error('Error fetching Pokémon list:', error);
    throw error;
  }
};

// Fetch a specific Pokémon's details
export const fetchPokemonDetails = async (name: string): Promise<Pokemon> => {
  try {
    const response = await fetch(`https://pokeapi.co/api/v2/pokemon/${name}`);
    return await response.json();
  } catch (error) {
    console.error(`Error fetching details for ${name}:`, error);
    throw error;
  }
};

// Fetch Pokémon species data (for generation info)
export const fetchPokemonSpecies = async (url: string): Promise<PokemonSpecies> => {
  try {
    const response = await fetch(url);
    return await response.json();
  } catch (error) {
    console.error('Error fetching Pokémon species:', error);
    throw error;
  }
};

// Check if a guess matches the daily Pokémon
export const isCorrectGuess = (guess: string, dailyPokemon: Pokemon): boolean => {
  return normalizePokemonName(guess) === normalizePokemonName(dailyPokemon.name);
};

// Validate if a guess is a real Pokémon name
export const isValidPokemonName = (guess: string, pokemonList: string[]): boolean => {
  const normalizedGuess = normalizePokemonName(guess);
  return pokemonList.includes(normalizedGuess);
};

// Compare letters between guess and target
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
  
  // First pass: mark correct letters
  const result = Array(normalizedGuess.length).fill('absent');
  const targetCopy = new Map(targetLetters);
  
  // First check for correct positions
  for (let i = 0; i < normalizedGuess.length; i++) {
    const letter = normalizedGuess[i];
    if (i < normalizedTarget.length && letter === normalizedTarget[i]) {
      result[i] = 'correct';
      targetCopy.set(letter, targetCopy.get(letter)! - 1);
    }
  }
  
  // Second pass: mark present letters (but not in correct position)
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
