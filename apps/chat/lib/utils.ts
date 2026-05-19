import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function generateCaseId(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const rand =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID().split('-')[0]
      : Math.random().toString(36).slice(2, 10)
  return `case_${date}_${rand}`
}
