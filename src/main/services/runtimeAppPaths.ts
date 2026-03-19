import path from 'node:path'

export const DEV_USER_DATA_DIR_NAME = 'dude-app-dev'

export function getRuntimeUserDataPath(appDataPath: string, isDevelopment: boolean): string | null {
  if (!isDevelopment) {
    return null
  }

  return path.join(appDataPath, DEV_USER_DATA_DIR_NAME)
}
