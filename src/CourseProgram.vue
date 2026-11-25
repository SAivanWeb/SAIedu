<script setup lang="ts">
import { computed } from 'vue'
import { NCollapse, NCollapseItem } from 'naive-ui'
import { isComplete, lessonSteps, stepKey, stepsOf, type CourseStep, type Entry } from './course'

const props = defineProps<{ entry: Entry; active?: string; resume?: string }>()
defineEmits<{ navigate: [] }>()

const groups = computed(() => {
  const { course } = props.entry
  return course.modules?.map(module => ({
    id: module.id,
    title: module.title,
    lessonCount: module.lessons.length,
    steps: lessonSteps(module.lessons, module.quiz),
  })) ?? []
})

const standalone = computed<CourseStep[]>(() => {
  const { course } = props.entry
  if (course.lessons) return stepsOf(course)
  return course.quiz ? [{ kind: 'quiz', item: course.quiz }] : []
})
</script>

<template>
  <div class="program-modules">
    <NCollapse v-if="groups.length" :default-expanded-names="groups.map(group => group.id)">
      <NCollapseItem v-for="group in groups" :key="group.id" :name="group.id" :title="group.title">
        <template #header-extra>
          <span class="module-count">Уроков: {{ group.lessonCount }}</span>
        </template>
        <a v-for="step in group.steps" :key="stepKey(step)" :href="'#/course/' + entry.course.id + '/' + stepKey(step)"
          class="program-lesson" :class="{ 'resume-lesson': resume === stepKey(step) }"
          :aria-current="active === stepKey(step) ? 'page' : undefined" @click="$emit('navigate')">
          <span class="status-icon" :class="{ done: isComplete(entry, step) }" aria-hidden="true">{{ isComplete(entry, step) ? '✓' : '' }}</span>
          <span>{{ step.item.title }}<span v-if="isComplete(entry, step)" class="visually-hidden">, пройдено</span></span>
          <span v-if="resume === stepKey(step)" class="lesson-marker">Продолжить отсюда</span>
          <span v-else-if="step.kind === 'quiz'" class="lesson-marker">Тест</span>
        </a>
      </NCollapseItem>
    </NCollapse>
    <div v-if="standalone.length" :class="{ 'course-final-quiz': groups.length }">
      <a v-for="step in standalone" :key="stepKey(step)" :href="'#/course/' + entry.course.id + '/' + stepKey(step)"
        class="program-lesson" :class="{ 'resume-lesson': resume === stepKey(step) }"
        :aria-current="active === stepKey(step) ? 'page' : undefined" @click="$emit('navigate')">
        <span class="status-icon" :class="{ done: isComplete(entry, step) }" aria-hidden="true">{{ isComplete(entry, step) ? '✓' : '' }}</span>
        <span>{{ step.item.title }}<span v-if="isComplete(entry, step)" class="visually-hidden">, пройдено</span></span>
        <span v-if="resume === stepKey(step)" class="lesson-marker">Продолжить отсюда</span>
        <span v-else-if="step.kind === 'quiz'" class="lesson-marker">Тест</span>
      </a>
    </div>
  </div>
</template>
