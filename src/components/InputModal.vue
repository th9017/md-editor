<template>
  <Teleport to="body">
    <div class="modal-mask" @click.self="onCancel">
      <div class="modal" @click.stop>
        <h3>{{ title }}</h3>
        <input
          ref="inputRef"
          v-model="value"
          type="text"
          class="modal-input"
          :placeholder="placeholder ?? ''"
          @keydown.enter.prevent="onConfirm"
          @click.stop
        />
        <div class="row">
          <button type="button" @click="onCancel">取消</button>
          <button type="button" class="primary" :disabled="!value.trim()" @click="onConfirm">
            {{ okLabel || '确定' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps<{
  title: string
  placeholder?: string
  initial?: string
  okLabel?: string
}>()

const emit = defineEmits<{
  confirm: [value: string]
  cancel: []
}>()

const inputRef = ref<HTMLInputElement | null>(null)
const value = ref(props.initial ?? '')

onMounted(async () => {
  await nextTick()
  inputRef.value?.focus()
  inputRef.value?.select()
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
})

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') onCancel()
}

function onConfirm(): void {
  const v = value.value.trim()
  if (!v) return
  emit('confirm', v)
}

function onCancel(): void {
  emit('cancel')
}
</script>

<style scoped>
.modal-input {
  width: 100%;
}
</style>
