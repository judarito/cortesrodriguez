export function fromMinorUnits(amountCents) {
  return Number(amountCents || 0) / 100
}

export function toMinorUnits(amount) {
  const value = Number(amount)
  if (!Number.isFinite(value) || value < 0) return NaN
  return Math.round((value + Number.EPSILON) * 100)
}
