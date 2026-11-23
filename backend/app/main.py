from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .database import SessionLocal
from .migrate import run_migrations
from .routers import addresses, admin, auth, coupons, dev_inbox, orders, payments, products, reviews, support
from .seed import migrate_legacy_addresses, seed_coupons, seed_products


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Runs once at startup: bring the database schema up to date (migrations), then seed data if empty.
    run_migrations()
    with SessionLocal() as db:
        seed_products(db)
        migrate_legacy_addresses(db)
        seed_coupons(db)
    yield


app = FastAPI(title="Zestora API", version="0.1.0", lifespan=lifespan)

# The Vite dev server proxies /api, so CORS isn't needed in dev; this allows direct calls from the browser too.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:4200", "http://127.0.0.1:4200"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Everything lives under /api so one proxy rule (and later one nginx rule) routes to the backend.
for r in (
    auth.router,
    addresses.router,
    products.router,
    reviews.router,
    coupons.router,
    support.router,
    orders.router,
    payments.router,
    admin.router,
    dev_inbox.router,
):
    app.include_router(r, prefix="/api")


@app.get("/api/health", tags=["meta"])
def health():
    return {"status": "ok"}
