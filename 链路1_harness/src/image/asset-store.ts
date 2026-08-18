import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { GeneratedImage } from "./client.js";
import type { GeneratedCardAsset } from "../domain.js";

export interface CardAssetStore {
  persist(args: {
    runId: string;
    candidateId: string;
    generated: GeneratedImage;
    attempt: number;
    variant?: "card" | "hint-sticker";
    targetWidth?: number;
    targetHeight?: number;
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
    generated: GeneratedImage;
    attempt: number;
    variant?: "card" | "hint-sticker";
    targetWidth?: number;
    targetHeight?: number;
  }): Promise<GeneratedCardAsset> {
    await mkdir(this.directory, { recursive: true });
    const source = await loadImageBytes(args.generated);
    const targetWidth = args.targetWidth ?? 310;
    const targetHeight = args.targetHeight ?? 180;
    const variantSuffix = args.variant === "hint-sticker" ? "_hint" : "";
    const filename = `${args.runId}_${args.candidateId}${variantSuffix}_a${args.attempt}.png`;
    const localPath = join(this.directory, filename);
    const resizeFilter =
      `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=increase,` +
      `crop=${targetWidth}:${targetHeight}`;
    const cornerSize = Math.max(4, Math.round(Math.min(targetWidth, targetHeight) * 0.045));
    const cornerFill = [
      `drawbox=x=0:y=0:w=${cornerSize}:h=${cornerSize}:color=0x0B0B0B:t=fill`,
      `drawbox=x=iw-${cornerSize}:y=0:w=${cornerSize}:h=${cornerSize}:color=0x0B0B0B:t=fill`,
      `drawbox=x=0:y=ih-${cornerSize}:w=${cornerSize}:h=${cornerSize}:color=0x0B0B0B:t=fill`,
      `drawbox=x=iw-${cornerSize}:y=ih-${cornerSize}:w=${cornerSize}:h=${cornerSize}:color=0x0B0B0B:t=fill`,
    ].join(",");
    const conversionArgs = args.variant === "hint-sticker"
      ? [
          "-hide_banner", "-loglevel", "error", "-i", "pipe:0",
          "-vf", resizeFilter,
          "-frames:v", "1", "-c:v", "png", "-f", "image2pipe", "pipe:1",
        ]
      : [
          "-hide_banner", "-loglevel", "error",
          "-f", "lavfi", "-i", `color=c=0x0B0B0B:s=${targetWidth}x${targetHeight}`,
          "-i", "pipe:0",
          "-filter_complex",
          `[1:v]${resizeFilter},format=rgba[card];` +
            `[0:v][card]overlay=0:0:format=auto,format=rgb24,${cornerFill}[out]`,
          "-map", "[out]",
          "-frames:v", "1", "-c:v", "png", "-f", "image2pipe", "pipe:1",
        ];
    const converted = spawnSync(
      "ffmpeg",
      conversionArgs,
      { input: source, maxBuffer: 20 * 1024 * 1024 },
    );
    if (converted.status !== 0 || !converted.stdout.length) {
      throw new Error(`ffmpeg card conversion failed: ${converted.stderr.toString().slice(0, 300)}`);
    }
    const output = args.variant === "hint-sticker"
      ? removeConnectedLightBackground(converted.stdout, targetWidth, targetHeight)
      : converted.stdout;
    await writeFile(localPath, output);
    return {
      ...(args.generated.url ? { originalUrl: args.generated.url } : {}),
      localPath,
      publicUrl: `${this.publicPrefix}/${filename}`,
      width: targetWidth,
      height: targetHeight,
      model: args.generated.model,
      attempts: args.attempt,
    };
  }
}

function removeConnectedLightBackground(
  png: Buffer,
  width: number,
  height: number,
): Buffer {
  const decoded = spawnSync(
    "ffmpeg",
    [
      "-hide_banner", "-loglevel", "error", "-i", "pipe:0",
      "-frames:v", "1", "-pix_fmt", "rgba", "-f", "rawvideo", "pipe:1",
    ],
    { input: png, maxBuffer: Math.max(20 * 1024 * 1024, width * height * 4 + 1024) },
  );
  if (decoded.status !== 0 || decoded.stdout.length !== width * height * 4) {
    throw new Error(`ffmpeg sticker decode failed: ${decoded.stderr.toString().slice(0, 300)}`);
  }

  const pixels = Buffer.from(decoded.stdout);
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  const isBackground = (pixel: number): boolean => {
    const offset = pixel * 4;
    const red = pixels[offset]!;
    const green = pixels[offset + 1]!;
    const blue = pixels[offset + 2]!;
    const alpha = pixels[offset + 3]!;
    return alpha === 0 || (
      Math.min(red, green, blue) >= 235 &&
      Math.max(red, green, blue) - Math.min(red, green, blue) <= 25
    );
  };
  const enqueue = (pixel: number): void => {
    if (visited[pixel] || !isBackground(pixel)) return;
    visited[pixel] = 1;
    queue[tail] = pixel;
    tail += 1;
  };

  for (let x = 0; x < width; x += 1) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    enqueue(y * width);
    enqueue(y * width + width - 1);
  }
  while (head < tail) {
    const pixel = queue[head]!;
    head += 1;
    pixels[pixel * 4 + 3] = 0;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    if (x > 0) enqueue(pixel - 1);
    if (x + 1 < width) enqueue(pixel + 1);
    if (y > 0) enqueue(pixel - width);
    if (y + 1 < height) enqueue(pixel + width);
  }

  const encoded = spawnSync(
    "ffmpeg",
    [
      "-hide_banner", "-loglevel", "error",
      "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${width}x${height}`,
      "-i", "pipe:0", "-frames:v", "1", "-c:v", "png", "-f", "image2pipe", "pipe:1",
    ],
    { input: pixels, maxBuffer: 20 * 1024 * 1024 },
  );
  if (encoded.status !== 0 || !encoded.stdout.length) {
    throw new Error(`ffmpeg sticker encode failed: ${encoded.stderr.toString().slice(0, 300)}`);
  }
  return encoded.stdout;
}

async function loadImageBytes(generated: GeneratedImage): Promise<Buffer> {
  if (generated.base64) return Buffer.from(generated.base64, "base64");
  if (!generated.url) throw new Error("Generated image has no URL or Base64 data");
  const response = await fetch(generated.url);
  if (!response.ok) throw new Error(`Failed to download generated image: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
