import { put } from "@vercel/blob";
import { NextResponse, type NextRequest } from "next/server";

import { auth } from "@/auth";

export const dynamic = "force-dynamic";

/** Big enough for a banner or signature image; mail clients choke on more. */
const MAX_BYTES = 2 * 1024 * 1024;

/** Checked against the file's first bytes, not just the browser's claim. */
const IMAGE_TYPES: { type: string; ext: string; matches: (bytes: Uint8Array) => boolean }[] = [
  {
    type: "image/png",
    ext: "png",
    matches: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  },
  { type: "image/jpeg", ext: "jpg", matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { type: "image/gif", ext: "gif", matches: (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 },
  {
    type: "image/webp",
    ext: "webp",
    matches: (b) =>
      String.fromCharCode(...b.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...b.slice(8, 12)) === "WEBP",
  },
];

function fail(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

/**
 * Uploads an image for a template body to Vercel Blob and returns its public
 * URL. Images are never deleted: emails already sent keep pointing at them.
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return fail("Sign in first.", 401);

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return fail("Image uploads are not set up: BLOB_READ_WRITE_TOKEN is missing.", 503);
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return fail("Choose an image to upload.", 400);
  if (file.size === 0) return fail("That file is empty.", 400);
  if (file.size > MAX_BYTES) return fail("Images can be at most 2 MB.", 413);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = IMAGE_TYPES.find((candidate) => candidate.matches(bytes));
  if (!kind) return fail("Use a PNG, JPEG, GIF or WebP image.", 415);

  const base =
    file.name
      .replace(/\.[^.]*$/, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "image";

  try {
    const blob = await put(`templates/${session.user.id}/${base}.${kind.ext}`, Buffer.from(bytes), {
      access: "public",
      addRandomSuffix: true,
      contentType: kind.type,
      cacheControlMaxAge: 60 * 60 * 24 * 365,
    });
    return NextResponse.json({ url: blob.url });
  } catch (error) {
    console.error("Template image upload failed", error);
    return fail("Could not upload the image. Try again.", 502);
  }
}
