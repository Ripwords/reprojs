<!-- apps/dashboard/app/components/integrations/github/unlink-dialog.vue -->
<script setup lang="ts">
interface Props {
  issueNumber: number
  repoFullName: string
  open: boolean
}
defineProps<Props>()
const emit = defineEmits<{ cancel: []; confirm: [] }>()
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 z-50 bg-black/40 flex items-center justify-center"
    @click="emit('cancel')"
  >
    <div class="bg-white rounded-lg p-4 max-w-md text-sm" @click.stop>
      <h3 class="font-semibold mb-2">Unlink this report from issue #{{ issueNumber }}?</h3>
      <p class="text-neutral-600 mb-3">
        The GitHub issue will stay open in <code>{{ repoFullName }}</code> but won't sync with the
        dashboard anymore. You can create a new issue afterward.
      </p>
      <div class="flex gap-2 justify-end">
        <button type="button" class="border rounded px-3 py-1.5" @click="emit('cancel')">
          Cancel
        </button>
        <button
          type="button"
          class="border rounded px-3 py-1.5 text-red-700"
          @click="emit('confirm')"
        >
          Unlink
        </button>
      </div>
    </div>
  </div>
</template>
