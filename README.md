# Pokémon Wordle

A daily Pokémon guessing game inspired by Wordle. Instead of fixed 5-letter words, this game adapts to the actual length of the Pokémon name.

## Features

- Daily Pokémon to guess
- Variable-length names (3-12 letters)
- 10 chances to guess correctly
- Hints revealed at 3rd, 6th, and 9th attempts
- Autocomplete suggestions while typing
- Real-time data from PokéAPI

## Development

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build
```

## Testing

```bash
# Unit tests (Vitest)
npm test

# Unit tests in watch mode
npm run test:watch

# E2E tests (Playwright)
# Requires the dev server to be running first
npm run dev          # terminal 1
npm run test:e2e     # terminal 2

# Run E2E against a custom URL (e.g. staging)
PLAYWRIGHT_BASE_URL=https://your-url.com npm run test:e2e
```

## Tech Stack

- React + Vite
- TypeScript
- TailwindCSS
- Zustand (state management)
- PokéAPI
