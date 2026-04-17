import { h } from "preact"

interface LauncherProps {
  position: "bottom-right" | "bottom-left" | "top-right" | "top-left"
  onClick: () => void
}

export function Launcher({ position, onClick }: LauncherProps) {
  return (
    <button
      class={`ft-launcher pos-${position}`}
      aria-label="Report a bug"
      type="button"
      onClick={onClick}
    >
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M8 2l1.5 2h5L16 2" />
        <path d="M9 6h6a3 3 0 013 3v6a6 6 0 01-12 0V9a3 3 0 013-3z" />
        <path d="M6 12h-2M6 8h-2M6 16h-2" />
        <path d="M18 12h2M18 8h2M18 16h2" />
      </svg>
    </button>
  )
}
