"""Run with:  .venv/bin/pytest -q   (uses a throwaway in-memory database, never zestora.db)"""

import json
from datetime import UTC
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.models import Product
from app.seed import SEED_FILE, seed_coupons, seed_products

# Tests use their own small, frozen catalog so they never depend on the real (changing) shop catalog.
FIXTURE_CATALOG = Path(__file__).parent / "fixtures" / "products.json"

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
Session = sessionmaker(bind=engine, autoflush=False)


@pytest.fixture(autouse=True)
def isolated_mail(tmp_path, monkeypatch):
    """Every test: no real SMTP, and any email lands in a throwaway folder (never backend/outbox)."""
    from app import mailer

    monkeypatch.setattr(mailer, "OUTBOX", tmp_path / "outbox")
    monkeypatch.delenv("SMTP_USER", raising=False)
    monkeypatch.delenv("SMTP_PASSWORD", raising=False)


@pytest.fixture()
def client():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with Session() as db:
        seed_products(db, FIXTURE_CATALOG)
        seed_coupons(db)

    def override():
        with Session() as db:
            yield db

    app.dependency_overrides[get_db] = override
    yield TestClient(app)  # no `with`: skips the lifespan so the real DB isn't touched
    app.dependency_overrides.clear()


ADDRESS = {"name": "Test User", "phone": "9876543210", "line1": "12 MG Road", "city": "Pune", "state": "MH", "pincode": "411001"}


def signup(client, email="a@b.com"):
    r = client.post("/api/auth/signup", json={"name": "Test User", "email": email, "password": "secret123"})
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_signup_login_me(client):
    h = signup(client)
    assert client.get("/api/auth/me", headers=h).json()["email"] == "a@b.com"
    assert "passwordHash" not in client.get("/api/auth/me", headers=h).text
    assert client.post("/api/auth/login", json={"email": "a@b.com", "password": "secret123"}).status_code == 200
    assert client.post("/api/auth/login", json={"email": "a@b.com", "password": "wrong-pass1"}).status_code == 401
    assert client.post("/api/auth/signup", json={"name": "X Y", "email": "A@B.com", "password": "secret123"}).status_code == 409


def test_protected_routes_need_token(client):
    assert client.get("/api/orders").status_code == 401
    assert client.get("/api/auth/me", headers={"Authorization": "Bearer junk"}).status_code == 401


def test_product_filters_and_sort(client):
    assert len(client.get("/api/products").json()) == 48
    cheap = client.get("/api/products", params={"category": "electronics", "maxPrice": 5000, "sort": "price-asc"}).json()
    assert cheap and all(p["category"] == "electronics" and p["price"] <= 5000 for p in cheap)
    assert [p["price"] for p in cheap] == sorted(p["price"] for p in cheap)
    assert client.get("/api/products", params={"q": "wireless earbuds"}).json()[0]["brand"] == "Sonic"
    assert client.get("/api/products/nope").status_code == 404


def test_order_prices_come_from_server_and_stock_drops(client):
    h = signup(client)
    p = client.get("/api/products", params={"inStock": True}).json()[0]
    body = {"items": [{"productId": p["id"], "qty": 2}], "address": ADDRESS, "paymentMethod": "upi", "couponCode": "ZEST10"}
    r = client.post("/api/orders", json=body, headers=h)
    assert r.status_code == 201, r.text
    t = r.json()["totals"]
    assert t["subtotal"] == p["price"] * 2
    assert t["couponDiscount"] == round(p["price"] * 2 * 0.1)
    assert client.get(f"/api/products/{p['id']}").json()["stock"] == p["stock"] - 2
    assert len(client.get("/api/orders", headers=h).json()) == 1


def test_cannot_overbuy_or_read_others_orders_and_cancel_restores_stock(client):
    h1, h2 = signup(client, "one@x.com"), signup(client, "two@x.com")
    p = client.get("/api/products", params={"inStock": True}).json()[0]
    too_many = {"items": [{"productId": p["id"], "qty": 10}], "address": ADDRESS, "paymentMethod": "cod"}
    if p["stock"] < 10:
        assert client.post("/api/orders", json=too_many, headers=h1).status_code == 409
    ok = {"items": [{"productId": p["id"], "qty": 1}], "address": ADDRESS, "paymentMethod": "cod"}
    oid = client.post("/api/orders", json=ok, headers=h1).json()["id"]
    assert client.get(f"/api/orders/{oid}", headers=h2).status_code == 404  # someone else's order
    assert client.post(f"/api/orders/{oid}/cancel", headers=h1).json()["cancelled"] is True
    assert client.get(f"/api/products/{p['id']}").json()["stock"] == p["stock"]


def test_timestamps_are_utc_aware(client):
    h = signup(client)
    p = client.get("/api/products", params={"inStock": True}).json()[0]
    body = {"items": [{"productId": p["id"], "qty": 1}], "address": ADDRESS, "paymentMethod": "cod"}
    created = client.post("/api/orders", json=body, headers=h).json()["createdAt"]
    assert created.endswith("Z") or created.endswith("+00:00"), created


# ---------- order confirmation email ----------
@pytest.fixture()
def outbox(tmp_path):
    return tmp_path / "outbox"


def place(client, h, email=None, name="<b>Hax</b>", method="cod"):
    p = client.get("/api/products", params={"inStock": True}).json()[0]
    body = {
        "items": [{"productId": p["id"], "qty": 1}],
        "address": {**ADDRESS, "name": name},
        "paymentMethod": method,
        "couponCode": "ZEST10",
    }
    if email:
        body["email"] = email
    r = client.post("/api/orders", json=body, headers=h)
    assert r.status_code == 201, r.text
    return r.json(), p


def test_order_writes_confirmation_email_to_checkout_address(client, outbox):
    from email import message_from_bytes, policy

    order, p = place(client, signup(client), email="buyer@gmail.com")
    msg = message_from_bytes((outbox / f"{order['id']}.eml").read_bytes(), policy=policy.default)
    assert msg["To"] == "buyer@gmail.com"  # the address typed at checkout, not the account email
    assert order["id"] in msg["Subject"]
    text = msg.get_body(("plain",)).get_content()
    assert p["title"] in text and "Order number" in text
    html = msg.get_body(("html",)).get_content()
    assert "<b>Hax</b>" not in html and "&lt;b&gt;Hax&lt;/b&gt;" in html  # user input is HTML-escaped


def test_email_defaults_to_account_email(client, outbox):
    from email import message_from_bytes, policy

    order, _ = place(client, signup(client, "acct@x.com"))
    assert message_from_bytes((outbox / f"{order['id']}.eml").read_bytes(), policy=policy.default)["To"] == "acct@x.com"


def test_smtp_path_uses_starttls_login_and_send(client, outbox, monkeypatch):
    import smtplib

    calls = []

    class FakeSMTP:
        def __init__(self, host, port, timeout=None):
            calls.append(("connect", host, port))

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def starttls(self):
            calls.append("starttls")

        def login(self, u, p):
            calls.append(("login", u))

        def send_message(self, m):
            calls.append(("send", m["To"]))

    monkeypatch.setattr(smtplib, "SMTP", FakeSMTP)
    monkeypatch.setenv("SMTP_USER", "store@gmail.com")
    monkeypatch.setenv("SMTP_PASSWORD", "app-password")
    place(client, signup(client), email="buyer@gmail.com")
    assert calls == [("connect", "smtp.gmail.com", 587), "starttls", ("login", "store@gmail.com"), ("send", "buyer@gmail.com")]


