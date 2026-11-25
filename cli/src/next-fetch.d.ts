// The terminal's data layer passes Next.js's `next: { revalidate }` fetch option; plain Node ignores it.
interface RequestInit {
  next?: { revalidate?: number | false; tags?: string[] };
}
