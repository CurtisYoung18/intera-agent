import { mergeLocaleMessages } from '../merge'
import { zhBuild } from './build'
import { zhCommon } from './common'
import { zhOperate } from './operate'
import { zhSettings } from './settings'

export const zhSurfaces = {
  common: zhCommon,
  build: zhBuild,
  operate: zhOperate,
  settings: zhSettings,
} as const

export const zh: Record<string, string> = mergeLocaleMessages('zh', zhSurfaces)
