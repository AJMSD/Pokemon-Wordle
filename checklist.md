# Checklist

> ⚠️ **PRESERVATION RULE — READ BEFORE EDITING ANY FILE**
>
> The following features are **currently working in production** and must not be broken by any implementation work:
> - **Guest mode gameplay**: client-side seeded daily Pokémon selection, localStorage state, 10 guesses
> - **Letter coloring**: Wordle-style tiles — correct position (green), wrong position (yellow), not in word (gray)
> - **Hint panel**: ability revealed after guess 3, generation after guess 6, type after guess 9
> - **Pokémon name input**: autocomplete, validation, submit on Enter
> - **Pokédex UI shell**: left panel (image + input), right panel (hints + guesses list)
>
> **Rule:** Before committing any change to `gameStore.ts`, `HintPanel.tsx`, or any component touching guess/hint state — manually test the guest game flow. If a previously working feature breaks, roll back immediately.

## Phase 1: Core Backend Infrastructure

### Tasks
- [x] Implement database schema: users, profiles, daily_puzzles, daily_sessions, daily_results, user_stats, ball_unlocks, ball_catalog
- [x] Create email/password authentication with password hashing
- [x] Implement Google OAuth flow with username selection during onboarding
- [x] Build email verification system with same-day verification credit
- [x] Implement session management and user/guest token handling
- [x] Create forgot-password flow with rate limiting
- [x] Set up server-side daily puzzle generation and storage (timezone-aware, Japan Time)
- [x] Implement server-authoritative guess validation
- [x] Build rate limiting for: signup, login, verification, forgot-password, guess submission, profile mutations
- [x] Implement guest account system with local-only storage
- [x] Add disposable email domain blocking

### Acceptance Criteria
- [x] Users can register via email/password
- [ ] Users can register via Google OAuth *(pending: Google Cloud Console + Supabase provider configuration)*
- [x] Email verification process works and unverified users cannot earn stats
- [x] Verified users on same day of signup can earn stats retroactively
- [x] Guest mode plays locally with clear messaging that progress is local-only
- [x] Server correctly determines current daily puzzle date/time in Japan Time
- [x] All rate limits respond with transparent retry-after timing
- [x] Disposable email domains are blocked at signup

---

## Phase 2: Daily Game Session Model

### Tasks
- [ ] Implement daily session state model with versioning
- [ ] Create session fields: user_id, guest_id, puzzle_date_key, puzzle_id, guesses, hint_flags, completion_state, version, timestamps
- [ ] Build guess submission endpoint with session version validation
- [ ] Implement hint unlock rules (after guess 3, 6, 9) server-side
- [ ] Create completion detection: solved, 10 guesses used, or missed after day rollover
- [ ] Implement stale-device detection and rejection with messaging
- [ ] Build daily session refresh endpoint
- [ ] Implement hard-lock on completed games (no further input allowed)
- [ ] Create compact daily_results archival after session completion
- [ ] Build guest-to-account migration with same-day session transfer

### Acceptance Criteria
- [ ] Guess submission validates against server state
- [ ] Hints unlock only at correct guess counts
- [ ] Session version prevents stale-device overwrites
- [ ] Completed games cannot be modified
- [ ] Stale-device errors display without silent refresh
- [ ] Guest-to-account migration transfers today's progress only
- [ ] Missed day after rollover counts as both missed participation and loss
- [ ] Guess rollback happens when submission is rejected by server

---

## Phase 3: Stats and Streaks Engine

### Tasks
- [ ] Implement stats tracking: total_participations, total_wins, total_losses, win_rate
- [ ] Build win streak tracking (increments on correct daily answer, breaks on loss or missed day)
- [ ] Build participation streak tracking (increments on any guess that day, breaks only on missed day, not on loss)
- [ ] Implement best win streak and best participation streak tracking
- [ ] Create solved-in-X counters (solved_in_1 through solved_in_10)
- [ ] Build average-guesses-to-win calculation (winning games only)
- [ ] Create best-guess summary display logic
- [ ] Implement stats denormalization/precomputation in user_stats table
- [ ] Build dashboard stats endpoint returning all tracked metrics

### Acceptance Criteria
- [ ] Win streak increments on correct answer and breaks correctly
- [ ] Participation streak increments on any participation and breaks only on missed days
- [ ] Win rate correctly calculates wins/participated_days
- [ ] Best guess summary displays "Solved in X guesses: Y times" format
- [ ] Stats persist correctly across device refreshes
- [ ] Unverified users do not contribute to stats until verification

