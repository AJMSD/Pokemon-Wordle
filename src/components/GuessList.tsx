import React, { useRef, useEffect } from 'react'
import { useGameStore } from '../store/gameStore'
import { normalizePokemonName } from '../utils/pokemonUtils'

const GuessList: React.FC = () => {
  const { guesses, guessResults, dailyPokemon, gameStatus } = useGameStore()
  const guessesEndRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to the latest guess
  useEffect(() => {
    if (guessesEndRef.current) {
      guessesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [guesses.length]);

  // Show placeholder when no guesses yet
  if (guesses.length === 0) {
    return (
      <div className="empty-guesses">
        <p>Throw your first Poké Ball to begin!</p>
      </div>
    )
  }

  return (
    <div className="guesses-list">
      <h2 className="guesses-title">Your Guesses</h2>
      <ul className="guess-items">
        {guesses.map((guess, index) => {
          const normalizedGuess = normalizePokemonName(guess);
          // No results yet means the server hasn't scored this guess: plain tiles.
          const letterResults = guessResults[index];
          const isPending = !letterResults;
          const isCorrect = !!letterResults?.length && letterResults.every(r => r === 'correct');

          return (
            <li
              key={index}
              className={`guess-item ${isCorrect ? 'correct-guess' : ''}`}
            >
              <div className="guess-info">
                <span className="guess-name">{guess}</span>
                <span className="guess-number">#{index + 1}</span>
              </div>

              {/* Letter match blocks */}
              <div className="letter-blocks">
                {normalizedGuess.split('').map((letter, letterIndex) => (
                  <div
                    key={letterIndex}
                    className={`letter-block ${isPending ? 'pending' : letterResults[letterIndex] ?? ''}`}
                  >
                    {letter}
                  </div>
                ))}
              </div>

              {/* Success message for correct guess */}
              {isCorrect && gameStatus === 'won' && dailyPokemon?.name && (
                <div className="mt-4 text-center">
                  <p className="text-lg font-bold text-pokemon-red">
                    Congratulations! You caught {dailyPokemon.name}!
                  </p>
                </div>
              )}
            </li>
          );
        })}
        {/* Invisible element for scrolling to bottom */}
        <div ref={guessesEndRef} />
      </ul>
    </div>
  )
}

export default GuessList
