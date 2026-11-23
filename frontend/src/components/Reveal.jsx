import { useReveal } from '@/hooks/useReveal'

// Wrap any section to fade/slide it in as it scrolls into view.
export default function Reveal({ children, className = '', as: Tag = 'section' }) {
  const ref = useReveal()
  return <Tag ref={ref} className={`reveal ${className}`}>{children}</Tag>
}
