import { preview } from 'vite'

const server = await preview({ root: process.cwd() })
process.send?.({ type: 'ready' })

process.on('message', async message => {
  if (message?.type !== 'close') return
  server.httpServer.closeAllConnections()
  await new Promise(resolve => server.httpServer.close(resolve))
  process.exit(0)
})

process.on('disconnect', () => process.exit(0))
