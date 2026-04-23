import React, { useEffect, useMemo, useRef, useState } from "react"
import { AppState, View } from "react-native"
import { ReproContext, type ReproInternalContext } from "./context"
import { normalizeConfig, type ReproConfigInput } from "./config"
import { createConsoleCollector } from "./collectors/console"
import { createNetworkCollector } from "./collectors/network"
import { createBreadcrumbsCollector } from "@reprojs/sdk-utils"
import { createQueueStorage } from "./queue/storage"
import { createQueueFlusher } from "./queue/flush"
import { createConnectivityListener } from "./queue/netinfo"
import { createIntakeClient } from "./intake-client"
import { captureView } from "./capture/screenshot"
import { collectSystemInfo } from "./collectors/system-info"
import { WizardSheet } from "./wizard/sheet"
import type { ReporterIdentity, ReportIntakeInput } from "@reprojs/shared"
import { setSingletonHandle, clearSingletonHandle } from "./singleton"

interface Props {
  config: ReproConfigInput
  children: React.ReactNode
}

export function ReproProvider({ config: rawConfig, children }: Props) {
  const config = useMemo(() => normalizeConfig(rawConfig), [rawConfig])
  const rootRef = useRef<View | null>(null)
  const [reporter, setReporter] = useState<ReporterIdentity | null>(config.reporter)
  const [metadata, setMetadata] = useState<Record<string, string | number | boolean>>(
    config.metadata,
  )
  const [wizardOpen, setWizardOpen] = useState(false)
  const [wizardInit, setWizardInit] = useState<{
    initialTitle?: string
    initialDescription?: string
  }>({})
  const [screenshot, setScreenshot] = useState<{
    uri: string
    width: number
    height: number
  } | null>(null)
  const [rootSize, setRootSize] = useState({ w: 0, h: 0 })

  const consoleRef = useRef(createConsoleCollector({ max: 200 }))
  const networkRef = useRef(
    createNetworkCollector({
      max: 100,
      captureBodies: config.collectors.network.captureBodies,
      redact: config.redact,
    }),
  )
  const breadcrumbsRef = useRef(createBreadcrumbsCollector({}))
  const queueRef = useRef(
    createQueueStorage({ maxReports: config.queue.maxReports, maxBytes: config.queue.maxBytes }),
  )
  const clientRef = useRef(createIntakeClient({ intakeUrl: config.intakeUrl }))
  const flusherRef = useRef(
    createQueueFlusher({
      queue: queueRef.current,
      client: clientRef.current,
      backoffMs: config.queue.backoffMs,
    }),
  )

  useEffect(() => {
    if (config.collectors.console) consoleRef.current.start()
    if (config.collectors.network.enabled) networkRef.current.start()
    if (config.collectors.breadcrumbs) breadcrumbsRef.current.start({ maxEntries: 50 })
    return () => {
      consoleRef.current.stop()
      networkRef.current.stop()
      breadcrumbsRef.current.stop()
    }
  }, [config.collectors.console, config.collectors.network.enabled, config.collectors.breadcrumbs])

  useEffect(() => {
    const net = createConnectivityListener()
    const unsubscribe = net.subscribe(() => {
      flusherRef.current.flush().catch(() => undefined)
    })
    const appSub = AppState.addEventListener("change", (state) => {
      if (state === "active") flusherRef.current.flush().catch(() => undefined)
    })
    flusherRef.current.flush().catch(() => undefined)
    return () => {
      unsubscribe()
      appSub.remove()
    }
  }, [])

  async function openWizard(opts?: { initialTitle?: string; initialDescription?: string }) {
    setWizardInit(opts ?? {})
    try {
      if (rootRef.current) {
        const shot = await captureView(rootRef)
        setScreenshot({ uri: shot.uri, width: rootSize.w, height: rootSize.h })
      } else {
        setScreenshot(null)
      }
    } catch {
      setScreenshot(null)
    }
    setWizardOpen(true)
  }

  async function handleSubmit(res: {
    title: string
    description: string
    annotatedUri: string | null
    rawUri: string | null
  }) {
    const systemInfo = config.collectors.systemInfo
      ? await collectSystemInfo({ pageUrl: "app://current" })
      : undefined
    const now = new Date().toISOString()
    const input: ReportIntakeInput = {
      projectKey: config.projectKey,
      title: res.title,
      description: res.description || undefined,
      context: {
        source: "expo",
        pageUrl: "app://current",
        userAgent: systemInfo?.userAgent ?? "Expo",
        viewport: { w: rootSize.w || 1, h: rootSize.h || 1 },
        timestamp: now,
        reporter: reporter ?? undefined,
        metadata,
        systemInfo,
      },
      metadata,
    }
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    await queueRef.current.enqueue({
      id,
      createdAt: now,
      payload: {
        input,
        attachments: [
          ...(res.annotatedUri
            ? [{ kind: "annotated-screenshot" as const, uri: res.annotatedUri, bytes: 0 }]
            : []),
          ...(res.rawUri ? [{ kind: "screenshot" as const, uri: res.rawUri, bytes: 0 }] : []),
        ],
      },
      attempts: 0,
      lastErrorAt: null,
      lastError: null,
    })
    setWizardOpen(false)
    setScreenshot(null)
    flusherRef.current.flush().catch(() => undefined)
  }

  const ctx: ReproInternalContext = {
    config,
    getReporter: () => reporter,
    setReporter,
    getMetadata: () => metadata,
    setMetadata: (patch) => setMetadata((m) => ({ ...m, ...patch })),
    logBreadcrumb: (event, data) => breadcrumbsRef.current.breadcrumb(event, data),
    openWizard,
    closeWizard: () => setWizardOpen(false),
    captureRoot: async () => {
      const shot = await captureView(rootRef)
      return { ...shot, width: rootSize.w, height: rootSize.h }
    },
    snapshotBreadcrumbs: () => breadcrumbsRef.current.snapshot(),
    queueStatus: () => ({ pending: 0, lastError: null }),
    flushQueue: () => flusherRef.current.flush(),
  }

  useEffect(() => {
    setSingletonHandle(ctx)
    return () => clearSingletonHandle()
  })

  return (
    <ReproContext.Provider value={ctx}>
      <View
        ref={rootRef}
        collapsable={false}
        onLayout={(e) =>
          setRootSize({
            w: Math.round(e.nativeEvent.layout.width),
            h: Math.round(e.nativeEvent.layout.height),
          })
        }
        style={{ flex: 1 }}
      >
        {children}
      </View>
      {wizardOpen && (
        <WizardSheet
          initialTitle={wizardInit.initialTitle}
          initialDescription={wizardInit.initialDescription}
          screenshot={screenshot}
          onSubmit={handleSubmit}
          onClose={() => setWizardOpen(false)}
        />
      )}
    </ReproContext.Provider>
  )
}
