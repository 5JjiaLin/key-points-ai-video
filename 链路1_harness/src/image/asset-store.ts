import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgnesGeneratedImage } from "./client.js";
import type { GeneratedCardAsset } from "../domain.js";

export interface CardAssetStore {
  persist(args: {
    runId: string;
    candidateId: string;
    generated: AgnesGeneratedImage;
    attempt: number;
  }): Promise<GeneratedCardAsset>;
}

export class LocalCardAssetStore implements CardAssetStore {
  constructor(
    private readonly directory: string,
    private readonly publicPrefix = "/generated/chain1-cards",
  ) {}

  async persist(args: {
    runId: string;
    candidateId: string;
    generated: AgnesGeneratedImage;
    attempt: number;
  }): Promise<GeneratedCardAsset> {
    await mkdir(this.directory, { recursive: true });
    const source = await loadImageBytes(args.generated);
    const filename = `${args.runId}_${args.candidateId}_a${args.attempt}.png`;
    const localPath = join(this.directory, filename);
    const converted = spawnSync(
      "ffmpeg",
      [
        "-hide_banner", "-loglevel", "error", "-i", "pipe:0",
        "-vf", "scale=310:180:force_original_aspect_ratio=increase,crop=310:180",
        "-frames:v", "1", "-c:v", "png", "-f", "image2pipe", "pipe:1",
      ],
      { input: source, maxBuffer: 20 * 1024 * 1024 },
    );
    if (converted.status !== 0 || !converted.stdout.length) {
      throw new Error(`ffmpeg card conversion failed: ${converted.stderr.toString().slice(0, 300)}`);
    }
    const output = converted.stdout;
    await writeFile(localPath, output);
    return {
      ...(args.generated.url ? { originalUrl: args.generated.url } : {}),
      localPath,
      publicUrl: `${this.publicPrefix}/${filename}`,
      width: 310,
      height: 180,
      model: args.generated.model,
      attempts: args.attempt,
    };
  }
}

async function loadImageBytes(generated: AgnesGeneratedImage): Promise<Buffer> {
  if (generated.base64) return Buffer.from(generated.base64, "base64");
  if (!generated.url) throw new Error("Generated image has no URL or Base64 data");
  const response = await fetch(generated.url);
  if (!response.ok) throw new Error(`Failed to download generated image: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
