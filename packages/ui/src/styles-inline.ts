// Auto-generated from styles.css by build-css.ts. Do not edit by hand.
// Run `bun run packages/ui/build-css.ts` after editing styles.css.

export default String.raw`:host,
* {
  box-sizing: border-box;
}
.ft-launcher {
  position: fixed;
  width: 56px;
  height: 56px;
  border-radius: var(--ft-radius-pill);
  background: var(--ft-color-text);
  color: var(--ft-color-bg);
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
  z-index: 2147483640;
  font-family:
    system-ui,
    -apple-system,
    sans-serif;
}
.ft-launcher:hover {
  background: color-mix(in oklch, var(--ft-color-text) 90%, black);
}
.ft-launcher.pos-bottom-right {
  right: 24px;
  bottom: 24px;
}
.ft-launcher.pos-bottom-left {
  left: 24px;
  bottom: 24px;
}
.ft-launcher.pos-top-right {
  right: 24px;
  top: 24px;
}
.ft-launcher.pos-top-left {
  left: 24px;
  top: 24px;
}

.ft-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2147483641;
  font-family:
    system-ui,
    -apple-system,
    sans-serif;
}

/* === Wizard shell === */
.ft-wizard {
  position: fixed;
  inset: 0;
  z-index: 2147483641;
  background: var(--ft-color-bg);
  color: var(--ft-color-text);
  display: flex;
  flex-direction: column;
  font-family:
    system-ui,
    -apple-system,
    sans-serif;
}
.ft-wizard-header {
  display: grid;
  grid-template-columns: 36px 1fr 36px;
  align-items: center;
  padding: 14px 20px 12px;
  background: var(--ft-color-bg);
  border-bottom: 1px solid var(--ft-color-border);
  gap: 8px;
}
.ft-wizard-eyebrow {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ft-color-primary);
  margin: 0 0 2px;
}
.ft-wizard-title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.3px;
  color: var(--ft-color-text);
}
.ft-icon-btn {
  width: 36px;
  height: 36px;
  border-radius: var(--ft-radius-pill);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--ft-color-surface);
  border: 0;
  color: var(--ft-color-text-muted);
  cursor: pointer;
}
.ft-icon-btn:hover {
  background: var(--ft-color-surface-soft);
  color: var(--ft-color-text);
}

.ft-wizard-body {
  flex: 1;
  min-height: 0;
  display: flex;
  overflow: hidden;
}
.ft-wizard-annotate {
  background: var(--ft-color-surface-soft);
}

/* Details + Review share a centered column layout */
.ft-wizard-step {
  flex: 1;
  overflow: auto;
  padding: 24px;
}
.ft-wizard-step-inner {
  max-width: 520px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.ft-wizard-footer {
  background: var(--ft-color-bg);
  border-top: 1px solid var(--ft-color-border);
  padding: 14px 20px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.ft-wizard-loading {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.75);
  color: var(--ft-color-bg);
  z-index: 2147483641;
  font-family:
    system-ui,
    -apple-system,
    sans-serif;
}

/* === Buttons === */
.ft-btn-primary {
  background: var(--ft-color-primary);
  color: #ffffff;
  border: 0;
  border-radius: var(--ft-radius-md);
  padding: 14px 24px;
  font: inherit;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.2px;
  cursor: pointer;
  min-height: 44px;
  box-shadow:
    0 6px 14px -6px color-mix(in oklch, var(--ft-color-primary) 60%, transparent),
    0 0 0 1px color-mix(in oklch, var(--ft-color-primary) 30%, transparent);
}
.ft-btn-primary:hover:not(:disabled) {
  background: var(--ft-color-primary-pressed);
}
.ft-btn-primary:disabled {
  background: var(--ft-color-primary-disabled);
  box-shadow: none;
  cursor: not-allowed;
}
.ft-btn-secondary {
  background: transparent;
  color: var(--ft-color-text-muted);
  border: 0;
  border-radius: var(--ft-radius-md);
  padding: 14px 20px;
  font: inherit;
  font-size: 15px;
  font-weight: 500;
  cursor: pointer;
  min-height: 44px;
}
.ft-btn-secondary:hover:not(:disabled) {
  color: var(--ft-color-text);
  background: var(--ft-color-surface);
}
.ft-btn-secondary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* === Step indicator === */
.ft-stepper {
  display: flex;
  align-items: flex-start;
  margin-top: 18px;
}
.ft-stepper-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  min-width: 64px;
}
.ft-stepper-dot {
  width: 24px;
  height: 24px;
  border-radius: var(--ft-radius-pill);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--ft-color-surface);
  color: var(--ft-color-text-faint);
  font-size: 11px;
  font-weight: 700;
}
.ft-stepper-dot.active,
.ft-stepper-dot.done {
  background: var(--ft-color-primary);
  color: #ffffff;
}
.ft-stepper-label {
  font-size: 11px;
  font-weight: 500;
  color: var(--ft-color-text-faint);
  letter-spacing: 0.2px;
}
.ft-stepper-label.active {
  color: var(--ft-color-text);
  font-weight: 600;
}
.ft-stepper-label.done {
  color: var(--ft-color-text-muted);
}
.ft-stepper-bar {
  flex: 1;
  height: 2px;
  background: var(--ft-color-border);
  margin: 11px 6px 0;
  border-radius: 1px;
}
.ft-stepper-bar.done {
  background: var(--ft-color-primary);
}

/* === Field labels + inputs === */
.ft-field-label {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 1.2px;
  text-transform: uppercase;
  color: var(--ft-color-text);
}
.ft-field-label-optional {
  font-style: italic;
  font-weight: 500;
  letter-spacing: 0;
  text-transform: none;
  font-size: 11px;
  color: var(--ft-color-text-faint);
}
.ft-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ft-field input,
.ft-field textarea {
  width: 100%;
  padding: 14px;
  background: var(--ft-color-surface-soft);
  border: 1px solid var(--ft-color-border);
  border-radius: var(--ft-radius-md);
  font: inherit;
  font-size: 15px;
  color: var(--ft-color-text);
}
.ft-field textarea {
  min-height: 140px;
  resize: vertical;
}
.ft-field input:focus,
.ft-field textarea:focus {
  outline: none;
  border-color: var(--ft-color-primary);
}

/* === Review summary card === */
.ft-summary {
  background: var(--ft-color-surface-soft);
  border: 1px solid var(--ft-color-border);
  border-radius: var(--ft-radius-lg);
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.ft-summary-title {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1.3px;
  text-transform: uppercase;
  color: var(--ft-color-text-muted);
}
.ft-summary-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.ft-summary-bullet {
  width: 5px;
  height: 5px;
  border-radius: var(--ft-radius-pill);
  background: var(--ft-color-primary);
}
.ft-summary-label {
  flex: 1;
  font-size: 14px;
  color: var(--ft-color-text);
}
.ft-summary-hint {
  font-size: 12px;
  color: var(--ft-color-text-muted);
  font-variant-numeric: tabular-nums;
}

/* === Inline messages === */
.ft-msg {
  font-size: 12px;
  margin-top: 8px;
}
.ft-msg.err {
  color: var(--ft-color-danger);
}
.ft-msg.ok {
  color: color-mix(in oklch, var(--ft-color-primary) 60%, var(--ft-color-text));
}
.ft-error-card {
  background: var(--ft-color-danger-soft);
  border: 1px solid var(--ft-color-danger-border);
  border-radius: var(--ft-radius-md);
  padding: 14px;
  color: var(--ft-color-danger);
  font-size: 14px;
}

/* === Tool picker === */
.ft-tool-picker {
  display: flex;
  gap: 16px;
  align-items: center;
  flex-wrap: wrap;
}
.ft-tool-group {
  display: flex;
  gap: 4px;
  align-items: center;
}
.ft-tool {
  width: 36px;
  height: 36px;
  border: 1px solid var(--ft-color-border);
  background: var(--ft-color-bg);
  color: var(--ft-color-text);
  border-radius: var(--ft-radius-md);
  cursor: pointer;
  font-size: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.ft-tool:hover {
  background: var(--ft-color-surface);
}
.ft-tool.active {
  background: var(--ft-color-text);
  color: var(--ft-color-bg);
  border-color: var(--ft-color-text);
}
.ft-tool[disabled] {
  opacity: 0.4;
  cursor: not-allowed;
}
.ft-swatch {
  width: 22px;
  height: 22px;
  border-radius: var(--ft-radius-pill);
  border: 2px solid transparent;
  cursor: pointer;
  padding: 0;
}
.ft-swatch.active {
  border-color: var(--ft-color-text);
  transform: scale(1.1);
}
.ft-stroke {
  background: var(--ft-color-bg);
  border: 1px solid var(--ft-color-border);
  border-radius: var(--ft-radius-md);
  padding: 0 6px;
  height: 36px;
}
.ft-stroke-dot {
  border: 0;
  background: transparent;
  cursor: pointer;
  padding: 0 4px;
  display: inline-flex;
  align-items: center;
  color: var(--ft-color-text-muted);
}
.ft-stroke-dot.active {
  color: var(--ft-color-text);
}

/* === Canvas container === */
.ft-canvas-container canvas {
  cursor: crosshair;
  touch-action: none;
}
.ft-text-input {
  box-sizing: border-box;
}
.ft-preview-full {
  max-width: 100%;
  max-height: 80vh;
  border: 1px solid var(--ft-color-border);
  border-radius: var(--ft-radius-md);
}
`
