import { afterEach, describe, expect, test } from "bun:test"
import {
  MAX_SUBSCRIBERS_PER_REPORT,
  __resetReportStreamBus,
  publishReportStream,
  subscribeReportStream,
  subscriberCount,
  totalSubscriberCount,
} from "./report-events-bus"

afterEach(() => {
  __resetReportStreamBus()
})

describe("report-events-bus", () => {
  test("subscribe / publish / unsubscribe happy path", () => {
    const received: string[] = []
    const unsub = subscribeReportStream("r1", (e) => {
      received.push(e.kind)
    })
    publishReportStream("r1", { kind: "triage" })
    publishReportStream("r1", { kind: "comment_added" })
    unsub()
    publishReportStream("r1", { kind: "comment_edited" })
    expect(received).toEqual(["triage", "comment_added"])
  })

  test("unsubscribe is idempotent", () => {
    const unsub = subscribeReportStream("r1", () => {})
    unsub()
    unsub()
    unsub()
    expect(subscriberCount("r1")).toBe(0)
  })

  test("deletes the Set entry when the last subscriber leaves (no empty-set leak)", () => {
    const unsubA = subscribeReportStream("r1", () => {})
    const unsubB = subscribeReportStream("r1", () => {})
    unsubA()
    expect(subscriberCount("r1")).toBe(1)
    unsubB()
    expect(subscriberCount("r1")).toBe(0)
    expect(totalSubscriberCount()).toBe(0)
  })

  test("multiple subscribers on the same report all receive events", () => {
    const received: string[] = []
    subscribeReportStream("r1", () => received.push("a"))
    subscribeReportStream("r1", () => received.push("b"))
    publishReportStream("r1", { kind: "triage" })
    expect(received.toSorted()).toEqual(["a", "b"])
  })

  test("throwing listener does not stop peers", () => {
    const received: string[] = []
    subscribeReportStream("r1", () => {
      throw new Error("boom")
    })
    subscribeReportStream("r1", () => received.push("ok"))
    publishReportStream("r1", { kind: "triage" })
    expect(received).toEqual(["ok"])
  })

  test("per-report subscriber cap throws after MAX_SUBSCRIBERS_PER_REPORT", () => {
    for (let i = 0; i < MAX_SUBSCRIBERS_PER_REPORT; i++) {
      subscribeReportStream("r1", () => {})
    }
    expect(() => subscribeReportStream("r1", () => {})).toThrow(/Too many/i)
  })

  test("unsubscribe during publish iteration is safe (snapshot semantics)", () => {
    const received: string[] = []
    const unsubA = subscribeReportStream("r1", () => {
      received.push("a")
      unsubA() // unsubscribe self mid-iteration
    })
    subscribeReportStream("r1", () => received.push("b"))
    publishReportStream("r1", { kind: "triage" })
    expect(received.toSorted()).toEqual(["a", "b"])
    expect(subscriberCount("r1")).toBe(1)
  })

  test("concurrent subscribe during publish iteration does NOT fire the new listener for that event", () => {
    // Snapshot semantics: a subscribe that arrives mid-dispatch shouldn't
    // receive the in-flight event (common pattern to avoid re-entrancy).
    const received: string[] = []
    subscribeReportStream("r1", () => {
      received.push("initial")
      subscribeReportStream("r1", () => received.push("late"))
    })
    publishReportStream("r1", { kind: "triage" })
    expect(received).toEqual(["initial"])
  })

  test("publish to a reportId with no subscribers is a cheap no-op", () => {
    // Just verify no throw + no entry created.
    publishReportStream("nobody", { kind: "triage" })
    expect(subscriberCount("nobody")).toBe(0)
    expect(totalSubscriberCount()).toBe(0)
  })

  test("subscribers are scoped per reportId", () => {
    const received: string[] = []
    subscribeReportStream("r1", () => received.push("r1"))
    subscribeReportStream("r2", () => received.push("r2"))
    publishReportStream("r1", { kind: "triage" })
    publishReportStream("r2", { kind: "triage" })
    publishReportStream("r3", { kind: "triage" })
    expect(received.toSorted()).toEqual(["r1", "r2"])
  })
})
