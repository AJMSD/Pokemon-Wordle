// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { deriveSeeds } from './hmacSeeds';
import { affinePick, POKEMON_COUNT } from '../../../src/logic/dailyTarget';
import { getLetterMatchResult, normalizeName } from './letterMatch';
import { buildSessionResponse, computeResults, nameLength } from './sessionResponse';
import { replayGuestGuesses, hintFlagsFor, completionFor } from './migrateGuest';

describe('deriveSeeds', () => {
  it('is deterministic and salt/user dependent', async () => {
    const a = await deriveSeeds('salt-1', 'user-1');
    expect(await deriveSeeds('salt-1', 'user-1')).toEqual(a);
    expect(await deriveSeeds('salt-2', 'user-1')).not.toEqual(a);
    expect(await deriveSeeds('salt-1', 'user-2')).not.toEqual(a);
  });

  it('produces valid, salt-dependent picks', async () => {
    const picks = new Set<number>();
    for (const salt of ['s1', 's2', 's3', 's4', 's5', 's6']) {
      const { aSeed, bSeed } = await deriveSeeds(salt, 'same-user');
      const id = affinePick('2026-10-05', aSeed, bSeed);
      expect(id).toBeGreaterThanOrEqual(1);
      expect(id).toBeLessThanOrEqual(POKEMON_COUNT);
      picks.add(id);
    }
    expect(picks.size).toBeGreaterThan(1);
  });
});

describe('getLetterMatchResult', () => {
  it('handles correct / present / absent with repeated letters', () => {
    expect(getLetterMatchResult('pikachu', 'pikachu')).toEqual(Array(7).fill('correct'));
    expect(getLetterMatchResult('abb', 'bab')).toEqual(['present', 'present', 'correct']);
    expect(getLetterMatchResult('aaa', 'abc')).toEqual(['correct', 'absent', 'absent']);
  });
  it('normalizes forms', () => {
    expect(normalizeName('Deoxys-Normal')).toBe('deoxys');
  });
});

describe('buildSessionResponse', () => {
  const target = {
    pokemonId: 25,
    name: 'pikachu',
    data: { ability: 'static', generation: 'generation-i', types: ['electric'] },
  };
  const base = { guesses: ['raichu', 'pikachu'], hint_flags: {}, version: 3 };

  it('hides the answer while playing', () => {
    const body = buildSessionResponse({ ...base, guesses: ['raichu'], completion_state: 'playing' }, target, {});
    expect(body.pokemon_name).toBeUndefined();
    expect(body.pokemon_id).toBeUndefined();
    expect(body.name_length).toBe(7);
    expect((body.results as string[][]).length).toBe(1);
  });

  it('reveals name and id when finished and aligns results', () => {
    const body = buildSessionResponse({ ...base, completion_state: 'won' }, target, {});
    expect(body.pokemon_name).toBe('pikachu');
    expect(body.pokemon_id).toBe(25);
    expect(body.results).toEqual(computeResults(base.guesses, 'pikachu'));
    expect((body.results as string[][])[1]).toEqual(Array(7).fill('correct'));
  });

  it('counts letters only', () => {
    expect(nameLength('mr-mime')).toBe(6);
  });
});

describe('replayGuestGuesses', () => {
  it('replays hints and completion', () => {
    const r = replayGuestGuesses(['bulbasaur', 'ivysaur', 'venusaur'], 'pikachu');
    expect(r).toMatchObject({ ok: true, completion_state: 'playing' });
    if (r.ok) expect(r.hint_flags).toEqual({ ability: true, generation: false, type: false });
  });
  it('detects a win and rejects guesses after it', () => {
    expect(replayGuestGuesses(['bulbasaur', 'pikachu'], 'pikachu')).toMatchObject({ ok: true, completion_state: 'won' });
    expect(replayGuestGuesses(['pikachu', 'raichu'], 'pikachu')).toMatchObject({ ok: false });
  });
  it('rejects invalid input', () => {
    expect(replayGuestGuesses('x', 'pikachu')).toMatchObject({ ok: false });
    expect(replayGuestGuesses(['notapokemon'], 'pikachu')).toMatchObject({ ok: false });
    expect(replayGuestGuesses(['raichu', 'raichu'], 'pikachu')).toMatchObject({ ok: false });
    expect(replayGuestGuesses([1], 'pikachu')).toMatchObject({ ok: false });
    const eleven = Array.from({ length: 11 }, (_, i) => `n${i}`);
    expect(replayGuestGuesses(eleven, 'pikachu')).toMatchObject({ ok: false });
  });
  it('loses after 10 wrong distinct guesses', () => {
    const names = ['bulbasaur', 'ivysaur', 'venusaur', 'charmander', 'charmeleon', 'charizard', 'squirtle', 'wartortle', 'blastoise', 'caterpie'];
    expect(replayGuestGuesses(names, 'pikachu')).toMatchObject({ ok: true, completion_state: 'lost' });
    expect(completionFor(names, 'pikachu')).toBe('lost');
    expect(hintFlagsFor(9)).toEqual({ ability: true, generation: true, type: true });
  });
});
