<script setup lang="ts">
import type { InvitationDetailDTO } from "@reprojs/shared"

definePageMeta({ middleware: [] })

const route = useRoute()
const token = computed(() => String(route.params.token))
const toast = useToast()
const { signOut } = useSession()

const invite = ref<InvitationDetailDTO | null>(null)
const errorCode = ref<"email_mismatch" | "expired" | "revoked" | "accepted" | "not_found" | null>(
  null,
)
const pending = ref(true)
const submitting = ref(false)

useHead({ title: "Accept invitation" })

async function load() {
  pending.value = true
  try {
    invite.value = await $fetch<InvitationDetailDTO>(`/api/invitations/${token.value}`, {
      credentials: "include",
    })
  } catch (err: unknown) {
    const status = (err as { statusCode?: number }).statusCode
    if (status === 401) {
      await navigateTo(`/auth/sign-in?returnTo=/invitations/${token.value}`)
      return
    }
    if (status === 409) {
      const msg = (err as { statusMessage?: string }).statusMessage
      if (msg === "expired" || msg === "revoked" || msg === "already_accepted") {
        errorCode.value = msg === "already_accepted" ? "accepted" : msg
      } else {
        errorCode.value = "not_found"
      }
      return
    }
    if (status === 404) errorCode.value = "not_found"
    else if (status === 403) errorCode.value = "email_mismatch"
    else errorCode.value = "not_found"
  } finally {
    pending.value = false
  }
}
await load()

async function accept() {
  submitting.value = true
  try {
    const res = await $fetch<{ projectId: string; role: string }>(
      `/api/invitations/${token.value}/accept`,
      { method: "POST", credentials: "include" },
    )
    toast.add({ title: "Invitation accepted", color: "success", icon: "i-heroicons-check-circle" })
    await navigateTo(`/projects/${res.projectId}`)
  } catch (err: unknown) {
    const status = (err as { statusCode?: number }).statusCode
    const msg = (err as { statusMessage?: string }).statusMessage ?? ""
    if (status === 403 && msg === "email_mismatch") errorCode.value = "email_mismatch"
    else if (status === 409 && msg === "expired") errorCode.value = "expired"
    else if (status === 409 && msg === "revoked") errorCode.value = "revoked"
    else
      toast.add({
        title: "Could not accept invitation",
        description: msg,
        color: "error",
        icon: "i-heroicons-exclamation-triangle",
      })
  } finally {
    submitting.value = false
  }
}

async function decline() {
  submitting.value = true
  try {
    await $fetch(`/api/invitations/${token.value}/decline`, {
      method: "POST",
      credentials: "include",
    })
    await navigateTo("/")
  } catch (err: unknown) {
    toast.add({
      title: "Could not decline",
      description: err instanceof Error ? err.message : undefined,
      color: "error",
    })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="max-w-md mx-auto p-6 mt-16">
    <UCard v-if="pending">
      <p class="text-sm text-muted">Loading invitation…</p>
    </UCard>

    <UCard v-else-if="errorCode === 'email_mismatch'">
      <h1 class="text-xl font-semibold mb-2">Wrong account</h1>
      <p class="text-sm text-muted mb-4">
        This invitation was sent to a different email. Please sign out and sign in as the invited
        address.
      </p>
      <UButton
        label="Sign out"
        @click="signOut({ redirectTo: `/auth/sign-in?returnTo=/invitations/${token}` })"
      />
    </UCard>

    <UCard v-else-if="errorCode === 'expired'">
      <h1 class="text-xl font-semibold mb-2">This invitation expired</h1>
      <p class="text-sm text-muted">Ask the inviter to resend it.</p>
    </UCard>

    <UCard v-else-if="errorCode === 'revoked'">
      <h1 class="text-xl font-semibold mb-2">This invitation is no longer valid</h1>
      <p class="text-sm text-muted">It was revoked or declined.</p>
    </UCard>

    <UCard v-else-if="errorCode === 'accepted'">
      <h1 class="text-xl font-semibold mb-2">Invitation already accepted</h1>
      <p class="text-sm text-muted">You've already joined this project.</p>
    </UCard>

    <UCard v-else-if="errorCode === 'not_found'">
      <h1 class="text-xl font-semibold mb-2">Invitation not found</h1>
    </UCard>

    <UCard v-else-if="invite">
      <h1 class="text-xl font-semibold mb-2">Join {{ invite.projectName }}</h1>
      <p class="text-sm text-muted mb-4">
        {{ invite.inviterName ?? invite.inviterEmail }} invited you to join as
        <strong>{{ invite.role }}</strong
        >.
      </p>
      <div class="flex justify-end gap-2">
        <UButton
          label="Decline"
          color="neutral"
          variant="ghost"
          :loading="submitting"
          @click="decline"
        />
        <UButton label="Accept" color="primary" :loading="submitting" @click="accept" />
      </div>
    </UCard>
  </div>
</template>
