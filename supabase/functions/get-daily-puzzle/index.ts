import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, handleCors } from '../_shared/cors.ts';

const POKEMON_WORDLE_SALT = 'pokemonWordle';
const POKEMON_COUNT = 1025;

function getJSTDateKey(): string {
  const now = new Date();
  // JST = UTC+9
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

function getDailyPokemonIndex(dateKey: string): number {
  const seed = dateKey + POKEMON_WORDLE_SALT;
  const PRIME1 = 7919;
  const PRIME2 = 6733;

  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) ^ (hash >> 7)) + seed.charCodeAt(i) * PRIME1;
    hash = (hash * PRIME2) & 0x7fffffff;
  }
  return hash % POKEMON_COUNT;
}

async function fetchPokemonFromPokeAPI(index: number): Promise<{
  id: number;
  name: string;
  ability: string;
  generation: string;
  types: string[];
}> {
  const pokemonRes = await fetch(`https://pokeapi.co/api/v2/pokemon/${index + 1}`);
  const pokemon = await pokemonRes.json();

  const speciesRes = await fetch(pokemon.species.url);
  const species = await speciesRes.json();

  return {
    id: pokemon.id,
    name: pokemon.name,
    ability: pokemon.abilities?.[0]?.ability?.name ?? 'unknown',
    generation: species.generation?.name ?? 'unknown',
    types: pokemon.types?.map((t: { type: { name: string } }) => t.type.name) ?? [],
  };
}

Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const start = Date.now();

  try {
    const puzzleDateKey = getJSTDateKey();

    // Check if puzzle already exists for today
    const { data: existing } = await supabase
      .from('daily_puzzles')
      .select('pokemon_name, pokemon_data')
      .eq('puzzle_date_key', puzzleDateKey)
      .single();

    let pokemonName: string;
    let pokemonData: { ability: string; generation: string; types: string[] };

    if (existing) {
      pokemonName = existing.pokemon_name;
      pokemonData = existing.pokemon_data;
    } else {
      // Generate and store today's puzzle
      const index = getDailyPokemonIndex(puzzleDateKey);
      const pokemon = await fetchPokemonFromPokeAPI(index);

      pokemonName = pokemon.name;
      pokemonData = {
        ability: pokemon.ability,
        generation: pokemon.generation,
        types: pokemon.types,
      };

      await supabase.from('daily_puzzles').insert({
        puzzle_date_key: puzzleDateKey,
        pokemon_id: pokemon.id,
        pokemon_name: pokemonName,
        pokemon_data: pokemonData,
      });
    }

    // Never return the answer — only metadata needed to play
    console.log(JSON.stringify({ fn: 'get-daily-puzzle', method: req.method, user_id: null, status: 200, duration_ms: Date.now() - start }));

    return new Response(
      JSON.stringify({
        puzzle_date_key: puzzleDateKey,
        pokemon_name_length: pokemonName.length,
        hints_schema: {
          ability: { revealed_after_guess: 3 },
          generation: { revealed_after_guess: 6 },
          type: { revealed_after_guess: 9 },
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (err) {
    console.error(JSON.stringify({ fn: 'get-daily-puzzle', error: String(err), status: 500 }));
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
