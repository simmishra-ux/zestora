import { useId } from 'react'

// Label + input + error message wired together for accessibility (htmlFor / aria-describedby).
export default function Field({ label, error, hint, as: Tag = 'input', ...props }) {
  const id = useId()
  return (
    <div className={`field ${error ? 'field--error' : ''}`}>
      <label htmlFor={id}>{label}</label>
      <Tag id={id} aria-invalid={!!error} aria-describedby={error || hint ? `${id}-msg` : undefined} {...props} />
      {(error || hint) && <small id={`${id}-msg`}>{error || hint}</small>}
    </div>
  )
}
