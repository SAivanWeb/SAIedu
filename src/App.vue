<script setup lang="ts">
import { computed, h, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { NButton, NCollapse, NCollapseItem, NConfigProvider, NInput, NModal, NProgress, NTooltip, NDrawer, NDrawerContent, createDiscreteApi, darkTheme, ruRU, dateRuRU, type NotificationReactive } from 'naive-ui'
import { isComplete, lessonsOf, parseCourse, percentage, stepKey, stepsOf, type CourseStep, type Entry, type QuizAnswers } from './course'
import CourseProgram from './CourseProgram.vue'
import KnowledgeQuiz from './KnowledgeQuiz.vue'
import PracticeVerification from './PracticeVerification.vue'
import { readLibrary, writeLibrary, type LibraryChange } from './storage'

const theme = {
  common: {
    primaryColor: '#185f48', primaryColorHover: '#23785a', primaryColorPressed: '#114b38',
    primaryColorSuppl: '#23785a', borderRadius: '8px', fontSize: 'var(--ui-font-size)',
  },
}

const darkOverrides = {
  common: {
    ...theme.common,
    primaryColor: '#9ce1bc', primaryColorHover: '#b6f1d1', primaryColorPressed: '#7bd3a3',
    primaryColorSuppl: '#9ce1bc',
  },
  Button: {
    textColorPrimary: '#12281d', textColorHoverPrimary: '#12281d',
    textColorPressedPrimary: '#12281d', textColorFocusPrimary: '#12281d',
  },
}
const appearances = [
  { id: 'light', label: 'Светлая' },
  { id: 'dark', label: 'Тёмная' },
  { id: 'black-on-white', label: 'Чёрный на белом' },
  { id: 'white-on-black', label: 'Белый на чёрном' },
  { id: 'sepia', label: 'Сепия' },
] as const
type Appearance = typeof appearances[number]['id']

const appearance = ref<Appearance>(matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
const outlineOpen = ref(true)
const sectionIndex = ref(0)
const programOpen = ref(false)
const lessonArticle = ref<HTMLElement>()
const answerFeedback = ref<Record<string, string>>({})
const copyFeedback = ref<Record<string, string>>({})
let scrollFrame = 0
let pendingSave = Promise.resolve(true)
const unsavedChanges: LibraryChange[] = []

try {
  const saved = appearances.find(option => option.id === localStorage.getItem('saiedu-theme'))
  if (saved) appearance.value = saved.id
  outlineOpen.value = localStorage.getItem('saiedu-outline-open') !== 'false'
} catch {}

watch(outlineOpen, value => {
  try { localStorage.setItem('saiedu-outline-open', String(value)) } catch {}
})

watch(appearance, value => {
  document.documentElement.dataset.theme = value
  const canvas = getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim()
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', canvas)
  try { localStorage.setItem('saiedu-theme', value) } catch {}
}, { immediate: true, flush: 'sync' })

function readingOverrides() {
  const style = getComputedStyle(document.documentElement)
  const color = (name: string) => style.getPropertyValue(name).trim()
  return {
    common: {
      ...theme.common,
      primaryColor: color('--accent'), primaryColorHover: color('--muted'),
      primaryColorPressed: color('--accent'), primaryColorSuppl: color('--muted'),
      bodyColor: color('--canvas'), cardColor: color('--paper'), modalColor: color('--paper'),
      popoverColor: color('--paper'), inputColor: color('--paper'), borderColor: color('--border'),
      dividerColor: color('--border'), hoverColor: color('--tint'),
      textColor1: color('--ink'), textColor2: color('--ink'), textColor3: color('--muted'),
    },
    Button: {
      textColorPrimary: color('--paper'), textColorHoverPrimary: color('--paper'),
      textColorPressedPrimary: color('--paper'), textColorFocusPrimary: color('--paper'),
    },
  }
}

const configProviderProps = computed(() => ({
  theme: appearance.value === 'dark' || appearance.value === 'white-on-black' ? darkTheme : null,
  themeOverrides: appearance.value === 'dark' ? darkOverrides : appearance.value === 'light' ? theme : readingOverrides(),
  locale: ruRU,
  dateLocale: dateRuRU,
}))
const { notification, unmount: unmountNotifications } = createDiscreteApi(['notification'], { configProviderProps })
let saveNotice: NotificationReactive | undefined
let updateNotice: NotificationReactive | undefined

const entries = ref<Entry[]>([])
const fileInput = ref<HTMLInputElement>()
const templateOpen = ref(false)
const localApp = location.protocol === 'http:'
  && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
const managedApp = ref(false)
const canStop = computed(() => localApp && (import.meta.env.DEV || managedApp.value))
const updating = ref(false)
const activeImports = ref(0)
const stopping = ref(false)
const stopped = ref(false)
const stoppedHeading = ref<HTMLElement>()
const route = ref(location.hash.slice(1))

const loadingLibrary = ref(true)
const libraryReady = ref(false)

async function loadLibrary() {
  loadingLibrary.value = true
  try {
    const { entries: saved, migrationFailed } = await readLibrary()
    libraryReady.value = true
    entries.value = saved
    if (migrationFailed) notification.error({ title: 'Не удалось перенести старую библиотеку из браузера.' })
    await nextTick()
    restoreSection()
  } catch {
    notification.error({ title: 'Не удалось прочитать библиотеку с диска.' })
  } finally {
    loadingLibrary.value = false
  }
}

async function syncRoute() {
  cancelAnimationFrame(scrollFrame)
  scrollFrame = 0
  programOpen.value = false
  answerFeedback.value = {}
  copyFeedback.value = {}
  route.value = location.hash.slice(1)
  await nextTick()
  document.querySelector<HTMLElement>('main h1')?.focus({ preventScroll: true })
  restoreSection()
}

onMounted(() => {
  void loadLibrary()
  if (localApp && !import.meta.env.DEV) void detectUpdater()
  window.addEventListener('hashchange', syncRoute)
  window.addEventListener('scroll', trackSection, { passive: true })
  restoreSection()
})
onUnmounted(() => {
  unmountNotifications()
  window.removeEventListener('hashchange', syncRoute)
  window.removeEventListener('scroll', trackSection)
  cancelAnimationFrame(scrollFrame)
})

const selected = computed(() => {
  const [, prefix, courseId] = route.value.split('/')
  return prefix === 'course' ? entries.value.find(entry => entry.course.id === courseId) : undefined
})
const lessons = computed(() => selected.value ? lessonsOf(selected.value.course) : [])
const steps = computed(() => selected.value ? stepsOf(selected.value.course) : [])
const activeIndex = computed(() => {
  const key = route.value.split('/').slice(3).join('/')
  return steps.value.findIndex(step => stepKey(step) === key)
})
const activeStep = computed<CourseStep | undefined>(() => steps.value[activeIndex.value])
const lesson = computed(() => activeStep.value?.kind === 'lesson' ? activeStep.value.item : undefined)
const quiz = computed(() => activeStep.value?.kind === 'quiz' ? activeStep.value.item : undefined)
const lessonIndex = computed(() => lessons.value.findIndex(item => item.id === lesson.value?.id))
const previous = computed<CourseStep | undefined>(() => steps.value[activeIndex.value - 1])
const next = computed<CourseStep | undefined>(() => steps.value[activeIndex.value + 1])
const targetStep = computed(() => selected.value && resumeStep(selected.value))
const templateUrl = import.meta.env.BASE_URL + 'course-prompt.txt'

function openTemplate() {
  templateOpen.value = true
}

const continuing = computed(() => entries.value
  .filter(entry => (entry.current || entry.completed.length) && percentage(entry) < 100)
  .reduce<Entry | undefined>((latest, entry) => !latest || (entry.visitedAt ?? 0) > (latest.visitedAt ?? 0)
    ? entry : latest, undefined))
const continuation = computed(() => continuing.value && resumeStep(continuing.value))

function savedSection(entry: Entry, lessonId: string) {
  return entry.sections?.[lessonId] ?? 0
}

function restoreSection() {
  const entry = selected.value
  const item = lesson.value
  const position = entry && item ? savedSection(entry, item.id) : 0
  sectionIndex.value = position
  const section = sectionElements()[position]
  if (position && section) section.scrollIntoView()
  else window.scrollTo(0, 0)
}

function sectionElements() {
  return Array.from(lessonArticle.value?.querySelectorAll<HTMLElement>('.lesson-section') ?? [])
}

function jumpToSection(index: number) {
  const section = sectionElements()[index]
  section?.focus({ preventScroll: true })
  section?.scrollIntoView()
}

function trackSection() {
  if (scrollFrame) return
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0
    const entry = selected.value
    const item = lesson.value
    if (!entry || !item) return
    const sections = sectionElements()
    const atEnd = window.scrollY > 0 && window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2
    const position = atEnd ? sections.length - 1 : sections.reduce((visible, section, index) =>
      section.getBoundingClientRect().top <= 140 ? index : visible, 0)
    if (sectionIndex.value === position) return
    sectionIndex.value = position
    entry.sections = { ...entry.sections, [item.id]: position }
    void save({ type: 'section', id: entry.course.id, key: item.id, value: position })
  })
}

