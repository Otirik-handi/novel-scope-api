import { BookDownloadRunnerRegistry } from "./book-download-runner.registry";
import type { BookDownloadRunner } from "./book-download-runner.interface";

describe("BookDownloadRunnerRegistry", () => {
  it("resolves platform runners", () => {
    const fanqie = { platform: "fanqie" } as BookDownloadRunner;
    const qidian = { platform: "qidian" } as BookDownloadRunner;
    const registry = new BookDownloadRunnerRegistry(fanqie, qidian);

    expect(registry.resolve("fanqie")).toBe(fanqie);
    expect(registry.resolve("qidian")).toBe(qidian);
  });
});
