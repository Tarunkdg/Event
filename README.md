# Gather — Event Booking Demo

A full-stack event discovery and booking demo built with React, Vite, Express, SQLite, JWT authentication, and Stripe Checkout in **test mode only**. Events are public after approval; users can register, reserve tickets, pay through Stripe's hosted test checkout, and view webhook-confirmed bookings. Authenticated users can submit events for admin approval.

> This project is a local demonstration, not a production payment system. The server refuses a Stripe live secret (`sk_live_...`); only test credentials are accepted. Never commit `.env` files or real credentials.

## Requirements

- Node.js 20.19+ or 22.12+ (the frontend uses Vite 7).
- npm 10+.
- Stripe CLI only if you want to exercise the payment/webhook flow.

## Windows PowerShell setup

Run these commands from the project root:

```powershell
npm install
Copy-Item server\.env.example server\.env
Copy-Item client\.env.example client\.env
```

Open `server\.env` and set a random `JWT_SECRET` of at least 32 characters. To bootstrap an administrator, set `ADMIN_EMAIL` to an address you control; the matching account receives the admin role when it signs up. For Stripe checkout, add your Stripe **test** secret key (`sk_test_...`) and webhook signing secret (`whsec_...`). The default frontend and API URLs work as-is.

Initialize the SQLite file and load the five sample events:

```powershell
npm run seed
```

Start the API and React frontend in one terminal:

```powershell
npm run dev
```

The API listens on `http://localhost:5000`, and the frontend is at `http://localhost:5173`. The SQLite schema is created automatically at server startup; the database file defaults to `server\data\events.sqlite`. To run either service separately:

```powershell
npm run dev --workspace server
npm run dev --workspace client
```

## Stripe test checkout

1. Add your Stripe test secret to `server\.env` as `STRIPE_SECRET_KEY=sk_test_...`.
2. Start the API and frontend with `npm run dev`.
3. In a separate PowerShell window, authenticate the Stripe CLI and forward webhooks:

   ```powershell
   stripe login
   stripe listen --forward-to localhost:5000/api/payments/webhook
   ```

4. Copy the CLI's `whsec_...` value into `STRIPE_WEBHOOK_SECRET` in `server\.env`, then restart the API.
5. Sign up or log in, open a published event, and select **Book your spot**. Use Stripe's test card `4242 4242 4242 4242`, any future expiry date, and any CVC / postal code.
6. The confirmation screen verifies booking/payment status with the API. A success-page redirect alone never marks a booking paid; the signed Stripe webhook is authoritative.

If Stripe is not configured, event browsing, signup, event submissions, and admin approval still work. Checkout requests return an explicit `503` until valid test credentials are configured.

## Demo data and admin

`npm run seed` is safe to repeat; it inserts only missing sample event titles. Seed data includes Tech Conference 2026 (Bengaluru, ₹1,999), Design Workshop (Mumbai, ₹799), Frontend Meetup (Pune, ₹499), Live Music Festival (Delhi, ₹1,499), and Business Networking Summit (Noida, ₹999). Dates are set in November and December 2026.

Set `ADMIN_EMAIL` before the matching email registers. Admins can review pending events from `/admin`; authenticated users can submit event proposals from **Become a Host**. Events submitted by a user are set to `PENDING` and are not publicly bookable until approved.

## API overview

All API routes are prefixed with `/api`. JSON errors have the form `{ "error": "..." }`; validation errors also include a `details` array. Protected routes require `Authorization: Bearer <token>`.

| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| POST | `/auth/signup` | Public | Register and receive a JWT |
| POST | `/auth/login` | Public | Authenticate and receive a JWT |
| GET | `/auth/me` | User | Return the authenticated user |
| GET | `/events?q=&category=&sort=` | Public | Search/filter published events (`sort=date` or `price`) |
| GET | `/events/:id` | Public | Published event details |
| POST | `/events` | User | Submit an event for review |
| PUT | `/events/:id` | Owner/Admin | Update an event; only admins can set its approval status |
| DELETE | `/events/:id` | Owner/Admin | Delete an event with no booking history |
| POST | `/bookings` | User | Atomically reserve tickets and create Stripe Checkout |
| GET | `/bookings/my` | User | List the current user's bookings |
| GET | `/bookings/:id` | Owner/Admin | Get booking details |
| POST | `/bookings/:id/checkout` | Owner/Admin | Resume an eligible Stripe Checkout Session |
| POST | `/payments/create-checkout-session` | Owner/Admin | Create/resume checkout with `{ "bookingId": "..." }` |
| POST | `/payments/webhook` | Stripe signature | Verify/process Stripe events; use raw request bytes |
| GET | `/payments/:bookingId/status` | Owner/Admin | Get server-verified payment status |
| GET | `/admin/summary` | Admin | View counts, paid revenue, and pending events |
| GET | `/admin/bookings` | Admin | View up to 100 recent booking and payment records |
| POST | `/admin/bookings/:id/cancel` | Admin | Cancel an open pending checkout and release its tickets |
| GET | `/health` | Public | API health check |

The admin dashboard can create event proposals, approve/reject them, edit event title/pricing/capacity, and delete events that have no booking history. Administrators can cancel only pending checkouts; paid bookings are not refunded or changed by this demo.

Event prices and payment amounts are integer paise throughout the API/database; the UI accepts/display prices in rupees. Example:

```powershell
$body = @{ name = "A. Person"; email = "person@example.com"; password = "a-long-demo-password" } | ConvertTo-Json
$auth = Invoke-RestMethod -Method Post -Uri http://localhost:5000/api/auth/signup -ContentType "application/json" -Body $body
$headers = @{ Authorization = "Bearer $($auth.token)" }
Invoke-RestMethod -Uri http://localhost:5000/api/events -Headers $headers
```

## Database, reservation and payment behavior

The server initializes the SQLite schema and indexes on startup. It uses SQL.js (SQLite compiled to WebAssembly) and persists the database file after writes. Ticket quantities are reserved atomically before checkout; unpaid reservations expire after 31 minutes and release seats. A periodic cleanup plus API reads reaps expired reservations. Stripe checkout uses an idempotency key per booking; webhook event IDs are persisted to reject duplicate processing. Only a verified Stripe event updates a booking to `PAID`/`CONFIRMED`.

The single-file SQL.js persistence approach is intended for local development/demo use; do not run multiple API processes against the same database file.

## Tests and build

```powershell
npm test
npm run build
```

The API tests cover authentication, input validation, event search/filtering, ticket availability, checkout retry behavior, webhook signature checks and idempotency, booking ownership, and admin approval permissions.
