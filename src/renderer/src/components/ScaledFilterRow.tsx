import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type ReactNode
} from 'react'

interface ScaledFilterRowProps {
  children: ReactNode
  className?: string
}

interface RowMetrics {
  scale: number
  height: number
}

export default function ScaledFilterRow({
  children,
  className = ''
}: ScaledFilterRowProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const [metrics, setMetrics] = useState<RowMetrics>({ scale: 1, height: 40 })

  useLayoutEffect(() => {
    let frameId = 0

    const updateMetrics = (): void => {
      const container = containerRef.current
      const content = contentRef.current
      if (!container || !content) {
        return
      }

      const availableWidth = container.clientWidth
      const contentWidth = content.scrollWidth
      const contentHeight = content.scrollHeight
      const nextScale =
        availableWidth > 0 && contentWidth > availableWidth ? availableWidth / contentWidth : 1
      const nextHeight = Math.max(1, Math.ceil(contentHeight * nextScale))

      setMetrics((current) => {
        if (
          Math.abs(current.scale - nextScale) < 0.001 &&
          Math.abs(current.height - nextHeight) < 1
        ) {
          return current
        }

        return {
          scale: nextScale,
          height: nextHeight
        }
      })
    }

    const scheduleUpdate = (): void => {
      if (frameId) {
        cancelAnimationFrame(frameId)
      }
      frameId = window.requestAnimationFrame(updateMetrics)
    }

    scheduleUpdate()

    const resizeObserver = new ResizeObserver(scheduleUpdate)
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current)
    }
    if (contentRef.current) {
      resizeObserver.observe(contentRef.current)
    }

    window.addEventListener('resize', scheduleUpdate)

    return () => {
      if (frameId) {
        cancelAnimationFrame(frameId)
      }
      resizeObserver.disconnect()
      window.removeEventListener('resize', scheduleUpdate)
    }
  }, [children])

  const contentStyle: CSSProperties = {
    transform: `scale(${metrics.scale})`,
    transformOrigin: 'left top'
  }

  return (
    <div
      ref={containerRef}
      className={`w-full overflow-hidden ${className}`.trim()}
      style={{ minHeight: `${metrics.height}px` }}
    >
      <div
        ref={contentRef}
        className="inline-flex min-w-max flex-nowrap items-center gap-3"
        style={contentStyle}
      >
        {children}
      </div>
    </div>
  )
}
