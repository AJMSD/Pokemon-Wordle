import React from 'react'

interface CollectionPageProps {
  onBack: () => void
}

interface BallEntry {
  id: string
  display_name: string
  category: 'standard' | 'achievement'
  status: 'past_tier' | 'current_tier' | 'future_tier' | 'unlocked' | 'locked'
  hint: string | null
}

const STANDARD_BALLS: BallEntry[] = [
  { id: 'poke-ball',   display_name: 'Poké Ball',   category: 'standard', status: 'current_tier', hint: null },
  { id: 'great-ball',  display_name: 'Great Ball',  category: 'standard', status: 'future_tier',  hint: null },
  { id: 'ultra-ball',  display_name: 'Ultra Ball',  category: 'standard', status: 'future_tier',  hint: null },
  { id: 'master-ball', display_name: 'Master Ball', category: 'standard', status: 'future_tier',  hint: null },
]

const ACHIEVEMENT_BALLS: BallEntry[] = [
  { id: 'quick-ball',  display_name: 'Quick Ball',  category: 'achievement', status: 'locked', hint: 'Solve a puzzle in 1 or 2 guesses' },
  { id: 'timer-ball',  display_name: 'Timer Ball',  category: 'achievement', status: 'locked', hint: 'Win on your very last guess (10th)' },
  { id: 'luxury-ball', display_name: 'Luxury Ball', category: 'achievement', status: 'locked', hint: 'Build a 7-day participation streak' },
  { id: 'net-ball',    display_name: 'Net Ball',    category: 'achievement', status: 'locked', hint: 'Participate on 10 Water or Bug-type days' },
  { id: 'heal-ball',   display_name: 'Heal Ball',   category: 'achievement', status: 'locked', hint: 'Win 3 times in a row after a loss' },
]

const STANDARD_ORDER = ['poke-ball', 'great-ball', 'ultra-ball', 'master-ball']

const StandardTrack: React.FC<{ balls: BallEntry[] }> = ({ balls }) => (
  <div className="flex items-center gap-2 flex-wrap">
    {balls.map((ball, i) => {
      const isPast = ball.status === 'past_tier'
      const isCurrent = ball.status === 'current_tier'
      const isFuture = ball.status === 'future_tier'

      return (
        <React.Fragment key={ball.id}>
          <div className="flex flex-col items-center gap-1">
            <div
              className={`w-14 h-14 rounded-full border-4 flex items-center justify-center text-xs font-bold transition-all ${
                isCurrent
                  ? 'border-pokemon-red bg-red-50 shadow-lg shadow-red-200 scale-110'
                  : isPast
                  ? 'border-green-400 bg-green-50'
                  : 'border-gray-200 bg-gray-50 opacity-50'
              }`}
            >
              {isCurrent ? '★' : isPast ? '✓' : '?'}
            </div>
            <span className={`text-xs text-center leading-tight max-w-[56px] ${isFuture ? 'text-gray-400' : 'text-gray-700'}`}>
              {ball.display_name}
            </span>
          </div>
          {i < balls.length - 1 && (
            <div className={`h-0.5 w-6 ${i < STANDARD_ORDER.indexOf(balls.find(b => b.status === 'current_tier')?.id ?? '') ? 'bg-green-400' : 'bg-gray-200'}`} />
          )}
        </React.Fragment>
      )
    })}
  </div>
)

const AchievementBallCard: React.FC<{ ball: BallEntry }> = ({ ball }) => (
  <div className="border-2 border-gray-200 rounded-xl p-4 flex flex-col items-center gap-2 bg-gray-50 opacity-75">
    <div className="w-12 h-12 rounded-full bg-gray-300 border-2 border-gray-400 flex items-center justify-center">
      <span className="text-gray-500 text-lg">?</span>
    </div>
    <span className="text-sm font-semibold text-gray-400">{ball.display_name}</span>
    {ball.hint && (
      <p className="text-xs text-gray-400 text-center leading-snug">{ball.hint}</p>
    )}
  </div>
)

const CollectionPage: React.FC<CollectionPageProps> = ({ onBack }) => {
  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-pokemon-red transition-colors mb-6"
      >
        ← Back to Game
      </button>

      <h2 className="text-2xl font-bold text-gray-800 mb-1">Ball Collection</h2>
      <p className="text-sm text-gray-500 mb-6">Earn balls by playing and achieving milestones.</p>

      <section className="mb-8">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Streak Tier</h3>
        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <StandardTrack balls={STANDARD_BALLS} />
          <p className="text-xs text-gray-400 mt-3">Maintain your win streak to climb the tiers.</p>
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Achievement Balls</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {ACHIEVEMENT_BALLS.map(ball => (
            <AchievementBallCard key={ball.id} ball={ball} />
          ))}
        </div>
      </section>
    </div>
  )
}

export default CollectionPage
