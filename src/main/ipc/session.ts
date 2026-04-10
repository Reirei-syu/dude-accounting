import type { IpcMainInvokeEvent } from 'electron'
import type Database from 'better-sqlite3'
import {
  requireCommandActor,
  requireCommandAdmin,
  requireCommandLedgerAccess,
  requireCommandPermission
} from '../commands/authz'
import type { CommandActor, PermissionKey } from '../commands/types'

export type SessionUser = CommandActor

const senderSessionMap = new Map<number, SessionUser>()
const senderCleanupBoundSet = new Set<number>()

interface SessionSenderLike {
  id: number
  once: (eventName: 'destroyed', listener: () => void) => void
}

function clearSessionBySenderId(senderId: number): void {
  senderSessionMap.delete(senderId)
}

function cleanupSessionBySenderId(senderId: number): void {
  clearSessionBySenderId(senderId)
  senderCleanupBoundSet.delete(senderId)
}

export function setSessionByEvent(event: IpcMainInvokeEvent, user: SessionUser): void {
  setSessionBySender(event.sender, user)
}

export function setSessionBySender(sender: SessionSenderLike, user: SessionUser): void {
  const senderId = sender.id
  senderSessionMap.set(senderId, user)

  if (!senderCleanupBoundSet.has(senderId)) {
    senderCleanupBoundSet.add(senderId)
    sender.once('destroyed', () => {
      cleanupSessionBySenderId(senderId)
    })
  }
}

export function clearSessionByEvent(event: IpcMainInvokeEvent): void {
  clearSessionBySenderId(event.sender.id)
}

export function getSessionByEvent(event: IpcMainInvokeEvent): SessionUser | null {
  return senderSessionMap.get(event.sender.id) || null
}

export function requireAuth(event: IpcMainInvokeEvent): SessionUser {
  return requireCommandActor(getSessionByEvent(event))
}

export function requireAdmin(event: IpcMainInvokeEvent): SessionUser {
  return requireCommandAdmin(getSessionByEvent(event))
}

export function requirePermission(
  event: IpcMainInvokeEvent,
  permission: PermissionKey
): SessionUser {
  return requireCommandPermission(getSessionByEvent(event), permission)
}

export function requireLedgerAccess(
  event: IpcMainInvokeEvent,
  db: Pick<Database.Database, 'prepare'>,
  ledgerId: number
): SessionUser {
  return requireCommandLedgerAccess(db, getSessionByEvent(event), ledgerId)
}