function save(change?: LibraryChange) {
  if (change) unsavedChanges.push(change)
  pendingSave = pendingSave.then(async () => {
    try {
      while (unsavedChanges.length) {
        await writeLibrary(unsavedChanges[0]!)
        unsavedChanges.shift()
      }
      saveNotice?.destroy()
      saveNotice = undefined
      return true
    } catch {
      saveNotice ??= notification.error({
        title: 'Не удалось сохранить библиотеку на диск.',
        onClose: () => { saveNotice = undefined },
      })
      return false
    }
  })
  return pendingSave
}

async function stopApplication() {
  if (stopping.value || updating.value || activeImports.value) return
  if (!window.confirm('Остановить SAIedu? Для повторного запуска открой ярлык на рабочем столе или файл запуска.')) return

  stopping.value = true
  try {
    if (!await save()) return
    const response = await fetch('/__saiedu/stop', {
      method: 'POST',
      mode: 'same-origin',
      referrerPolicy: 'same-origin',
      headers: { 'X-SAIedu-Action': 'stop' },
      signal: AbortSignal.timeout(5000),
    })
    if (response.status !== 202) {
      notification.error({
        title: `Сервер отклонил остановку (HTTP ${response.status})`,
        content: 'Перезапусти SAIedu через файл запуска.',
      })
      return
    }
    stopped.value = true
    await nextTick()
    stoppedHeading.value?.focus()
  } catch {
    notification.error({
      title: 'Не удалось остановить приложение',
      content: 'Можно нажать Ctrl+C в окне запуска.',
    })
  } finally {
    stopping.value = false
  }
}

