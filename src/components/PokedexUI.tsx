import React, { useState, useEffect } from 'react'
import { useGameStore } from '../store/gameStore'
import HintPanel from './HintPanel'
import GuessList from './GuessList'
import useToast from '../hooks/useToast'
import useGame from '../hooks/useGame'

const PokedexUI: React.FC = () => {
  const [currentGuess, setCurrentGuess] = useState('')
  const { makeGuess, error, resetError, dailyPokemon, gameStatus, checkForNewDay } = useGameStore()
  const { getSuggestions } = useGame()
  const { showError, addToast } = useToast()
  const [showSuggestions, setShowSuggestions] = useState(false)
  const suggestions = currentGuess.length > 0 ? getSuggestions(currentGuess) : []

  // Check for a new day on component mount
  useEffect(() => {
    checkForNewDay();
  }, [checkForNewDay]);

  // Show error toast when error occurs
  useEffect(() => {
    if (error) {
      showError(error)
      resetError()
    }
    
    if (gameStatus === 'won') {
      addToast('Congratulations! You guessed correctly!', 'success')
    } else if (gameStatus === 'lost') {
      addToast(`Game over! The Pokémon was ${dailyPokemon?.name}.`, 'error')
    }
  }, [error, resetError, showError, gameStatus, addToast, dailyPokemon?.name])

  const handleSubmitGuess = (e: React.FormEvent) => {
    e.preventDefault()
    if (currentGuess.trim() === '') return
    
    makeGuess(currentGuess)
    setCurrentGuess('')
    setShowSuggestions(false)
  }

  const handleSelectSuggestion = (suggestion: string) => {
    setCurrentGuess(suggestion)
    setShowSuggestions(false)
  }

  // Determine what to show in the main screen
  const pokemonImage = dailyPokemon?.sprites?.other?.['official-artwork']?.front_default || dailyPokemon?.sprites?.front_default;

  return (
    <div className="pokedex">
      <div className="pokedex-left-panel">
        <div className="left-panel-top">
          <div className="blue-light"></div>
          <div className="small-lights-container">
            <div className="small-light red"></div>
            <div className="small-light yellow"></div>
            <div className="small-light green"></div>
          </div>
        </div>
        <div className="main-screen-container">
          <div className="main-screen">
            {gameStatus === 'won' ? (
              <div className="pokemon-image-container">
                <img src={pokemonImage} alt={dailyPokemon?.name} className="pokemon-image" />
              </div>
            ) : (
              <div className="unknown-pokemon">?</div>
            )}
          </div>
          <div className="main-screen-decorations">
            <div className="bottom-lights-container">
              <div className="bottom-light red"></div>
              <div className="bottom-light green"></div>
            </div>
            <div className="sound-holes">
              <div className="sound-hole"></div>
              <div className="sound-hole"></div>
              <div className="sound-hole"></div>
              <div className="sound-hole"></div>
            </div>
          </div>
        </div>
        <div className="guess-input-container">
          <form onSubmit={handleSubmitGuess} className="guess-form">
            <input
              type="text"
              value={currentGuess}
              onChange={(e) => {
                setCurrentGuess(e.target.value)
                setShowSuggestions(e.target.value.length > 0)
              }}
              className="guess-input"
              placeholder="Enter Pokémon name..."
              autoComplete="off"
              autoFocus
              disabled={gameStatus !== 'playing'}
            />
            <div className="masterball-button-container">
              <button 
                type="submit" 
                className="masterball-button"
                disabled={currentGuess.trim() === '' || gameStatus !== 'playing'}
                aria-label="Submit guess"
              >
                <div className="masterball">
                  <div className="masterball-top">
                    <div className="masterball-m">M</div>
                    <div className="masterball-dots">
                      <div className="masterball-dot"></div>
                      <div className="masterball-dot"></div>
                    </div>
                  </div>
                  <div className="masterball-stripe"></div>
                  <div className="masterball-bottom"></div>
                  <div className="masterball-button-center"></div>
                </div>
              </button>
            </div>
            {showSuggestions && suggestions.length > 0 && (
              <div className="suggestions-dropdown">
                {suggestions.map((suggestion, index) => (
                  <div
                    key={index}
                    className="suggestion-item"
                    onClick={() => handleSelectSuggestion(suggestion)}
                  >
                    {suggestion}
                  </div>
                ))}
              </div>
            )}
          </form>
        </div>
      </div>
      <div className="pokedex-right-panel">
        <div className="right-panel-screen">
          <HintPanel />
        </div>
        <div className="guesses-container">
          <GuessList />
        </div>
      </div>
    </div>
  )
}

export default PokedexUI
