import fs from 'node:fs'
import { nativeImage } from 'electron'
import {
  calculateInitialCropViewport,
  clampCropViewport,
  detectContentBounds,
  type ContentBounds,
  type CropViewportState
} from '../../shared/wallpaperCrop'
import {
  WALLPAPER_CROP_OUTPUT_HEIGHT,
  WALLPAPER_CROP_OUTPUT_WIDTH,
  validateWallpaperSourceFile
} from './wallpaperPreference'

const CROP_FRAME_WIDTH = 640
const CROP_FRAME_HEIGHT = 360

export interface WallpaperAnalyzeResult {
  sourcePath: string
  extension: string
  naturalWidth: number
  naturalHeight: number
  contentBounds: ContentBounds
  suggestedViewport: CropViewportState
  outputWidth: number
  outputHeight: number
}

function loadSourceImage(sourcePath: string) {
  const image = nativeImage.createFromPath(sourcePath)
  if (image.isEmpty()) {
    throw new Error('读取图片失败，文件可能已损坏或格式不受支持')
  }
  return image
}

export function analyzeWallpaperSource(sourcePath: string): WallpaperAnalyzeResult {
  const extension = validateWallpaperSourceFile(sourcePath)
  const image = loadSourceImage(sourcePath)
  const { width, height } = image.getSize()
  const bitmap = image.toBitmap()
  const pixels = new Uint8ClampedArray(bitmap.buffer, bitmap.byteOffset, bitmap.byteLength)
  const contentBounds = detectContentBounds(pixels, width, height)
  const suggestedViewport = calculateInitialCropViewport({
    imageWidth: width,
    imageHeight: height,
    frameWidth: CROP_FRAME_WIDTH,
    frameHeight: CROP_FRAME_HEIGHT,
    contentBounds
  })

  return {
    sourcePath,
    extension,
    naturalWidth: width,
    naturalHeight: height,
    contentBounds,
    suggestedViewport,
    outputWidth: WALLPAPER_CROP_OUTPUT_WIDTH,
    outputHeight: WALLPAPER_CROP_OUTPUT_HEIGHT
  }
}

export function renderWallpaperCrop(input: {
  sourcePath: string
  extension?: string
  viewport?: Partial<CropViewportState>
  useSuggestedViewport?: boolean
}): {
  bytes: Buffer
  appliedExtension: string
  analysis: WallpaperAnalyzeResult
  viewport: CropViewportState
} {
  const analysis = analyzeWallpaperSource(input.sourcePath)
  const image = loadSourceImage(input.sourcePath)

  const nextViewport = clampCropViewport({
    viewport: input.useSuggestedViewport || !input.viewport
      ? analysis.suggestedViewport
      : {
          ...analysis.suggestedViewport,
          ...input.viewport
        },
    frameWidth: CROP_FRAME_WIDTH,
    frameHeight: CROP_FRAME_HEIGHT,
    contentBounds: analysis.contentBounds
  })

  const sourceX = Math.max(0, -nextViewport.offsetX / nextViewport.scale)
  const sourceY = Math.max(0, -nextViewport.offsetY / nextViewport.scale)
  const sourceWidth = CROP_FRAME_WIDTH / nextViewport.scale
  const sourceHeight = CROP_FRAME_HEIGHT / nextViewport.scale

  const croppedImage = image
    .crop({
      x: Math.round(sourceX),
      y: Math.round(sourceY),
      width: Math.max(1, Math.round(sourceWidth)),
      height: Math.max(1, Math.round(sourceHeight))
    })
    .resize({
      width: WALLPAPER_CROP_OUTPUT_WIDTH,
      height: WALLPAPER_CROP_OUTPUT_HEIGHT,
      quality: 'best'
    })

  const preferredExtension = (input.extension || analysis.extension).trim().toLowerCase()
  const shouldUseJpeg = preferredExtension === 'jpg' || preferredExtension === 'jpeg'
  const bytes = shouldUseJpeg ? croppedImage.toJPEG(92) : croppedImage.toPNG()

  return {
    bytes,
    appliedExtension: shouldUseJpeg ? 'jpg' : 'png',
    analysis,
    viewport: nextViewport
  }
}

export function readWallpaperSourceAsDataUrl(sourcePath: string, extension: string): string {
  const normalizedExtension = extension.toLowerCase()
  const mimeType =
    normalizedExtension === 'jpg' || normalizedExtension === 'jpeg'
      ? 'image/jpeg'
      : normalizedExtension === 'webp'
        ? 'image/webp'
        : 'image/png'

  return `data:${mimeType};base64,${fs.readFileSync(sourcePath).toString('base64')}`
}
