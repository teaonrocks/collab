import { Search } from "lucide-react"
import { type RefObject, useEffect, useRef, useState } from "react"
import type { ChatMessageId } from "../chat-data"
import { cn } from "../lib/cn"
import { Combobox, ComboboxContent, ComboboxInput, ComboboxItem, ComboboxList } from "../ui"
import {
  type ChannelMessageSearchResult,
  type ChannelMessageSearchState,
  formatTime,
  toIso
} from "../workspace-chat-model"

export function ChannelMessageSearch(props: {
  readonly channelName: string
  readonly open: boolean
  readonly inputRef: RefObject<HTMLInputElement | null>
  readonly query: string
  readonly state: ChannelMessageSearchState
  readonly activeSearchMessageId: ChatMessageId | null
  readonly disabled: boolean
  readonly onQueryChange: (query: string) => void
  readonly onSelectResult: (messageId: ChatMessageId) => void
}) {
  const { channelName, open, inputRef, query, state, activeSearchMessageId, disabled, onQueryChange, onSelectResult } =
    props
  const activeResultIndexRef = useRef(0)
  const [activeResultIndex, setActiveResultIndex] = useState(0)
  const showResults = query.trim().length > 0
  const navigableResults = state.status === "results" ? state.results : []
  const selectedResult =
    activeSearchMessageId === null
      ? null
      : (navigableResults.find((result) => result.message.id === activeSearchMessageId) ?? null)
  const activeResult = navigableResults[activeResultIndex] ?? navigableResults[0]
  const activeResultId =
    activeResult === undefined ? undefined : `channel-message-search-option-${activeResult.message.id}`

  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
  }, [inputRef, open])

  useEffect(() => {
    activeResultIndexRef.current = 0
    setActiveResultIndex(0)
  }, [query])

  useEffect(() => {
    if (state.status !== "results") return
    setActiveResultIndex((index) => {
      const nextIndex = Math.min(index, Math.max(0, state.results.length - 1))
      activeResultIndexRef.current = nextIndex
      return nextIndex
    })
  }, [state])

  useEffect(() => {
    if (activeSearchMessageId === null || state.status !== "results") return
    const index = state.results.findIndex((result) => result.message.id === activeSearchMessageId)
    if (index >= 0) {
      activeResultIndexRef.current = index
      setActiveResultIndex(index)
    }
  }, [activeSearchMessageId, state])

  useEffect(() => {
    if (!open || activeSearchMessageId !== null) return
    inputRef.current?.focus()
  }, [activeSearchMessageId, inputRef, open])

  const selectSearchResult = (result: ChannelMessageSearchResult) => {
    onSelectResult(result.message.id)
  }

  return (
    <Combobox<ChannelMessageSearchResult>
      items={navigableResults}
      value={selectedResult}
      inputValue={query}
      open={open && showResults}
      disabled={disabled}
      filter={null}
      autoHighlight={false}
      highlightItemOnHover={false}
      itemToStringLabel={(result) => result.bodyPreview}
      itemToStringValue={(result) => result.message.id}
      isItemEqualToValue={(item, value) => item.message.id === value.message.id}
      onInputValueChange={(value, eventDetails) => {
        if (eventDetails.reason === "input-change") onQueryChange(value)
      }}
    >
      <div
        className={cn(
          "channelMessageSearch relative z-30 row-start-1 border-b border-border bg-surface-canvas px-4 py-2.5",
          !open && "hidden"
        )}
      >
        <label className="sr-only" htmlFor="channel-message-search">
          Search messages
        </label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-foreground-subtle"
            aria-hidden="true"
          />
          <ComboboxInput
            ref={inputRef}
            id="channel-message-search"
            className="h-9 pl-9 text-sm"
            placeholder={`Search ${channelName}`}
            aria-controls="channel-message-search-results"
            aria-activedescendant={activeResultId}
            aria-invalid={state.status === "error"}
            onKeyDownCapture={(event) => {
              if (navigableResults.length === 0) return
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault()
                event.stopPropagation()
                setActiveResultIndex((index) => {
                  const nextIndex =
                    event.key === "ArrowDown"
                      ? (index + 1) % navigableResults.length
                      : (index - 1 + navigableResults.length) % navigableResults.length
                  activeResultIndexRef.current = nextIndex
                  return nextIndex
                })
                return
              }
              if (event.key !== "Enter") return
              const selectedResult = navigableResults[activeResultIndexRef.current] ?? activeResult
              if (selectedResult === undefined) return
              event.preventDefault()
              event.stopPropagation()
              selectSearchResult(selectedResult)
            }}
          />
          <ComboboxContent
            id="channel-message-search-results"
            className="messageSearchResults w-[min(680px,calc(100vw-120px))]"
            role={showResults ? "region" : undefined}
            aria-label="Message search results"
            initialFocus={false}
            finalFocus={false}
          >
            {renderChannelMessageSearchState(
              channelName,
              state,
              activeSearchMessageId,
              activeResultIndex,
              (index) => {
                activeResultIndexRef.current = index
                setActiveResultIndex(index)
              },
              selectSearchResult
            )}
          </ComboboxContent>
        </div>
      </div>
    </Combobox>
  )
}

function renderChannelMessageSearchState(
  channelName: string,
  state: ChannelMessageSearchState,
  activeSearchMessageId: ChatMessageId | null,
  activeResultIndex: number,
  onActiveResultIndexChange: (index: number) => void,
  onSelectResult: (result: ChannelMessageSearchResult) => void
) {
  if (state.status === "idle") {
    return <p className="m-0 text-xs text-foreground-subtle">Search the current channel.</p>
  }
  if (state.status === "loading") {
    return (
      <p className="m-0 text-xs text-foreground-subtle" role="status">
        Searching channel history...
      </p>
    )
  }
  if (state.status === "error") {
    return (
      <p className="m-0 text-xs text-destructive-text" role="alert">
        {state.message}
      </p>
    )
  }
  if (state.status === "empty") {
    return (
      <p className="m-0 text-xs text-foreground-subtle" role="status">
        No matching messages.
      </p>
    )
  }
  return (
    <ComboboxList className="messageSearchMatches" aria-label="Message search matches">
      {state.results.map((result, index) => {
        const highlighted = activeSearchMessageId === result.message.id
        const active = index === activeResultIndex
        return (
          <ComboboxItem
            key={result.message.id}
            id={`channel-message-search-option-${result.message.id}`}
            value={result}
            className={cn(
              "messageSearchResult grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-3 rounded-control border border-transparent bg-transparent px-2 py-1.5 text-left hover:border-border hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              active && "border-border bg-surface-muted",
              highlighted && "border-border-strong"
            )}
            data-active={active ? "" : undefined}
            data-message-highlighted={highlighted ? "" : undefined}
            onMouseEnter={() => onActiveResultIndexChange(index)}
            onClick={() => onSelectResult(result)}
          >
            <span className="min-w-0">
              <span className="block min-w-0 overflow-hidden text-xs font-bold text-ellipsis whitespace-nowrap text-foreground">
                {result.message.authorDisplayName}
              </span>
              <span className="block min-w-0 overflow-hidden text-xs text-ellipsis whitespace-nowrap text-foreground-muted">
                {result.bodyPreview}
              </span>
            </span>
            <span className="flex shrink-0 flex-col items-end gap-0.5 text-[11px] leading-tight text-foreground-subtle">
              <time dateTime={toIso(result.message.createdAt)}>{formatTime(result.message.createdAt)}</time>
              <span>#{channelName}</span>
            </span>
          </ComboboxItem>
        )
      })}
    </ComboboxList>
  )
}