def test_mail_failure_never_breaks_the_order(client, outbox, monkeypatch):
    import smtplib

    def boom(*a, **k):
        raise OSError("mail server down")

    monkeypatch.setattr(smtplib, "SMTP", boom)
    monkeypatch.setenv("SMTP_USER", "store@gmail.com")
    monkeypatch.setenv("SMTP_PASSWORD", "x")
    h = signup(client)
    order, _ = place(client, h)
    assert len(client.get("/api/orders", headers=h).json()) == 1 and order["id"]


def test_response_tells_the_truth_about_email(client, outbox, monkeypatch):
    order, _ = place(client, signup(client))
    assert order["emailStatus"] == "saved-locally"
    monkeypatch.setenv("SMTP_USER", "s@gmail.com")
    monkeypatch.setenv("SMTP_PASSWORD", "x")
    monkeypatch.setattr("smtplib.SMTP", lambda *a, **k: (_ for _ in ()).throw(OSError("down")))
    assert place(client, signup(client, "z@z.com"))[0]["emailStatus"] == "queued"


def test_dev_inbox_shows_email_and_blocks_path_traversal(client, outbox):
    order, _ = place(client, signup(client), email="buyer@gmail.com")
    assert order["id"] in client.get("/api/dev/inbox").text
    page = client.get(f"/api/dev/inbox/{order['id']}")
    assert page.status_code == 200 and "Order confirmed" in page.text and "buyer@gmail.com" in page.text
    assert client.get("/api/dev/inbox/..%2F..%2Fetc%2Fpasswd").status_code == 404
    assert client.get("/api/dev/inbox/ZS00000000").status_code == 404


# ---------- deleting orders ----------
def test_delete_rules(client, outbox):
    h1, h2 = signup(client, "d1@x.com"), signup(client, "d2@x.com")
    order, _ = place(client, h1)
    oid = order["id"]
    # in-flight order: refused
    assert client.delete(f"/api/orders/{oid}", headers=h1).status_code == 409
    # someone else's order: indistinguishable from "doesn't exist"
    assert client.delete(f"/api/orders/{oid}", headers=h2).status_code == 404
    assert client.delete(f"/api/orders/{oid}").status_code == 401
    # after cancelling it can be deleted, and it is really gone
    client.post(f"/api/orders/{oid}/cancel", headers=h1)
    assert client.delete(f"/api/orders/{oid}", headers=h1).status_code == 204
    assert client.get(f"/api/orders/{oid}", headers=h1).status_code == 404
    assert client.get("/api/orders", headers=h1).json() == []


def test_delivered_order_can_be_deleted(client, outbox):
    from datetime import datetime, timedelta

    from app.models import Order

    h = signup(client)
    oid = place(client, h)[0]["id"]
    with Session() as db:  # time-travel: pretend it was placed 10 minutes ago
        db.get(Order, oid).created_at = datetime.now(UTC) - timedelta(minutes=10)
        db.commit()
    assert client.delete(f"/api/orders/{oid}", headers=h).status_code == 204


# ---------- bulk delete ----------
def test_bulk_delete_partial_success(client, outbox):
    from datetime import datetime, timedelta

    from app.models import Order

    h1, h2 = signup(client, "b1@x.com"), signup(client, "b2@x.com")
    ids = [place(client, h1)[0]["id"] for _ in range(3)]
    other = place(client, h2)[0]["id"]
    client.post(f"/api/orders/{ids[0]}/cancel", headers=h1)  # eligible (cancelled)
    with Session() as db:  # eligible (delivered long ago)
        db.get(Order, ids[1]).created_at = datetime.now(UTC) - timedelta(minutes=10)
        db.commit()
    # ids[2] is still in progress; `other` belongs to someone else; one id doesn't exist; one is duplicated
    r = client.post("/api/orders/bulk-delete", headers=h1, json={"ids": [ids[0], ids[1], ids[2], other, "ZS00000000", ids[0]]})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["deleted"] == [ids[0], ids[1]]
    assert {s["id"] for s in body["skipped"]} == {ids[2], other, "ZS00000000"}
    assert [o["id"] for o in client.get("/api/orders", headers=h1).json()] == [ids[2]]  # in-flight order survived
    assert len(client.get("/api/orders", headers=h2).json()) == 1  # other user's untouched


def test_bulk_delete_validation_and_auth(client, outbox):
    h = signup(client)
    assert client.post("/api/orders/bulk-delete", json={"ids": ["ZS1"]}).status_code == 401
    assert client.post("/api/orders/bulk-delete", headers=h, json={"ids": []}).status_code == 422
    assert client.post("/api/orders/bulk-delete", headers=h, json={"ids": [f"ZS{i}" for i in range(101)]}).status_code == 422


# ---------- address book ----------
def addr(**kw):
    return {
        "label": "Home",
        "name": "Test User",
        "phone": "9876543210",
        "line1": "12 MG Road",
        "city": "Pune",
        "state": "MH",
        "pincode": "411001",
        **kw,
    }


def test_address_book_default_rules(client):
    h = signup(client)
    assert client.get("/api/auth/me", headers=h).json()["addresses"] == []
    a = client.post("/api/addresses", json=addr(), headers=h).json()
    assert len(a) == 1 and a[0]["isDefault"] is True  # first one is default automatically
    two = client.post("/api/addresses", json=addr(label="Work", line1="Tech Park, Hinjewadi"), headers=h).json()
    assert [x["label"] for x in two] == ["Home", "Work"] and two[1]["isDefault"] is False
    work_id = two[1]["id"]
    after = client.post(f"/api/addresses/{work_id}/default", headers=h).json()
    assert after[0]["id"] == work_id and [x["isDefault"] for x in after] == [True, False]  # default listed first
    edited = client.put(f"/api/addresses/{work_id}", json=addr(label="Work", city="Mumbai"), headers=h).json()
    assert edited[0]["city"] == "Mumbai"
    left = client.delete(f"/api/addresses/{work_id}", headers=h).json()  # delete the default -> another is promoted
    assert len(left) == 1 and left[0]["isDefault"] is True
    assert client.get("/api/auth/me", headers=h).json()["addresses"][0]["id"] == left[0]["id"]


def test_address_validation_limit_and_ownership(client):
    h1, h2 = signup(client, "a1@x.com"), signup(client, "a2@x.com")
    assert client.post("/api/addresses", json=addr(pincode="12"), headers=h1).status_code == 422
    assert client.post("/api/addresses", json=addr(label="Boat"), headers=h1).status_code == 422
    assert client.post("/api/addresses", json=addr()).status_code == 401
    aid = client.post("/api/addresses", json=addr(), headers=h1).json()[0]["id"]
    assert client.put(f"/api/addresses/{aid}", json=addr(), headers=h2).status_code == 404
    assert client.delete(f"/api/addresses/{aid}", headers=h2).status_code == 404
    assert client.post(f"/api/addresses/{aid}/default", headers=h2).status_code == 404
    for i in range(9):
        assert client.post("/api/addresses", json=addr(line1=f"House number {i}"), headers=h1).status_code == 201
    assert client.post("/api/addresses", json=addr(), headers=h1).status_code == 409  # max 10


def test_legacy_json_addresses_are_migrated(client):
    from app.models import User
    from app.seed import migrate_legacy_addresses

    h = signup(client)
    old = {
        "name": "Old User",
        "phone": "9876543210",
        "line1": "Old Street 1",
        "city": "Delhi",
        "state": "DL",
        "pincode": "110001",
    }
    with Session() as db:
        db.query(User).one().legacy_addresses = [old]
        db.commit()
        assert migrate_legacy_addresses(db) == 1
        assert migrate_legacy_addresses(db) == 0  # running it twice is harmless
    got = client.get("/api/auth/me", headers=h).json()["addresses"]
    assert len(got) == 1 and got[0]["city"] == "Delhi" and got[0]["isDefault"] is True


