export class RingBuffer<T> {
  private readonly items: T[] = []
  constructor(private readonly capacity: number) {
    if (capacity < 1) throw new Error("RingBuffer capacity must be >= 1")
  }

  push(item: T): void {
    this.items.push(item)
    if (this.items.length > this.capacity) this.items.shift()
  }

  drain(): T[] {
    return this.items.slice()
  }

  clear(): void {
    this.items.length = 0
  }

  size(): number {
    return this.items.length
  }
}