function updateRequest(method = 'GET') {
  return fetch('/__saiedu/update', {
    method,
    cache: 'no-store',
    headers: { 'X-SAIedu-Action': 'update' },
    signal: AbortSignal.timeout(5000),
  })
}

async function detectUpdater() {
  try {
    const response = await updateRequest()
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return
    managedApp.value = true
    const status = await response.json()
    if (status.state === 'running') await waitForUpdate(status.id)
  } catch {}
}

function showUpdateNotice(content: string, state: 'running' | 'current' | 'error') {
  if (state === 'running') {
    updateNotice ??= notification.info({ title: 'Обновление SAIedu', closable: false })
    updateNotice.content = content
    return
  }
  updateNotice?.destroy()
  updateNotice = undefined
  if (state === 'error') notification.error({ title: 'Не удалось обновить SAIedu', content })
  else notification.success({ title: content, duration: 4000 })
}

async function waitForUpdate(id: string) {
  updating.value = true
  showUpdateNotice('Проверяем обновления…', 'running')
  const deadline = Date.now() + 30 * 60 * 1000
  try {
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 1000))
      const response = await updateRequest().catch(() => undefined)
      if (!response?.ok) continue
      const status = await response.json()
      if (status.id !== id) continue
      if (status.state === 'updated') {
        location.reload()
        return
      }
      if (status.state === 'current' || status.state === 'error') {
        showUpdateNotice(status.text, status.state)
        return
      }
      if (status.state === 'running') showUpdateNotice(status.text, 'running')
    }
    showUpdateNotice('Не удалось получить результат обновления. Проверь окно запуска SAIedu.', 'error')
  } catch {
    showUpdateNotice('Не удалось прочитать статус обновления.', 'error')
  } finally {
    updating.value = false
  }
}

