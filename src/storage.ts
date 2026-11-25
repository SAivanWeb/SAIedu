import { lessonsOf, parseLibrary, type Entry } from './course'

export type LibraryChange =
  | { type: 'import' | 'migrate'; entries: Entry[] }
  | { type: 'delete'; id: string }
  | { type: 'progress'; id: string; completed?: string; current?: string; visitedAt?: number }
  | { type: 'section'; id: string; key: string; value: number }
  | { type: 'answer'; id: string; key: string; value: string }
  | { type: 'quiz'; id: string; key: string; value: NonNullable<Entry['quizResults']>[string] }

async function request(change?: LibraryChange) {
  const response = await fetch('/__saiedu/library', {
    cache: 'no-store',
    headers: { 'X-SAIedu-Action': 'library', 'Content-Type': 'application/json' },
    ...(change && { method: 'POST', body: JSON.stringify(change) }),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response
}

export async function readLibrary(): Promise<{ entries: Entry[]; migrationFailed: boolean }> {
  const legacyKey = 'saiedu-library-v1'
  const migratedKey = 'saiedu-library-migrated'
  let migrationFailed = false
  try {
    const saved = localStorage.getItem(legacyKey)
    if (saved && !localStorage.getItem(migratedKey)) {
      const entries = parseLibrary(JSON.parse(saved))
      for (const entry of entries) {
        for (const lesson of lessonsOf(entry.course)) {
          const savedSection = localStorage.getItem(`saiedu-section/${entry.course.id}/${lesson.id}`)
          const position = Number(savedSection)
          if (savedSection !== null && Number.isInteger(position) && position >= 0 && position < lesson.sections.length) {
            (entry.sections ??= Object.create(null))[lesson.id] = position
          }
        }
      }
      if (entries.length) await request({ type: 'migrate', entries })
      localStorage.setItem(migratedKey, '1')
    }
  } catch {
    migrationFailed = true
  }

  return { entries: parseLibrary(await (await request()).json()), migrationFailed }
}

export async function writeLibrary(change: LibraryChange) {
  await request(change)
}
