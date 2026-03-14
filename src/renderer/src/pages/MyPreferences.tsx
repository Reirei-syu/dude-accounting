import { useEffect, useRef, useState, type JSX } from 'react'

import wallpaper from '../assets/wallpaper.png'
import { useLedgerStore } from '../stores/ledgerStore'
import { HOME_TAB_PRESETS } from '../stores/uiStore'
import { useWallpaperStore } from '../stores/wallpaperStore'
import {
  calculateInitialCropViewport,
  clampCropViewport,
  detectContentBounds,
  type ContentBounds,
  type CropViewportState
} from './wallpaperCrop'

const CROP_FRAME_WIDTH = 640
const CROP_FRAME_HEIGHT = 360
const OUTPUT_WIDTH = 1920
const OUTPUT_HEIGHT = 1080

interface CropDialogState {
  sourcePath: string
  sourceDataUrl: string
  extension: string
}

interface CropImageState {
  naturalWidth: number
  naturalHeight: number
  contentBounds: ContentBounds
  initialViewport: CropViewportState
}

function getCanvasMimeType(extension: string): string {
  const normalizedExtension = extension.toLowerCase()
  if (normalizedExtension === 'jpg' || normalizedExtension === 'jpeg') {
    return 'image/jpeg'
  }
  if (normalizedExtension === 'webp') {
    return 'image/webp'
  }
  return 'image/png'
}

