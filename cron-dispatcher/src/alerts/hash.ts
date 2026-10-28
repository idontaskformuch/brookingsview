/** Same as db.content_hash() in Python: sha256 of the parts joined with "|" (None -> ""), hex. */
export async function contentHash(...parts: (string | null | undefined)[]): Promise<string> {
  const payload = parts.map((p) => (p == null ? '' : String(p))).join('|');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
