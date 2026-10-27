import type { QuotaConfig } from './types.js'

export const DEFAULT_NOTIFY_TEXT =
  '哼，今天不聊了，尾鳍没力气了。明天再来找我。（{used}/{limit}，{resetAt} 恢复）'

export const DEFAULT_CONFIG: QuotaConfig = {
  groupDaily: 2_000_000,
  userDaily: 300_000,
  resetAt: '00:00',
  timezone: 'Asia/Shanghai',
  groups: [],
  overLimit: 'notify-once',
  notifyText: DEFAULT_NOTIFY_TEXT,
  admins: [],
}

function nonNegativeNumber(
  value: unknown,
  fallback: number,
  field: string,
): number {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${field} must be a non-negative finite number`)
  }
  return Math.floor(value)
}

function stringArray(value: unknown, fallback: string[], field: string): string[] {
  if (value === undefined) return [...fallback]
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new TypeError(`${field} must be an array of strings`)
  }
  return [...new Set(value.map((item) => item.trim()).filter(Boolean))]
}

export function normalizeConfig(input: Partial<QuotaConfig> = {}): QuotaConfig {
  const resetAt = input.resetAt ?? DEFAULT_CONFIG.resetAt
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(resetAt)) {
    throw new TypeError('resetAt must use HH:mm')
  }

  const timezone = input.timezone ?? DEFAULT_CONFIG.timezone
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date())
  } catch {
    throw new TypeError(`invalid timezone: ${timezone}`)
  }

  const overLimit = input.overLimit ?? DEFAULT_CONFIG.overLimit
  if (overLimit !== 'silent' && overLimit !== 'notify-once') {
    throw new TypeError('overLimit must be silent or notify-once')
  }

  const notifyText = input.notifyText ?? DEFAULT_CONFIG.notifyText
  if (typeof notifyText !== 'string' || notifyText.trim() === '') {
    throw new TypeError('notifyText must be a non-empty string')
  }

  return {
    groupDaily: nonNegativeNumber(
      input.groupDaily,
      DEFAULT_CONFIG.groupDaily,
      'groupDaily',
    ),
    userDaily: nonNegativeNumber(
      input.userDaily,
      DEFAULT_CONFIG.userDaily,
      'userDaily',
    ),
    resetAt,
    timezone,
    groups: stringArray(input.groups, DEFAULT_CONFIG.groups, 'groups'),
    overLimit,
    notifyText,
    admins: stringArray(input.admins, DEFAULT_CONFIG.admins, 'admins'),
  }
}
