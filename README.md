# Zestora

A full-stack e-commerce learning project: **React (Vite)** storefront, **FastAPI** backend, **SQLite** database.

```
zestora/
├── frontend/            React app (Vite)             → http://localhost:4200
│   └── src/
│       ├── pages/         one file per route (admin/ for the dashboard)
│       ├── components/    reusable UI pieces
│       ├── context/       app-wide state: auth, cart, wishlist, toasts
│       ├── hooks/         reusable logic (useAsync, useDebounce, useOrderStatus...)
│       ├── services/      ALL network calls live here (the only code that knows the API exists)
│       ├── utils/         pure helpers: formatting, validation, price maths
│       ├── data/          small static config (categories)
│       └── styles/        base.css (tokens) · components.css · pages.css
├── backend/             FastAPI app                  → http://localhost:8000  (docs: /docs)
│   ├── app/
│   │   ├── routers/       endpoints grouped by feature (auth, products, orders, payments, admin...)
│   │   ├── models.py      database tables         schemas.py   request/response shapes
│   │   ├── security.py    bcrypt + JWT            coupons.py   ALL coupon rules, one place
│   │   ├── gateway.py     mock payment gateway    mailer.py    order-confirmation emails
│   │   └── order_ops.py   stock + order lifecycle
│   ├── migrations/      Alembic: versioned schema changes
│   ├── seed/            starter catalog (products.json)
│   └── tests/           pytest suite
├── e2e/                 Playwright end-to-end tests (a real browser drives the whole app)
├── Makefile             one-word commands (below)
└── README.md
```

## Run it
```bash
make install     # first time only: Python venv + npm packages
make api         # terminal 1 → backend  (port 8000)
make web         # terminal 2 → frontend (port 4200)
```
Other commands: `make test` · `make lint` · `make format` · `make build` · `make help`.

The frontend calls `/api/...` on its own port and Vite forwards it to the backend (see `frontend/vite.config.js`), so there is no CORS setup to worry about in development.

## Handy facts
- **Admin dashboard:** sign up with `admin@zestora.dev` (change in `backend/.env` → `ADMIN_EMAILS`), then open the account menu → *Admin dashboard*.
- **Test payments:** card `4242 4242 4242 4242` succeeds, `4000 0000 0000 0002` is declined; UPI `success@upi` / `fail@upi`. No real money or accounts involved.
- **Emails:** without Gmail credentials, confirmation emails land in the dev inbox at `/api/dev/inbox`. To send real mail, copy `backend/.env.example` to `backend/.env` and add a Gmail App Password; verify with `cd backend && .venv/bin/python -m app.send_test you@gmail.com`.
- **Database changes:** edit `backend/app/models.py`, then `cd backend && .venv/bin/alembic revision --autogenerate -m "what changed"`. Migrations are applied automatically when the API starts.
- **The catalog:** 177 products in 7 categories with photos, brands, specs and rupee prices. The data and photos come from [DummyJSON](https://dummyjson.com) (a free demo dataset), copied into the repo by `backend/tools/build_catalog.py`, so the shop works offline. Re-run that script to rebuild `backend/seed/products.json`, `frontend/public/products/` and `frontend/src/data/catalog.js`.
- **Hide, don't delete:** products can be hidden from the shop in *Admin -> Products*. Hidden products stay in the database, because past orders point to them. The 48 original emoji demo products were hidden this way when the photo catalog arrived.
- **Catalog versions:** the catalog loads once per version (`CATALOG_VERSION` in `backend/app/seed.py`, remembered in the `meta` table), so products an admin deletes don't come back on restart. Bump the version to load a changed catalog into an existing database.
- **Reset the data:** stop the API, delete `backend/zestora.db`, start again (re-seeds the catalog and coupons).
- **Guided tour of the ideas:** `services/` ↔ `routers/` is the seam between the halves; `context/` + `hooks/` is how React state is organised; `coupons.py`, `order_ops.py` and `gateway.py` hold the business rules.

## Testing

| Command | What it runs | Size |
|---|---|---|
| `make test` | Backend unit and API tests (pytest, in-memory database) plus frontend unit tests (Node's built-in runner) | 68 + 5 tests, ~20 s |
| `make e2e` | **End-to-end:** a real browser drives the real frontend, backend and database | 84 tests, ~3.5 min |
| `make lint` | ruff (backend) and oxlint (frontend) | |

**How the end-to-end tests stay safe.** Playwright starts its *own* copy of the app on different ports (backend `:8100`, frontend `:4300`) with a throwaway database in `e2e/.tmp/` that is deleted on every run. Your development data is never touched, and real email can never be sent (SMTP settings are blanked for the test run).

**What they cover** (`e2e/tests/`): browsing, filters and search, accounts and access control, the address book, cart and coupons, checkout with cash on delivery, online payment with the mock gateway (declines, retries, pay-later), order tracking, cancelling and bulk delete, reviews, the whole admin dashboard, the support chat (including a customer and an agent in two browsers), voice search, phone layouts, and API security (login tokens, ownership, price tampering, coupon abuse, forged payments).

Handy: `cd e2e && npx playwright test support` (one file) · `npx playwright test --ui` (watch it click) · `npm run report` (HTML report with screenshots and traces of failures). It uses the Chromium-based browser already on your Mac (Chrome, Brave or Chromium); set `E2E_BROWSER=/path/to/browser` to choose another.

## Support chat

A floating **Help** button on every page opens a chat. A rule-based assistant (`backend/app/support_bot.py`) answers from real data: order status, payment state, delivery fees, coupon rules, product stock. When it cannot solve something (quality complaints, payment disputes, or "talk to a person") it opens a **ticket**. Admins reply from *Admin -> Support*, and the reply appears in the customer's chat. Visitors who are not logged in get general answers only. The bot only states policies that exist in the code and hands anything else to a person. To use an AI model instead, replace the body of `respond()`; nothing else needs to change.

## Voice search

The search bar has a microphone button. It opens a "Listening…" panel that shows your words as you speak, then searches automatically. It uses the browser's built-in speech recognition (`frontend/src/hooks/useVoiceSearch.js`): no API keys, nothing to install.

- **Works in:** Chrome, Edge and Safari (on `localhost` or HTTPS, with microphone permission). **Not in:** Firefox (no speech recognition, so the button is simply hidden) and Brave (it blocks Google's speech service, so the panel explains that voice search is unavailable and suggests typing).
- **Every failure has a clear message:** microphone blocked, nothing heard, no microphone, speech service unreachable, each with a "Try again" button.
- **Privacy:** Chrome and Edge send the audio to their speech service to transcribe it. The panel says so.
- **Testing without a microphone:** the end-to-end tests plant a fake speech engine in the page (`mockSpeech` in `e2e/tests/helpers.js`) and "speak" through it. The text-cleaning logic has unit tests in `frontend/src/utils/voice.test.js`.
