<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NButton, NInput } from 'naive-ui'
import { checkPractice, type PracticeCheck } from './course'

const props = defineProps<{
  check: PracticeCheck
  title?: string
  answer: string
  output: string
  status?: string
}>()
defineEmits<{ output: [value: string] }>()

const checked = ref(false)
const value = computed(() => props.check.source === 'output' ? props.output : props.answer)
const result = computed(() => checked.value ? checkPractice(props.check, value.value) : [])
const passed = computed(() => result.value.filter(criterion => criterion.passed).length)
watch(value, () => { checked.value = false })
</script>

<template>
  <section class="practice-verification" aria-label="Самопроверка">
    <template v-if="check.source === 'output'">
      <p class="practice-output-label">Фактический вывод</p>
      <NInput type="textarea" :value="output" :autosize="{ minRows: 3, maxRows: 12 }"
        :input-props="{ 'aria-label': title ? 'Фактический вывод: ' + title : 'Фактический вывод' }"
        placeholder="Вставь вывод команды, лога или приложения" @update:value="$emit('output', $event)" />
    </template>
    <div class="practice-actions">
      <NButton size="small" type="primary" :disabled="!value.trim()" @click="checked = true">
        {{ check.source === 'output' ? 'Проверить вывод' : 'Проверить ответ' }}
      </NButton>
      <span v-if="check.source === 'output'" role="status">{{ status }}</span>
    </div>
    <p v-if="check.source === 'answer'" class="practice-check-note">Сверка текста по критериям задания.</p>
    <div v-if="result.length" class="practice-check-result" role="status">
      <strong>Критериев выполнено: {{ passed }} из {{ result.length }}</strong>
      <ul>
        <li v-for="(criterion, index) in result" :key="index">
          <strong>{{ criterion.passed ? 'Совпало' : 'Не совпало' }}</strong> — {{ criterion.label }}
        </li>
      </ul>
    </div>
  </section>
</template>
