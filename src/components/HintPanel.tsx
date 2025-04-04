import React, { useEffect, useState } from 'react'
import { useGameStore } from '../store/gameStore'

const HintPanel: React.FC = () => {
  const { hints, dailyPokemon, guesses } = useGameStore()
  const [newlyRevealed, setNewlyRevealed] = useState<number[]>([])
  
  // Track newly revealed hints to show the glow effect
  useEffect(() => {
    const justRevealed: number[] = []
    
    hints.forEach((hint, index) => {
      if (hint.revealed) {
        const revealThreshold = (index + 1) * 3 // 3, 6, 9
        if (guesses.length === revealThreshold) {
          justRevealed.push(index)
        }
      }
    })
    
    if (justRevealed.length > 0) {
      setNewlyRevealed(justRevealed)
      
      // Clear the newly revealed status after animation completes
      const timer = setTimeout(() => {
        setNewlyRevealed([])
      }, 2000)
      
      return () => clearTimeout(timer)
    }
  }, [hints, guesses.length])
  
  if (guesses.length === 0) {
    return (
      <div className="pokedex-info">
        <p className="info-text">Start guessing to see hints here!</p>
      </div>
    )
  }
  
  return (
    <div className="pokedex-info">
      <h2 className="info-title">Pokédex Entry</h2>
      
      <div className="info-sections">
        <HintItem 
          label="Ability" 
          value={dailyPokemon?.abilities?.[0]?.ability?.name || "Static"}
          revealed={hints[0].revealed}
          unlocksAt={3}
          currentGuesses={guesses.length}
          isNew={newlyRevealed.includes(0)}
        />
        
        <HintItem 
          label="Generation" 
          value={hints[1].value || "Generation I"}
          revealed={hints[1].revealed}
          unlocksAt={6}
          currentGuesses={guesses.length}
          isNew={newlyRevealed.includes(1)}
        />
        
        <HintItem 
          label="Type(s)" 
          value={Array.isArray(hints[2].value) ? hints[2].value.join(", ") : "Electric"}
          revealed={hints[2].revealed}
          unlocksAt={9}
          currentGuesses={guesses.length}
          isNew={newlyRevealed.includes(2)}
        />
      </div>
    </div>
  )
}

interface HintItemProps {
  label: string;
  value: string;
  revealed: boolean;
  unlocksAt: number;
  currentGuesses: number;
  isNew: boolean;
}

const HintItem: React.FC<HintItemProps> = ({ 
  label, 
  value, 
  revealed, 
  unlocksAt, 
  currentGuesses,
  isNew
}) => {
  const remaining = unlocksAt - currentGuesses;
  const willUnlockSoon = remaining > 0 && remaining <= 2;
  
  return (
    <div className={`info-item hint-container ${isNew ? 'hint-glow' : ''}`}>
      <div className="info-label">{label}:</div>
      <div className="info-value">
        {revealed ? (
          <span className={`revealed-value ${isNew ? 'hint-new' : ''}`}>{value}</span>
        ) : (
          <span className="hidden-value">
            {willUnlockSoon 
              ? `Unlocks in ${remaining} more ${remaining === 1 ? 'guess' : 'guesses'}` 
              : `Revealed after ${unlocksAt} guesses`}
          </span>
        )}
      </div>
    </div>
  )
}

export default HintPanel
