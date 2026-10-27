export type Mood = 'happy' | 'angry' | 'sad' | 'shy' | 'confused' | 'daily'

export const MOOD_TRIGGERS: Readonly<Record<Mood, readonly string[]>> = {
  happy: [
    'happy', 'joy', 'smile', 'laugh', 'like', 'love', 'meow', 'deyi',
    '开心', '高兴', '快乐', '好耶', '喜欢', '比心', '得意', '卖萌', '笑',
  ],
  angry: [
    'angry', 'rage', 'mad', 'fool', 'baka', 'shengqi',
    '生气', '愤怒', '恼火', '火大', '气鼓鼓',
  ],
  sad: [
    'sad', 'cry', 'sigh', 'tear', 'speechless',
    '难过', '伤心', '哭', '委屈', '无语',
  ],
  shy: [
    'shy', 'blush', 'haisiu',
    '害羞', '脸红',
  ],
  confused: [
    'confused', 'confusion', 'surprised', 'surprise', 'question', 'what',
    '困惑', '疑惑', '惊讶', '震惊', '问号',
  ],
  daily: [
    'daily', 'sleep', 'morning', 'work', 'cpu', 'reply', 'ganfan', 'eat',
    '日常', '睡觉', '早安', '早上好', '上班', '摸鱼', '干饭', '吃饭',
  ],
}

export const MOOD_QUERY_ALIASES: Readonly<Record<string, Mood>> = {
  开心: 'happy',
  高兴: 'happy',
  快乐: 'happy',
  好耶: 'happy',
  得意: 'happy',
  卖萌: 'happy',
  喜欢: 'happy',
  比心: 'happy',
  生气: 'angry',
  愤怒: 'angry',
  恼火: 'angry',
  难过: 'sad',
  伤心: 'sad',
  哭: 'sad',
  委屈: 'sad',
  无语: 'sad',
  害羞: 'shy',
  脸红: 'shy',
  困惑: 'confused',
  疑惑: 'confused',
  惊讶: 'confused',
  震惊: 'confused',
  日常: 'daily',
  睡觉: 'daily',
  早上好: 'daily',
  上班: 'daily',
  摸鱼: 'daily',
}

export function splitTerms(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
}

export function inferMoods(text: string): Mood[] {
  const haystack = text.toLowerCase()
  const terms = new Set(splitTerms(haystack))
  const moods: Mood[] = []

  for (const [mood, triggers] of Object.entries(MOOD_TRIGGERS) as [Mood, readonly string[]][]) {
    const matched = triggers.some(trigger => /^[a-z0-9]+$/.test(trigger)
      ? terms.has(trigger)
      : haystack.includes(trigger))
    if (matched) moods.push(mood)
  }
  return moods
}

export function normalizeMoodQuery(value: string): string {
  const normalized = value.trim().toLowerCase()
  if (normalized === '') return ''
  return MOOD_QUERY_ALIASES[normalized] ?? normalized
}
