# Filing a bug report

This guide is for **anyone reporting a bug** through Repro — whether you're a tester, a designer, a customer-success agent, or just clicked the little widget at the corner of a page. No coding required.

## What you'll see on a page

When Repro is set up on a website, a small floating button appears in a corner of the page (usually bottom-right). Click it to start a report.

If you don't see the button on a site you're testing, you probably need the [Chrome extension](#using-the-chrome-extension-for-testers) — that's covered below.

## Filing a report — step by step

### 1. Click the launcher button

The widget opens and asks if you want to capture a screenshot of the current page. Say yes — Chrome may show a "Share this tab?" prompt; pick the current tab and click **Share**.

::: tip
The screenshot captures the page exactly as you see it. Open the menu, scroll to the bug, hover over the broken thing — *then* click the launcher. Whatever's on screen is what gets captured.
:::

### 2. Annotate the screenshot

A toolbar appears over the screenshot. Use it to point out what's wrong:

| Tool | When to use it |
| --- | --- |
| **Pen / Freehand** | Circle a button, scribble around an area |
| **Arrow** | Point at one specific thing |
| **Rectangle** | Frame a section ("everything in this box is wrong") |
| **Text** | Write a short label like "should say 'Save' not 'Submut'" |
| **Color picker** | Switch to red/yellow/etc. so your annotations stand out |
| **Undo / Redo** | Take back a stroke |
| **Clear** | Wipe all annotations and start over |

You don't need to be neat. A messy circle around the broken button is more useful than a perfectly aligned rectangle.

### 3. Describe what went wrong

You'll see a short form:

- **Title** — one line, like "Save button doesn't work on the profile page".
- **Description** — what you expected vs. what actually happened. Two or three sentences is usually enough.
- **Severity** (if shown) — pick one. "Blocker" = nobody can use the feature. "Minor" = annoying but workable.
- **Your email or name** (if shown) — so the developer can ping you with questions.

::: tip Writing a good description
Three things make a report easy to fix:
1. **What you tried to do** — "I clicked Save after editing my display name."
2. **What happened** — "The page reloaded but my name didn't change."
3. **What you expected** — "I expected the new name to show up in the header."

That's it. You don't need to guess the cause.
:::

### 4. Click Send

The report is uploaded along with:

- Your annotated screenshot
- A 30-second replay of what you were doing right before you clicked the launcher (so the developer can *see* the bug happen)
- Browser console logs and network errors
- Your browser, OS, screen size, and the page URL

You'll get a "Report sent" confirmation. The widget closes. You can keep using the page.

The developer who triages the report has everything they need to reproduce — you don't need to write a 10-step repro guide.

## Privacy — what's captured, what isn't

The 30-second replay records what changed on the page (clicks, scrolls, inputs you filled in). A few things are **automatically scrubbed**:

- **Passwords** — every `<input type="password">` is masked. Your password never rides along.
- **Anything the site marks as private** — developers can tag fields like credit card numbers or SSNs to mask them. Ask your team if you're not sure.
- **Cookies on a denylist** — session tokens, auth cookies, etc. are redacted by default.

If you're worried about something specific, **don't type it in before clicking Send**. The replay only covers the last 30 seconds before you clicked the launcher.

## Using the Chrome extension (for testers)

Some sites won't have the widget yet — usually because the developers haven't installed it, or because you're testing a third-party site. For those, the **Repro Tester** Chrome extension lets you run the widget anyway.

### Install the extension

Easiest way: install from the Chrome Web Store.

> 🧩 [**Repro Tester on the Chrome Web Store**](https://chromewebstore.google.com/detail/repro-tester/kiedhhobipcjkgiljemcmmmnfcbcmjbg)

Click **Add to Chrome**. Pin the icon to your toolbar (click the puzzle-piece icon → pin Repro Tester) so you can find it.

### Set up the site you want to test

You need to add the site to the extension once. Your team admin should give you four things:

| What | What it looks like |
| --- | --- |
| **Site address** | `https://staging.acme.com` (whatever site you're testing) |
| **Project key** | Starts with `rp_pk_` and has a long string of letters/numbers |
| **Dashboard address** | `https://feedback.yourcompany.com` (where reports go) |
| **Label** | Anything you'll recognize, like `staging` or `customer demo` |

If you don't have these, ask whoever set up Repro at your company.

Steps:

1. Click the extension icon in your toolbar.
2. Click **+ New origin**.
3. Fill in the four fields above.
4. Click **Add origin**.
5. Chrome shows a permission prompt — click **Allow** for both the site and the dashboard.
6. Open a new tab on the site you just added. The Repro launcher button appears in the corner.

You're done — file reports the same way as on any other site.

### Common problems

**"I added the site but the launcher doesn't show up"**
Open the extension popup. If your site card has an amber stripe saying "Permission required", click **Grant** and accept Chrome's prompt.

**"It says 'Origin not allowed' when I send a report"**
Your dashboard admin needs to add the site to the project's allowed-origins list. Send them the URL of the page you're testing.

**"The screen-share prompt didn't appear / hangs"**
On macOS, Chrome needs screen-recording permission. Open **System Settings → Privacy & Security → Screen Recording**, turn it on for Chrome, and restart Chrome.

**"I want to remove a site I added"**
Open the extension popup, find the site card, click the three-dot menu, choose **Remove**.

### Removing the extension

`chrome://extensions` → Repro Tester → **Remove**. All your saved sites and permissions are deleted at the same time.

## FAQ

**Do I need an account to file reports?**
No. The widget works without you logging in. If your team has identity turned on, the page passes your name automatically — you don't have to type it.

**Will my coworkers see my report?**
Anyone with access to the dashboard project will see reports filed against that project. Your team controls who has access.

**Can I attach extra files (logs, screenshots, videos)?**
Yes — the description field accepts pasted images, and the dashboard's comment thread on each report supports drag-and-drop attachments after the report is filed.

**Does it work on mobile?**
The widget itself works in mobile browsers. For native iOS/Android apps, your developers need the [Expo SDK](/guide/expo) — the Chrome extension only helps on desktop Chrome.

**The page is on `localhost` — does Repro work there?**
Yes, both for the embed widget and the Chrome extension. Just add the localhost URL (with port) when configuring the extension.

## Need more help?

- **Stuck on a step?** Ask the person who set up Repro at your company — they'll know your specific dashboard URL and project keys.
- **Found a bug in Repro itself?** [Open an issue on GitHub](https://github.com/Ripwords/ReproJs/issues).
