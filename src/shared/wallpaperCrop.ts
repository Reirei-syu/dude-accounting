export interface ContentBounds {
  left: number
  top: number
  right: number
  bottom: number
}

export interface CropViewportState {
  scale: number
  minScale: number
  maxScale: number
  offsetX: number
  offsetY: number
}

export function detectContentBounds(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  alphaThreshold = 8
): ContentBounds {
  let left = width
  let right = -1
  let top = height
  let bottom = -1

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = pixels[(y * width + x) * 4 + 3]
      if (alpha <= alphaThreshold) {
        continue
      }

      left = Math.min(left, x)
      right = Math.max(right, x)
      top = Math.min(top, y)
      bottom = Math.max(bottom, y)
    }
  }

  if (right === -1 || bottom === -1) {
    return {
      left: 0,
      top: 0,
      right: width - 1,
      bottom: height - 1
    }
  }

  return { left, top, right, bottom }
}

export function calculateInitialCropViewport(input: {
  imageWidth: number
  imageHeight: number
  frameWidth: number
  frameHeight: number
  contentBounds: ContentBounds
}): CropViewportState {
  const contentWidth = Math.max(1, input.contentBounds.right - input.contentBounds.left + 1)
  const contentHeight = Math.max(1, input.contentBounds.bottom - input.contentBounds.top + 1)
  const minScale = Math.max(input.frameWidth / contentWidth, input.frameHeight / contentHeight)
  const scale = minScale

  const contentCenterX = input.contentBounds.left + contentWidth / 2
  const contentCenterY = input.contentBounds.top + contentHeight / 2

  return {
    scale,
    minScale,
    maxScale: minScale * 3,
    offsetX: input.frameWidth / 2 - contentCenterX * scale,
    offsetY: input.frameHeight / 2 - contentCenterY * scale
  }
}

export function clampCropViewport(input: {
  viewport: CropViewportState
  frameWidth: number
  frameHeight: number
  contentBounds: ContentBounds
}): CropViewportState {
  const scale = Math.min(Math.max(input.viewport.scale, input.viewport.minScale), input.viewport.maxScale)

  const minOffsetX = input.frameWidth - (input.contentBounds.right + 1) * scale
  const maxOffsetX = -input.contentBounds.left * scale
  const minOffsetY = input.frameHeight - (input.contentBounds.bottom + 1) * scale
  const maxOffsetY = -input.contentBounds.top * scale

  return {
    ...input.viewport,
    scale,
    offsetX: Math.min(Math.max(input.viewport.offsetX, minOffsetX), maxOffsetX),
    offsetY: Math.min(Math.max(input.viewport.offsetY, minOffsetY), maxOffsetY)
  }
}