# ---------- reviews ----------
def test_only_buyers_can_review_and_rating_math_is_exact(client, outbox):
    h = signup(client, "r1@x.com")
    p = client.get("/api/products", params={"inStock": True}).json()[0]
    pid, n0, r0 = p["id"], p["reviews"], p["rating"]
    assert client.get(f"/api/products/{pid}/reviews", headers=h).json()["canReview"] is False
    assert client.put(f"/api/products/{pid}/reviews/me", json={"rating": 5}, headers=h).status_code == 403  # hasn't bought it
    assert client.put(f"/api/products/{pid}/reviews/me", json={"rating": 5}).status_code == 401
    place_for(client, h, pid)
    assert client.get(f"/api/products/{pid}/reviews", headers=h).json()["canReview"] is True
    r = client.put(f"/api/products/{pid}/reviews/me", json={"rating": 5, "title": "Great", "body": "Loved it"}, headers=h)
    assert r.status_code == 200 and r.json()["mine"]["rating"] == 5 and r.json()["mine"]["verifiedBuyer"] is True
    after = client.get(f"/api/products/{pid}").json()
    assert after["reviews"] == n0 + 1 and abs(after["rating"] - (r0 * n0 + 5) / (n0 + 1)) < 1e-9
    client.put(f"/api/products/{pid}/reviews/me", json={"rating": 1}, headers=h)  # edit: 5 -> 1, count unchanged
    edited = client.get(f"/api/products/{pid}").json()
    assert edited["reviews"] == n0 + 1 and abs(edited["rating"] - (r0 * n0 + 1) / (n0 + 1)) < 1e-9
    client.delete(f"/api/products/{pid}/reviews/me", headers=h)  # delete restores the original
    gone = client.get(f"/api/products/{pid}").json()
    assert gone["reviews"] == n0 and abs(gone["rating"] - r0) < 1e-9
    assert client.put(f"/api/products/{pid}/reviews/me", json={"rating": 6}, headers=h).status_code == 422


def place_for(client, h, pid):
    body = {"items": [{"productId": pid, "qty": 1}], "address": ADDRESS, "paymentMethod": "cod"}
    assert client.post("/api/orders", json=body, headers=h).status_code == 201


def test_review_author_is_abbreviated_and_cancelled_order_does_not_qualify(client, outbox):
    h = signup(client, "r2@x.com")
    pid = client.get("/api/products", params={"inStock": True}).json()[0]["id"]
    oid = client.post(
        "/api/orders", json={"items": [{"productId": pid, "qty": 1}], "address": ADDRESS, "paymentMethod": "cod"}, headers=h
    ).json()["id"]
    client.post(f"/api/orders/{oid}/cancel", headers=h)
    assert client.put(f"/api/products/{pid}/reviews/me", json={"rating": 4}, headers=h).status_code == 403
    place_for(client, h, pid)
    client.put(f"/api/products/{pid}/reviews/me", json={"rating": 4}, headers=h)
    public = client.get(f"/api/products/{pid}/reviews").json()  # no token needed to read
    assert public["reviews"][0]["author"] == "Test U." and public["mine"] is None and "email" not in str(public)


# ---------- admin ----------
ADMIN = "admin@zestora.dev"


def test_admin_routes_require_admin(client):
    user, admin = signup(client, "plain@x.com"), signup(client, ADMIN)
    assert client.get("/api/auth/me", headers=admin).json()["isAdmin"] is True
    assert client.get("/api/auth/me", headers=user).json()["isAdmin"] is False
    for method, url in [
        ("get", "/api/admin/stats"),
        ("get", "/api/admin/products"),
        ("get", "/api/admin/orders"),
        ("delete", "/api/admin/products/p001"),
        ("post", "/api/admin/orders/ZS1/status"),
    ]:
        assert getattr(client, method)(url).status_code == 401
        assert getattr(client, method)(url, headers=user).status_code == 403
    assert client.get("/api/admin/stats", headers=admin).status_code == 200


NEW_PRODUCT = {
    "title": "Test Gadget",
    "brand": "Acme",
    "category": "electronics",
    "price": 800,
    "mrp": 1000,
    "stock": 3,
    "emoji": "🧪",
    "hue": 200,
    "description": "A thoroughly tested gadget.",
}


def test_admin_product_crud_and_inventory(client):
    a = signup(client, ADMIN)
    made = client.post("/api/admin/products", json=NEW_PRODUCT, headers=a)
    assert made.status_code == 201, made.text
    p = made.json()
    assert p["discount"] == 20 and p["rating"] == 0 and p["reviews"] == 0 and p["id"].startswith("p")
    assert client.get(f"/api/products/{p['id']}").status_code == 200  # visible to shoppers immediately
    assert client.post("/api/admin/products", json={**NEW_PRODUCT, "price": 2000}, headers=a).status_code == 422  # price > mrp
    assert client.post("/api/admin/products", json={**NEW_PRODUCT, "category": "cars"}, headers=a).status_code == 422
    upd = client.put(f"/api/admin/products/{p['id']}", json={**NEW_PRODUCT, "stock": 50, "price": 500}, headers=a).json()
    assert upd["stock"] == 50 and upd["discount"] == 50
    low = client.get("/api/admin/products", params={"lowStock": True}, headers=a).json()
    assert all(x["stock"] <= 5 for x in low) and p["id"] not in [x["id"] for x in low]
    assert client.delete(f"/api/admin/products/{p['id']}", headers=a).status_code == 204
    assert client.get(f"/api/products/{p['id']}").status_code == 404


def test_admin_orders_status_and_stats(client, outbox):
    a, u = signup(client, ADMIN), signup(client, "cust@x.com")
    prod = client.get("/api/products", params={"inStock": True}).json()[0]
    oid = client.post(
        "/api/orders",
        json={"items": [{"productId": prod["id"], "qty": 1}], "address": ADDRESS, "paymentMethod": "cod"},
        headers=u,
    ).json()["id"]
    listing = client.get("/api/admin/orders", headers=a).json()
    assert listing[0]["customerEmail"] == "cust@x.com" and listing[0]["id"] == oid
    # admin moves it to "shipped": the customer can no longer cancel, and can't delete until delivered
    r = client.post(f"/api/admin/orders/{oid}/status", json={"status": "shipped"}, headers=a)
    assert r.status_code == 200 and r.json()["adminStatus"] == "shipped"
    assert client.get(f"/api/orders/{oid}", headers=u).json()["adminStatus"] == "shipped"
    assert client.post(f"/api/orders/{oid}/cancel", headers=u).status_code == 409
    assert client.delete(f"/api/orders/{oid}", headers=u).status_code == 409
    assert len(client.get("/api/admin/orders", params={"status": "shipped"}, headers=a).json()) == 1
    assert client.get("/api/admin/orders", params={"status": "placed"}, headers=a).json() == []
    client.post(f"/api/admin/orders/{oid}/status", json={"status": "delivered"}, headers=a)
    assert client.delete(f"/api/orders/{oid}", headers=u).status_code == 204  # delivered orders can be deleted
    # cancelling via admin restores stock
    before = client.get(f"/api/products/{prod['id']}").json()["stock"]
    oid2 = client.post(
        "/api/orders",
        json={"items": [{"productId": prod["id"], "qty": 2}], "address": ADDRESS, "paymentMethod": "cod"},
        headers=u,
    ).json()["id"]
    assert client.get(f"/api/products/{prod['id']}").json()["stock"] == before - 2
    client.post(f"/api/admin/orders/{oid2}/status", json={"status": "cancelled"}, headers=a)
    assert client.get(f"/api/products/{prod['id']}").json()["stock"] == before
    assert client.post(f"/api/admin/orders/{oid2}/status", json={"status": "packed"}, headers=a).status_code == 409
    s = client.get("/api/admin/stats", headers=a).json()
    assert s["orders"] == 1 and s["ordersByStatus"] == {"cancelled": 1} and s["revenue"] == 0 and len(s["revenueByDay"]) == 7


