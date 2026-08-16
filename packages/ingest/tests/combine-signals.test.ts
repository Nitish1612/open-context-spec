import { describe, expect, it } from "vitest";
import { combineSignals } from "../src/index.js";

describe("Defect 15 (cross-cutting): combineSignals adversarial coverage", () => {
  it("never aborts when given no signals or only undefined entries", () => {
    const { signal } = combineSignals([undefined, undefined]);
    expect(signal.aborted).toBe(false);
    const empty = combineSignals([]);
    expect(empty.signal.aborted).toBe(false);
  });

  it("is already aborted if any input signal is already aborted at combine time", () => {
    const already = new AbortController();
    already.abort(new Error("pre-aborted"));
    const { signal } = combineSignals([undefined, already.signal]);
    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBeInstanceOf(Error);
  });

  it("aborts when any one of several live signals fires, preserving its reason", () => {
    const a = new AbortController();
    const b = new AbortController();
    const { signal } = combineSignals([a.signal, b.signal]);
    expect(signal.aborted).toBe(false);
    b.abort("b's reason");
    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBe("b's reason");
  });

  it("only reflects the first signal to abort when multiple fire", () => {
    const a = new AbortController();
    const b = new AbortController();
    const { signal } = combineSignals([a.signal, b.signal]);
    a.abort("a first");
    b.abort("b second");
    expect(signal.reason).toBe("a first");
  });

  it("dispose() removes listeners so a later abort on an input signal has no effect", () => {
    const a = new AbortController();
    const { signal, dispose } = combineSignals([a.signal]);
    dispose();
    a.abort("too late");
    expect(signal.aborted).toBe(false);
  });

  it("dispose() is safe to call even when the combined signal already aborted", () => {
    const a = new AbortController();
    const { signal, dispose } = combineSignals([a.signal]);
    a.abort();
    expect(signal.aborted).toBe(true);
    expect(() => dispose()).not.toThrow();
  });
});