---

## Phase 4: Ball Progression System

### Tasks
- [ ] Create ball_catalog with all Poké Ball, Great Ball, Ultra Ball, Master Ball entries
- [ ] Implement streak-based ball progression: Poké Ball (0-2), Great Ball (3+), Ultra Ball (7+), Master Ball (14+)
- [ ] Create achievement balls: Quick Ball, Timer Ball, Luxury Ball, Net Ball, Heal Ball
- [ ] Implement Quick Ball unlock: solved in 1 or 2 guesses
- [ ] Implement Timer Ball unlock: solved on 10th guess
- [ ] Implement Luxury Ball unlock: profile setup + verified + 7-day participation streak
- [ ] Implement Net Ball unlock: 10 cumulative Water/Bug-type daily answers
- [ ] Implement Heal Ball unlock: 3 wins after losses
- [ ] Build ball_unlocks table and tracking
- [ ] Implement display ball selection (can only display current streak tier or any unlocked achievement ball)
- [ ] Build ball unlock celebration/notification on the frontend
- [ ] Create collection page data endpoint showing locked balls as silhouettes

### Acceptance Criteria
- [ ] Users automatically reach new streak tiers as streak progresses
- [ ] Achievement balls unlock when conditions met
- [ ] Display ball cannot be set to locked or below current streak tier
- [ ] Unlocked balls remain even if streak breaks
- [ ] Collection endpoint returns locked balls with hint copy for display

---

## Phase 5: Profile and Avatar System

### Tasks
- [ ] Implement username rules: unique, permanent, 3-20 chars, server-validated, profanity-filtered
- [ ] Build username validation rejecting injection and malformed input
- [ ] Create default profile image (Red silhouette aesthetic)
- [ ] Implement Pokémon avatar selection from all available Pokémon
- [ ] Add form/sprite filtering (only show if good support exists)
- [ ] Implement shiny variant toggle when supported
- [ ] Create avatar revert-to-default functionality
- [ ] Build profile update endpoint (avatar_mode, avatar_pokemon_id, avatar_form_id, avatar_is_shiny)
- [ ] Implement optimistic avatar update on frontend with rollback
- [ ] Create GET /me endpoint returning user, profile, and current stats
- [ ] Build profile avatar image URL generation/serving

### Acceptance Criteria
- [ ] Usernames are unique and validated for injection
- [ ] Usernames under 3 chars or over 20 chars are rejected with clear messaging
- [ ] Profanity-filtered usernames are rejected with explanation
- [ ] Users can select any Pokémon and shiny variant
- [ ] Forms without good sprite support are hidden
- [ ] Avatar updates work optimistically with rollback on failure
- [ ] Default profile image is visually recognizable as Red silhouette

---

## Phase 6: Dashboard and UI Components

### Tasks
- [ ] Build dashboard hero section: avatar, username, current display ball, win streak, best streak, win rate
- [ ] Create supporting stat cards: participation streak, total games, wins/losses, best guess summary, achievement summary
- [ ] Implement trainer-card styling with visual hierarchy and compact card layout
- [ ] Build responsive dashboard layout working equally on mobile and desktop
- [ ] Create collection page with unlocked balls, locked silhouettes, and hint copy
- [ ] Implement ball display selection UI with validation
- [ ] Build ball unlock celebration modal/animation
- [ ] Create new-streak-tier prompt (suggest switching to new ball)
- [ ] Implement game screen header showing current streak, best streak, current display ball
- [ ] Build themed loading states and error messages

### Acceptance Criteria
- [ ] Dashboard displays all required stats in trainer-card format
- [ ] Mobile and desktop layouts are equally usable
- [ ] Collection page shows locked balls as silhouettes with suggestive hints
- [ ] Ball unlock celebrations are visually distinct from regular interactions
- [ ] New streak tier prompts appear and remember user choice
- [ ] All themed copy remains readable and conveys clear meaning

---

## Phase 7: Auth UI and Onboarding

