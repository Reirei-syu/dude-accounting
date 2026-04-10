import path from 'node:path'

export const PRODUCT_NAME = 'dude-app'
export const DEV_USER_DATA_DIR_NAME = 'dude-app-dev'

export function getPackagedUserDataPath(
  appDataPath: string,
  productName: string = PRODUCT_NAME
): string {
  return path.join(appDataPath, productName)
}

export function getRuntimeUserDataPath(
  appDataPath: string,
  isDevelopment: boolean,
  productName: string = PRODUCT_NAME
): string {
  if (isDevelopment) {
    return path.join(appDataPath, DEV_USER_DATA_DIR_NAME)
  }

  return getPackagedUserDataPath(appDataPath, productName)
}
