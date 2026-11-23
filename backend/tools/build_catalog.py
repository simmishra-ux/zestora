"""Builds the demo product catalog: seed/products.json, the product photos, and the frontend's catalog.js.

Source: DummyJSON (https://dummyjson.com), a free dataset of fake products made for demos and testing.
We keep a LOCAL copy of everything (data + photos) so the shop works offline and never depends on their server.

Run from the project root (needs internet, takes about a minute):
    backend/.venv/bin/python backend/tools/build_catalog.py

What it changes, so the data feels like an Indian online shop:
  * USD prices -> INR with normal retail endings (₹829, ₹1,65,899)
  * 24 source categories -> 7 shop categories with sub-categories (cars and motorcycles are left out)
  * products without a brand get a plausible fictional one (never a real company)
  * ratings are re-mapped smoothly into 3.5-4.9 (order preserved), items above MAX_PRICE_INR are skipped
  * stock, discounts, warranty/shipping/return text are kept from the source
"""

import concurrent.futures as cf
import hashlib
import json
import random
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SEED = ROOT / "backend" / "seed" / "products.json"
PUBLIC = ROOT / "frontend" / "public" / "products"
CATALOG_JS = ROOT / "frontend" / "src" / "data" / "catalog.js"
SOURCE = "https://dummyjson.com/products?limit=0"
USD_TO_INR = 83
MAX_PRICE_INR = 250_000  # luxury outliers (Rolex etc.) are skipped: they would make the price slider useless
FIRST_ORDER = 101  # ids start at p101, clear of the old demo products p001-p048 that past orders point to

# slug, name, emoji (fallback art), hue, [(source category, sub-category name)]
CATEGORIES = [
    (
        "electronics",
        "Electronics",
        "📱",
        255,
        [
            ("smartphones", "Smartphones"),
            ("laptops", "Laptops"),
            ("tablets", "Tablets"),
            ("mobile-accessories", "Mobile Accessories"),
        ],
    ),
    (
        "fashion",
        "Fashion",
        "👗",
        335,
        [
            ("mens-shirts", "Men's Shirts"),
            ("tops", "Women's Tops"),
            ("womens-dresses", "Dresses"),
            ("mens-shoes", "Men's Shoes"),
            ("womens-shoes", "Women's Shoes"),
            ("womens-bags", "Bags"),
            ("womens-jewellery", "Jewellery"),
        ],
    ),
    (
        "accessories",
        "Watches & Eyewear",
        "⌚",
        200,
        [("mens-watches", "Men's Watches"), ("womens-watches", "Women's Watches"), ("sunglasses", "Sunglasses")],
    ),
    ("beauty", "Beauty & Care", "💄", 12, [("beauty", "Makeup"), ("skin-care", "Skin Care"), ("fragrances", "Fragrances")]),
    (
        "home",
        "Home & Kitchen",
        "🛋️",
        165,
        [("furniture", "Furniture"), ("home-decoration", "Home Décor"), ("kitchen-accessories", "Kitchen & Dining")],
    ),
    ("grocery", "Grocery", "🛒", 95, [("groceries", "Fresh & Pantry")]),
    ("sports", "Sports & Fitness", "🏋️", 145, [("sports-accessories", "Sports Gear")]),
]

# Fictional brands for items the source left blank (picked deterministically from the title).
BRAND_POOLS = {
    "groceries": ["FreshFarm", "Green Valley", "Daily Harvest", "Pure Pantry", "Farmhouse"],
    "kitchen-accessories": ["Chefmate", "KitchenPro", "Cookwell", "Homeware", "Tasteful"],
}
DEFAULT_BRANDS = ["Zestora Essentials", "Urban Nest", "Northfield", "Maple & Co"]


def get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "zestora-catalog-builder"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read()
        except Exception:
            if attempt == 2:
                raise
    raise RuntimeError("unreachable")


def retail_price(usd: float) -> int:
    inr = usd * USD_TO_INR
    step = 10 if inr < 10000 else 100
    return max(round(inr / step) * step - 1, 9)


def brand_for(item: dict) -> str:
    if item.get("brand"):
        return item["brand"]
    pool = BRAND_POOLS.get(item["category"], DEFAULT_BRANDS)
    return pool[int(hashlib.md5(item["title"].encode()).hexdigest(), 16) % len(pool)]


