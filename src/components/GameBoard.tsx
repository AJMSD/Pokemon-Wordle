import React, { useState, useEffect } from 'react'
import { useGameStore } from '../store/gameStore'
import GuessInput from './GuessInput'
import GuessList from './GuessList'
import HintPanel from './HintPanel'
import GameOverModal from './GameOverModal'
import ToastContainer from './ToastContainer'
import useToast from '../hooks/useToast'

const GameBoard: React.FC = () => {
  const [currentGuess, setCurrentGuess] = useState('')
  const [showModal, setShowModal] = useState(false)
  const { guesses, gameStatus, makeGuess, error, resetError } = useGameStore()
  const { toasts, addToast, removeToast, showError } = useToast()
  
  // Show game over modal when game ends
  useEffect(() => {
    if (gameStatus === 'won' || gameStatus === 'lost') {
      setShowModal(true);
      
      // Show toast based on game result
      if (gameStatus === 'won') {
        addToast('Congratulations! You guessed correctly!', 'success');
      } else {
        addToast('Game over! Better luck next time!', 'info');
      }
    }
  }, [gameStatus, addToast]);
  
  // Show error toast when error occurs, and reset error in store
  useEffect(() => {
    if (error) {
      showError(error);
      // Clear the error from the store after showing toast
      resetError();
    }
  }, [error, showError, resetError]);
  
  const handleSubmitGuess = (e: React.FormEvent) => {
    e.preventDefault();
    if (currentGuess.trim() === '') return;
    
    makeGuess(currentGuess);
    setCurrentGuess('');
  };
  
  const handleCloseModal = () => {
    setShowModal(false);
  };
  
  return (
    <div className="space-y-6">
      <GuessList />
      
      <HintPanel />
      
      {gameStatus === 'playing' && (
        <GuessInput 
          value={currentGuess}
          onChange={(e) => setCurrentGuess(e.target.value)}
          onSubmit={handleSubmitGuess}
          attemptsLeft={10 - guesses.length}
        />
      )}
      
      {showModal && (
        <GameOverModal onClose={handleCloseModal} />
      )}
      
      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </div>
  );
};

export default GameBoard;
