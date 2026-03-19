import { describe, expect, it } from "bun:test";
import { buildLogFilename, getLogRuntimeLabel } from "../src/utils/logger.js";

describe("logger filename scoping", () => {
  it("should mark Bun test runs with a test runtime label", () => {
    expect(getLogRuntimeLabel("test")).toBe("test");
    expect(getLogRuntimeLabel("production")).toBe("runtime");
  });

  it("should generate distinct filenames for test and runtime logs", () => {
    expect(buildLogFilename("2026-03-11_22-45-12_927", "test")).toBe(
      "2026-03-11_22-45-12_927-librarian-test.log",
    );
    expect(buildLogFilename("2026-03-11_22-45-12_927", "production")).toBe(
      "2026-03-11_22-45-12_927-librarian.log",
    );
  });
});
