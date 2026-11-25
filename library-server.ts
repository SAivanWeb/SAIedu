import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { parseLibrary, type Entry } from './src/course'
import type { LibraryChange } from './src/storage'

function applyChange(entries: Entry[], change: LibraryChange) {
  if (change.type === 'import' || change.type === 'migrate') {
    for (const incoming of parseLibrary(change.entries)) {
      const existing = entries.find(entry => entry.course.id === incoming.course.id)
      if (!existing) entries.push(incoming)
      else if (change.type === 'migrate') {
        existing.completed = [...new Set([...existing.completed, ...incoming.completed])]
        existing.sections = { ...incoming.sections, ...existing.sections }
        existing.answers = { ...incoming.answers, ...existing.answers }
        existing.quizResults = { ...incoming.quizResults, ...existing.quizResults }
        if ((incoming.visitedAt ?? 0) > (existing.visitedAt ?? 0)) {
          existing.current = incoming.current
          existing.visitedAt = incoming.visitedAt
        }
      }
    }
    return entries
  }

  if (change.type === 'delete') return entries.filter(entry => entry.course.id !== change.id)
  if (change.type !== 'section' && change.type !== 'progress' && change.type !== 'answer' && change.type !== 'quiz') throw new Error('Unknown change')
  const entry = entries.find(entry => entry.course.id === change.id)
  if (!entry) return null

  if (change.type === 'progress') {
    if (change.completed) entry.completed.push(change.completed)
    if (change.current && (change.visitedAt ?? 0) >= (entry.visitedAt ?? 0)) {
      entry.current = change.current
      entry.visitedAt = change.visitedAt
    }
  } else if (change.type === 'section') {
    entry.sections = { ...entry.sections, [change.key]: change.value }
  } else if (change.type === 'answer') {
    entry.answers = { ...entry.answers, [change.key]: change.value }
  } else {
    entry.quizResults = { ...entry.quizResults, [change.key]: change.value }
  }
  return entries
}

export function localLibrary(): Plugin {
  let directory: string
  async function handle(request: IncomingMessage, response: ServerResponse) {
    const file = resolve(directory, 'library.json')
    response.setHeader('Cache-Control', 'no-store')
    const host = request.headers.host ?? ''
    const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress ?? '')
    const origin = request.headers.origin
    if (!local || !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)
      || (origin && origin !== `http://${host}`) || request.headers['x-saiedu-action'] !== 'library') {
      response.writeHead(403).end()
      return
    }

    let change: LibraryChange | undefined
    if (request.method === 'POST') {
      try {
        const chunks: Buffer[] = []
        let size = 0
        for await (const chunk of request) {
          size += chunk.length
          if (size > 64 * 1024 * 1024) {
            response.writeHead(413).end()
            return
          }
          chunks.push(chunk)
        }
        change = JSON.parse(Buffer.concat(chunks).toString())
        if (!change || typeof change.type !== 'string') throw new Error('Invalid change')
      } catch {
        response.writeHead(400).end()
        return
      }
    } else if (request.method !== 'GET') {
      response.writeHead(405, { Allow: 'GET, POST' }).end()
      return
    }

    let entries: Entry[] = []
    try {
      try {
        entries = parseLibrary(JSON.parse(readFileSync(file, 'utf8')))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      if (change) {
        const updated = applyChange(entries, change)
        if (!updated) {
          response.writeHead(409).end()
          return
        }
        mkdirSync(directory, { recursive: true })
        const temporary = resolve(directory, 'library.json.tmp')
        writeFileSync(temporary, JSON.stringify(parseLibrary(updated)))
        renameSync(temporary, file)
        response.writeHead(204).end()
        return
      }
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(entries))
    } catch (error) {
      console.error('Ошибка библиотеки SAIedu:', error)
      response.writeHead(500).end()
    }
  }

  function middleware(request: IncomingMessage, response: ServerResponse, next: () => void) {
    if (request.url !== '/__saiedu/library') return next()
    void handle(request, response)
  }

  return {
    name: 'saiedu-local-library',
    configResolved(config) {
      directory = process.env.SAIEDU_DATA_DIRECTORY ?? resolve(config.root, 'data')
    },
    configureServer(server) { server.middlewares.use(middleware) },
    configurePreviewServer(server) { server.middlewares.use(middleware) },
  }
}
