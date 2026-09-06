<template>
  <Teleport to="body">
    <div ref="menuRef" class="ctx-menu" :style="{ left: `${pos.x}px`, top: `${pos.y}px` }">
      <template v-for="(item, i) in items" :key="i">
        <hr v-if="item.sep" class="ctx-sep" />
        <button
          v-else
          type="button"
          class="ctx-item"
          :class="{ danger: item.danger }"
          @click="run(item)"
        >
          {{ item.label }}
        </button>
      </template>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

export interface ContextMenuItem {
  label?: string
  danger?: boolean
  sep?: boolean
  action?: () => void
}

const props = defineProps<{
  x: number
  y: number
  items: ContextMenuItem[]
}>()

const emit = defineEmits<{ close: [] }>()

const menuRef = ref<HTMLElement | null>(null)
const pos = ref({ x: props.x, y: props.y })

onMounted(async () => {
  await nextTick()
  // 边缘翻转：超出视口时向内收
  const el = menuRef.value
  if (el) {
    const w = el.offsetWidth
    const h = el.offsetHeight
    let { x, y } = pos.value
    if (x + w > window.innerWidth - 4) x = Math.max(4, window.innerWidth - w - 4)
    if (y + h > window.innerHeight - 4) y = Math.max(4, window.innerHeight - h - 4)
    pos.value = { x, y }
  }
  window.addEventListener('mousedown', onGlobalMousedown, true)
  window.addEventListener('keydown', onKeydown, true)
})

onBeforeUnmount(() => {
  window.removeEventListener('mousedown', onGlobalMousedown, true)
  window.removeEventListener('keydown', onKeydown, true)
})

function run(item: ContextMenuItem): void {
  item.action?.()
  emit('close')
}

function onGlobalMousedown(e: MouseEvent): void {
  if (menuRef.value && !menuRef.value.contains(e.target as Node)) emit('close')
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close')
}
</script>
