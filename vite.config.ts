import { readFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { localLibrary } from './library-server'
import vue from '@vitejs/plugin-vue'
import { defineConfig, type Plugin } from 'vite'

const loopbackHost = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/
const loopbackClients = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

function localControl(): Plugin {
  const statusFile = process.env.SAIEDU_UPDATE_STATUS
  const managed = Boolean(statusFile && process.send)
  let requestedUpdate: string | undefined
  let shutdownScheduled = false

  function middleware(stop: () => void) {
    return (request: IncomingMessage, response: ServerResponse, next: () => void) => {
      const action = request.url === '/__saiedu/stop' ? 'stop'
        : request.url === '/__saiedu/update' ? 'update' : undefined
      if (!action) return next()

      response.setHeader('Cache-Control', 'no-store')
      const host = request.headers.host ?? ''
      const origin = request.headers.origin
      const sameOrigin = origin ? origin === `http://${host}` : request.headers['sec-fetch-site'] === 'same-origin'
      if (!loopbackClients.has(request.socket.remoteAddress ?? '') || !loopbackHost.test(host)
        || request.headers['x-saiedu-action'] !== action
        || (request.method === 'POST' && !sameOrigin)) {
        response.writeHead(403).end()
        return
      }

      if (!managed && action === 'update') {
        response.writeHead(404).end()
        return
      }

      let status = { id: null as string | null, state: 'idle', text: '' }
      if (statusFile) {
        try {
          status = JSON.parse(readFileSync(statusFile, 'utf8'))
        } catch {
          response.writeHead(503).end()
          return
        }
      }
      if (requestedUpdate && status.id === requestedUpdate) requestedUpdate = undefined
      const busy = Boolean(requestedUpdate || status.state === 'running')

      if (action === 'update' && request.method === 'GET') {
        response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(status))
        return
      }
      if (request.method !== 'POST') {
        response.writeHead(405, { Allow: action === 'update' ? 'GET, POST' : 'POST' }).end()
        return
      }
      if (busy || shutdownScheduled) {
        response.writeHead(409).end()
        return
      }

      if (action === 'update') {
        const id = globalThis.crypto.randomUUID()
        requestedUpdate = id
        process.send!({ type: 'update', id }, error => {
          if (error && requestedUpdate === id) requestedUpdate = undefined
        })
        response.writeHead(202, { 'Content-Type': 'application/json' }).end(JSON.stringify({ id }))
        return
      }
      shutdownScheduled = true
      response.writeHead(202).end(() => setTimeout(stop, 300))
    }
  }

  return {
    name: 'saiedu-local-control',
    configureServer(server) {
      if (server.httpServer) server.middlewares.use(middleware(() => {
        void server.close().catch(error => server.config.logger.error(String(error)))
      }))
    },
    configurePreviewServer(server) {
      if (managed) server.middlewares.use(middleware(() => process.send!({ type: 'stop' })))
    },
  }
}

export default defineConfig({
  plugins: [vue(), localLibrary(), localControl()],
  server: { port: 4173, strictPort: true, fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/data/**', '**/.saiedu/**'] } },
  preview: { port: 4173, strictPort: true },
})
