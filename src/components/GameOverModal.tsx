import React from 'react'
import { useGameStore } from '../store/gameStore'

interface GameOverModalProps {
  onClose: () => void;
}

const GameOverModal: React.FC<GameOverModalProps> = ({ onClose }) => {
  const { gameStatus, dailyPokemon, resetGame } = useGameStore();
  
  if (gameStatus === 'playing') {
    return null;
  }
  
  const isWin = gameStatus === 'won';
  
  const handlePlayAgain = () => {
    resetGame();
    onClose(); // This should be called after resetGame to ensure modal closes
  };
  
  const pokemonImage = dailyPokemon?.sprites?.other?.['official-artwork']?.front_default 
    || dailyPokemon?.sprites?.front_default;
  
  return (
    <div className="fixed inset-0 bg-pokemon-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-pokemon-white rounded-lg shadow-xl max-w-md w-full p-6 relative">
        <button 
          onClick={onClose}
          className="absolute top-2 right-2 text-gray-500 hover:text-gray-700"
          aria-label="Close"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        
        <div className="text-center">
          <h2 className={`text-2xl font-bold mb-4 ${isWin ? 'text-pokemon-blue' : 'text-pokemon-red'}`}>
            {isWin ? 'Congratulations!' : 'Game Over!'}
          </h2>
          
          <p className="mb-4 text-lg">
            {isWin 
              ? 'You guessed the Pokémon correctly!' 
              : `The Pokémon was ${dailyPokemon?.name}.`}
          </p>
          
          {pokemonImage && (
            <div className="my-6 flex justify-center">
              <img 
                src={pokemonImage} 
                alt={dailyPokemon?.name} 
                className="h-48 w-48 object-contain"
              />
            </div>
          )}
          
          <div className="mt-6 flex justify-center space-x-4">
            <button
              onClick={handlePlayAgain}
              className="px-4 py-2 bg-pokemon-red text-pokemon-white rounded-md hover:bg-primary-700 transition-colors"
            >
              Play Again
            </button>
            
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GameOverModal;
