<!--
  Shared loading skeleton. Uses the app-level `.shimmer` utility so every
  loader animates with the same rhythm. Three variants cover the shapes we
  reach for: `table` (rows), `card` (header+body), `form` (labels+fields).
-->
<script setup lang="ts">
interface Props {
  variant: "table" | "card" | "form"
  rows?: number
}

withDefaults(defineProps<Props>(), { rows: 6 })
</script>

<template>
  <div v-if="variant === 'table'" class="space-y-1.5">
    <div class="h-10 rounded-lg shimmer opacity-80" />
    <div
      v-for="n in rows"
      :key="n"
      class="h-10 rounded-lg shimmer"
      :style="{ animationDelay: `${n * 80}ms` }"
    />
  </div>
  <div
    v-else-if="variant === 'card'"
    class="rounded-xl border border-default bg-default p-6 space-y-3 overflow-hidden"
  >
    <div class="h-5 w-1/3 rounded shimmer" />
    <div class="h-4 w-2/3 rounded shimmer" style="animation-delay: 80ms" />
    <div class="h-4 w-1/2 rounded shimmer" style="animation-delay: 160ms" />
  </div>
  <div v-else class="space-y-4">
    <div v-for="n in rows" :key="n" class="space-y-2" :style="{ animationDelay: `${n * 80}ms` }">
      <div class="h-4 w-24 rounded shimmer" />
      <div class="h-10 w-full rounded-lg shimmer" />
    </div>
  </div>
</template>
