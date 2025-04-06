import React, { useState, useEffect, useRef, useMemo } from 'react'
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
  const suggestionsRef = useRef<HTMLDivElement>(null)
  const suggestionItemsRef = useRef<Array<HTMLDivElement | null>>([])
  
  // Get matching suggestions based on current input - use useMemo to prevent recreation
  const suggestions = useMemo(() => 
    currentGuess.length > 0 ? getSuggestions(currentGuess) : [],
  [currentGuess, getSuggestions]);

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

  // Update refs array when suggestions change
  useEffect(() => {
    suggestionItemsRef.current = suggestionItemsRef.current.slice(0, suggestions.length);
    // Only reset the selection index when the suggestion list actually changes content
    // not when we're just navigating with keys
  }, [suggestions])

  // Scroll selected item into view when selection changes
  useEffect(() => {
    if (selectedIndex >= 0 && selectedIndex < suggestions.length && 
        suggestionItemsRef.current[selectedIndex] && suggestionsRef.current) {
      const container = suggestionsRef.current;
      const selectedItem = suggestionItemsRef.current[selectedIndex];
      
      if (selectedItem) {
        // Check if item is not fully visible in the container
        const itemTop = selectedItem.offsetTop;
        const itemBottom = itemTop + selectedItem.offsetHeight;
        const containerTop = container.scrollTop;
        const containerBottom = containerTop + container.offsetHeight;
        
        // Scroll container if necessary
        if (itemTop < containerTop) {
          // Item is above visible area
          container.scrollTop = itemTop;
        } else if (itemBottom > containerBottom) {
          // Item is below visible area
          container.scrollTop = itemBottom - container.offsetHeight;
        }
      }
    }
  }, [selectedIndex, suggestions.length]);

  // Handle form submission
  const handleSubmitGuess = (e: React.FormEvent) => {
    e.preventDefault()
    if (currentGuess.trim() === '') return
    
    makeGuess(currentGuess)
    setCurrentGuess('')
    setShowSuggestions(false)
    setJustSelected(false)
    setSelectedIndex(-1) // Reset selection index after submission
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
      formRef.current?.requestSubmit()
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
        setSelectedIndex(prev => {
          // When no item is selected (-1) or at the end, loop to the beginning
          if (prev === -1 || prev >= suggestions.length - 1) {
            return 0;
          }
          // Otherwise move to the next item
          return prev + 1;
        })
        break
      case 'ArrowUp':
        e.preventDefault()
        setSelectedIndex(prev => {
          // When no item is selected (-1) or at the beginning, loop to the end
          if (prev <= 0) {
            return suggestions.length - 1;
          }
          // Otherwise move to the previous item
          return prev - 1;
        })
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
                setSelectedIndex(-1) // Only reset when the input text changes
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
              <div 
                ref={suggestionsRef}
                className="suggestions-dropdown"
              >
                {suggestions.map((suggestion, index) => (
                  <div
                    key={index}
                    ref={el => suggestionItemsRef.current[index] = el}
                    className={`suggestion-item ${index === selectedIndex ? 'active-suggestion' : ''}`}
                    onClick={() => handleSelectSuggestion(suggestion)}
                    onMouseEnter={() => setSelectedIndex(index)}
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
