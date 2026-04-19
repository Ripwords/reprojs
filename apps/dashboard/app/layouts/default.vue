<script setup lang="ts">
import ConfirmDialogHost from "~/components/common/confirm-dialog-host.vue"
import CommandPalette from "~/components/shell/command-palette.vue"
import AppSidebar from "~/components/shell/app-sidebar.vue"
import AppTopBar from "~/components/shell/app-top-bar.vue"
</script>

<template>
  <UApp>
    <div class="app-grain min-h-screen flex bg-muted text-default">
      <AppSidebar />
      <div class="flex-1 flex flex-col min-w-0">
        <AppTopBar />
        <main class="flex-1 overflow-y-auto">
          <div class="p-6 fade-up">
            <slot />
          </div>
        </main>
      </div>
    </div>
    <ConfirmDialogHost />
    <CommandPalette />
  </UApp>
</template>
