# PSP — Procurement, Stock, Production

Vita Manufacture's production operations workspace. Companion to
[vita-cff](https://github.com/vita-intelligence/vita-cff): once a spec
sheet is signed and the proposal paid for in vita-cff, the project
flows into PSP for procurement, stock control, and production
planning.

> **Status:** v0 — auth + presence + scaffold. Procurement, stock,
> and production modules build on top of this foundation.

## Stack

| Layer       | Tech                                                                |
| ----------- | ------------------------------------------------------------------- |
| Backend     | Elixir 1.19 · Phoenix 1.8 (API-only) · Bandit · Phoenix.Presence    |
| DB / Cache  | Postgres 16 · Redis 7 (for future Phoenix.PubSub clustering)        |
| Auth        | Built-in email + bcrypt + `Phoenix.Token` (stateless bearer)        |
| Email       | Swoosh — dev mailbox preview; ACS adapter swap-in for production    |
| Frontend    | Next.js 16 (App Router · Turbopack) · TypeScript · Tailwind v4      |
| UI          | shadcn/ui (Radix primitives) · lucide-react icons                   |
| State       | TanStack Query (server state) · Zustand (presence + UI state)       |
| Realtime    | Phoenix Channels via official `phoenix` JS client                   |
| Forms       | react-hook-form + Zod                                               |

Mobile-first responsive throughout — every page lays out at 375px
first and scales up via `sm: / md: / lg:` breakpoints.

## Local dev

```sh
# 1. Start the infrastructure (Postgres on :5433, Redis on :6380)
docker compose up -d

# 2. Backend (port 4000)
cd backend
mix deps.get
mix ecto.create     # idempotent
mix ecto.migrate
mix phx.server

# 3. Frontend (port 3000) — separate terminal
cd client
npm install
npm run dev
```

Open <http://localhost:3000>.

### Confirmation emails in dev

Registration emails go to Swoosh's in-memory mailbox. View them at
<http://localhost:4000/dev/mailbox>. Clicking the confirmation link in
the email completes the flow.

## Production deploy (Azure)

- **Web App for Containers** for backend (`vita-psp-backend`) and
  frontend (`vita-psp-frontend`) — same shape as vita-cff
- **Postgres Flexible Server** — separate `psp` database on the
  existing `vita-npd-db` server
- **Azure Cache for Redis** — fresh instance, do not share with
  vita-cff (different PubSub workload)
- **Email** — swap the Swoosh adapter to Azure Communication Services
  (same provider vita-cff uses); configured in `runtime.exs`

## Security defaults

- Bcrypt password hashes (cost 12)
- Email domain locked to `@vitamanufacture.co.uk` at registration
- Email confirmation required before login
- Generic auth failure messages (no email-vs-password leak)
- Bearer token stored in `HttpOnly` + `SameSite=Lax` cookie — never
  exposed to client JS via `localStorage`
- Next.js middleware blocks unauthenticated access to every authed
  route at the edge before page render
- WebSocket connection uses the same bearer; only-same-origin route
  handler hands it to the JS client

## Integration with vita-cff

Service-to-service via long-lived API keys (one per direction). Wiring
arrives in a later slice; see ticket / planning doc.
