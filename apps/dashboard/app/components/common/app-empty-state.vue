<!--
  Shared empty-state. Two variants:
    - `plain`    — flat bordered card, for secondary empty zones inside
                   a larger page (e.g. empty Recent Reports on an overview).
    - `gradient` — atmospheric hero for first-time screens. A teal radial
                   bloom + faint grid texture behind the icon signals
                   "this is where something will live", without shouting.
-->
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
</script>

<template>
  <div
    :class="[
      'relative overflow-hidden rounded-xl border border-default',
      variant === 'gradient' ? 'bg-default' : 'bg-default',
      'flex flex-col items-center justify-center text-center px-6 py-16',
    ]"
  >
    <!-- Gradient variant gets a layered background: a radial teal glow
         anchored behind the icon, plus a faint dot-grid so the surface
         reads as "canvas" rather than "empty" -->
    <template v-if="variant === 'gradient'">
      <div
        class="pointer-events-none absolute inset-0 opacity-60 dark:opacity-80"
        aria-hidden="true"
        :style="{
          background:
            'radial-gradient(ellipse 60% 50% at 50% 30%, color-mix(in oklch, var(--ui-primary) 12%, transparent), transparent 70%)',
        }"
      />
      <div
        class="pointer-events-none absolute inset-0 opacity-[0.35] dark:opacity-[0.18]"
        aria-hidden="true"
        :style="{
          backgroundImage: 'radial-gradient(circle, currentColor 1px, transparent 1px)',
          backgroundSize: '14px 14px',
          maskImage: 'radial-gradient(ellipse 60% 50% at 50% 30%, black, transparent 70%)',
          color: 'var(--ui-text-muted)',
        }"
      />
    </template>

    <div
      :class="[
        'relative flex items-center justify-center size-14 rounded-xl mb-4',
        variant === 'gradient'
          ? 'bg-primary/10 text-primary ring-1 ring-primary/20'
          : 'bg-muted text-muted',
      ]"
    >
      <UIcon :name="props.icon" class="size-6" />
    </div>

    <h3 class="relative text-lg font-semibold text-default tracking-tight">{{ title }}</h3>
    <p v-if="description" class="relative mt-2 text-sm text-muted max-w-md leading-relaxed">
      {{ description }}
    </p>

    <div v-if="actionLabel" class="relative mt-6">
      <UButton
        :label="actionLabel"
        :to="actionTo"
        color="primary"
        @click="!actionTo && $emit('action')"
      />
    </div>
  </div>
</template>
