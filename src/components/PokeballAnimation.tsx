import React, { useState, useEffect } from 'react'

interface PokeballAnimationProps {
  pokemonImage?: string;
}

const PokeballAnimation: React.FC<PokeballAnimationProps> = ({ pokemonImage }) => {
  const [animationState, setAnimationState] = useState<'initial' | 'falling' | 'catching' | 'caught'>('initial');
  
  useEffect(() => {
    // Show the Pokemon initially
    const timer1 = setTimeout(() => {
      setAnimationState('falling');
    }, 1000);
    
    // Start falling animation
    const timer2 = setTimeout(() => {
      setAnimationState('catching');
    }, 2000);
    
    // Complete the animation with glow effect
    const timer3 = setTimeout(() => {
      setAnimationState('caught');
    }, 4000);
    
    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);
    };
  }, []);
  
  return (
    <div className="pokemon-catch-container">
      {/* Pokemon image that disappears on catch */}
      {(animationState === 'initial' || animationState === 'falling') && pokemonImage && (
        <div className={`pokemon-target ${animationState === 'falling' ? 'visible' : ''}`}>
          <img 
            src={pokemonImage} 
            alt="Pokémon" 
            className="pokemon-target-image" 
          />
        </div>
      )}
      
      {/* Pokeball that falls and vibrates */}
      {animationState !== 'initial' && (
        <div className={`pokeball-wrapper ${animationState === 'falling' ? 'falling' : ''} ${animationState === 'catching' || animationState === 'caught' ? 'on-ground' : ''}`}>
          {/* Glow effect behind pokeball */}
          <div className={`pokeball-glow ${animationState === 'caught' ? 'active' : ''}`}></div>
          
          {/* Updated Pokeball with better design */}
          <div className={`pokeball ${animationState === 'catching' ? 'shake' : ''} ${animationState === 'caught' ? 'caught' : ''}`}>
            <div className="pokeball__button"></div>
            <div className="pokeball__top-half"></div>
            <div className="pokeball__bottom-half"></div>
            <div className="pokeball__hinge"></div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PokeballAnimation;
