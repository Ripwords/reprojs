<script setup lang="ts">
import type { InstallRole, UserDTO } from "@feedback-tool/shared"

definePageMeta({ middleware: "admin-only" })

const { data: users, refresh } = await useApi<UserDTO[]>("/api/users")
const inviteEmail = ref("")
const inviteRole = ref<InstallRole>("member")

async function invite() {
  await $fetch("/api/users", {
    method: "POST",
    baseURL: useRuntimeConfig().public.betterAuthUrl,
    credentials: "include",
    body: { email: inviteEmail.value, role: inviteRole.value },
  })
  inviteEmail.value = ""
  await refresh()
}

async function updateRole(id: string, role: InstallRole) {
  await $fetch(`/api/users/${id}`, {
    method: "PATCH",
    baseURL: useRuntimeConfig().public.betterAuthUrl,
    credentials: "include",
    body: { role },
  })
  await refresh()
}

async function disable(id: string) {
  await $fetch(`/api/users/${id}`, {
    method: "PATCH",
    baseURL: useRuntimeConfig().public.betterAuthUrl,
    credentials: "include",
    body: { status: "disabled" },
  })
  await refresh()
}
</script>

<template>
  <div class="space-y-6">
    <h1 class="text-2xl font-semibold">Users</h1>
    <form class="flex gap-2" @submit.prevent="invite">
      <input
        v-model="inviteEmail"
        type="email"
        placeholder="user@example.com"
        class="border rounded px-3 py-2 flex-1"
        required
      />
      <select v-model="inviteRole" class="border rounded px-3 py-2">
        <option value="member">Member</option>
        <option value="admin">Admin</option>
      </select>
      <button class="bg-neutral-900 text-white rounded px-4 py-2">Invite</button>
    </form>
    <table class="w-full bg-white border rounded">
      <thead class="bg-neutral-100 text-left text-sm">
        <tr>
          <th class="p-3">Email</th>
          <th class="p-3">Role</th>
          <th class="p-3">Status</th>
          <th class="p-3"></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="u in users" :key="u.id" class="border-t">
          <td class="p-3">{{ u.email }}</td>
          <td class="p-3">
            <select
              :value="u.role"
              class="border rounded px-2 py-1"
              @change="updateRole(u.id, ($event.target as HTMLSelectElement).value as InstallRole)"
            >
              <option value="member">member</option>
              <option value="admin">admin</option>
            </select>
          </td>
          <td class="p-3">{{ u.status }}</td>
          <td class="p-3 text-right">
            <button class="text-red-600" @click="disable(u.id)">Disable</button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
