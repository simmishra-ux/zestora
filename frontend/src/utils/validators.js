export const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)
export const isPhone = (v) => /^[6-9]\d{9}$/.test(v)
export const isPincode = (v) => /^\d{6}$/.test(v)

export function passwordIssues(pw) {
  const issues = []
  if (pw.length < 8) issues.push('at least 8 characters')
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) issues.push('a letter and a number')
  return issues
}

// Shared by Profile and Checkout. Returns an object of { field: message }; empty = valid.
export function validateAddress(a) {
  const e = {}
  if (a.name.trim().length < 2) e.name = 'Enter the recipient name.'
  if (!isPhone(a.phone)) e.phone = 'Enter a valid 10-digit mobile number.'
  if (a.line1.trim().length < 5) e.line1 = 'Enter your full address.'
  if (!a.city.trim()) e.city = 'Required.'
  if (!a.state.trim()) e.state = 'Required.'
  if (!isPincode(a.pincode)) e.pincode = '6-digit pincode.'
  return e
}
