import EmptyState from '@/components/EmptyState'

export default function NotFound() {
  return <div className="container"><EmptyState emoji="🧭" title="Page not found" text="The page you’re looking for doesn’t exist." actionLabel="Back to home" to="/" /></div>
}