def build() -> None:
    data = json.loads(get(SOURCE))["products"]
    by_cat: dict[str, list[dict]] = {}
    for p in data:
        by_cat.setdefault(p["category"], []).append(p)

    products, downloads = [], []
    order = FIRST_ORDER
    for slug, _name, emoji, hue, subs in CATEGORIES:
        for source_cat, sub_name in subs:
            for item in by_cat.get(source_cat, []):
                if retail_price(item["price"]) > MAX_PRICE_INR:
                    continue
                pid = f"p{order:03d}"
                rnd = random.Random(order)
                price = retail_price(item["price"])
                discount = max(0, min(round(item.get("discountPercentage", 0)), 60))
                mrp = round(price / (1 - discount / 100) / 10) * 10 if discount else price
                status = item.get("availabilityStatus", "In Stock")
                stock = 0 if status == "Out of Stock" else min(item["stock"], 5) if status == "Low Stock" else item["stock"]

                exts = lambda url: Path(url.split("?")[0]).suffix or ".webp"  # noqa: E731
                thumb = f"/products/{pid}/thumb{exts(item['thumbnail'])}"
                gallery = [f"/products/{pid}/{i}{exts(u)}" for i, u in enumerate(item["images"][:4], start=1)]
                downloads.append((item["thumbnail"], PUBLIC / pid / Path(thumb).name))
                downloads += [(u, PUBLIC / pid / Path(g).name) for u, g in zip(item["images"][:4], gallery, strict=False)]

                brand = brand_for(item)
                products.append(
                    {
                        "id": pid,
                        "title": item["title"],
                        "brand": brand,
                        "category": slug,
                        "subcategory": source_cat,
                        "price": price,
                        "mrp": max(mrp, price),
                        "discount": discount,
                        "rating": round(3.5 + (item["rating"] - 2.5) * 1.4 / 2.5, 1),  # source 2.5-5.0 -> 3.5-4.9
                        "reviews": rnd.randint(80, 6500),
                        "stock": stock,
                        "emoji": emoji,
                        "hue": hue,
                        "colors": [],
                        "description": item["description"],
                        "highlights": [
                            h
                            for h in (
                                item.get("warrantyInformation"),
                                item.get("shippingInformation"),
                                item.get("returnPolicy"),
                                f"Category: {sub_name}",
                            )
                            if h
                        ],
                        "specs": {
                            "Brand": brand,
                            "Category": sub_name,
                            "SKU": item.get("sku", pid.upper()),
                            "Warranty": item.get("warrantyInformation", "-"),
                            "Shipping": item.get("shippingInformation", "-"),
                            "Returns": item.get("returnPolicy", "-"),
                            "Availability": "Out of stock" if stock == 0 else "In stock",
                        },
                        "image": thumb,
                        "images": gallery,
                        "addedOrder": order,
                    }
                )
                order += 1

    def fetch(job):
        url, dest = job
        if dest.exists() and dest.stat().st_size > 0:
            return 0
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(get(url))
        return dest.stat().st_size

    with cf.ThreadPoolExecutor(max_workers=12) as pool:
        total = sum(pool.map(fetch, downloads))
    print(f"{len(products)} products, {len(downloads)} images, {total / 1024 / 1024:.1f} MB downloaded")

    SEED.write_text(json.dumps(products, indent=1, ensure_ascii=False))
    brands = sorted({p["brand"] for p in products})
    cats = ",\n".join(f"  {{ slug: '{s}', name: {json.dumps(n)}, emoji: '{e}', hue: {h} }}" for s, n, e, h, _ in CATEGORIES)
    subs = ",\n".join(
        f"  {{ slug: '{sc}', name: {json.dumps(sn)}, category: '{s}' }}" for s, _n, _e, _h, ss in CATEGORIES for sc, sn in ss
    )
    CATALOG_JS.write_text(
        "// GENERATED by backend/tools/build_catalog.py. Navigation and filter options for the storefront.\n"
        "// The products themselves live in the backend database.\n"
        f"export const CATEGORIES = [\n{cats},\n]\n\n"
        f"// Sub-categories shown as chips once a category is chosen.\nexport const SUBCATEGORIES = [\n{subs},\n]\n\n"
        f"export const BRANDS = {json.dumps(brands, ensure_ascii=False)}\n"
        f"export const PRICE_MAX = {max(p['price'] for p in products)}\n"
    )
    print(f"{len(brands)} brands, price range Rs {min(p['price'] for p in products)} to Rs {max(p['price'] for p in products)}")


if __name__ == "__main__":
    build()
