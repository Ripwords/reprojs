<script setup lang="ts">
import { ref, computed } from "vue"

interface Props {
  open: boolean
  title: string
  description: string
  /** If set, user must type this exact string before confirm is enabled. */
  confirmText?: string
  loading?: boolean
}

const props = defineProps<Props>()
const emit = defineEmits<{ "update:open": [boolean]; confirm: [] }>()

const typed = ref("")
const canConfirm = computed(() => {
  if (!props.confirmText) return true
  return typed.value === props.confirmText
})

function close() {
  typed.value = ""
  emit("update:open", false)
}
</script>

<template>
  <UModal :open="open" @update:open="close">
    <template #content>
      <div class="p-6 space-y-4">
        <h3 class="text-lg font-semibold text-default">{{ title }}</h3>
        <p class="text-sm text-muted">{{ description }}</p>
        <div v-if="confirmText" class="space-y-2">
          <p class="text-sm text-muted">
            Type <code class="px-1 rounded bg-muted">{{ confirmText }}</code> to confirm.
          </p>
          <UInput v-model="typed" :placeholder="confirmText" />
        </div>
        <div class="flex justify-end gap-2">
          <UButton label="Cancel" color="neutral" variant="ghost" @click="close" />
          <UButton
            label="Delete"
            color="error"
            :disabled="!canConfirm"
            :loading="loading"
            @click="emit('confirm')"
          />
        </div>
      </div>
    </template>
  </UModal>
</template>
