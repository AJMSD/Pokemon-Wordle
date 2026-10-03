import { describe, it, expect } from 'vitest';
import { missedStatsUpdate } from './missedStats';

describe('missedStatsUpdate', () => {
  it('resets both streaks when the latest missed day had no guesses', () => {
    expect(missedStatsUpdate([{ puzzle_date_key: '2026-10-05', guesses: [] }])).toEqual({
      current_streak: 0,
      participation_streak: 0,
      last_played_date: '2026-10-05',
    });
  });

  it('keeps the participation streak when guesses were made', () => {
    const u = missedStatsUpdate([
      { puzzle_date_key: '2026-10-04', guesses: [] },
      { puzzle_date_key: '2026-10-05', guesses: ['pikachu'] },
    ]);
    expect(u).toEqual({ current_streak: 0, last_played_date: '2026-10-05' });
  });
});
