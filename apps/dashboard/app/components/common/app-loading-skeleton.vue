<script setup lang="ts">
interface Props {
  variant: "table" | "card" | "form"
  rows?: number
}

withDefaults(defineProps<Props>(), { rows: 6 })
</script>

<template>
  <div v-if="variant === 'table'" class="space-y-2">
    <USkeleton class="h-9 w-full" />
    <USkeleton v-for="n in rows" :key="n" class="h-9 w-full" />
  </div>
  <div
    v-else-if="variant === 'card'"
    class="rounded-xl border border-default bg-default p-6 space-y-3"
  >
    <USkeleton class="h-5 w-1/3" />
    <USkeleton class="h-4 w-2/3" />
    <USkeleton class="h-4 w-1/2" />
  </div>
  <div v-else class="space-y-4">
    <div v-for="n in rows" :key="n" class="space-y-2">
      <USkeleton class="h-4 w-24" />
      <USkeleton class="h-9 w-full" />
    </div>
  </div>
</template>
