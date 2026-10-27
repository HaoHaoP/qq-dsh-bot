import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

export interface QqMemeConfig {
  packsDir?: string
  builtinDir?: string
  cooldownSeconds?: number
}

export interface NormalizedQqMemeConfig {
  packsDir: string
  builtinDir?: string
  indexDbPath: string
  cooldownSeconds: number
}

export const DEFAULT_COOLDOWN_SECONDS = 300

export function dshHome(): string {
  const configured = process.env.DSH_HOME?.trim()
  return configured !== undefined && configured !== ''
    ? resolve(expandHome(configured))
    : join(homedir(), '.dsh')
}

export function expandHome(value: string): string {
  const path = value.trim()
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) {
    return join(homedir(), path.slice(2))
  }
  return path
}

function absolutePath(value: string, cwd: string): string {
  const expanded = expandHome(value)
  return isAbsolute(expanded) ? resolve(expanded) : resolve(cwd, expanded)
}

export function normalizeCooldownSeconds(value: unknown): number {
  const seconds = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(seconds) && seconds >= 0
    ? seconds
    : DEFAULT_COOLDOWN_SECONDS
}

export function normalizeConfig(
  input: QqMemeConfig = {},
): NormalizedQqMemeConfig {
  const cwd = process.cwd()
  const home = dshHome()
  const packsDir = typeof input.packsDir === 'string' && input.packsDir.trim() !== ''
    ? absolutePath(input.packsDir, cwd)
    : join(home, 'meme-packs')
  const builtinDir = typeof input.builtinDir === 'string' && input.builtinDir.trim() !== ''
    ? absolutePath(input.builtinDir, cwd)
    : undefined
  return {
    packsDir,
    builtinDir,
    indexDbPath: join(home, 'qq-meme-pick', 'index.db'),
    cooldownSeconds: normalizeCooldownSeconds(input.cooldownSeconds),
  }
}
