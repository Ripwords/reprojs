import React from "react"
import { ScrollView, TextInput, View } from "react-native"
import { FieldLabel, inputStyle } from "./controls"
import { AttachmentList } from "./attachment-list"
import { theme } from "./theme"
import {
  DEFAULT_ATTACHMENT_LIMITS,
  type Attachment,
  type AttachmentLimits,
} from "@reprojs/sdk-utils"

interface Props {
  title: string
  description: string
  attachments: Attachment[]
  attachmentErrors: string[]
  limits?: AttachmentLimits
  onTitleChange: (v: string) => void
  onDescriptionChange: (v: string) => void
  onAttachmentsAdd: () => void
  onAttachmentRemove: (id: string) => void
}

export function StepForm({
  title,
  description,
  attachments,
  attachmentErrors,
  limits = DEFAULT_ATTACHMENT_LIMITS,
  onTitleChange,
  onDescriptionChange,
  onAttachmentsAdd,
  onAttachmentRemove,
}: Props) {
  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 20 }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
    >
      <View style={{ gap: 8 }}>
        <FieldLabel label="Title" />
        <TextInput
          value={title}
          onChangeText={onTitleChange}
          placeholder="What went wrong?"
          placeholderTextColor={theme.color.textFaint}
          maxLength={120}
          returnKeyType="next"
          style={inputStyle}
        />
      </View>
      <View style={{ gap: 8 }}>
        <FieldLabel label="Details" optional />
        <TextInput
          value={description}
          onChangeText={onDescriptionChange}
          placeholder="Steps to reproduce, expected vs actual…"
          placeholderTextColor={theme.color.textFaint}
          multiline
          maxLength={10000}
          style={[inputStyle, { minHeight: 140, textAlignVertical: "top" }]}
        />
      </View>
      <View style={{ gap: 8 }}>
        <FieldLabel label="Attachments" optional />
        <AttachmentList
          attachments={attachments}
          limits={limits}
          errors={attachmentErrors}
          onAdd={onAttachmentsAdd}
          onRemove={onAttachmentRemove}
        />
      </View>
    </ScrollView>
  )
}
