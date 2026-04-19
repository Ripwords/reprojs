<script setup lang="ts">
interface Props {
  title?: string
  message: string
  detail?: string
}

withDefaults(defineProps<Props>(), {
  title: "Something went wrong",
})

defineEmits<{ retry: [] }>()

function copyDetail(text: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    void navigator.clipboard.writeText(text)
  }
}
</script>

<template>
  <div
    class="rounded-xl border border-error/30 bg-error/5 px-6 py-10 flex flex-col items-center text-center"
  >
    <UIcon name="i-heroicons-exclamation-triangle" class="size-10 text-error mb-3" />
    <h3 class="text-base font-semibold text-default">{{ title }}</h3>
    <p class="mt-2 text-sm text-muted max-w-md">{{ message }}</p>
    <div class="mt-5 flex gap-2">
      <UButton label="Retry" color="neutral" variant="outline" @click="$emit('retry')" />
      <UButton
        v-if="detail"
        label="Copy error"
        color="neutral"
        variant="ghost"
        @click="copyDetail(detail)"
      />
    </div>
  </div>
</template>
