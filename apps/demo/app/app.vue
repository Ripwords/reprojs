<script lang="ts" setup>
useHead({
  script: [
    {
      src: "http://localhost:3000/sdk/feedback-tool.iife.js",
      tagPosition: "bodyClose",
    },
  ],
})

declare global {
  interface Window {
    FeedbackTool?: {
      init: (opts: { projectKey: string; endpoint: string }) => void
      identify: (r: { email?: string; name?: string; userId?: string } | null) => void
    }
  }
}

// The <script src="..."> loads async; poll briefly for the global.
function initFeedbackTool(tries = 0): void {
  if (window.FeedbackTool) {
    window.FeedbackTool.init({
      projectKey: "ft_pk_5HAbpZ7lvyhbTPAJZBEm7jH5",
      endpoint: "http://localhost:3000",
    })
    window.FeedbackTool.identify({
      email: "demo@example.com",
      name: "Demo User",
    })
  } else if (tries < 50) {
    setTimeout(() => initFeedbackTool(tries + 1), 50)
  } else {
    console.error(
      "[feedback-tool] SDK failed to load from http://localhost:3000/sdk/feedback-tool.iife.js",
    )
  }
}

onMounted(() => {
  initFeedbackTool()
})
</script>

<template>
  <div>
    <NuxtRouteAnnouncer />
    <NuxtWelcome />
  </div>
</template>
