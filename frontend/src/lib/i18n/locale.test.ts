import { describe, expect, it } from "vitest";
import { normalizeLocale } from "./locale";

describe("normalizeLocale", () => {
  it("dedupes messy locale codes into canonical form", () => {
    expect(normalizeLocale("de").canonical).toBe("de-DE");
    expect(normalizeLocale("DE").canonical).toBe("de-DE");
    expect(normalizeLocale("de-de").canonical).toBe("de-DE");
    expect(normalizeLocale("DE-DE").canonical).toBe("de-DE");
  });

  it("keeps explicit regions and flags", () => {
    const ch = normalizeLocale("de-CH");
    expect(ch.canonical).toBe("de-CH");
    expect(ch.flagTag).toBe("CH");
  });

  it("maps default regions for stability", () => {
    expect(normalizeLocale("en").canonical).toBe("en-GB");
    expect(normalizeLocale("es").canonical).toBe("es-ES");
    expect(normalizeLocale("pt").canonical).toBe("pt-PT");
    expect(normalizeLocale("fr").canonical).toBe("fr-FR");
    expect(normalizeLocale("hr").canonical).toBe("hr-HR");
    expect(normalizeLocale("ga").canonical).toBe("ga-IE");
    expect(normalizeLocale("zh").canonical).toBe("zh-CN");
  });

  it("does not merge pt-BR with pt-PT", () => {
    expect(normalizeLocale("pt-BR").canonical).toBe("pt-BR");
    expect(normalizeLocale("pt-PT").canonical).toBe("pt-PT");
  });

  it("keeps unknown languages without a region", () => {
    const unknown = normalizeLocale("zz");
    expect(unknown.canonical).toBe("zz");
    expect(unknown.flagTag).toBeUndefined();
  });

  it("normalizes Serbo-Croatian aliases", () => {
    expect(normalizeLocale("sh").canonical).toBe("sr-RS");
    expect(normalizeLocale("serbocroatian").canonical).toBe("sr-RS");
  });
});
