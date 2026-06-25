import { useEffect, useState } from "react"
import type { ChannelId, ChannelMessage, ChannelMessageId } from "../shared/collab-rpc"

export type MessageMenuState = {
  readonly messageId: ChannelMessageId
  readonly x: number
  readonly y: number
} | null

export type EditingMessageState = {
  readonly messageId: ChannelMessageId
  readonly draft: string
  readonly saving: boolean
} | null

export type MessageRowState = {
  readonly selected: boolean
  readonly selectionMode: boolean
  readonly actionsPinned: boolean
  readonly actionsAvailable: boolean
  readonly editingDraft: string | null
  readonly editSaving: boolean
}

export type MessageInteractionView = {
  readonly selectedMessageIds: ReadonlyArray<ChannelMessageId>
  readonly selectedMessageIdSet: ReadonlySet<ChannelMessageId>
  readonly topSelectedMessageId: ChannelMessageId | null
  readonly menuMessage: ChannelMessage | null
  readonly pendingDeleteMessage: ChannelMessage | null
  readonly getRowState: (message: ChannelMessage) => MessageRowState
}

export type DeleteChannelMessage = (input: {
  readonly channelId: ChannelId
  readonly messageId: ChannelMessageId
}) => Promise<unknown>

export type EditChannelMessage = (input: {
  readonly channelId: ChannelId
  readonly messageId: ChannelMessageId
  readonly body: string
}) => Promise<unknown>

type ChannelOperation = "edit" | "delete"
type OperationErrorMessage = (operation: ChannelOperation, cause: unknown) => string

export function useMessageInteractions(input: {
  readonly channelId: ChannelId
  readonly messages: ReadonlyArray<ChannelMessage>
  readonly deleteChannelMessage: DeleteChannelMessage
  readonly editChannelMessage?: EditChannelMessage
  readonly operationErrorMessage?: OperationErrorMessage
  readonly setOperationError: (message: string | null) => void
}) {
  const {
    channelId,
    messages,
    deleteChannelMessage,
    editChannelMessage,
    operationErrorMessage,
    setOperationError
  } = input
  const [selectedMessageIds, setSelectedMessageIds] = useState<ReadonlyArray<ChannelMessageId>>([])
  const [editingMessage, setEditingMessage] = useState<EditingMessageState>(null)
  const [pendingDeleteMessageId, setPendingDeleteMessageId] = useState<ChannelMessageId | null>(null)
  const [messageMenu, setMessageMenu] = useState<MessageMenuState>(null)
  const view = createMessageInteractionView(messages, selectedMessageIds, editingMessage, pendingDeleteMessageId, messageMenu)

  useEffect(() => {
    setSelectedMessageIds([])
    setEditingMessage(null)
    setPendingDeleteMessageId(null)
    setMessageMenu(null)
  }, [channelId])

  useEffect(() => {
    setSelectedMessageIds((ids) => pruneSelectedMessageIds(ids, messages))
  }, [messages])

  useEffect(() => {
    if (editingMessage === null) return
    const message = messages.find((item) => item.id === editingMessage.messageId)
    if (message === undefined || message.deletedAt !== null) setEditingMessage(null)
  }, [editingMessage, messages])

  useEffect(() => {
    if (pendingDeleteMessageId !== null && view.pendingDeleteMessage === null) setPendingDeleteMessageId(null)
  }, [pendingDeleteMessageId, view.pendingDeleteMessage])

  useEffect(() => {
    if (messageMenu === null) return
    const closeMenu = () => setMessageMenu(null)
    const closeMenuOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu()
    }
    window.addEventListener("click", closeMenu)
    window.addEventListener("keydown", closeMenuOnEscape)
    return () => {
      window.removeEventListener("click", closeMenu)
      window.removeEventListener("keydown", closeMenuOnEscape)
    }
  }, [messageMenu])

  const toggleMessageSelection = (messageId: ChannelMessageId) => {
    setSelectedMessageIds((ids) => toggleMessageId(ids, messageId))
  }

  const requestDeleteMessage = (messageId: ChannelMessageId) => {
    setPendingDeleteMessageId(messageId)
    setMessageMenu(null)
  }

  const cancelDeleteMessage = () => {
    setPendingDeleteMessageId(null)
  }

  const confirmDeleteMessage = () => {
    if (view.pendingDeleteMessage === null) return
    const messageId = view.pendingDeleteMessage.id
    setOperationError(null)
    void deleteChannelMessage({
      channelId,
      messageId
    })
      .then(() => {
        setSelectedMessageIds((ids) => ids.filter((id) => id !== messageId))
        setEditingMessage((editing) => editing?.messageId === messageId ? null : editing)
        setPendingDeleteMessageId(null)
        setMessageMenu(null)
      })
      .catch((cause) => {
        if (operationErrorMessage !== undefined) setOperationError(operationErrorMessage("delete", cause))
      })
  }

  const startEditingMessage = (message: ChannelMessage) => {
    setEditingMessage({ messageId: message.id, draft: message.body, saving: false })
    setMessageMenu(null)
  }

  const setEditingDraft = (draft: string) => {
    setEditingMessage((editing) => editing === null ? null : { ...editing, draft })
  }

  const cancelEditingMessage = () => {
    setEditingMessage(null)
  }

  const saveEditingMessage = () => {
    if (editingMessage === null || editChannelMessage === undefined || editingMessage.saving) return
    const body = editingMessage.draft.trim()
    if (body.length === 0) return

    setOperationError(null)
    setEditingMessage({ ...editingMessage, saving: true })
    void editChannelMessage({
      channelId,
      messageId: editingMessage.messageId,
      body
    })
      .then(() => setEditingMessage(null))
      .catch((cause) => {
        if (operationErrorMessage !== undefined) setOperationError(operationErrorMessage("edit", cause))
        setEditingMessage((editing) => editing === null ? null : { ...editing, saving: false })
      })
  }

  const openMessageMenu = (messageId: ChannelMessageId, x: number, y: number) => {
    setMessageMenu({ messageId, x, y })
  }

  const closeMessageMenu = () => {
    setMessageMenu(null)
  }

  return {
    selectedMessageIds: view.selectedMessageIds,
    selectedMessageIdSet: view.selectedMessageIdSet,
    topSelectedMessageId: view.topSelectedMessageId,
    menuMessage: view.menuMessage,
    pendingDeleteMessage: view.pendingDeleteMessage,
    messageMenu,
    getRowState: view.getRowState,
    toggleMessageSelection,
    requestDeleteMessage,
    cancelDeleteMessage,
    confirmDeleteMessage,
    startEditingMessage,
    setEditingDraft,
    cancelEditingMessage,
    saveEditingMessage,
    openMessageMenu,
    closeMessageMenu
  }
}

