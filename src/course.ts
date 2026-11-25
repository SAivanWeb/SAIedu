export type Block =
  | { type: 'text' | 'example'; title?: string; text: string }
  | { type: 'code'; title?: string; language: string; code: string }
  | { type: 'practice'; id: string; title?: string; task: string; starter?: string; check?: PracticeCheck }

export interface PracticeCheck {
  source: 'answer' | 'output'
  criteria: { label: string; match: 'exact' | 'line' | 'contains'; expected: string }[]
}

export function checkPractice(check: PracticeCheck, value: string) {
  const normalize = (text: string) => text.replace(/\r\n?/g, '\n').trim()
  const actual = normalize(value)
  const lines = new Set(actual.split('\n').map(line => line.trim()))
  return check.criteria.map(({ label, match, expected }) => {
    const target = normalize(expected)
    const passed = match === 'exact' ? actual === target
      : match === 'line' ? lines.has(target)
      : actual.includes(target)
    return { label, passed }
  })
}

export interface Lesson {
  id: string
  title: string
  sections: { title: string; blocks: Block[] }[]
}

export interface Question {
  id: string
  prompt: string
  type: 'single' | 'multiple'
  options: { id: string; text: string }[]
  correct: string[]
  explanation?: string
}

export interface Quiz {
  id: string
  title: string
  questions: Question[]
}

export interface CourseModule {
  id: string
  title: string
  lessons: Lesson[]
  quiz?: Quiz
}

export type Course = {
  version: 1
  id: string
  title: string
  description: string
  category?: string
  level?: string
  quiz?: Quiz
} & ({ modules: CourseModule[]; lessons?: never } | { lessons: Lesson[]; modules?: never })

export type QuizAnswers = Record<string, string[]>

export interface Entry {
  course: Course
  completed: string[]
  current?: string
  visitedAt?: number
  answers: Record<string, string>
  quizResults?: Record<string, QuizAnswers>
  sections?: Record<string, number>
}

export type CourseStep = { kind: 'lesson'; item: Lesson } | { kind: 'quiz'; item: Quiz }

export const lessonsOf = (course: Course) => course.lessons ?? course.modules.flatMap(module => module.lessons)

export function lessonSteps(lessons: Lesson[], quiz?: Quiz): CourseStep[] {
  const steps: CourseStep[] = lessons.map(item => ({ kind: 'lesson', item }))
  if (quiz) steps.push({ kind: 'quiz', item: quiz })
  return steps
}

export function stepsOf(course: Course): CourseStep[] {
  if (course.lessons) return lessonSteps(course.lessons, course.quiz)
  const steps = course.modules.flatMap(module => lessonSteps(module.lessons, module.quiz))
  if (course.quiz) steps.push({ kind: 'quiz', item: course.quiz })
  return steps
}

export const stepKey = (step: CourseStep) => step.kind === 'quiz' ? 'quiz/' + step.item.id : step.item.id
export const isComplete = (entry: Entry, step: CourseStep) => step.kind === 'quiz'
  ? Object.hasOwn(entry.quizResults ?? {}, step.item.id)
  : entry.completed.includes(step.item.id)
export const percentage = (entry: Entry) => {
  const steps = stepsOf(entry.course)
  return Math.floor(steps.filter(step => isComplete(entry, step)).length * 100 / steps.length)
}

export function isCorrect(question: Question, answer: string[]) {
  return answer.length === question.correct.length && question.correct.every(id => answer.includes(id))
}

function invalid(path: string, expected: string): never {
  throw new Error(`Поле «${path}» — ${expected}.`)
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid(path, 'ожидается объект')
  return value as Record<string, unknown>
}

function str(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim()) invalid(path, 'ожидается непустая строка')
  return value
}

function optional(value: unknown, path: string): string | undefined {
  return value === undefined ? undefined : str(value, path)
}

function list<T>(value: unknown, path: string, parse: (value: unknown, path: string) => T): T[] {
  if (!Array.isArray(value) || !value.length) invalid(path, 'ожидается непустой список')
  return value.map((item, index) => parse(item, `${path}[${index}]`))
}

