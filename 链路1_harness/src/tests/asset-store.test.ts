import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalCardAssetStore } from "../image/asset-store.js";

test("generated card is persisted as a 310x180 PNG without libwebp", async () => {
  const directory = await mkdtemp(join(tmpdir(), "chain1-card-"));
  try {
    const onePixelPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const asset = await new LocalCardAssetStore(directory).persist({
      runId: "run",
      candidateId: "candidate",
      generated: { source: "base64", base64: onePixelPng, model: "test" },
      attempt: 1,
    });
    const bytes = await readFile(asset.localPath);
    assert.equal(asset.width, 310);
    assert.equal(asset.height, 180);
    assert.match(asset.localPath, /\.png$/);
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