# ---------- coupons / offers ----------
def offers(client, items, method=None, headers=None):
    body = {"items": items, "paymentMethod": method}
    r = client.post("/api/coupons/offers", json=body, headers=headers or {})
    assert r.status_code == 200, r.text
    return {o["code"]: o for o in r.json()["offers"]}, r.json()


def cart_of(client, min_total, maxx=None):
    """Pick an in-stock product (and qty) whose subtotal lands in a wanted range."""
    for p in client.get("/api/products", params={"inStock": True, "sort": "price-desc"}).json():
        for q in range(1, 6):
            if p["stock"] >= q and p["price"] * q >= min_total and (maxx is None or p["price"] * q < maxx):
                return [{"productId": p["id"], "qty": q}], p["price"] * q
    raise AssertionError("no product fits")


def test_offers_show_savings_and_reasons(client):
    small, sub_small = cart_of(client, 100, 499)
    o, data = offers(client, small)
    assert data["subtotal"] == sub_small
    assert o["ZEST10"]["eligible"] and o["ZEST10"]["discount"] == round(sub_small * 0.1)
    assert not o["FLAT200"]["eligible"] and "more to use this offer" in o["FLAT200"]["reason"]
    assert not o["UPI5"]["eligible"]  # needs ₹499
    big, sub_big = cart_of(client, 6000)
    o, _ = offers(client, big)
    assert o["BIGSAVE"]["discount"] == min(round(sub_big * 0.12), 1000)  # percent coupons are capped
    assert o["FLAT200"]["discount"] == 200
    first = [x for x in o.values() if x["eligible"]][0]
    assert first["best"] is True and first["discount"] == max(x["discount"] for x in o.values())
    assert client.post("/api/coupons/offers", json={"items": []}).json() == {
        "subtotal": 0,
        "offers": [
            {**x, "eligible": False, "reason": "Add items to your cart", "discount": 0, "best": False}
            for x in client.post("/api/coupons/offers", json={"items": []}).json()["offers"]
        ],
    }  # empty cart: nothing usable


def test_payment_method_specific_coupon(client, outbox):
    h = signup(client)
    items, _ = cart_of(client, 600)
    assert offers(client, items)[0]["UPI5"]["eligible"] is True  # method not chosen yet: allowed
    assert offers(client, items, "upi")[0]["UPI5"]["eligible"] is True
    cod, _ = offers(client, items, "cod")
    assert cod["UPI5"]["eligible"] is False and "UPI" in cod["UPI5"]["reason"]
    body = {"items": items, "address": ADDRESS, "couponCode": "UPI5"}
    r = client.post("/api/orders", json={**body, "paymentMethod": "cod"}, headers=h)
    assert r.status_code == 422 and "UPI" in r.text  # the server enforces it too
    assert client.post("/api/orders", json={**body, "paymentMethod": "upi"}, headers=h).status_code == 201


def test_first_order_and_per_user_limit(client, outbox):
    h = signup(client)
    items, subtotal = cart_of(client, 300)
    assert offers(client, items, headers=h)[0]["WELCOME15"]["eligible"] is True
    body = {"items": items, "address": ADDRESS, "paymentMethod": "upi", "couponCode": "welcome15"}  # case-insensitive
    first = client.post("/api/orders", json=body, headers=h)
    assert first.status_code == 201
    assert first.json()["couponCode"] == "WELCOME15" and first.json()["totals"]["couponDiscount"] == min(
        round(subtotal * 0.15), 500
    )
    again = offers(client, items, headers=h)[0]["WELCOME15"]
    assert again["eligible"] is False and "first order" in again["reason"]
    assert client.post("/api/orders", json=body, headers=h).status_code == 422
    oid = first.json()["id"]
    client.post(f"/api/orders/{oid}/cancel", headers=h)  # a cancelled order frees the coupon again
    assert offers(client, items, headers=h)[0]["WELCOME15"]["eligible"] is True


def test_unknown_expired_and_inactive_coupons_are_rejected(client, outbox):
    from datetime import datetime, timedelta

    from app.models import Coupon

    h = signup(client)
    items, _ = cart_of(client, 300)
    body = {"items": items, "address": ADDRESS, "paymentMethod": "upi"}
    assert client.post("/api/orders", json={**body, "couponCode": "NOPE"}, headers=h).status_code == 422
    with Session() as db:
        db.get(Coupon, "ZEST10").expires_at = datetime.now(UTC) - timedelta(days=1)
        db.get(Coupon, "FESTIVE20").active = False
        db.commit()
    assert client.post("/api/orders", json={**body, "couponCode": "ZEST10"}, headers=h).status_code == 422
    listed, _ = offers(client, items)
    assert "ZEST10" not in listed and "FESTIVE20" not in listed  # expired/inactive offers aren't even shown


def test_admin_coupon_management(client):
    a, u = signup(client, ADMIN), signup(client, "u@x.com")
    new = {"code": "Summer25", "title": "Summer sale", "kind": "percent", "value": 25, "maxDiscount": 400, "minOrder": 999}
    assert client.get("/api/admin/coupons", headers=u).status_code == 403
    made = client.post("/api/admin/coupons", json=new, headers=a)
    assert made.status_code == 201 and made.json()["code"] == "SUMMER25" and made.json()["used"] == 0
    assert client.post("/api/admin/coupons", json=new, headers=a).status_code == 409
    assert (
        client.post(
            "/api/admin/coupons",
            json={
                **new,
                "code": "X",
            },
            headers=a,
        ).status_code
        == 422
    )
    assert client.post("/api/admin/coupons", json={**new, "code": "OVER", "value": 150}, headers=a).status_code == 422
    items, _ = cart_of(client, 1500)
    assert "SUMMER25" in offers(client, items)[0]  # live for shoppers immediately
    client.put("/api/admin/coupons/SUMMER25", json={**new, "active": False}, headers=a)
    assert "SUMMER25" not in offers(client, items)[0]  # deactivated: hidden
    assert client.delete("/api/admin/coupons/SUMMER25", headers=a).status_code == 204
    assert client.put("/api/admin/coupons/SUMMER25", json=new, headers=a).status_code == 404


# ---------- migrations ----------
def test_migrations_build_exactly_the_schema_the_models_describe(tmp_path):
    """If someone edits models.py but forgets to write a migration, this test fails (schema drift)."""
    from alembic.autogenerate import compare_metadata
    from alembic.migration import MigrationContext

    from app.migrate import run_migrations

    url = f"sqlite:///{tmp_path / 'fresh.db'}"
    run_migrations(url)
    eng = create_engine(url)
    with eng.connect() as conn:
        diff = compare_metadata(MigrationContext.configure(conn, opts={"compare_type": False}), Base.metadata)
    assert diff == [], f"models and migrations disagree: {diff}"


