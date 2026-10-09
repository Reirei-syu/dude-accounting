import type { JSX } from 'react'
import './QueryAmount.css'

export default function QueryAmount({
  amount,
  children
}: {
  amount: number
  children: string
}): JSX.Element {
  return <span className={amount === 0 ? 'query-zero-amount' : undefined}>{children}</span>
}
