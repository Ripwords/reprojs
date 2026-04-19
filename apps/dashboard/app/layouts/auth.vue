<template>
  <div
    class="app-grain min-h-screen flex items-center justify-center relative overflow-hidden bg-default"
  >
    <!-- Ambient colored-glow atmosphere. Two large, heavily-blurred radial
         blobs anchored off-canvas give the sign-in surface warmth without
         looking like a stock-SaaS "purple gradient on white". The glow
         slowly drifts for a subtle sense of life on an otherwise
         near-static screen. -->
    <div
      class="pointer-events-none absolute -top-32 -left-32 size-[32rem] rounded-full bg-primary/20 blur-3xl motion-safe:animate-[glow-drift_14s_ease-in-out_infinite]"
      aria-hidden="true"
    />
    <div
      class="pointer-events-none absolute -bottom-40 -right-24 size-[28rem] rounded-full bg-primary/10 blur-3xl motion-safe:animate-[glow-drift_18s_ease-in-out_infinite_reverse]"
      aria-hidden="true"
    />

    <div class="relative w-full max-w-md px-6 fade-up">
      <slot />
    </div>
  </div>
</template>

<style>
@keyframes glow-drift {
  0%,
  100% {
    transform: translate(0, 0) scale(1);
    opacity: 0.8;
  }
  50% {
    transform: translate(4%, -3%) scale(1.08);
    opacity: 1;
  }
}
</style>