export default function MyPreferences(): JSX.Element {
  const ledgers = useLedgerStore((state) => state.ledgers)
  const wallpaperState = useWallpaperStore((state) => state.wallpaper)
  const setWallpaper = useWallpaperStore((state) => state.setWallpaper)
  const [defaultLedgerId, setDefaultLedgerId] = useState('')
  const [defaultHomeTab, setDefaultHomeTab] = useState('voucher-entry')
  const [saving, setSaving] = useState(false)
  const [wallpaperBusy, setWallpaperBusy] = useState(false)
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)
  const [cropDialog, setCropDialog] = useState<CropDialogState | null>(null)
  const [cropImageState, setCropImageState] = useState<CropImageState | null>(null)
  const [cropViewport, setCropViewport] = useState<CropViewportState | null>(null)
  const [cropLoading, setCropLoading] = useState(false)
  const [cropSaving, setCropSaving] = useState(false)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    originOffsetX: number
    originOffsetY: number
  } | null>(null)

  useEffect(() => {
    if (!window.electron) return

    Promise.all([window.api.settings.getUserPreferences(), window.api.settings.getWallpaperState()])
      .then(([preferences, nextWallpaperState]) => {
        setDefaultLedgerId(preferences.default_ledger_id ?? '')
        setDefaultHomeTab(preferences.default_home_tab ?? 'voucher-entry')
        setWallpaper(nextWallpaperState)
      })
      .catch((error) => {
        setMessage({
          type: 'error',
          text: error instanceof Error ? error.message : '加载个人偏好失败'
        })
      })
  }, [setWallpaper])

  useEffect(() => {
    if (!cropDialog) {
      setCropImageState(null)
      setCropViewport(null)
      setCropLoading(false)
      return
    }

    let cancelled = false
    setCropLoading(true)

    const image = new Image()
    image.onload = () => {
      if (cancelled) return

      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const context = canvas.getContext('2d')
      if (!context) {
        setMessage({ type: 'error', text: '初始化裁切工具失败' })
        setCropLoading(false)
        return
      }

      context.drawImage(image, 0, 0)
      const imageData = context.getImageData(0, 0, canvas.width, canvas.height)
      const contentBounds = detectContentBounds(imageData.data, canvas.width, canvas.height)
      const initialViewport = calculateInitialCropViewport({
        imageWidth: canvas.width,
        imageHeight: canvas.height,
        frameWidth: CROP_FRAME_WIDTH,
        frameHeight: CROP_FRAME_HEIGHT,
        contentBounds
      })

      setCropImageState({
        naturalWidth: canvas.width,
        naturalHeight: canvas.height,
        contentBounds,
        initialViewport
      })
      setCropViewport(initialViewport)
      setCropLoading(false)
    }
    image.onerror = () => {
      if (cancelled) return
      setMessage({
        type: 'error',
        text: `读取图片失败：浏览器无法解码所选 ${cropDialog.extension.toUpperCase()} 图片，可能是图片已损坏、格式异常或文件内容为空。`
      })
      setCropDialog(null)
      setCropLoading(false)
    }
    image.src = cropDialog.sourceDataUrl

    return () => {
      cancelled = true
    }
  }, [cropDialog])

  const handleSave = async (): Promise<void> => {
    setMessage(null)
    if (!window.electron) {
      setMessage({ type: 'error', text: '浏览器预览模式不支持保存个人偏好' })
      return
    }

    setSaving(true)
    try {
      await window.api.settings.setUserPreferences({
        default_ledger_id: defaultLedgerId,
        default_home_tab: defaultHomeTab
      })
      setMessage({ type: 'success', text: '个人偏好已更新' })
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '保存个人偏好失败'
      })
    } finally {
      setSaving(false)
    }
  }

  const handleChooseWallpaper = async (): Promise<void> => {
    setMessage(null)
    if (!window.electron) {
      setMessage({ type: 'error', text: '浏览器预览模式不支持上传壁纸' })
      return
    }

    setWallpaperBusy(true)
    try {
      const result = await window.api.settings.chooseWallpaper()
      if (result.cancelled) return
      if (!result.success || !result.sourcePath || !result.sourceDataUrl || !result.extension) {
        setMessage({ type: 'error', text: result.error || '选择壁纸失败' })
        return
      }

      setCropDialog({
        sourcePath: result.sourcePath,
        sourceDataUrl: result.sourceDataUrl,
        extension: result.extension
      })
    } finally {
      setWallpaperBusy(false)
    }
  }

  const handleRestoreDefaultWallpaper = async (): Promise<void> => {
    setMessage(null)
    if (!window.electron) {
      setMessage({ type: 'error', text: '浏览器预览模式不支持恢复默认壁纸' })
      return
    }

    setWallpaperBusy(true)
    try {
      const result = await window.api.settings.restoreDefaultWallpaper()
      if (!result.success || !result.state) {
        setMessage({ type: 'error', text: result.error || '恢复默认壁纸失败' })
        return
      }

      setWallpaper(result.state)
      setMessage({ type: 'success', text: '默认壁纸已恢复并立即生效。' })
    } finally {
      setWallpaperBusy(false)
    }
  }

  const resetCropViewport = (): void => {
    if (!cropImageState) return
    setCropViewport(cropImageState.initialViewport)
  }

  const handleCropPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!cropViewport) return
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originOffsetX: cropViewport.offsetX,
      originOffsetY: cropViewport.offsetY
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handleCropPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!cropViewport || !cropImageState || !dragRef.current) return

    const nextViewport = clampCropViewport({
      viewport: {
        ...cropViewport,
        offsetX: dragRef.current.originOffsetX + (event.clientX - dragRef.current.startX),
        offsetY: dragRef.current.originOffsetY + (event.clientY - dragRef.current.startY)
      },
      frameWidth: CROP_FRAME_WIDTH,
      frameHeight: CROP_FRAME_HEIGHT,
      contentBounds: cropImageState.contentBounds
    })

    setCropViewport(nextViewport)
  }

  const handleCropPointerUp = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const handleZoomChange = (nextScale: number): void => {
    if (!cropViewport || !cropImageState) return

    setCropViewport(
      clampCropViewport({
        viewport: {
          ...cropViewport,
          scale: nextScale
        },
        frameWidth: CROP_FRAME_WIDTH,
        frameHeight: CROP_FRAME_HEIGHT,
        contentBounds: cropImageState.contentBounds
      })
    )
  }

  const handleApplyCrop = async (): Promise<void> => {
    if (!window.electron || !cropDialog || !cropViewport || !imageRef.current) {
      return
    }

    setCropSaving(true)
    setMessage(null)
    try {
      const canvas = document.createElement('canvas')
      canvas.width = OUTPUT_WIDTH
      canvas.height = OUTPUT_HEIGHT
      const context = canvas.getContext('2d')
      if (!context) {
        throw new Error('初始化裁切画布失败')
      }

      const sourceX = Math.max(0, -cropViewport.offsetX / cropViewport.scale)
      const sourceY = Math.max(0, -cropViewport.offsetY / cropViewport.scale)
      const sourceWidth = CROP_FRAME_WIDTH / cropViewport.scale
      const sourceHeight = CROP_FRAME_HEIGHT / cropViewport.scale

      if (cropDialog.extension === 'jpg' || cropDialog.extension === 'jpeg') {
        context.fillStyle = '#ffffff'
        context.fillRect(0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT)
      }

      context.drawImage(
        imageRef.current,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        0,
        0,
        OUTPUT_WIDTH,
        OUTPUT_HEIGHT
      )

      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, getCanvasMimeType(cropDialog.extension), 0.92)
      })

      if (!blob) {
        throw new Error('导出裁切图片失败')
      }

      const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()))
      const result = await window.api.settings.applyWallpaperCrop({
        extension: cropDialog.extension,
        bytes,
        sourcePath: cropDialog.sourcePath
      })

      if (!result.success || !result.state) {
        setMessage({ type: 'error', text: result.error || '应用裁切壁纸失败' })
        return
      }

      setWallpaper(result.state)
      setCropDialog(null)
      setMessage({ type: 'success', text: '自定义壁纸已裁切并生效。' })
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '应用裁切壁纸失败'
      })
    } finally {
      setCropSaving(false)
    }
  }

  const currentWallpaperUrl = wallpaperState.wallpaperUrl ?? wallpaper

  return (
    <div className="h-full flex flex-col p-4 gap-4">
      <h2 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
        我的偏好
      </h2>

      <div className="glass-panel-light p-4 flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <div className="text-base" style={{ color: 'var(--color-text-primary)' }}>
            默认账套
          </div>
          <div className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            登录后优先进入该账套；若账套未授权或已失效，将自动回退到首个可访问账套。
          </div>
          <select
            className="glass-input"
            value={defaultLedgerId}
            onChange={(event) => setDefaultLedgerId(event.target.value)}
          >
            <option value="">跟随首个可访问账套</option>
            {ledgers.map((ledger) => (
              <option key={ledger.id} value={String(ledger.id)}>
                {ledger.name}（{ledger.standard_type === 'npo' ? '民非' : '企业'}）
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-2">
          <div className="text-base" style={{ color: 'var(--color-text-primary)' }}>
            默认首页
          </div>
          <div className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            登录成功后，如果当前没有打开中的工作标签，则自动打开这里配置的首页。
          </div>
          <select
            className="glass-input"
            value={defaultHomeTab}
            onChange={(event) => setDefaultHomeTab(event.target.value)}
          >
            {HOME_TAB_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.title}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="glass-panel-light p-4 flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="text-base" style={{ color: 'var(--color-text-primary)' }}>
              壁纸替换
            </div>
            <div className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
              当前壁纸会同步应用到登录页和主界面。默认动画风格壁纸会永久保留，可随时恢复。
            </div>
          </div>
          <div className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            当前使用：{wallpaperState.mode === 'custom' ? '自定义壁纸' : '默认壁纸'}
          </div>
        </div>

        <div
          className="rounded-2xl border overflow-hidden"
          style={{ borderColor: 'var(--color-glass-border-light)' }}
        >
          <div
            style={{
              minHeight: 220,
              backgroundImage: `url(${currentWallpaperUrl})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center'
            }}
          >
            <div
              className="h-full min-h-[220px] flex items-end p-4"
              style={{ background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.08), rgba(15, 23, 42, 0.42))' }}
            >
              <div
                className="glass-panel-light px-4 py-3 max-w-lg"
                style={{ background: 'rgba(255, 255, 255, 0.78)' }}
              >
                <div className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                  壁纸预览
                </div>
                <div className="text-xs mt-1" style={{ color: 'var(--color-text-secondary)' }}>
                  预览区域保留现有玻璃态遮罩，实际登录页与主界面也会保持相同的可读性策略。
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="glass-panel-light p-3">
            <div className="text-sm font-semibold mb-1" style={{ color: 'var(--color-text-primary)' }}>
              上传建议
            </div>
            <div className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              推荐分辨率：{wallpaperState.recommendedResolution}
            </div>
            <div className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              推荐比例：{wallpaperState.recommendedRatio}
            </div>
            <div className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              过小图片可能被拉伸模糊
            </div>
          </div>

          <div className="glass-panel-light p-3">
            <div className="text-sm font-semibold mb-1" style={{ color: 'var(--color-text-primary)' }}>
              文件规则
            </div>
            <div className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              支持格式：{wallpaperState.supportedFormats.join(' / ')}
            </div>
            <div className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              大小上限：{wallpaperState.maxFileSizeMb}MB
            </div>
            <div className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              每个用户仅保留当前 1 张自定义壁纸，新上传会覆盖旧文件
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <button
            className="glass-btn-secondary px-5 py-2"
            onClick={() => void handleChooseWallpaper()}
            disabled={wallpaperBusy}
          >
            {wallpaperBusy ? '处理中...' : '选择图片'}
          </button>
          <button
            className="glass-btn-secondary px-5 py-2"
            onClick={() => void handleRestoreDefaultWallpaper()}
            disabled={wallpaperBusy || wallpaperState.mode === 'default'}
          >
            恢复默认壁纸
          </button>
        </div>
      </div>

      <div>
        <button
          className="glass-btn-secondary px-6 py-2"
          onClick={() => void handleSave()}
          disabled={saving}
        >
          {saving ? '保存中...' : '保存'}
        </button>
      </div>

      {message && (
        <div
          className="text-sm px-1"
          aria-live="polite"
          style={{
            color: message.type === 'error' ? 'var(--color-danger)' : 'var(--color-success)'
          }}
        >
          {message.text}
        </div>
      )}

      {cropDialog && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center px-4"
          style={{ background: 'rgba(15, 23, 42, 0.36)' }}
        >
          <div className="glass-panel w-full max-w-5xl p-5 flex flex-col gap-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                  裁切壁纸
                </h3>
                <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                  裁切框固定为 16:9。若图片四周存在透明空白区域，系统会自动贴合到有内容的范围。
                </p>
              </div>
              <button
                type="button"
                className="glass-btn-secondary px-3 py-1 text-xs"
                onClick={() => setCropDialog(null)}
                disabled={cropSaving}
              >
                关闭
              </button>
            </div>

            <div className="flex gap-5 flex-wrap">
              <div className="flex-1 min-w-[640px]">
                <div
                  className="relative overflow-hidden rounded-2xl border bg-slate-950/80 select-none"
                  style={{
                    width: CROP_FRAME_WIDTH,
                    height: CROP_FRAME_HEIGHT,
                    borderColor: 'var(--color-glass-border-light)',
                    cursor: dragRef.current ? 'grabbing' : 'grab'
                  }}
                  onPointerDown={handleCropPointerDown}
                  onPointerMove={handleCropPointerMove}
                  onPointerUp={handleCropPointerUp}
                  onPointerCancel={handleCropPointerUp}
                >
                  {cropDialog && cropViewport && (
                    <img
                      ref={imageRef}
                      src={cropDialog.sourceDataUrl}
                      alt="壁纸裁切预览"
                      draggable={false}
                      className="absolute top-0 left-0 pointer-events-none"
                      style={{
                        width: cropImageState?.naturalWidth ?? 'auto',
                        height: cropImageState?.naturalHeight ?? 'auto',
                        transform: `translate(${cropViewport.offsetX}px, ${cropViewport.offsetY}px) scale(${cropViewport.scale})`,
                        transformOrigin: 'top left',
                        maxWidth: 'none',
                        maxHeight: 'none'
                      }}
                    />
                  )}

                  <div className="absolute inset-0 pointer-events-none border border-white/55 rounded-2xl shadow-[inset_0_0_0_9999px_rgba(15,23,42,0.16)]" />

                  {cropLoading && (
                    <div className="absolute inset-0 flex items-center justify-center text-sm text-white/85">
                      正在分析图片内容范围...
                    </div>
                  )}
                </div>
              </div>

              <div className="flex-1 min-w-[280px] flex flex-col gap-4">
                <div className="glass-panel-light p-4">
                  <div className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text-primary)' }}>
                    裁切建议
                  </div>
                  <div className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                    输出分辨率：{OUTPUT_WIDTH} × {OUTPUT_HEIGHT}
                  </div>
                  <div className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                    输出比例：16:9
                  </div>
                  <div className="text-sm mt-2" style={{ color: 'var(--color-text-secondary)' }}>
                    拖动画面可调整取景，缩放滑杆可放大或缩小画面。系统已自动把透明空白边缘裁掉。
                  </div>
                </div>

                <div className="glass-panel-light p-4 flex flex-col gap-3">
                  <label className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                    缩放
                  </label>
                  <input
                    type="range"
                    min={cropViewport?.minScale ?? 1}
                    max={cropViewport?.maxScale ?? 1}
                    step={0.01}
                    value={cropViewport?.scale ?? 1}
                    onChange={(event) => handleZoomChange(Number(event.target.value))}
                    disabled={!cropViewport || cropLoading || cropSaving}
                  />
                  <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    当前缩放：{cropViewport ? `${cropViewport.scale.toFixed(2)}x` : '--'}
                  </div>
                </div>

                <div className="flex items-center gap-3 flex-wrap">
                  <button
                    type="button"
                    className="glass-btn-secondary px-4 py-2"
                    onClick={resetCropViewport}
                    disabled={!cropImageState || cropLoading || cropSaving}
                  >
                    重置裁切
                  </button>
                  <button
                    type="button"
                    className="glass-btn-secondary px-4 py-2"
                    onClick={() => void handleApplyCrop()}
                    disabled={!cropViewport || cropLoading || cropSaving}
                  >
                    {cropSaving ? '保存中...' : '应用裁切'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