### Tasks
- [ ] Build guest-first signup/login flow
- [ ] Create email signup form with password requirements
- [ ] Implement Google OAuth integration on frontend
- [ ] Build username selection form for Google OAuth onboarding
- [ ] Create email verification UI and flow
- [ ] Build forgot-password request and confirm UI
- [ ] Implement unverified user state messaging (can play, no stats)
- [ ] Create guest-mode messaging clearly explaining local-only behavior
- [ ] Build logout functionality
- [ ] Create responsive auth screens for mobile and desktop

### Acceptance Criteria
- [ ] Users can sign up with email and password
- [ ] Google OAuth prompts for username during first-time signup
- [ ] Email verification emails are sent and verification works
- [ ] Unverified users cannot earn streaks or stats
- [ ] Forgot-password flow is secure and user-friendly
- [ ] Guest mode clearly states progress is local-only
- [ ] All auth screens work on mobile and desktop

---

## Phase 8: Main Game Screen Polish

### Tasks
- [ ] Implement optimistic guess submission with rollback
- [ ] Create guess row with input validation
- [ ] Build hint display with progressive unlock
- [ ] Implement stale-device error message: "Game updated elsewhere"
- [ ] Create themed rate-limit countdown display with retry-after timing
- [ ] Build loading states with game-like messaging
- [ ] Implement daily win animation (short, crisp, celebratory)
- [ ] Create milestone ball-unlock animation (larger, more celebratory)
- [ ] Build error rollback UI for rejected guesses
- [ ] Implement hard-lock UI for completed games (input disabled)
- [ ] Add streaks display on game header

### Acceptance Criteria
- [ ] Optimistic guesses display immediately and rollback on server rejection
- [ ] Hint text displays at correct guess thresholds
- [ ] Stale-device errors prevent further interaction without silent refresh
- [ ] Rate-limit messages include countdown and retry-after timing
- [ ] Animations respect prefers-reduced-motion setting
- [ ] Completed games show locked state with no input allowed
- [ ] Win animations are celebratory but not excessive

---

## Phase 9: Visual Theme and Polish

### Tasks
- [ ] Audit existing Pokédex-inspired theme and identify improvements
- [ ] Update color palette to match Pokémon visual language
- [ ] Implement proper font pairing (pixel font for headings/badges only)
- [ ] Ensure pixel font is not used in body text, forms, or dense stats
- [ ] Create consistent spacing and layout grid
- [ ] Build subtle/snappy motion for normal interactions
- [ ] Implement larger celebratory motion for milestones and unlocks
- [ ] Add reduce-motion/prefers-reduced-motion support degrading animation richness first
- [ ] Create polished transitions for UI state changes
- [ ] Review and improve mobile-specific styling and touch targets

### Acceptance Criteria
- [ ] Color palette aligns with Pokémon visual identity
- [ ] Pixel font improves readability only on headings/badges
- [ ] Motion is subtle for normal interactions, larger for milestones
- [ ] Reduce-motion preference degrades animation richness, not functionality
- [ ] Mobile experience matches desktop in usability and polish
- [ ] All transitions feel crisp and responsive

---

## Phase 10: Themed Copy and Messaging

### Tasks
- [ ] Audit all error messages and rewrite with game-like tone
- [ ] Create themed loading messages: "Your Pokédex is syncing…"
- [ ] Implement stale-session message: "That game state changed elsewhere. Refresh to continue."
- [ ] Create rate-limit message template: "Too many attempts. Try again in HH:MM."
- [ ] Build ball unlock celebration copy: "A new ball has been added to your case."
- [ ] Implement email verification message copy
- [ ] Create forgot-password confirmation messaging
- [ ] Build streak milestone messages
- [ ] Ensure all themed copy preserves critical meaning and is readable
- [ ] Create form validation error messages with game tone

### Acceptance Criteria
- [ ] All copy is game-like but still clearly conveys meaning
- [ ] Rate-limit and loading messages are themed without obscuring information
- [ ] Error messages explain the problem and next steps
- [ ] Unlock celebration messages feel celebratory and themed
- [ ] Form validation provides clear, helpful error guidance

---

## Phase 11: Performance and Loading Optimization

### Tasks
- [ ] Audit initial page load time on desktop and mobile
- [ ] Implement code splitting for auth, game, dashboard, collection screens
- [ ] Optimize image loading for Pokémon sprites and avatars
- [ ] Implement lazy-loading for collection ball images
- [ ] Create loading skeletons for async data (dashboard, stats)
- [ ] Optimize animations to use GPU (transform, opacity only)
- [ ] Implement request caching for daily puzzle data
- [ ] Create offline state handling for network errors
- [ ] Test on low-end devices and degrade animation richness accordingly
- [ ] Profile runtime performance and address bottlenecks

