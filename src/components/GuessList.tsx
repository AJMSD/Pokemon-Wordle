import React from 'react'
import { useGameStore } from '../store/gameStore'
import { getLetterMatchResult } from '../utils/pokemonUtils'
import PokeballAnimation from './PokeballAnimation'

const GuessList: React.FC = () => {
  const { guesses, dailyPokemon } = useGameStore()
  
  if (guesses.length === 0) {
    return (
      <div className="bg-gray-100 p-8 rounded-md text-center">
        <p className="text-gray-500">Start guessing to see your attempts here!</p>
      </div>
    )
  }
  
  return (
    <div className="space-y-2">
      <h2 className="text-xl font-semibold">Your Guesses</h2>
      <ul className="space-y-3">
        {guesses.map((guess, index) => {
          const isCorrect = guess === dailyPokemon?.name;
          const letterResults = getLetterMatchResult(guess, dailyPokemon?.name || '');
          
          return (
            <li 
              key={index}
              className={`p-3 rounded-md ${
                isCorrect
                  ? 'bg-green-100 text-green-800 font-medium border border-green-300'
                  : 'bg-gray-100'
              } transition-all duration-300 transform ${
                isCorrect ? 'scale-105' : ''
              }`}
            >
              <div className="flex justify-between items-center mb-2">
                <span className="font-medium">{guess}</span>
                <span className="text-sm text-gray-500">
                  Attempt {index + 1}
                </span>
              </div>
              
              <div className="flex flex-wrap gap-1">
                {guess.split('').map((letter, letterIndex) => {
                  const result = letterResults[letterIndex] || 'absent';
                  const bgColor = {
                    'correct': 'bg-correct text-white',
                    'present': 'bg-present text-gray-800',
                    'absent': 'bg-absent text-white'
                  }[result];
                  
                  return (
                    <div 
                      key={letterIndex}
                      className={`w-8 h-8 flex items-center justify-center text-sm font-semibold uppercase rounded ${bgColor}`}
                    >
                      {letter}
                    </div>
                  );
                })}
              </div>
              
              {isCorrect && (
                <div className="mt-4 flex flex-col items-center">
                  <PokeballAnimation pokemonImage={dailyPokemon?.sprites?.other?.['official-artwork']?.front_default || dailyPokemon?.sprites?.front_default} />
                  <p className="mt-3 text-lg font-bold text-pokemon-red">
                    Congratulations! You caught {dailyPokemon?.name}!
                  </p>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  )
}

export default GuessList
