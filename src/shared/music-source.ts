export function musicSource(track: { id: string }): "Audius" | "Deezer" {
  return track.id.startsWith("deezer-") ? "Deezer" : "Audius";
}

export function packDisplayName(pack: { id: string; name: string }): string {
  const genres: Record<string, string> = { pop: "Pop", "hip-hop": "Hip-hop", rock: "Rock", indie: "Indie & alternative", electronic: "Electronic" };
  return Object.hasOwn(genres, pack.id) ? genres[pack.id] : pack.name;
}
