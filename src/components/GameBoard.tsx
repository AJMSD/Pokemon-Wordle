import React, { useState, useEffect } from 'react'
import { useGameStore } from '../store/gameStore'
import GuessInput from './GuessInput'
import GuessList from './GuessList'
import HintPanel from './HintPanel'
import ToastContainer from './ToastContainer'
import useToast from '../hooks/useToast'
import { ToastProps } from './Toast'

const GameBoard: React.FC = () => {
  const [currentGuess, setCurrentGuess] = useState('')
  const { gameStatus, makeGuess, error, resetError } = useGameStore()
  const { toasts, addToast, removeToast, showError } = useToast()
  
  // Show win toast when player guesses correctly
  useEffect(() => {
    if (gameStatus === 'won') {
      addToast('Congratulations! You guessed correctly! New Pokémon coming...', 'success');
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
  
  // Cast toasts to the expected type
  const typedToasts = toasts.map(toast => ({
    ...toast,
    onClose: toast.onClose || (() => removeToast(toast.id))
  })) as (ToastProps & { id: string })[]
  
  return (
    <div className="space-y-6">
      <GuessList />
      
      <HintPanel />
      
      <GuessInput 
        value={currentGuess}
        onChange={(e) => setCurrentGuess(e.target.value)}
        onSubmit={handleSubmitGuess}
      />
      
      <ToastContainer toasts={typedToasts} removeToast={removeToast} />
    </div>
  );
};

export default GameBoard;
