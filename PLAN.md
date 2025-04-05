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

## 🧱 Phase 8: Full Backend System — User Accounts & Daily Game Tracking

A full backend to support registered users, allow login via JWT, persist their **game progress for the current day**, and prevent duplicate plays once they’ve won or lost. The backend will also be extendable for future stats, leaderboards, and friend features.

---

### 🛠️ Technologies

| Component        | Tool                             |
|------------------|----------------------------------|
| Runtime          | Node.js                          |
| Framework        | Express or Fastify               |
| Language         | TypeScript                       |
| Authentication   | JWT (Bearer Token)               |
| Password Hashing | bcrypt                           |
| ORM              | Prisma                           |
| Database         | PostgreSQL                       |
| Deployment       | Railway / Fly.io / Render        |
| Environment      | `.env` for secrets and configs   |

---

## 📊 Database Schema

```prisma
model User {
  id          String   @id @default(uuid())
  username    String   @unique
  email       String   @unique
  password    String
  createdAt   DateTime @default(now())
  games       Game[]
}

model Game {
  id            String   @id @default(uuid())
  userId        String
  dateKey       String   // e.g., "2025-04-01"
  guesses       String[] // list of guesses (e.g., ["pikachu", "bulbasaur"])
  isWin         Boolean?
  isComplete    Boolean  // true if win or 10 attempts
  guessCount    Int      // total guesses
  revealedHint1 Boolean  // ability
  revealedHint2 Boolean  // generation
  revealedHint3 Boolean  // type(s)
  createdAt     DateTime @default(now())

  user          User     @relation(fields: [userId], references: [id])
}
```

---

## 🧠 Backend Features Overview

| Feature                          | Description                                                                 |
|----------------------------------|-----------------------------------------------------------------------------|
| User Registration                | Create account with email + password (hashed)                              |
| Login                            | Return JWT token on successful login                                       |
| Protected Routes                 | JWT middleware to verify and attach user info                              |
| Start New Game                   | Auto-create game entry for user on first interaction each day              |
| Guess Submission                | Append guess, update game state, check win/loss                            |
| Hint Tracking                    | Store which hints have been revealed for the user that day                 |
| Prevent Replay                  | Block guesses if user already completed today's game                       |
| Game Resume                      | Allow frontend to fetch the saved game state and continue mid-progress     |

---

## 📦 API Routes Design

### 🔐 Auth Routes

| Method | Endpoint              | Purpose               |
|--------|-----------------------|------------------------|
| POST   | `/api/auth/register`  | Register new user     |
| POST   | `/api/auth/login`     | Login and get JWT     |

---

### 👤 User/Game Routes

All below routes require JWT Bearer token.

| Method | Endpoint                  | Description                                                                 |
|--------|---------------------------|-----------------------------------------------------------------------------|
| GET    | `/api/user/me`            | Get current user's basic info                                               |
| GET    | `/api/game/today`         | Fetch today’s game (create one if not started)                             |
| POST   | `/api/game/guess`         | Submit a guess for today’s game                                            |
| POST   | `/api/game/hint/:level`   | Unlock hint #1 (ability), #2 (generation), or #3 (type)                    |
| GET    | `/api/game/history`       | (Future) List of past game results for streak tracking                     |

---

## 🔄 Game Flow

1. **Frontend loads**  
   → Calls `GET /api/game/today`  
   → If no game exists for today, backend creates one and returns empty state

2. **User makes a guess**  
   → `POST /api/game/guess`  
   → Backend:
   - Adds guess to `guesses[]`
   - Updates `guessCount`
   - Checks if correct (sets `isWin = true`, `isComplete = true`)
   - If 10 guesses, mark `isComplete = true`

3. **User requests a hint**  
   → `POST /api/game/hint/1` (or 2, 3)  
   → Backend:
   - Checks if user is allowed to view it (3rd, 6th, 9th guess)
   - Sets `revealedHint1 = true`, etc.

4. **User refreshes browser**  
   → Calls `GET /api/game/today`  
   → Server returns full game state (guesses, hint progress, etc.)

---

## 🔐 JWT Auth Flow

- On login/register, server returns a **JWT signed with a secret key**.
- Client stores JWT in localStorage or HttpOnly cookie (localStorage for now).
- Every request to protected endpoints uses `Authorization: Bearer <token>`.
- Middleware decodes JWT, fetches user from DB, and attaches to `req.user`.

---

## 🧰 Folder Structure

```
backend/
├── src/
│   ├── controllers/        # Route logic
│   ├── routes/             # Express/Fastify route definitions
│   ├── middlewares/        # JWT validation, error handling
│   ├── services/           # Game logic, validation
│   ├── prisma/             # Prisma schema + client
│   └── utils/              # Helper functions (e.g., Pokémon normalization)
├── .env
├── tsconfig.json
└── index.ts                # Main server entry
```

---

## 🔒 Security Practices

- Store JWT secret + DB URL in `.env`
- Use `helmet`, `cors`, and `rate-limit` middleware
- Hash passwords with `bcrypt`
- Avoid exposing raw PokéAPI keys (if used later)
- Sanitize user inputs

---

## 🚀 Deployment Strategy

- Use **Railway** (easy PostgreSQL + Express deploy)
- Use GitHub → Railway deploy connection
- Set up secrets (`JWT_SECRET`, `DATABASE_URL`)
- Allow CORS only from your GitHub Pages frontend domain
- Optional: monitor logs + add request logging (like `morgan`)

---

## 🧪 Phase-Based Backend Development Plan

| Phase | Task                                                                 |
|-------|----------------------------------------------------------------------|
| 1     | Scaffold backend with Express + TypeScript + Prisma                  |
| 2     | Create User model, Auth routes, and JWT middleware                   |
| 3     | Implement `GET /game/today` to return or create today’s game        |
| 4     | Implement `/game/guess` and win/loss logic                          |
| 5     | Add hint tracking logic (`/game/hint/:id`)                          |
| 6     | Connect frontend to backend with fetch + JWT                        |
| 7     | Final polish, error handling, CORS setup, deploy to Railway         |

---

## 🚀 Phase 9: Deployment

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

## 🌱 Phase 10: Stretch Features (Post-MVP)

- User authentication (OAuth or simple email login)
- Stats tracking (streaks, guess distribution)
- Emoji-based share feature (like Wordle)
- Leaderboards (global or friends)
- Difficulty modes (Gen 1–3 only, or Hard mode with all forms)
- Offline support with service workers
- Daily reminder notifications via PWA

---