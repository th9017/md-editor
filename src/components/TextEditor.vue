<template>
  <div ref="host" class="text-editor"></div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { EditorView, keymap } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { basicSetup } from 'codemirror'
import { oneDark } from '@codemirror/theme-one-dark'
import { indentWithTab } from '@codemirror/commands'
import { store, scheduleSave } from '../store'

const props = defineProps<{ path: string; value: string }>()
const emit = defineEmits<{ (e: 'update', value: string): void }>()

const host = ref<HTMLDivElement>()
let view: EditorView | null = null

onMounted(() => {
  const extensions = [
    basicSetup,
    keymap.of([indentWithTab]),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) {
        emit('update', u.state.doc.toString())
        scheduleSave()
      }
    }),
    EditorView.theme({
      '&': { height: '100%', fontSize: '14px' },
      '.cm-scroller': { fontFamily: 'Consolas, "Courier New", monospace' },
    }),
  ]
  if (store.theme === 'dark') extensions.push(oneDark)
  view = new EditorView({
    state: EditorState.create({ doc: props.value, extensions }),
    parent: host.value!,
  })
})

onBeforeUnmount(() => {
  view?.destroy()
  view = null
})
</script>

<style scoped>
.text-editor {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
</style>
