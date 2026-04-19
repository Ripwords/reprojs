<script setup lang="ts">
import { _useConfirmHost } from "~/composables/use-confirm"

const { open, state, accept, cancel } = _useConfirmHost()

function onOpenUpdate(next: boolean) {
  // Closing via overlay click / escape key counts as cancel.
  if (!next) cancel()
  else open.value = next
}
</script>

<template>
  <UModal :open="open" :ui="{ content: 'max-w-md' }" @update:open="onOpenUpdate">
    <template #content>
      <div class="p-6 space-y-4">
        <div class="flex items-start gap-3">
          <div
            v-if="state.icon"
            :class="[
              'flex items-center justify-center rounded-full size-10 shrink-0',
              state.confirmColor === 'error'
                ? 'bg-error/10 text-error'
                : state.confirmColor === 'warning'
                  ? 'bg-warning/10 text-warning'
                  : 'bg-primary/10 text-primary',
            ]"
          >
            <UIcon :name="state.icon" class="size-5" />
          </div>
          <div class="flex-1 min-w-0">
            <h3 class="text-base font-semibold text-default">{{ state.title }}</h3>
            <p v-if="state.description" class="mt-1.5 text-sm text-muted leading-relaxed">
              {{ state.description }}
            </p>
          </div>
        </div>
        <div class="flex justify-end gap-2 pt-2">
          <UButton :label="state.cancelLabel" color="neutral" variant="ghost" @click="cancel" />
          <UButton :label="state.confirmLabel" :color="state.confirmColor" @click="accept" />
        </div>
      </div>
    </template>
  </UModal>
</template>
