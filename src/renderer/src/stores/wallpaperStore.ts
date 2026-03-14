import { create } from 'zustand'

export interface WallpaperPreferenceState {
  mode: 'default' | 'custom'
  wallpaperPath: string | null
  wallpaperUrl: string | null
  recommendedResolution: string
  recommendedRatio: string
  maxFileSizeMb: number
  supportedFormats: string[]
}

const defaultWallpaperState: WallpaperPreferenceState = {
  mode: 'default',
  wallpaperPath: null,
  wallpaperUrl: null,
  recommendedResolution: '1920 × 1080 及以上',
  recommendedRatio: '16:9',
  maxFileSizeMb: 10,
  supportedFormats: ['jpg', 'jpeg', 'png', 'webp']
}

interface WallpaperStoreState {
  wallpaper: WallpaperPreferenceState
  setWallpaper: (wallpaper: WallpaperPreferenceState) => void
  resetWallpaper: () => void
}

export const useWallpaperStore = create<WallpaperStoreState>((set) => ({
  wallpaper: defaultWallpaperState,
  setWallpaper: (wallpaper) => set({ wallpaper }),
  resetWallpaper: () => set({ wallpaper: defaultWallpaperState })
}))
