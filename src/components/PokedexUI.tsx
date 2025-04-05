import React, { useState, useEffect, useRef } from 'react'
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
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const [justSelected, setJustSelected] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  
  // Get matching suggestions based on current input
  const suggestions = currentGuess.length > 0 ? getSuggestions(currentGuess) : []

  // Handle responsive layout based on screen size
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth <= 768);
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Check for a new day when component mounts
  useEffect(() => {
    checkForNewDay();
  }, [checkForNewDay]);

  // Display error toasts and game status notifications
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

  // Reset selected suggestion when suggestions change
  useEffect(() => {
    setSelectedIndex(-1)
  }, [suggestions])

  // Handle form submission
  const handleSubmitGuess = (e: React.FormEvent) => {
    e.preventDefault()
    if (currentGuess.trim() === '') return
    
    makeGuess(currentGuess)
    setCurrentGuess('')
    setShowSuggestions(false)
    setJustSelected(false)
  }

  // Handle suggestion selection
  const handleSelectSuggestion = (suggestion: string) => {
    setCurrentGuess(suggestion)
    setShowSuggestions(false)
    setSelectedIndex(-1)
    setJustSelected(true)
    
    // Focus input for immediate submission
    setTimeout(() => inputRef.current?.focus(), 10)
  }

  // Handle keyboard navigation for suggestions
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Skip if no suggestions visible
    if (!showSuggestions || suggestions.length === 0) {
      setJustSelected(false)
      return
    }

    // Handle submission after selection
    if (justSelected && e.key === 'Enter') {
      e.preventDefault()
      formRef.current?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }))
      setJustSelected(false)
      return
    }

    // Reset flag for non-Enter keys
    if (e.key !== 'Enter') {
      setJustSelected(false)
    }

    // Keyboard navigation
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setSelectedIndex(prev => (prev < suggestions.length - 1 ? prev + 1 : 0))
        break
      case 'ArrowUp':
        e.preventDefault()
        setSelectedIndex(prev => (prev > 0 ? prev - 1 : suggestions.length - 1))
        break
      case 'Enter':
        if (selectedIndex >= 0) {
          e.preventDefault()
          handleSelectSuggestion(suggestions[selectedIndex])
        }
        break
      case 'Escape':
        e.preventDefault()
        setShowSuggestions(false)
        setSelectedIndex(-1)
        break
    }
  }

  // Get pokemon image for display
  const pokemonImage = dailyPokemon?.sprites?.other?.['official-artwork']?.front_default || 
                      dailyPokemon?.sprites?.front_default;

  // Render different content based on device and game status
  const renderMainScreenContent = () => {
    if (isMobile) {
      return gameStatus === 'won' 
        ? <div className="pokemon-image-container">
            <img src={pokemonImage} alt={dailyPokemon?.name} className="pokemon-image" />
          </div>
        : <div className="mobile-hint-panel">
            <HintPanel />
          </div>;
    } else {
      return gameStatus === 'won' 
        ? <div className="pokemon-image-container">
            <img src={pokemonImage} alt={dailyPokemon?.name} className="pokemon-image" />
          </div>
        : <div className="unknown-pokemon">?</div>;
    }
  };

  return (
    <div className="pokedex">
      {/* Left panel with main screen and input */}
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
            {renderMainScreenContent()}
          </div>
          <div className="main-screen-decorations">
            <div className="bottom-lights-container">
              <div className="bottom-light red"></div>
              <div className="bottom-light green"></div>
            </div>
            <div className="sound-holes">
              {[0, 1, 2, 3].map(i => (
                <div key={i} className={`sound-hole ${gameStatus === 'won' ? 'win-glow' : ''}`}></div>
              ))}
            </div>
          </div>
        </div>
        
        {/* Pokemon name input form */}
        <div className="guess-input-container">
          <form ref={formRef} onSubmit={handleSubmitGuess} className="guess-form">
            <input
              ref={inputRef}
              type="text"
              value={currentGuess}
              onChange={(e) => {
                setCurrentGuess(e.target.value)
                setShowSuggestions(e.target.value.length > 0)
              }}
              onKeyDown={handleKeyDown}
              className="guess-input"
              placeholder="Enter Pokémon name..."
              autoComplete="off"
              autoFocus
              disabled={gameStatus !== 'playing'}
            />
            
            {/* Masterball submit button */}
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
            
            {/* Suggestions dropdown */}
            {showSuggestions && suggestions.length > 0 && (
              <div className="suggestions-dropdown">
                {suggestions.map((suggestion, index) => (
                  <div
                    key={index}
                    className={`suggestion-item ${index === selectedIndex ? 'bg-gray-200' : ''}`}
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
      
      {/* Right panel with hints and guesses */}
      <div className="pokedex-right-panel">
        <div className="right-panel-screen">
          {!isMobile && <HintPanel />}
        </div>
        <div className="guesses-container">
          <GuessList />
        </div>
      </div>
    </div>
  )
}

export default PokedexUI
