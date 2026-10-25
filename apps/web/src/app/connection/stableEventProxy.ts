export interface EventHandlerRef<T extends Event = Event> {
  current: (event: T) => void;
}

/** One listener identity with a replaceable implementation. */
export function stableEventProxy<T extends Event>(ref: EventHandlerRef<T>): (event: T) => void {
  return (event) => ref.current(event);
}
