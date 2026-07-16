export const takeUnseenNotificationEvents = <Event extends { readonly id: string }>(
  events: ReadonlyArray<Event>,
  seenIds: Set<string>
): ReadonlyArray<Event> => {
  const unseen = []
  for (const event of events) {
    if (seenIds.has(event.id)) continue
    seenIds.add(event.id)
    unseen.push(event)
  }
  return unseen
}

export const consumeNotificationFeedPage = <Event extends { readonly id: string }>(
  page: {
    readonly cursor: number
    readonly notifications: ReadonlyArray<Event>
  },
  seenIds: Set<string>
): {
  readonly cursor: number
  readonly notifications: ReadonlyArray<Event>
} => ({
  cursor: page.cursor,
  notifications: takeUnseenNotificationEvents(page.notifications, seenIds)
})
