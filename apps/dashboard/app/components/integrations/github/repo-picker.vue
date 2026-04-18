<script setup lang="ts">
interface Repo {
  id: number
  owner: string
  name: string
  fullName: string
}
interface Props {
  repos: Repo[]
  modelValue: { owner: string; name: string }
}
defineProps<Props>()
const emit = defineEmits<{ "update:modelValue": [{ owner: string; name: string }] }>()
</script>

<template>
  <select
    :value="modelValue.owner && modelValue.name ? `${modelValue.owner}/${modelValue.name}` : ''"
    class="border rounded px-2 py-1 text-sm w-full"
    @change="
      (e) => {
        const v = (e.target as HTMLSelectElement).value
        const [owner, name] = v.split('/')
        emit('update:modelValue', { owner: owner ?? '', name: name ?? '' })
      }
    "
  >
    <option value="" disabled>Select a repository…</option>
    <option v-for="r in repos" :key="r.id" :value="r.fullName">{{ r.fullName }}</option>
  </select>
</template>
