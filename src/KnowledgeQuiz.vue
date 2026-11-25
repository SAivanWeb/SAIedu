<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { NButton } from 'naive-ui'
import { isCorrect, type Question, type Quiz, type QuizAnswers } from './course'

const props = defineProps<{ quiz: Quiz; saved?: QuizAnswers; nextUrl: string; nextLabel: string }>()
const emit = defineEmits<{ submit: [answers: QuizAnswers] }>()
const answers = ref<QuizAnswers>(Object.create(null))
const result = ref(props.saved)
const resultHeading = ref<HTMLElement>()
const title = ref<HTMLElement>()
const missing = computed(() => props.quiz.questions.filter(question => !answers.value[question.id]?.length).length)
const score = computed(() => props.quiz.questions.filter(question =>
  isCorrect(question, result.value?.[question.id] ?? [])).length)

function select(question: Question, option: string, event: Event) {
  const input = event.target as HTMLInputElement
  const current = answers.value[question.id] ?? []
  answers.value[question.id] = question.type === 'single' ? [option]
    : input.checked ? [...current, option] : current.filter(id => id !== option)
}

async function submit() {
  if (missing.value) return
  result.value = { ...answers.value }
  emit('submit', result.value)
  await nextTick()
  resultHeading.value?.focus()
}

async function retry() {
  answers.value = Object.create(null)
  result.value = undefined
  await nextTick()
  title.value?.focus()
}
</script>

<template>
  <article class="lesson quiz">
    <header class="heading">
      <h1 ref="title" tabindex="-1">{{ quiz.title }}</h1>
    </header>
    <div v-if="result" class="quiz-summary">
      <h2 ref="resultHeading" tabindex="-1">Правильных ответов: {{ score }} из {{ quiz.questions.length }}</h2>
      <div class="actions quiz-result-actions">
        <NButton @click="retry">Пройти ещё раз</NButton>
        <NButton type="primary" tag="a" :href="nextUrl">{{ nextLabel }}</NButton>
      </div>
    </div>
    <form class="quiz-form" @submit.prevent="submit">
      <fieldset v-for="(question, index) in quiz.questions" :key="question.id" class="quiz-question">
        <legend>{{ index + 1 }}. {{ question.prompt }}</legend>
        <p v-if="!result">{{ question.type === 'single' ? 'Выбери один вариант' : 'Выбери все верные варианты' }}</p>
        <template v-for="option in question.options" :key="option.id">
          <label v-if="!result" class="quiz-option">
            <input :type="question.type === 'single' ? 'radio' : 'checkbox'" :name="question.id"
              :checked="answers[question.id]?.includes(option.id)" @change="select(question, option.id, $event)">
            <span>{{ option.text }}</span>
          </label>
          <div v-else class="quiz-option">
            <span>{{ option.text }}</span>
            <span v-if="question.correct.includes(option.id)" class="quiz-tag">Верный вариант</span>
            <span v-if="result[question.id]?.includes(option.id)" class="quiz-tag">Твой выбор</span>
          </div>
        </template>
        <div v-if="result" class="quiz-feedback">
          <strong>{{ isCorrect(question, result[question.id] ?? []) ? 'Верно' : 'Неверно' }}</strong>
          <p v-if="question.explanation" class="multiline">{{ question.explanation }}</p>
        </div>
      </fieldset>
      <footer v-if="!result" class="lesson-footer">
        <span v-if="missing">Осталось ответить: {{ missing }}</span>
        <NButton type="primary" attr-type="submit" :disabled="Boolean(missing)">Проверить ответы</NButton>
      </footer>
    </form>
  </article>
</template>
