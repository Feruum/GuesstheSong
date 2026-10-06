export interface FeaturedArtist { name: string; genre: string; aliases?: readonly string[]; spotifyAllTimeRank?: number }
const roster = (genre: string, names: string[]): FeaturedArtist[] => names.map(name => ({ name, genre }));

// These major artists had fewer than five readable primary-artist previews in
// the provider response. Keep their absence explicit instead of using covers.
export const DEFERRED_FEATURED_ARTISTS: readonly FeaturedArtist[] = [
  ...roster("Pop", ["Ed Sheeran", "Bruno Mars", "Dua Lipa", "Madonna"]),
  ...roster("Hip-Hop/Rap", ["Lil Uzi Vert", "The Notorious B.I.G.", "Cardi B"]),
  ...roster("Rock", ["Coldplay", "Linkin Park", "Red Hot Chili Peppers", "Green Day", "Twenty One Pilots"]),
];
const deferredNames = new Set(DEFERRED_FEATURED_ARTISTS.map(artist => artist.name));

// Ranked entries follow Spotify's April 2026 all-time list. All other entries
// are editorial choices with available originals, not positions in that chart.
export const FEATURED_ARTISTS: readonly FeaturedArtist[] = [
  ...[
    ["Taylor Swift", "Pop"], ["Bad Bunny", "Latin"], ["Drake", "Hip-Hop/Rap"], ["The Weeknd", "Pop"],
    ["Ariana Grande", "Pop"], ["Ed Sheeran", "Pop"], ["Justin Bieber", "Pop"], ["Billie Eilish", "Pop"],
    ["Eminem", "Hip-Hop/Rap"], ["Kanye West", "Hip-Hop/Rap"], ["Travis Scott", "Hip-Hop/Rap"], ["BTS", "Pop"],
    ["Post Malone", "Hip-Hop/Rap"], ["Bruno Mars", "Pop"], ["J Balvin", "Latin"], ["Rihanna", "Pop"],
    ["Coldplay", "Rock"], ["Kendrick Lamar", "Hip-Hop/Rap"], ["Future", "Hip-Hop/Rap"], ["Juice WRLD", "Hip-Hop/Rap"],
  ].map(([name, genre], index) => ({ name, genre, spotifyAllTimeRank: index + 1 })).filter(artist => !deferredNames.has(artist.name)),
  ...roster("Pop", [
    "SZA", "Beyoncé", "Lady Gaga", "Katy Perry", "Adele", "Miley Cyrus", "Harry Styles",
    "Sabrina Carpenter", "Olivia Rodrigo", "Lana Del Rey", "Doja Cat", "Chappell Roan", "Halsey", "Lorde",
    "Selena Gomez", "Shawn Mendes", "Camila Cabello", "Sam Smith", "Sia", "Britney Spears",
    "Michael Jackson", "Maroon 5", "Imagine Dragons", "OneRepublic", "Lewis Capaldi", "Tate McRae", "Khalid",
    "BLACKPINK", "ABBA", "Elton John", "Jennifer Lopez", "Meghan Trainor",
  ]),
  { name: "P!nk", genre: "Pop", aliases: ["Pink"] },
  ...roster("Hip-Hop/Rap", [
    "Nicki Minaj", "Tyler, The Creator", "J. Cole", "Lil Wayne", "XXXTENTACION", "A$AP Rocky",
    "21 Savage", "Metro Boomin", "Playboi Carti", "50 Cent", "Snoop Dogg", "JAY-Z", "Nas", "Dr. Dre",
    "2Pac", "Outkast", "Lil Baby", "Lil Nas X", "Pitbull", "Lil Peep",
  ]),
  ...roster("R&B/Soul", ["Frank Ocean", "USHER", "Alicia Keys"]),
  ...roster("Rock", [
    "Queen", "Nirvana", "Arctic Monkeys", "The Beatles",
    "The Rolling Stones", "AC/DC", "Metallica", "Oasis", "Radiohead", "Tame Impala",
    "The Neighbourhood",
  ]),
  ...roster("Electronic", ["Daft Punk", "Avicii", "Calvin Harris", "David Guetta", "Martin Garrix", "Alan Walker", "Zedd", "Kygo", "Marshmello", "The Chainsmokers", "Tiësto"]),
  ...roster("Latin", ["Shakira", "KAROL G", "Daddy Yankee", "ROSALÍA"]),
  { name: "Rema", genre: "Afrobeats" },
];

export const artistIdentity = (name: string) => name.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
export const featuredArtistNames = new Set(FEATURED_ARTISTS.flatMap(artist => [artist.name, ...artist.aliases ?? []]).map(artistIdentity));
export const SPOTIFY_ARTIST_SOURCE = "https://newsroom.spotify.com/2026-04-23/spotify-20-most-streamed-music-podcasts-audiobooks/";
