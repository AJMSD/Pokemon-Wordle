**PLAN.md**

# Pokémon Wordle – Project Development Plan

A daily Pokémon guessing game inspired by Wordle. Instead of fixed 5-letter words, this game adapts to the **actual length of the Pokémon name**—be it 3, 7, or more letters. Players get 10 chances to guess the correct Pokémon. Hints are revealed at the 3rd, 6th, and 9th attempts. The game fetches real-time Pokémon data from the [PokéAPI](https://pokeapi.co/docs/v2), and users are assisted with **autocomplete suggestions** while typing.

No user login or database is needed initially, but the architecture is designed to support a backend in later phases.

---

## 📁 Phase 1: Tech Stack & Project Structure

### Goals:
- Choose a robust tech stack for scalability and rapid prototyping
- Maintain separation between frontend and backend for clean growth

### Stack:
- **Frontend**: React + Vite, TailwindCSS, Zustand (or Context), TypeScript
- **Backend** (for future): Node.js (Express or Fastify), TypeScript
- **API**: PokéAPI (external) with future proxy support
- **Deployment**: Vercel/Netlify (frontend), Railway/Fly.io (backend)

---

## 🎮 Phase 2: Game Mechanics & Core Logic

### Goals:
- Build the actual game loop with support for variable-length Pokémon names
- Dynamically validate guesses
- Track game state (win/loss, guess count, hint status)

### Requirements:
- Dynamically determine the length of today’s Pokémon name
- Allow input of any length to match real Pokémon names
- Normalize input (case-insensitive, ignore special forms like "-mega")
- Max 10 attempts
- Unlock hints at:
  - **3rd attempt**: Ability
  - **6th attempt**: Generation
  - **9th attempt**: Type(s)
- End game upon correct guess or after 10 tries

---

## ✨ Phase 3: User Interface & Experience

### Goals:
- Create a clean, responsive, and accessible UI
- Handle names of varying lengths
- Guide the user with suggestions during input

### Key Components:
- **Dynamic Guess Input**:
  - Resizable input field
  - Suggestions dropdown as user types (like search autocomplete)
- **Guesses Display**:
  - Show previously guessed names
  - Color/indicator for correct guess
- **Hint Panel**:
  - Reveals new hint after every 3rd guess
  - Fetched live from PokéAPI
- **Endgame Modal**:
  - Win/loss message with Pokémon details and image
- **Toast Alerts**:
  - For invalid names, repeated guesses, or errors

---

## 🔍 Phase 4: Pokémon Data & Autocomplete Integration

### Goals:
- Fetch and manage Pokémon data efficiently
- Use that data to validate guesses and provide suggestions

### Strategy:
- On load, fetch all Pokémon names:
  - `https://pokeapi.co/api/v2/pokemon?limit=10000`
- Normalize the list (remove special forms)
- On user input:
  - Filter list using fuzzy or startsWith match
  - Provide a dropdown of suggested Pokémon names
- On guess submission:
  - Confirm if name is valid (in Pokémon list)

---

## 🧠 Phase 5: Hints System with Live PokéAPI Data

### Goals:
- Fetch and reveal hints as players progress

### Implementation:
- **3rd Guess** – Primary Ability  
  → `GET /pokemon/{name}` → `abilities[0].ability.name`

- **6th Guess** – Generation  
  → `GET /pokemon-species/{name}` → `generation.name`

- **9th Guess** – Type(s)  
  → `GET /pokemon/{name}` → `types[]`

- Cache daily hint data locally once fetched

---

## 📆 Phase 6: Daily Pokémon Selection Logic

### Goals:
- Ensure a consistent "Pokémon of the Day" across users
- No backend required (yet)

### Strategy:
- Use deterministic method:
  - List of Pokémon from PokéAPI
  - Seed: `new Date().toISOString().slice(0, 10)` (e.g., `2025-04-01`)
  - Hash (e.g., SHA256 → int) → `index = hash % totalPokemonCount`
- This ensures the same Pokémon each day with no database

---

## 🧪 Phase 7: Testing & Polish

### Goals:
- Ensure smooth gameplay and robust error handling

### Tasks:
- Validate all user input and edge cases
- Handle PokéAPI rate limits and errors gracefully
- Add loading spinners for hint fetching
- Optimize mobile layout
- Add basic keyboard accessibility
- Lighthouse performance audit

---

## 🚀 Phase 8: Deployment

### Frontend-Only Deployment (MVP)
- **Build**: `npm run build`
- **Deploy to**:
  - [Vercel](https://vercel.com) or [Netlify](https://netlify.com)
- **Connect GitHub Repo**: Auto-deploy on push
- **Custom Domain (optional)**: Use domain like `pokewordle.xyz`
- **Add favicon + meta tags** for shareability

### Future Backend Deployment (Stretch)
- **Deploy Backend to**:
  - Railway / Fly.io / Render
- **Features**:
  - Centralize "Pokémon of the Day" logic
  - Proxy PokéAPI to cache data
  - Add rate limiting & tracking
  - Later: persistent stats, user login, admin controls

---

## 🌱 Phase 9: Stretch Features (Post-MVP)

- User authentication (OAuth or simple email login)
- Stats tracking (streaks, guess distribution)
- Emoji-based share feature (like Wordle)
- Leaderboards (global or friends)
- Difficulty modes (Gen 1–3 only, or Hard mode with all forms)
- Offline support with service workers
- Daily reminder notifications via PWA

---