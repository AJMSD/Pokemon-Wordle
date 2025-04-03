import { useEffect, useCallback } from 'react';
import useGameStore from '../store/gameStore';
import { normalizePokemonName } from '../utils/pokemonUtils';

export const useGame = () => {
  const {
    dailyPokemon,
    pokemonList,
    guesses,
    hints,
    gameStatus,
    isLoading,
    error,
    initializeGame,
    makeGuess,
    resetGame
  } = useGameStore();

  // Initialize the game on first load
  useEffect(() => {
    if (!dailyPokemon && pokemonList.length === 0) {
      initializeGame();
    }
  }, [dailyPokemon, pokemonList, initializeGame]);

  // Get the current attempt number
  const currentAttempt = guesses.length;

  // Calculate remaining attempts
  const remainingAttempts = 10 - currentAttempt;

  // Get Pokémon name length for UI to display the correct number of boxes
  const pokemonNameLength = dailyPokemon ? normalizePokemonName(dailyPokemon.name).length : 0;

  // Filter Pokémon list for autocomplete suggestions - memoized with useCallback
  const getSuggestions = useCallback((input: string) => {
    if (!input) return [];
    
    const normalizedInput = normalizePokemonName(input);
    
    // Keep track of normalized names we've already seen
    const normalizedNames = new Set<string>();
    
    return pokemonList
      .filter(name => {
        // Check if the Pokémon name starts with the input
        if (name.startsWith(normalizedInput)) {
          // Get normalized name and check if we've seen it before
          const normalized = normalizePokemonName(name);
          if (!normalizedNames.has(normalized) && !guesses.includes(name)) {
            normalizedNames.add(normalized);
            return true;
          }
        }
        return false;
      })
      .slice(0, 5); // Limit to 5 suggestions
  }, [pokemonList, guesses]);

  return {
    dailyPokemon,
    pokemonNameLength,
    guesses,
    hints,
    currentAttempt,
    remainingAttempts,
    gameStatus,
    isLoading,
    error,
    makeGuess,
    resetGame,
    getSuggestions
  };
};

export default useGame;
