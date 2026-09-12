<template>
  <div ref="host" class="text-editor"></div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { EditorView, keymap } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { basicSetup } from 'codemirror'
import { oneDark } from '@codemirror/theme-one-dark'
import { indentWithTab } from '@codemirror/commands'
import { vim } from '@replit/codemirror-vim'
import { cmDark } from '../theme'
import { store } from '../store'

const props = defineProps<{ path: string; value: string; revision?: number; vim?: boolean }>()
const emit = defineEmits<{ (e: 'update', value: string): void }>()

const host = ref<HTMLDivElement>()
let view: EditorView | null = null

function build(): void {
  view?.destroy()
  view = null
  if (!host.value) return
  const extensions = [
    basicSetup,
    keymap.of([indentWithTab]),
    // Vim 键位（可在设置中开关；Ctrl+S/Ctrl+F 等全局键不在 vim 键位表内，不受影响）
    ...(props.vim ? [vim()] : []),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) {
        emit('update', u.state.doc.toString())
      }
    }),
    EditorView.theme({
      '&': { height: '100%', fontSize: '14px' },
      '.cm-scroller': { fontFamily: 'Consolas, "Courier New", monospace' },
    }),
  ]
  if (cmDark(store.theme)) extensions.push(oneDark)
  view = new EditorView({
    state: EditorState.create({ doc: props.value, extensions }),
    parent: host.value,
  })
}

onMounted(build)
watch(() => store.theme, build)
watch(() => props.vim, build)
watch(
  () => props.revision,
  () => {
    if (view) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: props.value } })
  },
)

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
