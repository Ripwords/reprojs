<script setup lang="ts">
import type { ProjectDTO, ProjectMemberDTO, ProjectRole } from "@feedback-tool/shared"

const route = useRoute()
const { data: project } = await useApi<ProjectDTO>(`/api/projects/${route.params.id}`)
const { data: members, refresh } = await useApi<ProjectMemberDTO[]>(
  `/api/projects/${route.params.id}/members`,
)
const email = ref("")
const role = ref<ProjectRole>("developer")

async function add() {
  await $fetch(`/api/projects/${route.params.id}/members`, {
    method: "POST",
    baseURL: useRuntimeConfig().public.betterAuthUrl,
    credentials: "include",
    body: { email: email.value, role: role.value },
  })
  email.value = ""
  await refresh()
}

async function changeRole(userId: string, r: ProjectRole) {
  await $fetch(`/api/projects/${route.params.id}/members/${userId}`, {
    method: "PATCH",
    baseURL: useRuntimeConfig().public.betterAuthUrl,
    credentials: "include",
    body: { role: r },
  })
  await refresh()
}

async function remove(userId: string) {
  await $fetch(`/api/projects/${route.params.id}/members/${userId}`, {
    method: "DELETE",
    baseURL: useRuntimeConfig().public.betterAuthUrl,
    credentials: "include",
  })
  await refresh()
}
</script>

<template>
  <div class="space-y-6">
    <h1 class="text-2xl font-semibold">{{ project?.name }} — Members</h1>
    <form v-if="project?.effectiveRole === 'owner'" class="flex gap-2" @submit.prevent="add">
      <input
        v-model="email"
        type="email"
        placeholder="user@example.com"
        class="border rounded px-3 py-2 flex-1"
        required
      />
      <select v-model="role" class="border rounded px-3 py-2">
        <option value="viewer">Viewer</option>
        <option value="developer">Developer</option>
        <option value="owner">Owner</option>
      </select>
      <button class="bg-neutral-900 text-white rounded px-4 py-2">Add</button>
    </form>
    <table class="w-full bg-white border rounded">
      <thead class="bg-neutral-100 text-left text-sm">
        <tr>
          <th class="p-3">Email</th>
          <th class="p-3">Role</th>
          <th class="p-3"></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="m in members" :key="m.userId" class="border-t">
          <td class="p-3">{{ m.email }}</td>
          <td class="p-3">
            <select
              :value="m.role"
              :disabled="project?.effectiveRole !== 'owner'"
              class="border rounded px-2 py-1"
              @change="
                changeRole(m.userId, ($event.target as HTMLSelectElement).value as ProjectRole)
              "
            >
              <option value="viewer">viewer</option>
              <option value="developer">developer</option>
              <option value="owner">owner</option>
            </select>
          </td>
          <td class="p-3 text-right">
            <button
              v-if="project?.effectiveRole === 'owner'"
              class="text-red-600"
              @click="remove(m.userId)"
            >
              Remove
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