def test_pre_alembic_database_is_stamped_then_upgraded(tmp_path):
    """Simulates the REAL situation: an old database that has tables but no alembic_version table."""
    from alembic import command
    from sqlalchemy import inspect, text

    from app.migrate import make_config, run_migrations

    url = f"sqlite:///{tmp_path / 'old.db'}"
    command.upgrade(make_config(url), "0001")  # build the OLD schema (before payments)
    eng = create_engine(url)
    with eng.begin() as c:
        c.execute(text("DROP TABLE alembic_version"))  # ...and pretend Alembic never ran
        c.execute(
            text(
                "INSERT INTO users (id, name, email, phone, password_hash, addresses, created_at) VALUES ('u1','A B','a@b.c','','x','[]','2026-01-01')"
            )
        )
        c.execute(
            text(
                "INSERT INTO orders (id, user_id, created_at, payment_method, cancelled, address, mrp_total, subtotal, product_savings, coupon_discount, delivery, total, item_count) "
                "VALUES ('ZS1','u1','2026-01-01','upi',0,'{}',1,1,0,0,0,1,1), ('ZS2','u1','2026-01-01','cod',0,'{}',1,1,0,0,0,1,1)"
            )
        )
    run_migrations(url)
    cols = {c["name"] for c in inspect(eng).get_columns("orders")}
    assert {"payment_status", "paid_at", "payment_id", "contact_email"} <= cols
    with eng.connect() as c:
        rows = dict(c.execute(text("SELECT id, payment_status FROM orders")).all())
    assert rows == {"ZS1": "paid", "ZS2": "cod"}  # existing data was migrated sensibly, not lost
    run_migrations(url)  # idempotent: running again changes nothing


# ---------- mock payment gateway ----------
GOOD_CARD = {"cardNumber": "4242 4242 4242 4242", "expiry": "12/39", "cvv": "123"}


def intent_for(client, h, oid):
    r = client.post("/api/payments/intents", json={"orderId": oid}, headers=h)
    assert r.status_code == 201, r.text
    return r.json()


def confirm(client, i, method="card", **fields):
    body = {
        "intentId": i["intentId"],
        "clientSecret": i["clientSecret"],
        "method": method,
        **(GOOD_CARD if method == "card" else {}),
        **fields,
    }
    return client.post("/api/gateway/confirm", json=body)


def order_state(client, h, oid):
    return client.get(f"/api/orders/{oid}", headers=h).json()


def test_online_order_waits_for_payment_then_is_paid(client, outbox):
    h, a = signup(client, "pay1@x.com"), signup(client, ADMIN)
    order, prod = place(client, h, method="upi", email="buyer@gmail.com")
    oid = order["id"]
    assert order["paymentStatus"] == "pending" and order["emailStatus"] is None
    assert not (outbox / f"{oid}.eml").exists()  # no confirmation before payment
    assert client.get(f"/api/products/{prod['id']}").json()["stock"] == prod["stock"] - 1  # stock IS held meanwhile
    assert client.post(f"/api/admin/orders/{oid}/status", json={"status": "shipped"}, headers=a).status_code == 409
    assert client.get("/api/admin/stats", headers=a).json()["revenue"] == 0  # unpaid is not revenue
    assert client.put(f"/api/products/{prod['id']}/reviews/me", json={"rating": 5}, headers=h).status_code == 403
    r = confirm(client, intent_for(client, h, oid), method="upi", vpa="riya@okaxis")
    assert r.status_code == 200 and r.json()["status"] == "succeeded"
    paid = order_state(client, h, oid)
    assert paid["paymentStatus"] == "paid" and paid["paidAt"] is not None
    assert (outbox / f"{oid}.eml").exists()  # NOW the confirmation is sent
    assert client.post(f"/api/admin/orders/{oid}/status", json={"status": "shipped"}, headers=a).status_code == 200
    assert client.get("/api/admin/stats", headers=a).json()["revenue"] == paid["totals"]["total"]
    assert client.put(f"/api/products/{prod['id']}/reviews/me", json={"rating": 5}, headers=h).status_code == 200


def test_declined_payment_can_be_retried(client, outbox):
    h = signup(client)
    oid = place(client, h, method="card")[0]["id"]
    bad = confirm(client, intent_for(client, h, oid), cardNumber="4000 0000 0000 0002").json()
    assert (bad["status"], bad["message"], bad["emailStatus"]) == (
        "failed",
        "Your card was declined.",
        None,
    )  # no email on failure
    assert order_state(client, h, oid)["paymentStatus"] == "failed"
    assert not (outbox / f"{oid}.eml").exists()
    assert (
        confirm(client, intent_for(client, h, oid), cardNumber="4000 0000 0000 9995").json()["message"] == "Insufficient funds."
    )
    assert confirm(client, intent_for(client, h, oid)).json()["status"] == "succeeded"  # third time lucky
    assert order_state(client, h, oid)["paymentStatus"] == "paid"
    assert client.post("/api/payments/intents", json={"orderId": oid}, headers=h).status_code == 409  # can't pay twice


def test_gateway_input_validation_and_secrets(client):
    h = signup(client)
    oid = place(client, h, method="card")[0]["id"]
    i = intent_for(client, h, oid)
    assert confirm(client, i, cardNumber="1234").status_code == 422
    assert confirm(client, i, expiry="01/20").status_code == 422  # expired card
    assert confirm(client, i, cvv="12").status_code == 422
    assert confirm(client, i, method="upi", vpa="not-a-upi").status_code == 422
    assert order_state(client, h, oid)["paymentStatus"] == "pending"  # malformed input is not a "failed payment"
    assert confirm(client, {**i, "clientSecret": "wrong"}).status_code == 404  # wrong secret
    assert confirm(client, i, method="upi", vpa="fail@upi").json()["status"] == "failed"
    assert confirm(client, i).json()["message"] == "This payment was already processed."  # intent already settled


def test_intent_rules(client):
    h1, h2 = signup(client, "i1@x.com"), signup(client, "i2@x.com")
    cod = place(client, h1, method="cod")[0]["id"]
    assert client.post("/api/payments/intents", json={"orderId": cod}, headers=h1).status_code == 409  # nothing to pay online
    oid = place(client, h1, method="upi")[0]["id"]
    assert client.post("/api/payments/intents", json={"orderId": oid}, headers=h2).status_code == 404  # someone else's order
    assert client.post("/api/payments/intents", json={"orderId": oid}).status_code == 401
    client.post(f"/api/orders/{oid}/cancel", headers=h1)
    assert client.post("/api/payments/intents", json={"orderId": oid}, headers=h1).status_code == 409  # cancelled


def test_webhook_signature_replay_and_amount_checks(client, outbox):
    import json

    from app import gateway

    h = signup(client)
    oid = place(client, h, method="upi")[0]["id"]
    i = intent_for(client, h, oid)
    total = order_state(client, h, oid)["totals"]["total"]
    event = {
        "id": "evt_1",
        "type": "payment.succeeded",
        "intentId": i["intentId"],
        "orderId": oid,
        "amount": total,
        "reason": None,
    }
    raw = json.dumps(event, separators=(",", ":")).encode()

    def hook(body, sig):
        return client.post("/api/webhooks/payment", content=body, headers={"X-Gateway-Signature": sig})

    assert hook(raw, "deadbeef").status_code == 400  # forged signature
    assert hook(raw, "").status_code == 400  # missing signature
    assert hook(raw.replace(b'"orderId"', b'"orderId "'), gateway.sign(raw)).status_code == 400  # tampered body, old signature
    assert order_state(client, h, oid)["paymentStatus"] == "pending"  # nothing changed so far
    cheap = json.dumps({**event, "amount": 1}, separators=(",", ":")).encode()
    assert hook(cheap, gateway.sign(cheap)).status_code == 400  # validly signed, but wrong amount
    assert order_state(client, h, oid)["paymentStatus"] == "pending"
    assert hook(raw, gateway.sign(raw)).json() == {"received": True}  # the genuine, signed event
    assert order_state(client, h, oid)["paymentStatus"] == "paid"
    assert hook(raw, gateway.sign(raw)).json() == {"received": True, "duplicate": True}  # gateways retry: must be idempotent
    ghost = json.dumps({**event, "intentId": "pi_nope"}, separators=(",", ":")).encode()
    assert hook(ghost, gateway.sign(ghost)).status_code == 404
    assert len(list(outbox.glob("*.eml"))) == 1  # the replay sent no second email


