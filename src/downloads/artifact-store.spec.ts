import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import {
  ArtifactStore,
  ArtifactStoreError,
} from "./artifact-store";

describe("ArtifactStore", () => {
  async function createStore(maxSizeBytes = 1024) {
    const root = await mkdtemp(join(tmpdir(), "novel-scope-artifacts-"));
    return { root, store: new ArtifactStore({ rootDirectory: root, maxSizeBytes }) };
  }

  it("validates the root and atomically stores a TXT with SHA-256", async () => {
    const { root, store } = await createStore();
    await expect(store.validateRoot()).resolves.toBeUndefined();

    const result = await store.store(
      "11111111-1111-4111-8111-111111111111",
      Readable.from([Buffer.from("第一章\n正文内容", "utf8")]),
      "text/plain; charset=utf-8",
    );

    expect(result).toEqual({
      relativePath: "11111111-1111-4111-8111-111111111111.txt",
      sizeBytes: 22,
      sha256: "a50db2d95bec021260c697289518becbdc92df2beb6693fce2f8150da9258d24",
    });
    await expect(readFile(join(root, result.relativePath), "utf8")).resolves.toBe(
      "第一章\n正文内容",
    );
    await expect(stat(join(root, "11111111-1111-4111-8111-111111111111.part"))).rejects.toThrow();
  });

  it("removes the partial file when the stream exceeds the configured limit", async () => {
    const { root, store } = await createStore(4);

    await expect(
      store.store(
        "22222222-2222-4222-8222-222222222222",
        Readable.from([Buffer.from("12345")]),
        "text/plain",
      ),
    ).rejects.toMatchObject({ code: "ARTIFACT_TOO_LARGE" });
    await expect(stat(join(root, "22222222-2222-4222-8222-222222222222.part"))).rejects.toThrow();
    await expect(stat(join(root, "22222222-2222-4222-8222-222222222222.txt"))).rejects.toThrow();
  });

  it.each([
    ["", "text/plain", "ARTIFACT_INVALID"],
    ["<html><body>error</body></html>", "text/html", "ARTIFACT_INVALID"],
    ['{"error":"blocked"}', "application/json", "ARTIFACT_INVALID"],
    ["abc\u0000def", "text/plain", "ARTIFACT_INVALID"],
  ])("rejects an invalid artifact (%p)", async (content, contentType, code) => {
    const { store } = await createStore();

    await expect(
      store.store(
        "33333333-3333-4333-8333-333333333333",
        Readable.from([Buffer.from(content)]),
        contentType,
      ),
    ).rejects.toMatchObject({ code });
  });

  it("removes a partial file after a source stream error", async () => {
    const { root, store } = await createStore();
    const source = new Readable({
      read() {
        this.push("partial");
        this.destroy(new Error("source failed"));
      },
    });

    await expect(
      store.store(
        "44444444-4444-4444-8444-444444444444",
        source,
        "text/plain",
      ),
    ).rejects.toBeInstanceOf(ArtifactStoreError);
    await expect(stat(join(root, "44444444-4444-4444-8444-444444444444.part"))).rejects.toThrow();
  });

  it("opens and idempotently deletes only UUID TXT artifacts", async () => {
    const { root, store } = await createStore();
    const name = "55555555-5555-4555-8555-555555555555.txt";
    await writeFile(join(root, name), "正文", "utf8");

    const stream = await store.open(name);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString("utf8")).toBe("正文");

    await expect(store.delete(name)).resolves.toBeUndefined();
    await expect(store.delete(name)).resolves.toBeUndefined();
    await expect(store.open(name)).rejects.toMatchObject({
      code: "ARTIFACT_NOT_FOUND",
    });
  });

  it.each(["../secret.txt", "not-a-uuid.txt", "11111111-1111-4111-8111-111111111111.epub"])(
    "rejects an unsafe artifact path: %s",
    async (path) => {
      const { store } = await createStore();
      await expect(store.open(path)).rejects.toMatchObject({
        code: "ARTIFACT_INVALID",
      });
    },
  );
});
