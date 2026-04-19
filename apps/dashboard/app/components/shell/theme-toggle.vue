<script setup lang="ts">
const colorMode = useColorMode()

const items = [
  { label: "Light", icon: "i-heroicons-sun", value: "light" },
  { label: "Dark", icon: "i-heroicons-moon", value: "dark" },
  { label: "System", icon: "i-heroicons-computer-desktop", value: "system" },
] as const

function select(value: "light" | "dark" | "system") {
  colorMode.preference = value
}
</script>

<template>
  <UDropdownMenu
    :items="items.map((i) => ({ label: i.label, icon: i.icon, onSelect: () => select(i.value) }))"
  >
    <UButton
      :icon="colorMode.value === 'dark' ? 'i-heroicons-moon' : 'i-heroicons-sun'"
      color="neutral"
      variant="ghost"
      size="sm"
      aria-label="Toggle theme"
    />
  </UDropdownMenu>
</template>
