# Changelog


## extension-v0.1.2

[compare changes](https://github.com/Ripwords/ReproJs/compare/extension-v0.1.1...extension-v0.1.2)

### 🚀 Enhancements

- **shared:** Add AdminOverviewDTO for admin overview dashboard ([f76efdb](https://github.com/Ripwords/ReproJs/commit/f76efdb))
- **shared:** Add 'manager' to ProjectRole enum ([2996a41](https://github.com/Ripwords/ReproJs/commit/2996a41))
- **shared:** Add source discriminator and mobile device fields to ReportContext/SystemInfo ([2f6effc](https://github.com/Ripwords/ReproJs/commit/2f6effc))
- **shared:** Add source and devicePlatform to ReportSummaryDTO ([95ed429](https://github.com/Ripwords/ReproJs/commit/95ed429))
- **expo:** Config normalizer and internal context shape ([50e2018](https://github.com/Ripwords/ReproJs/commit/50e2018))
- **shared:** ReportSummaryDTO.assignees (array); TriagePatchInput.assigneeIds ([572ae66](https://github.com/Ripwords/ReproJs/commit/572ae66))
- **shared:** Add milestone + githubAssigneeLogins to reports DTOs ([4c64078](https://github.com/Ripwords/ReproJs/commit/4c64078))
- **integrations:** PushOnEdit UI toggle for GitHub integration ([dfd32b2](https://github.com/Ripwords/ReproJs/commit/dfd32b2))
- **integration-api:** Expose autoCreateOnIntake toggle ([1574a7d](https://github.com/Ripwords/ReproJs/commit/1574a7d))
- **shared:** Comment DTOs ([2485a18](https://github.com/Ripwords/ReproJs/commit/2485a18))
- **github:** Create custom labels in linked repo from the picker ([18ad810](https://github.com/Ripwords/ReproJs/commit/18ad810))
- **sdk-utils:** Add canonical theme tokens shared by web and expo SDKs ([989d8e3](https://github.com/Ripwords/ReproJs/commit/989d8e3))
- **sdk-utils:** Add Attachment shape and validateAttachments helper ([a6c8159](https://github.com/Ripwords/ReproJs/commit/a6c8159))
- **ui:** Add themeToCssVars helper that emits flame/mist tokens as CSS vars ([1a2e692](https://github.com/Ripwords/ReproJs/commit/1a2e692))
- **ui:** Inject flame/mist CSS vars into shadow root at mount ([91a883b](https://github.com/Ripwords/ReproJs/commit/91a883b))
- **ui:** Add PrimaryButton, SecondaryButton, FieldLabel, StepIndicator, WizardHeader ([61404b5](https://github.com/Ripwords/ReproJs/commit/61404b5))
- **ui:** Add StepDetails (replaces step-describe in 3-step wizard) ([1077c55](https://github.com/Ripwords/ReproJs/commit/1077c55))
- **ui:** Add StepReview with 'Included in this report' summary ([da15040](https://github.com/Ripwords/ReproJs/commit/da15040))
- **ui:** Replace 2-step wizard with annotate → details → review flow ([25c916f](https://github.com/Ripwords/ReproJs/commit/25c916f))
- **ui:** Add AttachmentList with hybrid thumbnail + chip rendering ([b8070d6](https://github.com/Ripwords/ReproJs/commit/b8070d6))
- **sdk-web:** Add user attachments end-to-end ([46af0bb](https://github.com/Ripwords/ReproJs/commit/46af0bb))
- **shared:** Add user-file kind and filename field to AttachmentDTO ([dd715e5](https://github.com/Ripwords/ReproJs/commit/dd715e5))
- **ui:** Side-by-side details layout + paste-to-attach screenshots ([4452729](https://github.com/Ripwords/ReproJs/commit/4452729))
- **ui:** Inflight toast + clamav scan visibility ([23b9349](https://github.com/Ripwords/ReproJs/commit/23b9349))
- **dashboard:** Show clamav scan report on user-file attachments ([368d63b](https://github.com/Ripwords/ReproJs/commit/368d63b))
- **expo:** Pick attachments from Photos / Files / Clipboard ([0cc0bf5](https://github.com/Ripwords/ReproJs/commit/0cc0bf5))
- **extension:** Retheme popup + options to flame/mist tokens ([2708f72](https://github.com/Ripwords/ReproJs/commit/2708f72))

### 🩹 Fixes

- **docs:** Update URLs after repo rename to ReproJs ([ee6ff03](https://github.com/Ripwords/ReproJs/commit/ee6ff03))
- **sdk-utils:** Hermes-safe newShapeId — fall back when crypto.randomUUID missing ([a3c218b](https://github.com/Ripwords/ReproJs/commit/a3c218b))
- **github:** Subscribe to issue_comment/label/milestone/member events + activity feed tag rendering ([40e160c](https://github.com/Ripwords/ReproJs/commit/40e160c))

### 💅 Refactors

- **sdk-utils:** Extract ring-buffer from @reprojs/ui ([998a4e1](https://github.com/Ripwords/ReproJs/commit/998a4e1))
- **sdk-utils:** Extract redact from @reprojs/ui ([0b1406b](https://github.com/Ripwords/ReproJs/commit/0b1406b))
- **sdk-utils:** Extract breadcrumbs from @reprojs/ui ([eceb072](https://github.com/Ripwords/ReproJs/commit/eceb072))
- **sdk-utils:** Extract annotation tool geometry from @reprojs/ui ([bac4449](https://github.com/Ripwords/ReproJs/commit/bac4449))
- **dev:** Move hardcoded tunnel host + demo endpoint out of tracked files ([17ae31c](https://github.com/Ripwords/ReproJs/commit/17ae31c))
- **assignees:** Github-only, drop dashboard-user linking ([557d2d6](https://github.com/Ripwords/ReproJs/commit/557d2d6))
- **ui:** Switch styles to CSS custom properties from sdk-utils tokens ([ede8899](https://github.com/Ripwords/ReproJs/commit/ede8899))

### 📖 Documentation


### 🏡 Chore

- **sdk-utils:** Scaffold package ([abd9d08](https://github.com/Ripwords/ReproJs/commit/abd9d08))
- **github-app:** Default auto_create_on_intake to true for new installs ([a7fbab1](https://github.com/Ripwords/ReproJs/commit/a7fbab1))
- **release:** Sdk-v0.4.0 ([5868b7e](https://github.com/Ripwords/ReproJs/commit/5868b7e))

### ✅ Tests

- **shared:** Align ReportSummaryDTO test with new assignees/milestone shape ([9dca620](https://github.com/Ripwords/ReproJs/commit/9dca620))
- **extension:** Rename Playwright e2e spec to .e2e.ts so bun test skips it ([11149b5](https://github.com/Ripwords/ReproJs/commit/11149b5))

### 🎨 Styles


### 🤖 CI


### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>
- Jer-tan ([@jer-tan](https://github.com/jer-tan))

## extension-v0.1.1

[compare changes](https://github.com/Ripwords/ReproJs/compare/4e19da84f9e333ee5690834a005a91bdaa00766b...extension-v0.1.1)

### 🚀 Enhancements


### 🔥 Performance


### 🩹 Fixes


### 💅 Refactors


### 📖 Documentation

- Close open question #2 (recorder format); recorder package no longer pending ([#2](https://github.com/Ripwords/ReproJs/issues/2))

### 📦 Build


### 🏡 Chore


### ✅ Tests


### 🎨 Styles


### 🤖 CI


#### ⚠️ Breaking Changes


### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>