def pending_age(minutes, oid):
    from datetime import datetime, timedelta

    from app.models import Order

    with Session() as db:
        db.get(Order, oid).created_at = datetime.now(UTC) - timedelta(minutes=minutes)
        db.commit()


def test_unpaid_orders_expire_and_release_stock(client):
    h = signup(client)
    order, prod = place(client, h, method="upi")
    oid = order["id"]
    stock_now = client.get(f"/api/products/{prod['id']}").json()["stock"]
    assert stock_now == prod["stock"] - 1
    pending_age(5, oid)
    assert order_state(client, h, oid)["cancelled"] is False  # 5 min: still within the window
    pending_age(20, oid)
    after = order_state(client, h, oid)  # reading triggers the sweep
    assert after["cancelled"] is True and after["paymentStatus"] == "expired"
    assert client.get(f"/api/products/{prod['id']}").json()["stock"] == prod["stock"]  # stock released
    assert client.post("/api/payments/intents", json={"orderId": oid}, headers=h).status_code == 409


def test_late_payment_on_expired_order_is_refunded_not_resurrected(client, outbox):
    h = signup(client)
    oid = place(client, h, method="card")[0]["id"]
    i = intent_for(client, h, oid)  # customer opens the payment page...
    pending_age(20, oid)
    client.get("/api/orders", headers=h)  # ...the order expires meanwhile...
    assert confirm(client, i).status_code == 200  # ...and then they pay
    late = order_state(client, h, oid)
    assert late["cancelled"] is True and late["paymentStatus"] == "refunded"
    assert not (outbox / f"{oid}.eml").exists()


def test_cancel_settles_payment_status(client, outbox):
    h = signup(client)
    unpaid = place(client, h, method="upi")[0]["id"]
    paid = place(client, h, method="upi")[0]["id"]
    assert confirm(client, intent_for(client, h, paid), method="upi", vpa="alice@okaxis").json()["status"] == "succeeded"
    assert client.post(f"/api/orders/{unpaid}/cancel", headers=h).json()["paymentStatus"] == "void"
    assert client.post(f"/api/orders/{paid}/cancel", headers=h).json()["paymentStatus"] == "refunded"


# ---------- stock race condition ----------
def test_stock_reservation_is_atomic_even_with_a_stale_view(client):
    """Session A has READ "1 left". Session B then buys it. With read-check-write in Python, A would still
    think 1 is available and oversell. Atomic UPDATE ... WHERE stock >= qty makes the database say no."""
    from app.models import Product
    from app.order_ops import OutOfStock, reserve_stock

    pid = client.get("/api/products", params={"inStock": True}).json()[0]["id"]
    with Session() as db:
        db.get(Product, pid).stock = 1
        db.commit()
    a, b = Session(), Session()
    try:
        assert a.get(Product, pid).stock == 1  # A's cached view
        reserve_stock(b, {pid: 1})
        b.commit()  # B buys the last unit
        with pytest.raises(OutOfStock):
            reserve_stock(a, {pid: 1})  # A is refused despite its stale view
        a.rollback()
    finally:
        a.close(), b.close()
    with Session() as db:
        assert db.get(Product, pid).stock == 0  # never negative


def test_last_unit_cannot_be_sold_twice_and_failed_order_rolls_back(client):
    from app.models import Product

    h1, h2 = signup(client, "r1@x.com"), signup(client, "r2@x.com")
    prods = client.get("/api/products", params={"inStock": True}).json()
    pid, other = prods[0]["id"], prods[1]
    with Session() as db:
        db.get(Product, pid).stock = 1
        db.commit()

    def mk(items, h):
        return client.post("/api/orders", json={"items": items, "address": ADDRESS, "paymentMethod": "cod"}, headers=h)

    assert mk([{"productId": pid, "qty": 1}], h1).status_code == 201
    r = mk([{"productId": other["id"], "qty": 1}, {"productId": pid, "qty": 1}], h2)  # second line is now sold out
    assert r.status_code == 409 and ("sold out" in r.text or "left" in r.text)
    assert client.get(f"/api/products/{other['id']}").json()["stock"] == other["stock"]  # first line's stock NOT leaked
    assert client.get("/api/orders", headers=h2).json() == []  # no half-created order


# ---------- bigger catalog: hidden products, sub-categories, photos, seeding ----------
def admin_body(p, **changes):
    keys = ("title", "brand", "category", "price", "mrp", "stock", "emoji", "hue", "description")
    return {**{k: p[k] for k in keys}, "active": True, **changes}


def test_hidden_products_are_invisible_to_shoppers_but_manageable_by_admin(client, outbox):
    a, u = signup(client, ADMIN), signup(client, "shopper@x.com")
    p = client.get("/api/products", params={"inStock": True}).json()[0]
    pid = p["id"]
    hidden = client.put(f"/api/admin/products/{pid}", json=admin_body(p, active=False), headers=a)
    assert hidden.status_code == 200 and hidden.json()["active"] is False
    assert pid not in [x["id"] for x in client.get("/api/products").json()]
    assert client.get(f"/api/products/{pid}").status_code == 404
    assert client.get("/api/products", params={"ids": [pid]}).json() == []  # wishlist/cart lookups too
    order = {"items": [{"productId": pid, "qty": 1}], "address": ADDRESS, "paymentMethod": "cod"}
    r = client.post("/api/orders", json=order, headers=u)
    assert r.status_code == 409 and "no longer available" in r.text  # can't buy a hidden product
    as_admin = lambda v: [x["id"] for x in client.get("/api/admin/products", params={"visibility": v}, headers=a).json()]  # noqa: E731
    assert pid in as_admin("hidden") and pid in as_admin("all") and pid not in as_admin("visible")
    client.put(f"/api/admin/products/{pid}", json=admin_body(p, active=True), headers=a)
    assert client.get(f"/api/products/{pid}").status_code == 200  # reversible
    assert client.post("/api/orders", json=order, headers=u).status_code == 201


def test_subcategory_filter_and_search(client):
    ids = [p["id"] for p in client.get("/api/products").json()[:3]]
    with Session() as db:
        for pid, sub in zip(ids, ["smartphones", "smartphones", "laptops"], strict=True):
            db.get(Product, pid).subcategory = sub
        db.commit()
    got = client.get("/api/products", params={"sub": "smartphones"}).json()
    assert {x["id"] for x in got} == set(ids[:2]) and all(x["subcategory"] == "smartphones" for x in got)
    assert ids[2] in [x["id"] for x in client.get("/api/products", params={"q": "laptops"}).json()]  # search sees sub-categories


def test_order_items_keep_a_snapshot_of_the_product_photo(client, outbox):
    h = signup(client)
    pid = client.get("/api/products", params={"inStock": True}).json()[0]["id"]
    with Session() as db:
        db.get(Product, pid).image = "/products/demo/thumb.webp"
        db.commit()
    order, _ = place(client, h)
    assert order["items"][0]["image"] == "/products/demo/thumb.webp"
    with Session() as db:  # the shop later changes the photo: the old order must not change
        db.get(Product, pid).image = "/products/demo/NEW.webp"
        db.commit()
    assert client.get(f"/api/orders/{order['id']}", headers=h).json()["items"][0]["image"] == "/products/demo/thumb.webp"


def make_catalog(tmp_path, ids):
    base = json.loads(FIXTURE_CATALOG.read_text())[0]
    rows = [
        {
            **base,
            "id": i,
            "addedOrder": int(i[1:]),
            "image": f"/products/{i}/thumb.webp",
            "images": [],
            "specs": {"Brand": "X"},
            "subcategory": "smartphones",
        }
        for i in ids
    ]
    path = tmp_path / "new-catalog.json"
    path.write_text(json.dumps(rows))
    return path