### Acceptance Criteria
- [ ] Initial load completes in under 3 seconds on mobile 4G
- [ ] Interactions respond within 100ms
- [ ] Smooth 60fps animations on mid-range devices
- [ ] No layout shifts during async data loading
- [ ] Reduce-motion preference visibly reduces animation complexity
- [ ] Battery/lightweight performance is reasonable on mobile

---

## Phase 12: API Implementation and Integration

### Tasks
- [ ] Implement all auth endpoints: register, login, Google start/complete, verify request/confirm, password-reset request/confirm, logout
- [ ] Implement profile endpoints: GET /me, GET /me/dashboard, PATCH /me/profile, PATCH /me/avatar, PATCH /me/display-ball
- [ ] Implement game endpoints: GET /game/today, POST /game/today/migrate-guest, POST /game/today/guess, POST /game/today/refresh-state
- [ ] Implement collection endpoint: GET /collection/balls
- [ ] Add version/session-id validation to all state-mutating requests
- [ ] Implement proper error response formatting
- [ ] Create comprehensive error logging for debugging
- [ ] Add request/response logging for audit trails
- [ ] Test all endpoints for edge cases (stale sessions, invalid input, rate limits)
- [ ] Document API contract with examples

### Acceptance Criteria
- [ ] All API endpoints exist and respond correctly
- [ ] Version validation prevents stale-device conflicts
- [ ] Error responses include clear messaging and retry information
- [ ] Rate limits are enforced on all protected endpoints
- [ ] Guess validation is server-authoritative
- [ ] All endpoints properly handle guest vs. authenticated users

---

## Phase 13: Testing and Validation

### Tasks
- [ ] Write unit tests for stats calculation logic
- [ ] Write tests for streak detection (win streak, participation streak)
- [ ] Write tests for ball unlock conditions
- [ ] Write integration tests for daily session workflow
- [ ] Write tests for guest-to-account migration
- [ ] Test email verification flow end-to-end
- [ ] Test password reset flow end-to-end
- [ ] Test stale-device detection and rejection
- [ ] Write tests for rate limiting behavior
- [ ] Test Pokédex sprite/form filtering logic
- [ ] Test avatar update rollback behavior
- [ ] Manual testing on desktop and mobile browsers

### Acceptance Criteria
- [ ] All calculation logic has corresponding tests
- [ ] Daily session workflow passes integration tests
- [ ] Migration preserves today's data and rejects old data
- [ ] Email flows work without exposing sensitive data
- [ ] Rate limits trigger correctly and reject excess requests
- [ ] Avatar updates rollback properly on failure
- [ ] Stale-device conflicts are detected and rejected

---

## Phase 14: Deployment and Monitoring

### Tasks
- [ ] Set up database migrations and deployment process
- [ ] Configure environment variables for production
- [ ] Set up error tracking and logging (e.g., Sentry)
- [ ] Implement health check endpoint
- [ ] Create monitoring for auth failures and rate-limit triggers
- [ ] Set up analytics for daily participation, win rate, streak distribution
- [ ] Implement backup strategy for user data
- [ ] Create runbook for common operational issues
- [ ] Set up uptime monitoring
- [ ] Document deployment procedure

### Acceptance Criteria
- [ ] Database migrations can be applied safely
- [ ] Environment-specific configuration is properly managed
- [ ] Errors are logged and tracked in real-time
- [ ] Health checks confirm service is operational
- [ ] Analytics show participation and engagement metrics
- [ ] Backup strategy protects against data loss

---

## Assumptions / Unresolved Items

- Exact streak thresholds (3, 7, 14) should be reviewed and may need tuning after user testing
- Special-ball numeric thresholds (10 for Net Ball, 3 for Heal Ball, 7-day for Luxury Ball) are recommended starting points and may need adjustment
- Disposable email provider list needs to be selected (ProtonMail, 10minutemail, etc. blocking strategy)
- Exact pixel font choice for headings/badges is not specified
- Pokémon sprite source and form/shiny support coverage needs to be audited before implementation
- Google OAuth configuration (client ID, redirect URIs) must be obtained from Google Cloud Console
- Email service provider (SendGrid, AWS SES, etc.) needs to be selected and configured
