import { useEffect, useCallback } from 'react';
import useGameStore from '../store/gameStore';
import { normalizePokemonName } from '../utils/pokemonUtils';

// Custom hook for game logic and state access
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

  // Initialize game on first load if needed
  useEffect(() => {
    if (!dailyPokemon && pokemonList.length === 0) {
      initializeGame();
    }
  }, [dailyPokemon, pokemonList, initializeGame]);

  // Calculate game metrics
  const currentAttempt = guesses.length;
  const remainingAttempts = 10 - currentAttempt;
  const pokemonNameLength = dailyPokemon ? normalizePokemonName(dailyPokemon.name).length : 0;

  // Generate autocomplete suggestions for the input field
  const getSuggestions = useCallback((input: string) => {
    if (!input) return [];
    
    const normalizedInput = normalizePokemonName(input);
    const normalizedNames = new Set<string>();
    
    return pokemonList
      .filter(name => {
        // Only include names that start with input and haven't been guessed yet
        if (name.startsWith(normalizedInput)) {
          const normalized = normalizePokemonName(name);
          if (!normalizedNames.has(normalized) && !guesses.includes(name)) {
            normalizedNames.add(normalized);
            return true;
          }
        }
        return false;
      })
      .slice(0, 5); // Limit to 5 suggestions for better performance
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