def test_catalog_loads_once_per_version_and_hides_old_demo_products(tmp_path):
    eng = create_engine(f"sqlite:///{tmp_path / 'seed.db'}")
    Base.metadata.create_all(eng)
    with sessionmaker(bind=eng)() as db:
        assert seed_products(db, FIXTURE_CATALOG, "v0") == 48  # the old, photo-less demo catalog
        new = make_catalog(tmp_path, ["p101", "p102"])
        assert seed_products(db, new, "v1") == 2  # new catalog arrives
        old = db.scalars(select(Product).where(Product.image.is_(None))).all()
        assert len(old) == 48 and not any(p.active for p in old)  # old ones hidden, NOT deleted
        assert all(p.active for p in db.scalars(select(Product).where(Product.image.is_not(None))))
        db.get(Product, "p101").stock = 7
        db.delete(db.get(Product, "p102"))
        db.commit()
        assert seed_products(db, new, "v1") == 0  # same version: nothing happens
        assert db.get(Product, "p102") is None and db.get(Product, "p101").stock == 7  # deleted stays deleted; stock kept
        assert seed_products(db, new, "v2") == 1  # a NEW version tops up what is missing
        assert db.get(Product, "p101").stock == 7  # ...without touching existing rows


def test_migration_gives_existing_products_sensible_defaults(tmp_path):
    from alembic import command
    from sqlalchemy import text

    from app.migrate import make_config, run_migrations

    url = f"sqlite:///{tmp_path / 'upgrade.db'}"
    command.upgrade(make_config(url), "0002")  # the schema before photos existed
    eng = create_engine(url)
    with eng.begin() as c:
        c.execute(
            text(
                "INSERT INTO products (id,title,brand,category,price,mrp,discount,rating,reviews,stock,emoji,hue,colors,description,highlights,added_order) "
                "VALUES ('p001','Old','B','home',10,10,0,4.0,1,5,'x',1,'[]','d','[]',1)"
            )
        )
    run_migrations(url)
    with eng.connect() as c:
        row = c.execute(text("SELECT active, images, specs, image, subcategory FROM products")).one()
    assert tuple(row) == (1, "[]", "{}", None, None)  # visible, empty gallery, no photo yet


def test_real_catalog_file_is_consistent_with_the_shop():
    """Guards the generated seed/products.json: every product is valid and every photo really exists on disk."""
    import re
    from typing import get_args

    from app.schemas import CATEGORY_SLUGS

    public = Path(__file__).resolve().parents[2] / "frontend" / "public"
    rows = json.loads(SEED_FILE.read_text())
    assert len(rows) >= 150
    assert len({r["id"] for r in rows}) == len(rows)
    for r in rows:
        assert re.fullmatch(r"p\d{3}", r["id"]) and int(r["id"][1:]) > 100, r["id"]  # never collides with old demo ids p001-p048
        assert r["category"] in get_args(CATEGORY_SLUGS) and r["subcategory"], r["id"]
        assert 0 < r["price"] <= r["mrp"] and r["stock"] >= 0 and 3.0 <= r["rating"] <= 5.0, r["id"]
        assert r["image"] and r["images"] and r["specs"]["Brand"] == r["brand"], r["id"]
        for path in [r["image"], *r["images"]]:
            assert (public / path.lstrip("/")).stat().st_size > 0, f"missing photo {path}"


def test_real_catalog_loads_into_the_database_model(tmp_path):
    eng = create_engine(f"sqlite:///{tmp_path / 'real.db'}")
    Base.metadata.create_all(eng)
    with sessionmaker(bind=eng)() as db:
        added = seed_products(db)  # the real file, the real function
        assert added == len(json.loads(SEED_FILE.read_text())) and db.scalar(select(func.count()).select_from(Product)) == added