export const createMessageInteractionView = (
  messages: ReadonlyArray<ChannelMessage>,
  selectedMessageIds: ReadonlyArray<ChannelMessageId>,
  editingMessage: EditingMessageState,
  pendingDeleteMessageId: ChannelMessageId | null,
  messageMenu: MessageMenuState
): MessageInteractionView => {
  const liveMessages = messages.filter(isLiveMessage)
  const liveMessageIds = new Set(liveMessages.map((message) => message.id))
  const visibleSelectedMessageIds = selectedMessageIds.filter((id) => liveMessageIds.has(id))
  const selectedMessageIdSet = new Set(visibleSelectedMessageIds)
  const topSelectedMessageId = liveMessages.find((message) => selectedMessageIdSet.has(message.id))?.id ?? null
  const selectionMode = visibleSelectedMessageIds.length > 0

  return {
    selectedMessageIds: visibleSelectedMessageIds,
    selectedMessageIdSet,
    topSelectedMessageId,
    menuMessage: messageMenu === null
      ? null
      : liveMessages.find((message) => message.id === messageMenu.messageId) ?? null,
    pendingDeleteMessage: pendingDeleteMessageId === null
      ? null
      : liveMessages.find((message) => message.id === pendingDeleteMessageId) ?? null,
    getRowState: (message) => {
      const actionsPinned = selectionMode && message.id === topSelectedMessageId
      return {
        selected: selectedMessageIdSet.has(message.id),
        selectionMode,
        actionsPinned,
        actionsAvailable: !selectionMode || actionsPinned,
        editingDraft: editingMessage?.messageId === message.id ? editingMessage.draft : null,
        editSaving: editingMessage?.messageId === message.id && editingMessage.saving
      }
    }
  }
}

export const isLiveMessage = (message: ChannelMessage): boolean => message.deletedAt === null

export const toggleMessageId = (
  messageIds: ReadonlyArray<ChannelMessageId>,
  messageId: ChannelMessageId
): ReadonlyArray<ChannelMessageId> =>
  messageIds.includes(messageId)
    ? messageIds.filter((id) => id !== messageId)
    : [...messageIds, messageId]

export const pruneSelectedMessageIds = (
  selectedMessageIds: ReadonlyArray<ChannelMessageId>,
  messages: ReadonlyArray<ChannelMessage>
): ReadonlyArray<ChannelMessageId> => {
  if (selectedMessageIds.length === 0) return selectedMessageIds
  const liveMessageIds = new Set(messages.filter(isLiveMessage).map((message) => message.id))
  const nextSelectedMessageIds = selectedMessageIds.filter((id) => liveMessageIds.has(id))
  return nextSelectedMessageIds.length === selectedMessageIds.length
    ? selectedMessageIds
    : nextSelectedMessageIds
}
