import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalCardAssetStore } from "../image/asset-store.js";

test("generated card is persisted as a 3x 930x540 PNG without libwebp", async () => {
  const directory = await mkdtemp(join(tmpdir(), "chain1-card-"));
  try {
    const onePixelPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const asset = await new LocalCardAssetStore(directory).persist({
      runId: "run",
      candidateId: "candidate",
      generated: { source: "base64", base64: onePixelPng, model: "test" },
      attempt: 1,
      targetWidth: 930,
      targetHeight: 540,
    });
    const bytes = await readFile(asset.localPath);
    assert.equal(asset.width, 930);
    assert.equal(asset.height, 540);
    assert.match(asset.localPath, /\.png$/);
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    const probe = spawnSync(
      "ffprobe",
      [
        "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=pix_fmt", "-of", "default=nw=1:nk=1",
        asset.localPath,
      ],
      { encoding: "utf8" },
    );
    assert.equal(probe.status, 0);
    assert.equal(probe.stdout.trim(), "rgb24");
    const corner = spawnSync(
      "ffmpeg",
      [
        "-v", "error", "-i", asset.localPath,
        "-vf", "crop=1:1:0:0,format=rgb24",
        "-frames:v", "1", "-f", "rawvideo", "pipe:1",
      ],
    );
    assert.equal(corner.status, 0);
    assert.ok(
      [...corner.stdout].every((channel) => Math.abs(channel - 11) <= 1),
      `expected #0B0B0B corner within ffmpeg rounding tolerance, got ${[...corner.stdout].join(",")}`,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("light-prompt sticker is persisted as a 3x 120x120 PNG", async () => {
  const directory = await mkdtemp(join(tmpdir(), "chain1-sticker-"));
  try {
    const whitePng = spawnSync(
      "ffmpeg",
      [
        "-v", "error", "-f", "lavfi", "-i", "color=c=white:s=8x8",
        "-frames:v", "1", "-c:v", "png", "-f", "image2pipe", "pipe:1",
      ],
    );
    assert.equal(whitePng.status, 0);
    const asset = await new LocalCardAssetStore(directory).persist({
      runId: "run",
      candidateId: "candidate",
      generated: { source: "base64", base64: whitePng.stdout.toString("base64"), model: "test" },
      attempt: 1,
      variant: "hint-sticker",
      targetWidth: 120,
      targetHeight: 120,
    });
    assert.equal(asset.width, 120);
    assert.equal(asset.height, 120);
    assert.match(asset.localPath, /_hint_a1\.png$/);
    const corner = spawnSync(
      "ffmpeg",
      [
        "-v", "error", "-i", asset.localPath,
        "-vf", "crop=1:1:0:0,format=rgba",
        "-frames:v", "1", "-f", "rawvideo", "pipe:1",
      ],
    );
    assert.equal(corner.status, 0);
    assert.equal(corner.stdout[3], 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