function id(value: unknown, path: string, ids = new Set<string>()): string {
  const key = str(value, path)
  if (!/^[a-z0-9][a-z0-9-]*$/.test(key)) invalid(path, 'используй строчные латинские буквы, цифры и дефисы')
  if (ids.has(key)) invalid(path, 'идентификатор уже используется')
  ids.add(key)
  return key
}

function parsePracticeCheck(value: unknown, path: string): PracticeCheck | undefined {
  if (value === undefined) return undefined
  const data = object(value, path)
  const source = data.source
  if (source !== 'answer' && source !== 'output') invalid(path + '.source', 'допустимы answer и output')
  return {
    source,
    criteria: list(data.criteria, path + '.criteria', (value, path) => {
      const criterion = object(value, path)
      const match = criterion.match
      if (match !== 'exact' && match !== 'line' && match !== 'contains') {
        invalid(path + '.match', 'допустимы exact, line и contains')
      }
      const expected = str(criterion.expected, path + '.expected')
      if (match === 'line' && /[\r\n]/.test(expected.trim())) invalid(path + '.expected', 'ожидается одна строка')
      return { label: str(criterion.label, path + '.label'), match, expected }
    }),
  }
}

function block(value: unknown, path: string, practiceIds: Set<string>): Block {
  const data = object(value, path)
  const title = optional(data.title, `${path}.title`)
  switch (data.type) {
    case 'text':
    case 'example':
      return { type: data.type, title, text: str(data.text, `${path}.text`) }
    case 'code':
      return { type: 'code', title, language: str(data.language, `${path}.language`), code: str(data.code, `${path}.code`) }
    case 'practice':
      return { type: 'practice', title, id: id(data.id, `${path}.id`, practiceIds),
        task: str(data.task, `${path}.task`), starter: optional(data.starter, `${path}.starter`), check: parsePracticeCheck(data.check, path + '.check') }
    default:
      return invalid(`${path}.type`, 'допустимы text, example, code и practice')
  }
}

function parseQuiz(value: unknown, path: string, quizIds: Set<string>): Quiz | undefined {
  if (value === undefined) return undefined
  const data = object(value, path)
  const questionIds = new Set<string>()
  return {
    id: id(data.id, path + '.id', quizIds),
    title: str(data.title, path + '.title'),
    questions: list(data.questions, path + '.questions', (value, path) => {
      const question = object(value, path)
      const type = question.type
      if (type !== 'single' && type !== 'multiple') invalid(path + '.type', 'допустимы single и multiple')
      const optionIds = new Set<string>()
      const options = list(question.options, path + '.options', (value, path) => {
        const option = object(value, path)
        return { id: id(option.id, path + '.id', optionIds), text: str(option.text, path + '.text') }
      })
      if (options.length < 2) invalid(path + '.options', 'нужно хотя бы два варианта')
      const correctIds = new Set<string>()
      const correct = list(question.correct, path + '.correct', (value, path) => {
        const key = id(value, path, correctIds)
        if (!optionIds.has(key)) invalid(path, 'варианта с таким id нет')
        return key
      })
      if (type === 'single' && correct.length !== 1) invalid(path + '.correct', 'нужен ровно один правильный вариант')
      if (type === 'multiple' && correct.length < 2) invalid(path + '.correct', 'нужно хотя бы два правильных варианта')
      return {
        id: id(question.id, path + '.id', questionIds), prompt: str(question.prompt, path + '.prompt'),
        type, options, correct, explanation: optional(question.explanation, path + '.explanation'),
      }
    }),
  }
}

function parseLessons(value: unknown, path: string, lessonIds: Set<string>) {
  return list(value, path, (value, path) => {
    const lesson = object(value, path)
    const practiceIds = new Set<string>()
    return {
      id: id(lesson.id, path + '.id', lessonIds),
      title: str(lesson.title, path + '.title'),
      sections: list(lesson.sections, path + '.sections', (value, path) => {
        const section = object(value, path)
        return {
          title: str(section.title, path + '.title'),
          blocks: list(section.blocks, path + '.blocks', (item, path) => block(item, path, practiceIds)),
        }
      }),
    }
  })
}

