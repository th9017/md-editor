<template>
  <Teleport to="body">
    <div class="modal-mask" @click.self="emit('choice', 'cancel')">
      <div class="modal" @click.stop>
        <h3>有未保存的更改</h3>
        <p class="msg">
          {{ dirtyCount === 1 ? `「${firstName}」` : `${dirtyCount} 个标签` }}有未保存的更改，关闭窗口前要保存吗？
        </p>
        <div class="row">
          <button type="button" @click="emit('choice', 'cancel')">取消</button>
          <button type="button" class="danger" @click="emit('choice', 'discard')">不保存关闭</button>
          <button type="button" class="primary" @click="emit('choice', 'save')">保存并关闭</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { store } from '../store'

const emit = defineEmits<{
  choice: ['save' | 'discard' | 'cancel']
}>()

const dirtyTabs = computed(() => store.tabs.filter((t) => t.content !== t.savedContent))
const dirtyCount = computed(() => dirtyTabs.value.length)
const firstName = computed(() => dirtyTabs.value[0]?.name ?? '')

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('choice', 'cancel')
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<style scoped>
.msg {
  margin: 0 0 14px;
  line-height: 1.7;
  color: var(--text);
}

.danger {
  color: var(--err);
}
</style>
