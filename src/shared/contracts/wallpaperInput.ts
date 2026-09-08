import type { CropViewportState } from '../wallpaperCrop'

export type WallpaperApplyInput =
  | {
      sourcePath: string
      extension?: string
      viewport?: Partial<CropViewportState>
      useSuggestedViewport?: boolean
    }
  | { extension: string; bytes: number[]; sourcePath?: string }
