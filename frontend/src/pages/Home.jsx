import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getCategories, getHomeCollections } from '@/services/productService'
import { useAsync } from '@/hooks/useAsync'
import ProductGrid from '@/components/ProductGrid'
import ProductArt from '@/components/ProductArt'
import SectionHeader from '@/components/SectionHeader'
import Reveal from '@/components/Reveal'
import Price from '@/components/Price'
import { HeadsetIcon, RefreshIcon, ShieldIcon, TruckIcon } from '@/components/Icons'

function useCountdown() {
  // Counts down to the next midnight so the "deal ends" timer always looks live.
  const [left, setLeft] = useState(() => msToMidnight())
  useEffect(() => {
    const id = setInterval(() => setLeft(msToMidnight()), 1000)
    return () => clearInterval(id)
  }, [])
  const pad = (n) => String(Math.floor(n)).padStart(2, '0')
  return [pad(left / 3.6e6), pad((left % 3.6e6) / 6e4), pad((left % 6e4) / 1000)]
}
const msToMidnight = () => {
  const d = new Date()
  const next = new Date(d)
  next.setHours(24, 0, 0, 0)
  return next - d
}

const PERKS = [
  { Icon: TruckIcon, title: 'Free delivery', text: 'On orders above ₹499' },
  { Icon: RefreshIcon, title: '7-day returns', text: 'Hassle-free replacement' },
  { Icon: ShieldIcon, title: 'Secure checkout', text: 'Protected payments' },
  { Icon: HeadsetIcon, title: 'Friendly support', text: 'Here when you need us' },
]

export default function Home() {
  const { data, loading } = useAsync(getHomeCollections, [])
  const [h, m, s] = useCountdown()
  const hero = data?.trending.slice(0, 3) ?? []

  return (
    <>
      <section className="hero">
        <div className="container hero__inner">
          <div className="hero__copy">
            <span className="pill">✨ New season · Up to 40% off</span>
            <h1>Shop what <span className="grad">moves</span> you.</h1>
            <p>From everyday essentials to once-in-a-while treats — thousands of products, honest prices, and delivery you can actually track.</p>
            <div className="hero__cta">
              <Link to="/products" className="btn btn--primary btn--lg">Start shopping</Link>
              <Link to="/products?sort=discount" className="btn btn--ghost btn--lg">Today’s deals</Link>
            </div>
            <ul className="hero__stats">
              <li><b>175+</b> products</li>
              <li><b>4.6★</b> avg. rating</li>
              <li><b>24h</b> dispatch</li>
            </ul>
          </div>
          <div className="hero__visual" aria-hidden={loading}>
            {hero.map((p, i) => (
              <Link key={p.id} to={`/products/${p.id}`} className={`float-card float-card--${i}`}>
                <ProductArt product={p} size="sm" />
                <div>
                  <span>{p.title}</span>
                  <Price price={p.price} mrp={p.mrp} discount={0} />
                </div>
              </Link>
            ))}
            <span className="orb orb--1" /><span className="orb orb--2" />
          </div>
        </div>
      </section>

      <div className="container">
        <Reveal className="perks">
          {PERKS.map(({ Icon, title, text }) => (
            <div key={title} className="perk"><Icon /><div><b>{title}</b><span>{text}</span></div></div>
          ))}
        </Reveal>

        <Reveal className="block">
          <SectionHeader eyebrow="Browse" title="Shop by category" />
          <div className="cats">
            {getCategories().map((c) => (
              <Link key={c.slug} to={`/products?category=${c.slug}`} className="cat" style={{ '--h': c.hue }}>
                <span className="cat__emoji">{c.emoji}</span>
                <span>{c.name}</span>
              </Link>
            ))}
            <Link to="/products" className="cat" style={{ '--h': 260 }}>
              <span className="cat__emoji">🛍️</span>
              <span>All products</span>
            </Link>
          </div>
        </Reveal>

        <Reveal className="block deals">
          <div className="deals__head">
            <div>
              <span className="eyebrow eyebrow--light">Flash sale</span>
              <h2>Deals that vanish at midnight</h2>
            </div>
            <div className="timer" aria-label="Time left">
              <span>{h}</span>:<span>{m}</span>:<span>{s}</span>
            </div>
          </div>
          <ProductGrid products={data?.deals ?? []} loading={loading} skeletons={10} />
        </Reveal>

        <Reveal className="block">
          <SectionHeader eyebrow="Popular right now" title="Trending products" linkTo="/products" />
          <ProductGrid products={data?.trending ?? []} loading={loading} skeletons={10} />
        </Reveal>

        <Reveal className="promo-row">
          <Link to="/products?category=electronics" className="promo promo--a">
            <span className="eyebrow eyebrow--light">Tech week</span>
            <h3>Upgrade your gear</h3>
            <p>Earbuds, watches & more from ₹1,799</p>
            <span className="promo__emoji">🎧</span>
          </Link>
          <Link to="/products?category=home" className="promo promo--b">
            <span className="eyebrow eyebrow--light">Home edit</span>
            <h3>Make it feel like home</h3>
            <p>Lighting, décor & comfort</p>
            <span className="promo__emoji">🪴</span>
          </Link>
        </Reveal>

        <Reveal className="block">
          <SectionHeader eyebrow="Customer favourites" title="Top rated" linkTo="/products?sort=rating" />
          <ProductGrid products={data?.topRated ?? []} loading={loading} skeletons={5} />
        </Reveal>

        <Reveal className="block">
          <SectionHeader eyebrow="Just landed" title="New arrivals" linkTo="/products?sort=newest" />
          <ProductGrid products={data?.newArrivals ?? []} loading={loading} skeletons={5} />
        </Reveal>

        <Reveal className="newsletter">
          <h2>Get 15% off your first order</h2>
          <p>Create an account and use code <b>WELCOME15</b> at payment.</p>
          <Link to="/signup" className="btn btn--light btn--lg">Create free account</Link>
        </Reveal>
      </div>
    </>
  )
}