export function parseCourse(value: unknown): Course {
  const data = object(value, 'курс')
  if (data.version !== 1) invalid('version', 'ожидается число 1')
  if ((data.lessons === undefined) === (data.modules === undefined)) {
    invalid('курс', 'нужно указать один список: lessons или modules')
  }
  const moduleIds = new Set<string>()
  const lessonIds = new Set<string>()
  const quizIds = new Set<string>()
  const metadata = {
    version: 1 as const,
    id: id(data.id, 'id'),
    title: str(data.title, 'title'),
    description: str(data.description, 'description'),
    category: optional(data.category, 'category'),
    level: optional(data.level, 'level'),
    quiz: parseQuiz(data.quiz, 'quiz', quizIds),
  }
  if (data.lessons !== undefined) return { ...metadata, lessons: parseLessons(data.lessons, 'lessons', lessonIds) }
  return {
    ...metadata,
    modules: list(data.modules, 'modules', (value, path) => {
      const module = object(value, path)
      return {
        id: id(module.id, path + '.id', moduleIds),
        title: str(module.title, path + '.title'),
        lessons: parseLessons(module.lessons, path + '.lessons', lessonIds),
        quiz: parseQuiz(module.quiz, path + '.quiz', quizIds),
      }
    }),
  }
}

function parseQuizResults(course: Course, value: unknown): Record<string, QuizAnswers> {
  const results: Record<string, QuizAnswers> = Object.create(null)
  if (typeof value !== 'object' || value === null) return results
  for (const step of stepsOf(course)) {
    if (step.kind !== 'quiz') continue
    const saved = (value as Record<string, unknown>)[step.item.id]
    if (typeof saved !== 'object' || saved === null) continue
    const answers: QuizAnswers = Object.create(null)
    for (const question of step.item.questions) {
      const selected = (saved as Record<string, unknown>)[question.id]
      if (!Array.isArray(selected) || !selected.length || (question.type === 'single' && selected.length !== 1)) continue
      const valid = new Set(question.options.map(option => option.id))
      if (selected.every(option => valid.has(option))) answers[question.id] = [...new Set(selected)]
    }
    if (Object.keys(answers).length === step.item.questions.length) results[step.item.id] = answers
  }
  return results
}

export function parseLibrary(value: unknown): Entry[] {
  if (!Array.isArray(value)) invalid('библиотека', 'ожидается список курсов')
  const courseIds = new Set<string>()
  return value.map((item, index) => {
    const path = `библиотека[${index}]`
    const data = object(item, path)
    const course = parseCourse(data.course)
    id(course.id, `${path}.course.id`, courseIds)
    const lessons = lessonsOf(course)
    const lessonIds = new Set(lessons.map(lesson => lesson.id))
    const completed = Array.isArray(data.completed) ? data.completed : []
    const current = typeof data.current === 'string' && stepsOf(course).some(step => stepKey(step) === data.current) ? data.current : undefined
    const saved = object(data.answers, `${path}.answers`)
    const answers: Record<string, string> = {}
    for (const lesson of lessons) {
      for (const section of lesson.sections) {
        for (const block of section.blocks) {
          if (block.type !== 'practice') continue
          const key = `${lesson.id}/${block.id}`
          if (typeof saved[key] === 'string') answers[key] = saved[key]
          const outputKey = key + '/output'
          if (block.check?.source === 'output' && typeof saved[outputKey] === 'string') answers[outputKey] = saved[outputKey]
        }
      }
    }
    const visitedAt = typeof data.visitedAt === 'number' && Number.isFinite(data.visitedAt) ? data.visitedAt : undefined
    const positions = data.sections
    const sections: Record<string, number> = Object.create(null)
    if (positions && typeof positions === 'object') {
      for (const lesson of lessons) {
        const position = (positions as Record<string, unknown>)[lesson.id]
        if (typeof position === 'number' && Number.isInteger(position) && position >= 0 && position < lesson.sections.length) {
          sections[lesson.id] = position
        }
      }
    }
    return { course, current, visitedAt, sections, completed: [...new Set(completed.filter(id => lessonIds.has(id)))], answers, quizResults: parseQuizResults(course, data.quizResults) }
  })
}
