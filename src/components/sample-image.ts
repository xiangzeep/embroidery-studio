export function resolveSampleImageFromSearch(search: string): string | null {
  const params = new URLSearchParams(search);
  const sample = params.get("sample");
  if (!sample) return null;
  if (!sample.startsWith("/")) return null;
  if (sample.startsWith("//")) return null;
  return sample;
}
