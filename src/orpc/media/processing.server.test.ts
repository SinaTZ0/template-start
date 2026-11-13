import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { MEDIA_MAX_BYTES } from "#/orpc/media/constants";
import { processImage } from "#/orpc/media/processing.server";

/*===== Image Processing =====*/
// The only gate between an uploaded file and the bucket: whatever passes is stored and served to everyone.

async function pngFile(): Promise<File> {
  const body = await sharp({ create: { width: 64, height: 48, channels: 3, background: "#336699" } })
    .png()
    .toBuffer();
  return new File([new Uint8Array(body)], "photo.png", { type: "image/png" });
}

describe("processImage", () => {
  it("turns an accepted image into WebP variants", async () => {
    const result = await processImage({ file: await pngFile(), kind: "image" });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.image).toMatchObject({ width: 64, height: 48 });
    for (const variant of result.image.variants) {
      expect((await sharp(variant.body).metadata()).format).toBe("webp");
    }
  });

  it("rejects a file that only claims to be an image", async () => {
    const file = new File(["<script>alert(1)</script>"], "photo.png", { type: "image/png" });

    expect((await processImage({ file, kind: "image" })).kind).toBe("invalid");
  });

  it("rejects a file over the size limit", async () => {
    const file = new File([new Uint8Array(MEDIA_MAX_BYTES + 1)], "photo.png", { type: "image/png" });

    expect((await processImage({ file, kind: "image" })).kind).toBe("invalid");
  });
});
