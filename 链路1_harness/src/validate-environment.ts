import { loadVideoEnvironmentFile } from "./environment-file.js";

const path = process.argv[2];
if (!path) {
  console.error("Usage: npm run validate:environment -- /path/to/video_environment.json");
  process.exitCode = 2;
} else {
  const environment = loadVideoEnvironmentFile(path);
  console.log(
    JSON.stringify(
      {
        status: "valid",
        videoId: environment.videoId,
        durationMs: environment.durationMs,
        asrSegmentCount: environment.asrSegments.length,
        ocrSegmentCount: environment.ocrSegments.length,
        semanticSegmentCount: environment.semanticSegments.length,
      },
      null,
      2,
    ),
  );
}
