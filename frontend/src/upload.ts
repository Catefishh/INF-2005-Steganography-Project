const MEDIA_EXTENSIONS: Record<string, string[]> = {
  image: ["png", "bmp", "jpg", "jpeg", "gif", "webp", "tif", "tiff", "avif", "ico", "ppm", "pgm", "pbm", "pnm", "tga", "pcx", "dds", "dib", "xbm", "jp2", "j2k"],
  audio: ["wav", "mp3", "flac", "ogg", "oga", "opus", "aac", "m4a", "aiff", "aif", "aifc", "wma", "au", "amr", "ac3", "eac3", "w64", "asf"],
  video: ["mp4", "mov", "avi", "mkv", "webm", "flv", "wmv", "3gp", "m4v", "mpg", "mpeg", "ts", "m2ts", "mts", "ogv"],
};

export const MEDIA_ACCEPT = "image/*,audio/*,video/*";
export const KEY_ACCEPT = ".pem,.key,.pub,.txt";

/** Extensions take precedence over browser-supplied MIME types, which can be empty or spoofed. */
export function uploadError(file: File, accept?: string): string {
  if (!accept?.trim()) return "";
  const rules = accept.toLowerCase().split(",").map((rule) => rule.trim()).filter(Boolean);
  const name = file.name.toLowerCase();
  const extension = name.match(/\.([^.]+)$/)?.[1] ?? "";
  const allowed = rules.some((rule) => rule.startsWith(".") && name.endsWith(rule))
    || rules.some((rule) => rule.endsWith("/*") && MEDIA_EXTENSIONS[rule.split("/")[0]]?.includes(extension))
    || (!rules.some((rule) => rule.startsWith(".") || rule.endsWith("/*")) && rules.includes(file.type.toLowerCase()));
  return allowed ? "" : `Choose a file of the accepted types: ${accept}.`;
}

export async function readKeyFile(file: File): Promise<string> {
  const error = uploadError(file, KEY_ACCEPT);
  if (error) throw new Error(error);
  if (file.size > 64 * 1024) throw new Error("Choose a PEM key file smaller than 64 KiB.");
  const pem = await file.text();
  const match = pem.trim().match(/^-----BEGIN ((?:RSA |EC |ENCRYPTED )?(?:PRIVATE|PUBLIC) KEY)-----\s*([\s\S]+?)\s*-----END \1-----$/);
  const body = match?.[2].replace(/^(?:Proc-Type|DEK-Info):[^\r\n]*\r?\n/gm, "").trim();
  if (!body || !/^[A-Za-z0-9+/=\s]+$/.test(body)) throw new Error("Choose a PEM private or public key file.");
  return pem;
}