async function updateApplication() {
  if (updating.value || stopping.value || activeImports.value) return
  updating.value = true
  showUpdateNotice('Проверяем обновления…', 'running')
  try {
    if (!await save()) throw new Error('Сначала нужно сохранить прогресс на диск.')
    const response = await updateRequest('POST')
    if (response.status === 409) {
      const statusResponse = await updateRequest()
      const status = await statusResponse.json()
      if (status.state !== 'running') throw new Error('Обновление уже запускается. Попробуй через несколько секунд.')
      await waitForUpdate(status.id)
      return
    }
    if (!response.ok) throw new Error(`Не удалось запустить обновление (HTTP ${response.status}).`)
    await waitForUpdate((await response.json()).id)
  } catch (error) {
    showUpdateNotice(error instanceof Error ? error.message : 'Не удалось проверить обновление.', 'error')
  } finally {
    updating.value = false
  }
}

async function importCourses(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (!files.length) return
  activeImports.value++
  try {
    const problems: string[] = []
    const imported: Entry[] = []
    for (const file of files) {
      try {
        const course = parseCourse(JSON.parse(await file.text()))
        if ([...entries.value, ...imported].some(entry => entry.course.id === course.id)) {
          throw new Error('Курс с таким идентификатором уже есть в библиотеке.')
        }
        imported.push({ course, completed: [], answers: {} })
      } catch (reason) {
        problems.push(`${file.name} — ${reason instanceof SyntaxError ? 'файл должен содержать корректный JSON.' : (reason as Error).message}`)
      }
    }
    if (problems.length) {
      notification.error({
        title: 'Не удалось загрузить курсы',
        content: () => h('ul', problems.map(problem => h('li', problem))),
      })
    }
    if (imported.length) {
      entries.value.push(...imported)
      if (!await save({ type: 'import', entries: imported })) return
      templateOpen.value = false
      location.hash = '/'
      notification.success({ title: `Добавлено курсов: ${imported.length}.`, duration: 4000 })
    }
  } finally {
    activeImports.value--
  }
}

function courseUrl(entry: Entry, lessonId?: string) {
  return `#/course/${entry.course.id}${lessonId ? '/' + lessonId : ''}`
}

function resumeStep(entry: Entry) {
  const steps = stepsOf(entry.course)
  return steps.find(step => stepKey(step) === entry.current && !isComplete(entry, step))
    ?? steps.find(step => !isComplete(entry, step))
    ?? steps[0]
}

function progressLabel(entry: Entry) {
  const steps = stepsOf(entry.course)
  const count = steps.filter(step => isComplete(entry, step)).length
  return `${count} из ${steps.length} пройдено`
}

function quizResult(entry: Entry, quizId: string) {
  return Object.hasOwn(entry.quizResults ?? {}, quizId) ? entry.quizResults?.[quizId] : undefined
}

function saveQuizResult(answers: QuizAnswers) {
  const entry = selected.value
  const currentQuiz = quiz.value
  if (!entry || !currentQuiz) return
  entry.quizResults = { ...entry.quizResults, [currentQuiz.id]: answers }
  void save({ type: 'quiz', id: entry.course.id, key: currentQuiz.id, value: answers })
}

