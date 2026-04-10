import os from 'node:os'
import path from 'node:path'
import { getRuntimeUserDataPath, PRODUCT_NAME } from '../services/runtimeAppPaths'

export interface RuntimeContext {
  productName: string
  appDataPath: string
  documentsPath: string
  userDataPath: string
  executablePath: string
  isDevelopment: boolean
  isPackaged: boolean
}

let runtimeContext: RuntimeContext | null = null

function getDefaultAppDataPath(): string {
  if (process.platform === 'win32') {
    return process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
  }

  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support')
  }

  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
}

function getDefaultDocumentsPath(): string {
  if (process.platform === 'win32') {
    const userProfile = process.env.USERPROFILE || os.homedir()
    return path.join(userProfile, 'Documents')
  }

  return path.join(os.homedir(), 'Documents')
}

export function createNodeRuntimeContext(overrides: Partial<RuntimeContext> = {}): RuntimeContext {
  const productName = overrides.productName || PRODUCT_NAME
  const appDataPath = overrides.appDataPath || getDefaultAppDataPath()
  const isDevelopment = overrides.isDevelopment ?? true

  return {
    productName,
    appDataPath,
    documentsPath: overrides.documentsPath || getDefaultDocumentsPath(),
    userDataPath:
      overrides.userDataPath || getRuntimeUserDataPath(appDataPath, isDevelopment, productName),
    executablePath: overrides.executablePath || process.execPath,
    isDevelopment,
    isPackaged: overrides.isPackaged ?? !isDevelopment
  }
}

export function setRuntimeContext(nextContext: RuntimeContext): void {
  runtimeContext = { ...nextContext }
}

export function getRuntimeContext(): RuntimeContext {
  if (!runtimeContext) {
    runtimeContext = createNodeRuntimeContext()
  }

  return runtimeContext
}

export function clearRuntimeContext(): void {
  runtimeContext = null
}
