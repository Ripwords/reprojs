<script setup lang="ts">
const { session, isAdmin, signOut } = useSession()
</script>

<template>
  <div class="min-h-screen bg-neutral-50 text-neutral-900">
    <header class="border-b bg-white">
      <div class="max-w-6xl mx-auto flex items-center justify-between px-6 h-14">
        <NuxtLink to="/" class="font-semibold">Feedback Tool</NuxtLink>
        <nav class="flex gap-4 text-sm">
          <NuxtLink to="/">Projects</NuxtLink>
          <NuxtLink v-if="isAdmin" to="/settings/users">Users</NuxtLink>
          <NuxtLink v-if="isAdmin" to="/settings/install">Install</NuxtLink>
          <NuxtLink to="/settings/account">{{ session.data?.user?.email }}</NuxtLink>
          <button class="text-neutral-500" @click="signOut()">Sign out</button>
        </nav>
      </div>
    </header>
    <main class="max-w-6xl mx-auto p-6">
      <slot />
    </main>
  </div>
</template>
