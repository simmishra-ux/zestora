import { getBrands, PRICE_MAX } from '@/services/productService'

const RATINGS = [4, 3]
const DISCOUNTS = [10, 20, 30, 40]

// A "controlled" component: it owns no state. The parent passes `filters` and receives changes via `onChange`.
export default function FilterPanel({ filters, onChange, onReset }) {
  const toggleBrand = (b) =>
    onChange({ brands: filters.brands.includes(b) ? filters.brands.filter((x) => x !== b) : [...filters.brands, b] })

  return (
    <div className="filters">
      <div className="filters__head">
        <h3>Filters</h3>
        <button className="link-btn" onClick={onReset}>Clear all</button>
      </div>

      <fieldset>
        <legend>Max price: ₹{filters.maxPrice.toLocaleString('en-IN')}</legend>
        <input type="range" min={100} max={PRICE_MAX} step={100} value={filters.maxPrice}
               onChange={(e) => onChange({ maxPrice: Number(e.target.value) })} aria-label="Maximum price" />
      </fieldset>

      <fieldset>
        <legend>Customer rating</legend>
        {RATINGS.map((r) => (
          <label key={r} className="check">
            <input type="radio" name="rating" checked={filters.minRating === r} onChange={() => onChange({ minRating: r })} />
            {r}★ & above
          </label>
        ))}
        <label className="check">
          <input type="radio" name="rating" checked={!filters.minRating} onChange={() => onChange({ minRating: 0 })} /> Any
        </label>
      </fieldset>

      <fieldset>
        <legend>Discount</legend>
        {DISCOUNTS.map((d) => (
          <label key={d} className="check">
            <input type="radio" name="discount" checked={filters.minDiscount === d} onChange={() => onChange({ minDiscount: d })} />
            {d}% or more
          </label>
        ))}
        <label className="check">
          <input type="radio" name="discount" checked={!filters.minDiscount} onChange={() => onChange({ minDiscount: 0 })} /> Any
        </label>
      </fieldset>

      <fieldset>
        <legend>Brand</legend>
        <div className="brand-list">
          {getBrands().map((b) => (
            <label key={b} className="check">
              <input type="checkbox" checked={filters.brands.includes(b)} onChange={() => toggleBrand(b)} /> {b}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="check check--switch">
        <input type="checkbox" checked={filters.inStock} onChange={(e) => onChange({ inStock: e.target.checked })} />
        In stock only
      </label>
    </div>
  )
}
