import { describe, expect, test } from "bun:test"
import { resolveJsonMcpConfig, validateMemoryText } from "./mcp-import"

describe("Phase 2 command resolution", () => {
  test("JSON tools resolve, TOML and unknown tools throw", () => {
    expect(resolveJsonMcpConfig("/home/u", "claude")).toContain(".claude.json")
    expect(() => resolveJsonMcpConfig("/home/u", "codex")).toThrow(/TOML/)
    expect(() => resolveJsonMcpConfig("/home/u", "nope")).toThrow(/unknown/)
  })
  test("memory validation rejects empty text and accepts real text", () => {
    expect(() => validateMemoryText("   \n")).toThrow()
    expect(validateMemoryText("  hello  ")).toBe("hello")
  })
})
