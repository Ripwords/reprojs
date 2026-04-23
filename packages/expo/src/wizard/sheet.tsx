import React, { useEffect, useRef, useState } from "react"
import { Modal, SafeAreaView, Text, View } from "react-native"
import { FlattenView, type FlattenHandle } from "../capture/flatten"
import { StepForm } from "./step-form"
import { StepAnnotate } from "./step-annotate"
import { StepSubmit } from "./step-submit"
import { createAnnotationStore } from "../annotation/store"

export interface WizardArgs {
  initialTitle?: string
  initialDescription?: string
  screenshot: { uri: string; width: number; height: number } | null
  onSubmit: (result: {
    title: string
    description: string
    annotatedUri: string | null
    rawUri: string | null
  }) => Promise<void>
  onClose: () => void
}

export function WizardSheet({
  initialTitle,
  initialDescription,
  screenshot,
  onSubmit,
  onClose,
}: WizardArgs) {
  const [step, setStep] = useState<"form" | "annotate" | "submit">("form")
  const [title, setTitle] = useState(initialTitle ?? "")
  const [description, setDescription] = useState(initialDescription ?? "")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const store = useRef(createAnnotationStore()).current
  const flattenRef = useRef<FlattenHandle | null>(null)

  useEffect(() => {
    setStep("form")
  }, [screenshot])

  async function handleSubmit() {
    setSubmitting(true)
    setError(null)
    try {
      let annotated: string | null = null
      if (screenshot && store.snapshot().length > 0 && flattenRef.current) {
        const flat = await flattenRef.current.flatten()
        annotated = flat.uri
      }
      await onSubmit({
        title,
        description,
        annotatedUri: annotated,
        rawUri: screenshot?.uri ?? null,
      })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: "#eee" }}>
          <Text style={{ fontSize: 18, fontWeight: "600" }}>Report a bug</Text>
        </View>
        {step === "form" && (
          <StepForm
            title={title}
            description={description}
            onTitleChange={setTitle}
            onDescriptionChange={setDescription}
          />
        )}
        {step === "annotate" && screenshot && (
          <StepAnnotate
            imageUri={screenshot.uri}
            width={screenshot.width}
            height={screenshot.height}
            store={store}
          />
        )}
        {step === "submit" && (
          <StepSubmit
            submitting={submitting}
            error={error}
            onSubmit={handleSubmit}
            onCancel={onClose}
          />
        )}
        {screenshot && (
          <FlattenView
            ref={flattenRef}
            uri={screenshot.uri}
            width={screenshot.width}
            height={screenshot.height}
            shapes={store.snapshot()}
          />
        )}
        <View style={{ flexDirection: "row", padding: 12, gap: 8 }}>
          {step !== "form" && (
            <Text onPress={() => setStep(step === "submit" ? "annotate" : "form")}>Back</Text>
          )}
          {step !== "submit" && (
            <Text onPress={() => setStep(step === "form" ? "annotate" : "submit")}>Next</Text>
          )}
        </View>
      </SafeAreaView>
    </Modal>
  )
}
