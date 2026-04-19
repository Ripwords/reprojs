<!--
  Shared error state. Refined version: framed card with a subtle error-tinted
  radial glow, destructive-colored icon chip, and actions underneath. Used
  for in-page errors (API failures, missing data). Does not replace the
  global error pages.
-->
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
    class="relative overflow-hidden rounded-xl border border-error/30 bg-error/5 px-6 py-10 flex flex-col items-center text-center"
  >
    <div
      class="pointer-events-none absolute inset-0 opacity-70"
      aria-hidden="true"
      :style="{
        background:
          'radial-gradient(ellipse 60% 50% at 50% 20%, color-mix(in oklch, var(--ui-color-error-500) 10%, transparent), transparent 70%)',
      }"
    />

    <div
      class="relative flex items-center justify-center size-12 rounded-xl bg-error/10 text-error ring-1 ring-error/20 mb-4"
    >
      <UIcon name="i-heroicons-exclamation-triangle" class="size-6" />
    </div>

    <h3 class="relative text-base font-semibold text-default tracking-tight">{{ title }}</h3>
    <p class="relative mt-2 text-sm text-muted max-w-md leading-relaxed">{{ message }}</p>

    <div class="relative mt-5 flex gap-2">
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
