import { mergeLocaleMessages } from '../merge'
import { enBuild } from './build'
import { enCommon } from './common'
import { enOperate } from './operate'
import { enSettings } from './settings'

export const enSurfaces = {
  common: enCommon,
  build: enBuild,
  operate: enOperate,
  settings: enSettings,
} as const

export const en: Record<string, string> = mergeLocaleMessages('en', enSurfaces)