function deleteCourse(entry: Entry) {
  if (!window.confirm(`Удалить курс «${entry.course.title}»? Прогресс и ответы на задания будут удалены.`)) return

  entries.value = entries.value.filter(item => item.course.id !== entry.course.id)
  location.hash = '/'
  void save({ type: 'delete', id: entry.course.id })
}

watch([selected, activeStep], ([entry, item]) => {
  if (!entry || !item || stopping.value) return
  entry.current = stepKey(item)
  entry.visitedAt = Date.now()
  void save({ type: 'progress', id: entry.course.id, current: entry.current, visitedAt: entry.visitedAt })
}, { immediate: true })

function completeLesson() {
  const entry = selected.value
  const current = lesson.value
  if (!entry || !current) return
  if (!entry.completed.includes(current.id)) entry.completed.push(current.id)
  if (next.value) {
    entry.current = stepKey(next.value)
    location.hash = courseUrl(entry, stepKey(next.value))
  } else {
    location.hash = courseUrl(entry)
  }
  void save({ type: 'progress', id: entry.course.id, completed: current.id })
}

async function updateAnswer(key: string, value: string) {
  const entry = selected.value
  if (!entry) return
  const feedback = answerFeedback.value
  delete copyFeedback.value[key.slice(key.indexOf('/') + 1)]
  entry.answers[key] = value
  feedback[key] = 'Сохранение…'
  const saved = await save({ type: 'answer', id: entry.course.id, key, value })
  if (entry.answers[key] === value) feedback[key] = key.endsWith('/output')
    ? (saved ? 'Вывод сохранён' : 'Вывод не сохранён')
    : (saved ? 'Ответ сохранён' : 'Ответ не сохранён')
}

async function copyText(key: string, value: string) {
  const feedback = copyFeedback.value
  try {
    await navigator.clipboard.writeText(value)
    feedback[key] = 'Скопировано'
  } catch {
    feedback[key] = 'Не удалось скопировать'
  }
}

function countLessons(count: number) {
  const ending = new Intl.PluralRules('ru').select(count)
  return `${count} ${ending === 'one' ? 'урок' : ending === 'few' ? 'урока' : 'уроков'}`
}
</script>

