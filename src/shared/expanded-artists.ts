import type { PackSummary } from "./contracts";
import { artistIdentity, type FeaturedArtist } from "./featured-artists";

export interface CuratedArtistPack {
  id: "post-punk" | "guitar-favorites" | "uk-rap" | "russian-rap";
  name: string;
  description: string;
  genre: string;
  coverArt: PackSummary["coverArt"];
  artists: FeaturedArtist[];
}
const artists = (genre: string, names: string[]): FeaturedArtist[] => names.map(name => ({ name, genre }));

export const CURATED_ARTIST_PACKS: CuratedArtistPack[] = [
  { id: "post-punk", name: "Post-punk & new wave", description: "New Order, The Smiths, Joy Division, The Cure and Molchat Doma. A curated collection of original artist recordings.", genre: "Alternative", coverArt: "indie", artists: [
    ...artists("Alternative", ["New Order", "The Smiths", "Joy Division", "The Cure"]),
    { name: "Molchat Doma", genre: "Alternative", aliases: ["Молчат Дома"] },
  ] },
  { id: "guitar-favorites", name: "Alternative guitars", description: "Fugazi, Wolfmother, King Gizzard & The Lizard Wizard and Red Hot Chili Peppers. Punk, psychedelic and funk-rock favorites.", genre: "Rock", coverArt: "indie", artists: artists("Rock", ["Fugazi", "Wolfmother", "King Gizzard & The Lizard Wizard", "Red Hot Chili Peppers"]) },
  { id: "uk-rap", name: "UK rap", description: "Central Cee’s original recordings. A separate selection from the UK rap scene.", genre: "Hip-Hop/Rap", coverArt: "hip-hop", artists: artists("Hip-Hop/Rap", ["Central Cee"]) },
  { id: "russian-rap", name: "Russian rap", description: "kizaru, Big Baby Tape, OG Buda, PHARAOH, Скриптонит, Oxxxymiron and more. A curated artist selection; each song keeps its provider metadata.", genre: "Hip-Hop/Rap", coverArt: "hip-hop", artists: [
    ...artists("Hip-Hop/Rap", ["kizaru", "Big Baby Tape", "OG Buda", "PHARAOH", "SALUKI", "Oxxxymiron", "Скриптонит", "Boulevard Depo", "OBLADAET", "ATL", "Баста", "FRIENDLY THUG 52 NGG", "MAYOT"]),
    { name: "Miyagi & Andy Panda", genre: "Hip-Hop/Rap", aliases: ["Miyagi & Эндшпиль", "Miyagi & Endshpil"] },
    { name: "MORGENSHTERN", genre: "Hip-Hop/Rap", aliases: ["Моргенштерн"] },
  ] },
];

export const EXPANDED_ARTISTS: FeaturedArtist[] = [...CURATED_ARTIST_PACKS.flatMap(pack => pack.artists), { name: "Moby", genre: "Electronic" }];
export const curatedPackArtists = new Map(CURATED_ARTIST_PACKS.map(pack => [pack.id as string,
  new Set(pack.artists.flatMap(artist => [artist.name, ...artist.aliases ?? []]).map(artistIdentity)),
]));
