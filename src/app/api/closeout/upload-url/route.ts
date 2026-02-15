import { randomUUID } from "crypto";
import path from "path";
import { NextResponse } from "next/server";
import { authenticateShiftRequest } from "@/lib/shiftAuth";
import { supabaseServer } from "@/lib/supabaseServer";

type Body = {
  filename?: string;
  fileType?: string;
};

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

function sanitizeBaseFilename(filename: string): string {
  const base = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, "_");
  return base.length ? base : "upload";
}

function fileExtFromNameOrType(filename: string, fileType: string): string {
  const fromName = path.extname(filename).replace(".", "").toLowerCase();
  if (fromName) return fromName;
  const fromType = fileType.split("/")[1]?.toLowerCase() ?? "";
  return fromType || "bin";
}

function cstDateStamp(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export async function POST(req: Request) {
  try {
    const authResult = await authenticateShiftRequest(req);
    if (!authResult.ok) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }
    const auth = authResult.auth;

    const body = await req.json().catch(() => null) as Body | null;
    if (!body) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });

    const filename = (body.filename ?? "").trim();
    const fileType = (body.fileType ?? "").trim().toLowerCase();

    if (!filename) return NextResponse.json({ error: "filename is required." }, { status: 400 });
    if (!fileType) return NextResponse.json({ error: "fileType is required." }, { status: 400 });
    if (!ALLOWED_IMAGE_TYPES.has(fileType)) {
      return NextResponse.json({ error: "Unsupported file type." }, { status: 400 });
    }

    const safeName = sanitizeBaseFilename(filename);
    const ext = fileExtFromNameOrType(safeName, fileType);
    const key = `${auth.profileId}/${cstDateStamp()}/${randomUUID()}.${ext}`;

    const { data, error } = await supabaseServer.storage
      .from("safe-photos")
      .createSignedUploadUrl(key);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({
      url: data.signedUrl,
      path: data.path,
      token: data.token,
      contentType: fileType,
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to create signed upload URL." },
      { status: 500 }
    );
  }
}