<template>
  <NConfigProvider v-bind="configProviderProps">
    <header v-if="!stopped" class="topbar" :inert="stopping">
      <div class="topbar-inner">
        <a class="brand" href="#/" aria-label="SAIedu, главная" :aria-current="!selected ? 'page' : undefined"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span> SAI<span>edu</span></a>
        <label class="theme-control">
          <span>Тема</span>
          <select v-model="appearance">
            <option v-for="option in appearances" :key="option.id" :value="option.id">{{ option.label }}</option>
          </select>
        </label>
        <NTooltip v-if="managedApp" placement="bottom">
          <template #trigger>
            <NButton size="large" circle secondary aria-label="Обновить SAIedu"
              :disabled="stopping || activeImports > 0" :loading="updating" @click="updateApplication">
              <template #icon>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"
                  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M20 4v5h-5M20 9a8 8 0 1 0 0 6" />
                </svg>
              </template>
            </NButton>
          </template>
          Обновить SAIedu
        </NTooltip>
        <NTooltip v-if="canStop" placement="bottom">
          <template #trigger>
            <NButton size="large" circle secondary type="error"
              aria-label="Остановить приложение"
              :disabled="updating || activeImports > 0" :loading="stopping" @click="stopApplication">
              <template #icon>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  stroke-width="1.75" stroke-linecap="round" aria-hidden="true">
                  <path d="M12 3v9M6.35 5.85a8 8 0 1 0 11.3 0" />
                </svg>
              </template>
            </NButton>
          </template>
          Остановить приложение
        </NTooltip>
      </div>
    </header>

    <main v-if="stopped" class="shell">
      <section class="empty-card">
        <h1 ref="stoppedHeading" tabindex="-1">Приложение остановлено</h1>
        <p>Для повторного запуска открой ярлык на рабочем столе или файл запуска SAIedu.</p>
      </section>
    </main>
    <main v-if="!stopped" class="shell" :inert="stopping || updating">
      <input ref="fileInput" type="file" accept=".json,application/json" multiple hidden @change="importCourses">
      <p v-if="loadingLibrary" role="status">Загрузка библиотеки…</p>
      <p v-else-if="!libraryReady"><NButton @click="loadLibrary">Повторить загрузку</NButton></p>
      <template v-else-if="!selected">
        <section class="heading dashboard-heading">
          <div>
            <h1 tabindex="-1">Мои курсы</h1>
            <p>Личная библиотека для самостоятельного обучения.</p>
          </div>
          <NButton v-if="entries.length" type="primary" size="large" @click="fileInput?.click()">Загрузить курс</NButton>
        </section>

        <section v-if="!entries.length" class="empty-card">
          <h2>Здесь будут твои курсы</h2>
          <p>Загрузи готовый курс в формате JSON или создай свой по шаблону.</p>
          <NButton type="primary" size="large" @click="fileInput?.click()">Загрузить курс</NButton>
          <button type="button" class="template-link" @click="openTemplate">Скачать шаблон для нейросети</button>
        </section>
        <template v-else>
          <section v-if="continuing && continuation" class="resume">
            <div>
              <p class="label">{{ continuing.course.title }}</p>
              <h2>{{ continuation.item.title }}</h2>
              <p v-if="continuation.kind === 'lesson'">{{ continuation.item.sections[savedSection(continuing, continuation.item.id)]?.title }}</p>
              <p v-else>Проверка знаний</p>
            </div>
            <div class="resume-action">
              <span>{{ progressLabel(continuing) }}</span>
              <NButton type="primary" size="large" tag="a" :href="courseUrl(continuing, stepKey(continuation))">Продолжить обучение</NButton>
            </div>
          </section>
          <h2 v-if="continuing" class="library-heading">Все курсы</h2>
          <div class="course-grid">
            <a v-for="entry in entries" :key="entry.course.id" class="course-card" :href="courseUrl(entry)">
              <span class="label">{{ entry.course.category || 'Самостоятельный курс' }}</span>
              <h2>{{ entry.course.title }}</h2>
              <p>{{ entry.course.description }}</p>
              <div class="card-progress">
                <div><span>{{ progressLabel(entry) }}</span><strong>{{ percentage(entry) }}%</strong></div>
                <NProgress type="line" :percentage="percentage(entry)" :show-indicator="false" :height="5" />
              </div>
            </a>
          </div>
          <button type="button" class="template-link" @click="openTemplate">Скачать шаблон для нейросети</button>
        </template>
      </template>

      <template v-else-if="!activeStep && targetStep">
        <a class="back-link" href="#/">Все курсы</a>
        <section class="course-hero">
          <div class="heading">
            <div class="label">{{ [selected.course.category, selected.course.level, countLessons(lessons.length)].filter(Boolean).join(' · ') }}</div>
            <h1 tabindex="-1">{{ selected.course.title }}</h1>
            <p class="multiline">{{ selected.course.description }}</p>
            <NButton type="primary" size="large" tag="a" :href="courseUrl(selected, stepKey(targetStep))">
              {{ percentage(selected) === 100 ? 'Повторить курс' : selected.current || selected.completed.length ? 'Продолжить курс' : 'Начать курс' }}
            </NButton>
            <p v-if="percentage(selected) < 100 && selected.current" class="resume-caption">{{ targetStep.item.title }}</p>
          </div>
          <div class="summary">
            <div class="label">Прогресс курса</div>
            <strong>{{ percentage(selected) }}%</strong>
            <NProgress type="line" :percentage="percentage(selected)" :show-indicator="false" :height="7" />
            <p>{{ progressLabel(selected) }}</p>
          </div>
        </section>
        <section class="program">
          <h2>Программа курса</h2>
          <CourseProgram :key="selected.course.id" :entry="selected"
            :resume="percentage(selected) < 100 && selected.current ? stepKey(targetStep) : undefined" />
        </section>
        <NButton class="delete-course" type="error" quaternary @click="deleteCourse(selected)">Удалить курс</NButton>
      </template>

      <template v-else-if="activeStep">
        <div class="lesson-toolbar">
          <div class="lesson-toolbar-context">
            <a class="back-link" :href="courseUrl(selected)">{{ selected.course.title }}</a>
            <span v-if="lesson">Урок {{ lessonIndex + 1 }} из {{ lessons.length }}</span>
            <span v-else>Проверка знаний</span>
          </div>
          <div class="lesson-toolbar-actions">
            <div v-if="lesson && lesson.sections.length > 1" class="outline-toggle">
              <NButton secondary :aria-expanded="outlineOpen" aria-controls="lesson-outline"
                @click="outlineOpen = !outlineOpen">{{ outlineOpen ? 'Скрыть оглавление' : 'Показать оглавление' }}</NButton>
            </div>
            <NButton secondary :aria-expanded="programOpen" @click="programOpen = true">Программа курса</NButton>
          </div>
        </div>
        <NDrawer v-model:show="programOpen" :width="'min(100vw, clamp(20rem, 32vw, 34rem))'" placement="right">
          <NDrawerContent title="Программа курса" closable>
            <p class="drawer-progress">{{ progressLabel(selected) }}</p>
            <NProgress type="line" :percentage="percentage(selected)" :show-indicator="false" :height="5" />
            <nav aria-label="Уроки курса">
              <CourseProgram :entry="selected" :active="stepKey(activeStep)" @navigate="programOpen = false" />
            </nav>
          </NDrawerContent>
        </NDrawer>
        <KnowledgeQuiz v-if="quiz" :key="selected.course.id + '/' + quiz.id" :quiz="quiz"
          :saved="quizResult(selected, quiz.id)" :next-url="courseUrl(selected, next && stepKey(next))"
          :next-label="next ? (next.kind === 'quiz' ? 'Следующая проверка знаний' : 'Следующий урок') : 'К программе курса'"
          @submit="saveQuizResult" />
        <div v-else-if="lesson" class="learning" :class="{ 'with-outline': outlineOpen && lesson.sections.length > 1 }">
          <nav v-if="lesson.sections.length > 1" v-show="outlineOpen" id="lesson-outline" class="outline" aria-label="Разделы урока">
            <strong>В этом уроке</strong>
            <ul>
              <li v-for="(section, index) in lesson.sections" :key="index">
                <button type="button" :aria-current="sectionIndex === index ? 'location' : undefined" @click="jumpToSection(index)">{{ section.title }}</button>
              </li>
            </ul>
          </nav>
          <article ref="lessonArticle" :key="selected.course.id + '/' + lesson.id" class="lesson">
            <header class="heading">
              <h1 tabindex="-1">{{ lesson.title }}</h1>
            </header>
            <NCollapse v-if="lesson.sections.length > 1" class="mobile-sections">
              <NCollapseItem name="sections" title="Разделы урока">
                <nav aria-label="Разделы урока">
                  <button v-for="(section, index) in lesson.sections" :key="index" type="button"
                    :aria-current="sectionIndex === index ? 'location' : undefined" @click="jumpToSection(index)">{{ section.title }}</button>
                </nav>
              </NCollapseItem>
            </NCollapse>
            <section v-for="(section, index) in lesson.sections" :key="index" class="lesson-section" tabindex="-1">
              <h2>{{ section.title }}</h2>
              <div v-for="(block, blockIndex) in section.blocks" :key="blockIndex" class="block" :class="'block-' + block.type">
                <h3 v-if="block.title || block.type === 'practice' || block.type === 'example'">{{ block.title || (block.type === 'practice' ? 'Практика' : 'Пример') }}</h3>
                <p v-if="block.type === 'text' || block.type === 'example'" class="multiline">{{ block.text }}</p>
                <template v-else-if="block.type === 'code'">
                  <div class="code-language">
                    <span>{{ block.language }}</span>
                    <button type="button" @click="copyText(index + '/' + blockIndex, block.code)">Копировать</button>
                    <span v-if="copyFeedback[index + '/' + blockIndex]" role="status">{{ copyFeedback[index + '/' + blockIndex] }}</span>
                  </div>
                  <pre tabindex="0"><code>{{ block.code }}</code></pre>
                </template>
                <template v-else-if="block.type === 'practice'">
                  <div class="practice-body">
                    <p class="multiline">{{ block.task }}</p>
                    <div class="practice-editor">
                      <NInput type="textarea" :input-props="{ 'aria-label': block.title || 'Ответ на задание' }"
                        :value="selected.answers[lesson.id + '/' + block.id] ?? block.starter ?? ''"
                        :autosize="{ minRows: 3, maxRows: 16 }" placeholder="Напиши свой ответ"
                        @update:value="updateAnswer(lesson!.id + '/' + block.id, $event)" />
                      <div class="practice-actions">
                        <NButton size="small" secondary :disabled="!(selected.answers[lesson.id + '/' + block.id] ?? block.starter)"
                          @click="copyText(block.id, selected.answers[lesson!.id + '/' + block.id] ?? block.starter ?? '')">Копировать ответ</NButton>
                        <span role="status">{{ copyFeedback[block.id] || answerFeedback[lesson.id + '/' + block.id] || '' }}</span>
                      </div>
                    </div>
                    <PracticeVerification v-if="block.check" :key="lesson.id + '/' + block.id"
                      :check="block.check" :title="block.title"
                      :answer="selected.answers[lesson.id + '/' + block.id] ?? block.starter ?? ''"
                      :output="selected.answers[lesson.id + '/' + block.id + '/output'] ?? ''"
                      :status="answerFeedback[lesson.id + '/' + block.id + '/output']"
                      @output="updateAnswer(lesson!.id + '/' + block.id + '/output', $event)" />
                  </div>
                </template>
              </div>
            </section>
            <footer class="lesson-footer">
              <NButton v-if="previous" tag="a" :href="courseUrl(selected, stepKey(previous))">{{ previous.kind === 'quiz' ? 'Предыдущий тест' : 'Предыдущий урок' }}</NButton>
              <NButton type="primary" @click="completeLesson">
                {{ selected.completed.includes(lesson.id) ? (next ? (next.kind === 'quiz' ? 'К проверке знаний' : 'Следующий урок') : 'К программе курса') : (next ? (next.kind === 'quiz' ? 'Завершить урок и перейти к тесту' : 'Завершить и продолжить') : 'Завершить урок') }}
              </NButton>
            </footer>
          </article>
        </div>
      </template>
    </main>
    <NModal v-model:show="templateOpen" preset="card" class="template-dialog" title="Как создать курс с нейросетью"
      aria-label="Как создать курс с нейросетью" closable>
      <ol class="template-steps">
        <li>
          <h3>Скачай шаблон</h3>
          <p>Прикрепи файл <code>course-prompt.txt</code> к сообщению в чате с нейросетью или вставь его содержимое.</p>
          <NButton tag="a" :href="templateUrl" download>Скачать шаблон</NButton>
        </li>
        <li>
          <h3>Опиши курс в том же сообщении</h3>
          <p>Укажи тему, свой уровень, чему хочешь научиться и сколько уроков нужно. Приложи материалы или ссылки на источники. Если материалов нет, попроси опираться на официальную документацию и указывать источники.</p>
          <p>Попроси нейросеть вернуть готовый файл <code>.json</code> по структуре шаблона.</p>
        </li>
        <li>
          <h3>Загрузи готовый курс</h3>
          <p>Скачай JSON из чата. Если нейросеть вернула его текстом, сохрани сам JSON в файл с расширением <code>.json</code>. Затем выбери этот файл и открой курс в библиотеке.</p>
          <NButton type="primary" :loading="activeImports > 0" @click="fileInput?.click()">Загрузить курс (.json)</NButton>
        </li>
      </ol>
    </NModal>
  </NConfigProvider>
</template>
