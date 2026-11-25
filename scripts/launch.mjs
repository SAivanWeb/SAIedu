import { execFile, fork, spawn } from 'node:child_process'
import { unlinkSync } from 'node:fs'
import { once } from 'node:events'
import { access, copyFile, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { createHash, randomUUID } from 'node:crypto'

const exec = promisify(execFile)
const root = fileURLToPath(new URL('../', import.meta.url))
const managed = join(root, '.saiedu')
const library = join(root, 'data')
const statusPath = join(managed, 'status.json')
const installedPath = join(managed, 'installed.json')
const lockPath = join(managed, 'launcher.lock')
const windows = process.platform === 'win32'
const toolEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0' }
let child
let job
let stopping = false

async function git(args, cwd = root) {
  const { stdout } = await exec('git', args, { cwd, env: toolEnv, timeout: 120_000 })
  return stdout.trim()
}

async function npm(args, cwd) {
  const command = windows ? 'npm.cmd' : 'npm'
  const proc = spawn(command, args, { cwd, shell: windows, stdio: 'inherit', env: toolEnv })
  const [code] = await once(proc, 'exit')
  if (code !== 0) throw new Error(`Команда npm ${args.join(' ')} завершилась с кодом ${code}.`)
}

async function installRootDependencies() {
  const lockfile = await readFile(join(root, 'package-lock.json'))
  const revision = createHash('sha256').update(lockfile).digest('hex')
  const stamp = join(root, 'node_modules', '.saiedu-lock')
  try {
    await access(join(root, 'node_modules', 'vite', 'package.json'))
    if (await readFile(stamp, 'utf8') === revision) return
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  await npm(['ci'], root)
  await writeFile(stamp, revision)
}

async function writeJson(file, value) {
  const temporary = file + '.tmp'
  await writeFile(temporary, JSON.stringify(value))
  await rename(temporary, file)
}

async function updateStatus(id, state, text) {
  await writeJson(statusPath, { id, state, text })
  if (text) console.log(text)
}

async function start(directory) {
  const runtime = fork(join(directory, 'scripts', 'serve.mjs'), {
    cwd: directory,
    env: { ...process.env, SAIEDU_DATA_DIRECTORY: library, SAIEDU_UPDATE_STATUS: statusPath },
  })
  child = runtime
  let timer
  try {
    await new Promise((ready, fail) => {
      timer = setTimeout(() => fail(new Error('Сервер не запустился вовремя.')), 20_000)
      runtime.once('error', fail)
      runtime.once('exit', code => fail(new Error(`Сервер завершился с кодом ${code}.`)))
      runtime.on('message', message => {
        if (message?.type === 'ready') ready()
        if (message?.type === 'update' && child === runtime && !job && !stopping
          && typeof message.id === 'string') {
          job = update(message.id, directory).finally(() => { job = undefined })
          job.catch(error => console.error(error))
        }
        if (message?.type === 'stop' && child === runtime && !job) void stopLauncher()
      })
    })
  } catch (error) {
    await close(runtime)
    throw error
  } finally {
    clearTimeout(timer)
  }
  runtime.once('exit', code => {
    if (child === runtime && !job && !stopping) process.exitCode = code ?? 1
  })
}

async function close(runtime = child) {
  if (!runtime || runtime.exitCode !== null || runtime.signalCode !== null || !runtime.pid) return
  const force = setTimeout(() => runtime.kill('SIGKILL'), 4000)
  const exited = once(runtime, 'exit')
  if (runtime.connected) runtime.send({ type: 'close' }, error => { if (error) runtime.kill() })
  else runtime.kill()
  try {
    await exited
  } finally {
    clearTimeout(force)
  }
}

async function backupLibrary() {
  const directory = join(library, 'backups')
  const timestamp = new Date().toISOString().replaceAll(':', '-')
  await mkdir(directory, { recursive: true })
  try {
    await copyFile(join(library, 'library.json'), join(directory, `library-${timestamp}-${randomUUID()}.json`))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}

async function cleanHead() {
  if (await git(['status', '--porcelain'])) throw new Error('В репозитории есть локальные изменения. Сохрани их перед обновлением.')
  return git(['rev-parse', 'HEAD'])
}

async function update(id, runningDirectory) {
  let staged
  let switched = false
  let installed = false
  try {
    await updateStatus(id, 'running', 'Проверяем обновления…')
    try {
      await git(['rev-parse', '--show-toplevel'])
    } catch {
      throw new Error('Для обновления установи Git и запусти SAIedu из клона репозитория.')
    }
    const head = await cleanHead()
    const branch = await git(['symbolic-ref', '--short', 'HEAD'])
    const upstream = await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
    if (!upstream.startsWith('origin/')) throw new Error('Настрой отслеживаемую ветку в origin.')
    await git(['fetch', '--', 'origin'])
    const target = await git(['rev-parse', '@{u}'])
    const runningRevision = runningDirectory === root ? head : await git(['rev-parse', 'HEAD'], runningDirectory)
    if (runningRevision === target && head === target) {
      await updateStatus(id, 'current', 'Уже установлена последняя версия.')
      return
    }
    try {
      await git(['merge-base', '--is-ancestor', head, target])
    } catch {
      throw new Error('Ветка разошлась с origin. Автоматическое обновление остановлено.')
    }

    await backupLibrary()
    await updateStatus(id, 'running', 'Собираем новую версию…')
    staged = join(managed, 'versions', randomUUID())
    await mkdir(dirname(staged), { recursive: true })
    await git(['clone', '--shared', '--no-checkout', '--', root, staged])
    await git(['checkout', '--detach', target], staged)
    await npm(['ci'], staged)
    await npm(['run', 'build'], staged)

    if (await cleanHead() !== head || await git(['symbolic-ref', '--short', 'HEAD']) !== branch) {
      throw new Error('Рабочая ветка изменилась во время сборки.')
    }
    if (stopping) throw new Error('Приложение останавливается.')
    await updateStatus(id, 'running', 'Перезапускаем SAIedu…')
    switched = true
    await close()
    // The previous server may have accepted more progress while the build ran.
    await backupLibrary()
    await start(staged)
    await git(['merge', '--ff-only', target])
    await writeJson(installedPath, { version: basename(staged), revision: target })
    installed = true
    await updateStatus(id, 'updated', 'SAIedu обновлён.')
    if (runningDirectory !== root) await rm(runningDirectory, { recursive: true, force: true })
  } catch (error) {
    console.error(error)
    let reason = error.message
    if (switched && !installed && !stopping) {
      try {
        await close()
        await start(runningDirectory)
      } catch (restartError) {
        reason += ` Не удалось перезапустить предыдущую версию. ${restartError.message}`
      }
    }
    await updateStatus(id, installed ? 'updated' : 'error', installed ? 'SAIedu обновлён.' : reason)
  } finally {
    if (staged && !installed) await rm(staged, { recursive: true, force: true })
  }
}

async function stopLauncher() {
  if (stopping) return
  stopping = true
  await close()
  if (job) await job.catch(() => {})
  await close()
}

process.on('SIGINT', () => void stopLauncher())
process.on('SIGTERM', () => void stopLauncher())
async function lockLauncher() {
  while (true) {
    try {
      const lock = await open(lockPath, 'wx')
      await lock.writeFile(String(process.pid))
      await lock.close()
      process.on('exit', () => {
        try { unlinkSync(lockPath) } catch {}
      })
      return
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      const owner = Number(await readFile(lockPath, 'utf8'))
      if (!Number.isSafeInteger(owner) || owner <= 0) throw new Error('Другой экземпляр SAIedu запускается.')
      try {
        process.kill(owner, 0)
      } catch (probeError) {
        if (probeError.code !== 'ESRCH') throw probeError
        await rm(lockPath)
        continue
      }
      throw new Error('SAIedu уже запущен.')
    }
  }
}

await mkdir(managed, { recursive: true })
await lockLauncher()
await updateStatus(null, 'idle', '')

let directory = root
try {
  const { version, revision } = JSON.parse(await readFile(installedPath, 'utf8'))
  if (typeof version === 'string' && /^[a-f0-9-]{36}$/.test(version)
    && revision === await git(['rev-parse', 'HEAD'])) {
    directory = join(managed, 'versions', version)
  }
} catch (error) {
  if (error.code !== 'ENOENT') console.error(error)
}
if (directory !== root && !stopping) {
  try {
    await start(directory)
  } catch (error) {
    console.error(error)
    directory = root
  }
}
if (directory === root && !stopping) {
  await installRootDependencies()
  if (!stopping) await npm(['run', 'build'], root)
  if (!stopping) await start(root)
}
if (process.argv.includes('--open') && !stopping) {
  const url = 'http://localhost:4173'
  const browser = process.platform === 'darwin' ? ['open', url]
    : windows ? ['explorer.exe', url] : ['xdg-open', url]
  const opener = spawn(browser[0], browser.slice(1), { stdio: 'ignore' })
  opener.on('error', () => console.log(url))
  opener.unref()
}
