<script setup lang="ts">
import AppSidebar from "~/components/shell/app-sidebar.vue"
import AppTopBar from "~/components/shell/app-top-bar.vue"
</script>

<template>
  <UApp>
    <div class="min-h-screen flex bg-muted text-default">
      <AppSidebar />
      <div class="flex-1 flex flex-col min-w-0">
        <AppTopBar />
        <main class="flex-1 overflow-y-auto">
          <div class="p-6">
            <slot />
          </div>
        </main>
      </div>
    </div>
  </UApp>
</template>
