<script setup lang="ts">
const { session, signOut } = useSession()
</script>

<template>
  <div class="space-y-4 max-w-md">
    <h1 class="text-2xl font-semibold">Account</h1>
    <div class="border rounded-lg bg-white p-4 space-y-2 text-sm">
      <div><span class="text-neutral-500">Email:</span> {{ session.data?.user?.email }}</div>
      <div>
        <span class="text-neutral-500">Role:</span>
        {{ (session.data?.user as { role?: string } | undefined)?.role }}
      </div>
    </div>
    <button class="border rounded px-4 py-2" @click="signOut()">Sign out</button>
  </div>
</template>
