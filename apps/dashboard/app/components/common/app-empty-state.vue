<script setup lang="ts">
interface Props {
  icon?: string
  title: string
  description?: string
  actionLabel?: string
  actionTo?: string
  variant?: "plain" | "gradient"
}

const props = withDefaults(defineProps<Props>(), {
  icon: "i-heroicons-inbox",
  variant: "plain",
})

defineEmits<{ action: [] }>()

const gradientClasses =
  "relative overflow-hidden rounded-xl border border-default bg-gradient-to-br from-primary-50 via-default to-default dark:from-primary-950/30 dark:via-default dark:to-default"
</script>

<template>
  <div
    :class="[
      variant === 'gradient' ? gradientClasses : 'rounded-xl border border-default bg-default',
      'flex flex-col items-center justify-center text-center px-6 py-16',
    ]"
  >
    <UIcon :name="props.icon" class="size-12 text-muted mb-4" />
    <h3 class="text-lg font-semibold text-default">{{ title }}</h3>
    <p v-if="description" class="mt-2 text-sm text-muted max-w-md">{{ description }}</p>
    <div v-if="actionLabel" class="mt-6">
      <UButton
        :label="actionLabel"
        :to="actionTo"
        color="primary"
        @click="!actionTo && $emit('action')"
      />
    </div>
  </div>
</template>