# ================= support chat =================
def chat(client, headers, text):
    r = client.post("/api/support/messages", json={"text": text}, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def last(thread, sender="bot"):
    return [m for m in thread["messages"] if m["sender"] == sender][-1]


def test_support_endpoints_need_login(client):
    assert client.get("/api/support/thread").status_code == 401
    assert client.post("/api/support/messages", json={"text": "hi"}).status_code == 401


def test_guests_get_general_answers_but_nothing_personal(client):
    ask = lambda text: client.post("/api/support/ask", json={"text": text}).json()  # noqa: E731
    assert "₹499" in ask("What are the delivery charges?")["text"]  # real policy numbers from the code
    personal = ask("Where is my order?")
    assert "log in" in personal["text"].lower() and personal["links"][0]["to"] == "/login"
    assert "log in" in ask("I want to talk to a person")["text"].lower()  # guests can't open tickets
    h = signup(client)
    assert (
        client.post("/api/support/ask", json={"text": "hi"}, headers=h).status_code == 409
    )  # logged-in users use the saved chat


def test_greeting_offers_a_menu(client):
    t = chat(client, signup(client), "hello")
    assert t["status"] == "bot" and t["id"].startswith("ZT")
    assert last(t)["text"].startswith("Hi Test") and "Talk to a person" in last(t)["quickReplies"]


def test_bot_reports_the_real_order_status(client, outbox):
    h = signup(client)
    order, _ = place(client, h)
    t = chat(client, h, f"where is my order {order['id']}")
    reply = last(t)
    assert order["id"] in reply["text"] and "Order placed" in reply["text"] and "cash on delivery" in reply["text"]
    assert reply["links"][0]["to"] == f"/orders/{order['id']}"
    assert "Cancel this order" in reply["quickReplies"]  # it hasn't shipped yet


def test_bot_asks_which_order_then_remembers_the_question(client, outbox):
    h = signup(client)
    order, _ = place(client, h)
    asked = last(chat(client, h, "Where is my order?"))
    assert "Which order" in asked["text"] and order["id"] in asked["quickReplies"]
    answered = last(chat(client, h, order["id"]))  # just the number, like tapping the chip
    assert "currently: Order placed" in answered["text"]


def test_bot_never_reveals_someone_elses_order(client, outbox):
    owner, other = signup(client, "owner@x.com"), signup(client, "other@x.com")
    order, _ = place(client, owner)
    reply = last(chat(client, other, f"track {order['id']}"))
    assert "couldn't find" in reply["text"] and "Order placed" not in reply["text"] and order["id"] in reply["text"]
    assert order["id"] not in reply["quickReplies"]  # and it offers only the asker's own orders


def test_unpaid_online_payment_is_explained(client, outbox):
    h = signup(client)
    order, _ = place(client, h, method="upi")
    t = chat(client, h, "my payment failed")
    assert order["id"] in last(t)["quickReplies"]
    reply = last(chat(client, h, order["id"]))
    assert "hasn't been completed" in reply["text"] and "Pay now" in reply["text"] and "15 minutes" in reply["text"]
    assert client.get("/api/support/thread", headers=h).json()["status"] == "bot"  # a plain explanation, no ticket


def test_money_deducted_on_unpaid_order_becomes_a_ticket(client, outbox):
    h = signup(client)
    order, _ = place(client, h, method="card")
    t = chat(client, h, f"money was deducted for {order['id']} but it shows pending")
    assert t["status"] == "waiting_agent" and t["category"] == "payment" and t["orderId"] == order["id"]
    assert f"Ticket {t['id']}" in last(t)["text"]


def test_follow_up_uses_the_order_just_discussed(client, outbox):
    h = signup(client)
    order, _ = place(client, h, method="upi")
    chat(client, h, f"payment problem {order['id']}")
    t = chat(client, h, "money was deducted")  # no order number this time
    assert t["status"] == "waiting_agent" and t["orderId"] == order["id"]


def test_paid_and_cod_and_refunded_payment_answers(client, outbox):
    h = signup(client)
    paid, _ = place(client, h, method="upi")
    confirm(client, intent_for(client, h, paid["id"]))
    ok = chat(client, h, f"payment status for {paid['id']} please")
    assert "received" in last(ok)["text"] and ok["status"] == "bot"
    h2 = signup(client, "second@x.com")
    cod, _ = place(client, h2, method="cod")
    assert "cash on delivery" in last(chat(client, h2, f"payment issue {cod['id']}"))["text"]
    client.post(f"/api/orders/{paid['id']}/cancel", headers=h)  # paid, then cancelled = refunded
    assert "refunded" in last(chat(client, h, f"refund for {paid['id']}"))["text"]
    dispute = chat(client, h, f"I was charged twice for {paid['id']}")
    assert dispute["status"] == "waiting_agent" and dispute["category"] == "payment"


def test_quality_complaint_collects_the_order_then_opens_a_ticket(client, outbox):
    h = signup(client)
    order, _ = place(client, h)
    asked = chat(client, h, "the product I received is damaged")
    assert asked["status"] == "bot" and order["id"] in last(asked)["quickReplies"]
    assert "I don't have an order number" in last(asked)["quickReplies"]
    t = chat(client, h, order["id"])
    assert t["status"] == "waiting_agent" and t["category"] == "quality" and t["orderId"] == order["id"]
    assert "7-day replacement" in last(t, "bot")["text"] or any("7-day" in m["text"] for m in t["messages"])


def test_quality_complaint_without_an_order_number_still_gets_a_ticket(client, outbox):
    h = signup(client)
    place(client, h)
    chat(client, h, "this is poor quality")
    t = chat(client, h, "I don't have an order number")
    assert t["status"] == "waiting_agent" and t["category"] == "quality" and t["orderId"] is None


def test_cancellation_advice_follows_the_real_order_state(client, outbox):
    h, admin = signup(client, "canceller@x.com"), signup(client, ADMIN)
    order, _ = place(client, h)
    assert "you can cancel it" in last(chat(client, h, f"cancel {order['id']}"))["text"]
    client.post(f"/api/admin/orders/{order['id']}/status", json={"status": "shipped"}, headers=admin)
    assert "no longer be cancelled" in last(chat(client, h, f"cancel {order['id']}"))["text"]


def test_coupon_questions(client):
    h = signup(client)
    named = last(chat(client, h, "tell me about the ZEST10 coupon"))
    assert "ZEST10" in named["text"] and "10%" in named["text"]
    general = last(chat(client, h, "How do coupons work?"))
    assert "minimum order" in general["text"] and general["links"][0]["to"] == "/cart"


def test_product_questions_use_the_live_catalog(client):
    h = signup(client)
    found = last(chat(client, h, "is the Aero Pods available?"))
    assert "Aero Pods Pro" in found["text"] and "₹" in found["text"] and found["links"][0]["to"].startswith("/products/")
    assert "couldn't find" in last(chat(client, h, "do you have unicorn saddles"))["text"]


def test_human_request_and_repeated_confusion_both_escalate(client):
    h1, h2 = signup(client, "h1@x.com"), signup(client, "h2@x.com")
    t = chat(client, h1, "I want to talk to a person")
    assert t["status"] == "waiting_agent" and "Ticket" in last(t)["text"]
    first = chat(client, h2, "blah blah blah")
    assert first["status"] == "bot" and "not sure I understood" in last(first)["text"]
    second = chat(client, h2, "xyzzy plugh")
    assert second["status"] == "waiting_agent" and second["category"] == "other"


def test_agent_conversation_lifecycle(client, outbox):
    h, admin = signup(client, "cust@x.com"), signup(client, ADMIN)
    ticket = chat(client, h, "I want to talk to a person")
    tid = ticket["id"]
    inbox = client.get("/api/admin/support/threads", params={"status": "needs_reply"}, headers=admin).json()
    assert [x["id"] for x in inbox] == [tid] and inbox[0]["customerEmail"] == "cust@x.com" and inbox[0]["lastSender"] == "bot"
    assert client.get("/api/admin/stats", headers=admin).json()["openTickets"] == 1
    detail = client.get(f"/api/admin/support/threads/{tid}", headers=admin).json()
    assert detail["customerName"] == "Test User" and len(detail["messages"]) >= 2
    # the agent replies: the customer sees it in the same chat and the ticket leaves the "needs reply" list
    r = client.post(f"/api/admin/support/threads/{tid}/reply", json={"text": "Hi! How can I help?"}, headers=admin)
    assert r.status_code == 200 and r.json()["status"] == "answered"
    mine = client.get("/api/support/thread", headers=h).json()
    assert mine["status"] == "answered" and last(mine, "agent")["text"] == "Hi! How can I help?"
    assert client.get("/api/admin/stats", headers=admin).json()["openTickets"] == 0
    # the customer writes back: the bot stays out of it and the ticket returns to the team
    follow = chat(client, h, "My order never arrived")
    assert follow["status"] == "waiting_agent" and follow["messages"][-1]["sender"] == "user"
    # resolved: the next message starts a brand-new conversation with the bot
    client.post(f"/api/admin/support/threads/{tid}/action", json={"action": "resolve"}, headers=admin)
    assert client.get("/api/support/thread", headers=h).json()["status"] == "resolved"
    fresh = chat(client, h, "hello")
    assert fresh["id"] != tid and fresh["status"] == "bot"
    reopened = client.post(f"/api/admin/support/threads/{tid}/action", json={"action": "reopen"}, headers=admin).json()
    assert reopened["status"] == "waiting_agent"


def test_support_inbox_is_admin_only_and_customers_only_see_their_own(client):
    h1, h2, admin = signup(client, "a@x.com"), signup(client, "b@x.com"), signup(client, ADMIN)
    tid = chat(client, h1, "talk to a person")["id"]
    for method, url in [("get", "/api/admin/support/threads"), ("get", f"/api/admin/support/threads/{tid}"),
                        ("post", f"/api/admin/support/threads/{tid}/reply"), ("post", f"/api/admin/support/threads/{tid}/action")]:  # fmt: skip
        assert getattr(client, method)(url, headers=h2).status_code == 403
        assert getattr(client, method)(url).status_code == 401
    assert client.get("/api/support/thread", headers=h2).json() is None  # b has never written, and can't see a's ticket
    assert client.get("/api/admin/support/threads/ZT000000", headers=admin).status_code == 404
    assert client.post("/api/admin/support/threads/ZT000000/reply", json={"text": "x"}, headers=admin).status_code == 404
    assert client.post(f"/api/admin/support/threads/{tid}/reply", json={"text": "  "}, headers=admin).status_code == 422


def test_support_message_validation(client):
    h = signup(client)
    for bad in ("", "   ", "x" * 1001):
        assert client.post("/api/support/messages", json={"text": bad}, headers=h).status_code == 422
    assert client.post("/api/support/messages", json={}, headers=h).status_code == 422
    t = chat(client, h, "  <b>hello</b>  ")
    assert t["messages"][0]["text"] == "<b>hello</b>"  # trimmed; stored as typed (the React UI escapes it when displayed)


def test_support_rate_limit_and_conversation_cap(client, monkeypatch):
    h = signup(client)
    for _ in range(15):
        assert client.post("/api/support/messages", json={"text": "hello"}, headers=h).status_code == 200
    assert client.post("/api/support/messages", json={"text": "hello"}, headers=h).status_code == 429
    from app.routers import support

    monkeypatch.setattr(support, "MAX_MESSAGES_PER_THREAD", 4)
    h2 = signup(client, "cap@x.com")
    chat(client, h2, "hello")
    chat(client, h2, "hello")
    assert client.post("/api/support/messages", json={"text": "hello"}, headers=h2).status_code == 409
