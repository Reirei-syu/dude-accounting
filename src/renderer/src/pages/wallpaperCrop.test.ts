import { describe, expect, it } from 'vitest'
import { calculateInitialCropViewport, clampCropViewport, detectContentBounds } from './wallpaperCrop'

describe('wallpaper crop helpers', () => {
  it('detects transparent margins and returns the non-empty content bounds', () => {
    const width = 4
    const height = 4
    const pixels = new Uint8ClampedArray(width * height * 4)

    for (let y = 1; y <= 2; y += 1) {
      for (let x = 1; x <= 2; x += 1) {
        const index = (y * width + x) * 4
        pixels[index] = 255
        pixels[index + 1] = 255
        pixels[index + 2] = 255
        pixels[index + 3] = 255
      }
    }

    expect(detectContentBounds(pixels, width, height)).toEqual({
      left: 1,
      top: 1,
      right: 2,
      bottom: 2
    })
  })

  it('falls back to the full image when all pixels are transparent', () => {
    expect(detectContentBounds(new Uint8ClampedArray(4 * 4 * 4), 4, 4)).toEqual({
      left: 0,
      top: 0,
      right: 3,
      bottom: 3
    })
  })

  it('calculates a centered initial viewport that fits non-empty content into the frame', () => {
    const viewport = calculateInitialCropViewport({
      imageWidth: 800,
      imageHeight: 600,
      frameWidth: 320,
      frameHeight: 180,
      contentBounds: {
        left: 100,
        top: 100,
        right: 699,
        bottom: 499
      }
    })

    expect(viewport.minScale).toBeCloseTo(0.5333, 4)
    expect(viewport.scale).toBeCloseTo(viewport.minScale, 4)
    expect(viewport.offsetX).toBeCloseTo(-53.3, 1)
    expect(viewport.offsetY).toBeCloseTo(-70, 1)
  })

  it('clamps panning and zoom to keep content filling the crop frame', () => {
    const clamped = clampCropViewport({
      viewport: {
        scale: 0.2,
        minScale: 0.45,
        maxScale: 1.35,
        offsetX: 1000,
        offsetY: -1000
      },
      frameWidth: 320,
      frameHeight: 180,
      contentBounds: {
        left: 100,
        top: 100,
        right: 699,
        bottom: 499
      }
    })

    expect(clamped.scale).toBe(0.45)
    expect(clamped.offsetX).toBeCloseTo(-45, 1)
    expect(clamped.offsetY).toBeCloseTo(-45, 1)
  })
})
