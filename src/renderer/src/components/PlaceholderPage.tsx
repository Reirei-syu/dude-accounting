import type { JSX } from 'react'

interface Props {
  title: string
  componentType: string
}

export default function PlaceholderPage({ title, componentType }: Props): JSX.Element {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-4">
      <h2 className="text-2xl font-semibold" style={{ color: 'var(--color-text-primary)' }}>
        {title}
      </h2>
      <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
        组件: {componentType}，该模块入口已接入，可在此基础上继续扩展业务逻辑
      </p>
    </div>
  )
}
