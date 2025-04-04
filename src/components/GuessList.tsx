import React, { useRef, useEffect } from 'react'
import { useGameStore } from '../store/gameStore'
import { getLetterMatchResult } from '../utils/pokemonUtils'

const GuessList: React.FC = () => {
  const { guesses, dailyPokemon } = useGameStore()
  const guessesEndRef = useRef<HTMLDivElement>(null)
  
  // Scroll to bottom when new guesses are added
  useEffect(() => {
    if (guessesEndRef.current) {
      guessesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [guesses.length]);
  
  if (guesses.length === 0) {
    return (
      <div className="empty-guesses">
        <p>Start guessing to see your attempts here!</p>
      </div>
    )
  }
  
  return (
    <div className="guesses-list">
      <h2 className="guesses-title">Your Guesses</h2>
      <ul className="guess-items">
        {guesses.map((guess, index) => {
          const isCorrect = guess === dailyPokemon?.name;
          const letterResults = getLetterMatchResult(guess, dailyPokemon?.name || '');
          
          return (
            <li 
              key={index}
              className={`guess-item ${isCorrect ? 'correct-guess' : ''}`}
            >
              <div className="guess-info">
                <span className="guess-name">{guess}</span>
                <span className="guess-number">#{index + 1}</span>
              </div>
              
              <div className="letter-results">
                {guess.split('').map((letter, letterIndex) => {
                  const result = letterResults[letterIndex] || 'absent';
                  return (
                    <div 
                      key={letterIndex}
                      className={`letter-result ${result}`}
                    >
                      {letter}
                    </div>
                  );
                })}
              </div>
              
              {isCorrect && (
                <div className="mt-4 text-center">
                  <p className="text-lg font-bold text-pokemon-red">
                    Congratulations! You caught {dailyPokemon?.name}!
                  </p>
                </div>
              )}
            </li>
          );
        })}
        <div ref={guessesEndRef} />
      </ul>
    </div>
  )
}

export default GuessList
