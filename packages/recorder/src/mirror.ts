/**
 * Two-way map between DOM Node and numeric ID. IDs are monotonically
 * increasing per recorder instance so a later full snapshot never collides
 * with earlier incremental references.
 */
export class Mirror {
  private readonly nodeToId = new WeakMap<Node, number>()
  private readonly idToNode = new Map<number, Node>()
  private nextId = 1

  getOrCreateId(node: Node): number {
    const existing = this.nodeToId.get(node)
    if (existing !== undefined) return existing
    const id = this.nextId++
    this.nodeToId.set(node, id)
    this.idToNode.set(id, node)
    return id
  }

  getId(node: Node): number | undefined {
    return this.nodeToId.get(node)
  }

  getNode(id: number): Node | null {
    return this.idToNode.get(id) ?? null
  }

  has(node: Node): boolean {
    return this.nodeToId.has(node)
  }

  remove(node: Node): void {
    const id = this.nodeToId.get(node)
    if (id === undefined) return
    this.nodeToId.delete(node)
    this.idToNode.delete(id)
  }

  clear(): void {
    this.idToNode.clear()
    this.nextId = 1
  }
}
