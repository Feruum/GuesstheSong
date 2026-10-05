import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { deezerGet, normalizeDeezerTrack, privatePreviewsEnabled } from "../src/server/deezer";
import { importTracks, listPacks, organizeCatalog } from "../src/server/catalog";
import { getPool } from "../src/server/db";
import type { Track } from "../src/shared/contracts";

if (!privatePreviewsEnabled()) throw new Error("Set DEEZER_PRIVATE_PREVIEWS=true with a loopback APP_URL for private noncommercial listening. Public hosting is disabled for this source.");
const target = Number(process.argv[2] || 3000);
if (!Number.isInteger(target) || target < 10 || target > 10000) throw new Error("Choose a target between 10 and 10000 official previews.");

// Explicit editorial artist list. Resolve the canonical artist with the largest
// provider audience, then use only songs associated with that artist's ID.
const groups: Record<string, string[]> = {
  Pop: ["Taylor Swift", "Ariana Grande", "Beyoncé", "Rihanna", "Lady Gaga", "Katy Perry", "Britney Spears", "Bruno Mars", "Justin Bieber", "Miley Cyrus", "Selena Gomez", "Harry Styles", "Ed Sheeran", "Adele", "Sam Smith", "Dua Lipa", "The Weeknd", "Billie Eilish", "Sia", "Lana Del Rey", "Ellie Goulding", "Kesha", "Doja Cat", "Olivia Rodrigo", "Sabrina Carpenter", "Chappell Roan", "Maroon 5", "Imagine Dragons", "OneRepublic", "Justin Timberlake", "Shawn Mendes", "Camila Cabello", "Lorde", "Madonna", "Michael Jackson", "Whitney Houston", "ABBA", "a-ha", "Boney M.", "George Michael", "Elton John", "Tears for Fears", "Eurythmics", "Zivert", "t.A.T.u."],
  "Hip-Hop/Rap": ["Drake", "Eminem", "Kanye West", "JAY-Z", "Kendrick Lamar", "Travis Scott", "Future", "Post Malone", "Snoop Dogg", "2Pac", "50 Cent", "Ice Cube", "The Notorious B.I.G.", "Nicki Minaj", "Cardi B", "Tyler, The Creator", "J. Cole", "Kid Cudi", "A$AP Rocky", "Wiz Khalifa", "Macklemore", "Pitbull", "Outkast", "Nas", "Dr. Dre", "Баста", "Скриптонит", "Мот", "Егор Крид", "Макс Корж", "ЛСП"],
  Alternative: ["Arctic Monkeys", "Tame Impala", "Oasis", "Blur", "The Killers", "MGMT", "The Strokes", "Franz Ferdinand", "Paramore", "Twenty One Pilots", "Fall Out Boy", "Panic! At The Disco", "The Cure", "Depeche Mode", "Radiohead", "Muse", "Florence + The Machine", "Hozier", "The xx", "Cage The Elephant", "The 1975", "Foster The People", "Lykke Li", "Bon Iver", "alt-J", "Мумий Тролль", "Кино", "Би-2", "Сплин", "Земфира", "Монеточка", "Молчат Дома"],
  Rock: ["Coldplay", "Queen", "AC/DC", "Guns N' Roses", "Aerosmith", "Bon Jovi", "Nirvana", "Foo Fighters", "Green Day", "Linkin Park", "Red Hot Chili Peppers", "Pink Floyd", "The Rolling Stones", "The Beatles", "Fleetwood Mac", "David Bowie", "U2", "The Police", "Dire Straits", "Led Zeppelin", "Eagles", "Journey", "The Cranberries", "R.E.M.", "Blink-182"],
  "R&B/Soul": ["Frank Ocean", "Chris Brown", "Usher", "Ne-Yo", "Alicia Keys", "SZA", "Khalid", "Mary J. Blige", "Toni Braxton", "Seal", "Amy Winehouse", "John Legend", "Lauryn Hill", "Stevie Wonder", "Otis Redding", "Diana Ross", "Prince", "Marvin Gaye", "Aretha Franklin", "Ray Charles", "Sam Cooke", "Brandy", "Destiny's Child", "TLC", "Boyz II Men"],
  Electronic: ["Avicii", "Calvin Harris", "David Guetta", "Martin Garrix", "Alan Walker", "Zedd", "Kygo", "Daft Punk", "Skrillex", "deadmau5", "Diplo", "Disclosure", "Swedish House Mafia", "Fred again..", "DJ Snake", "Major Lazer", "Marshmello", "The Chainsmokers", "Alesso", "Tiësto", "Armin van Buuren", "Faithless", "The Prodigy", "Fatboy Slim", "Moby", "The Chemical Brothers", "RÜFÜS DU SOL", "ODESZA", "Justice", "Gorillaz"],
  Jazz: ["Miles Davis", "Louis Armstrong", "Ella Fitzgerald", "Frank Sinatra", "Duke Ellington", "John Coltrane", "Chet Baker", "Herbie Hancock", "Dave Brubeck", "Norah Jones", "Nat King Cole", "Nina Simone", "Billie Holiday", "Diana Krall", "Stacey Kent"],
  Latin: ["Shakira", "Bad Bunny", "J Balvin", "Maluma", "Daddy Yankee", "KAROL G", "ROSALÍA", "Enrique Iglesias", "Luis Fonsi", "Don Omar", "Ricky Martin", "Marc Anthony", "Celia Cruz", "Rauw Alejandro", "Ozuna", "Nicky Jam", "Juanes", "Manu Chao"],
  Country: ["Johnny Cash", "Dolly Parton", "Willie Nelson", "Carrie Underwood", "Shania Twain", "Luke Combs", "Chris Stapleton", "Morgan Wallen", "Zach Bryan", "Kenny Rogers", "John Denver", "The Chicks", "Kacey Musgraves"],
  Metal: ["Metallica", "Iron Maiden", "Black Sabbath", "Judas Priest", "Megadeth", "Slipknot", "System Of A Down", "Korn", "Rammstein", "Nightwish", "Disturbed", "Evanescence", "Limp Bizkit", "Bring Me The Horizon", "Scorpions"],
  Reggae: ["Bob Marley & The Wailers", "Sean Paul", "Shaggy", "Jimmy Cliff", "Damian Marley", "Peter Tosh", "UB40", "Inner Circle"],
  Classical: ["Ludovico Einaudi", "Max Richter", "Ólafur Arnalds", "Yiruma", "Lang Lang", "Yo-Yo Ma", "André Rieu"],
};
const cacheDir = resolve(".data/deezer-metadata");
await mkdir(cacheDir, { recursive: true });
const artistSchema = z.object({ id: z.number().int().positive(), name: z.string(), nb_fan: z.number().default(0) });
const topSchema = z.object({ data: z.array(z.object({ id: z.number(), title: z.string(), rank: z.number().optional(), artist: z.object({ id: z.number(), name: z.string() }), album: z.object({ id: z.number() }), contributors: z.array(z.object({ id: z.number() })).optional() }).passthrough()) });
const identity = (text: string) => text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const songIdentity = (track: Track) => `${identity(track.artist)}:${identity(track.title.replace(/\s*[([{].*?[)\]}]/g, "").replace(/\s*[-–]\s*(?:\d{4}\s*)?remaster.*$/i, ""))}`;
const cacheGet = async (path: string, params: Record<string, string | number> = {}) => {
  const file = resolve(cacheDir, `${path.replaceAll("/", "-")}-${Buffer.from(JSON.stringify(params)).toString("base64url")}.json`);
  try {
    const cached = JSON.parse(await readFile(file, "utf8")) as { at: number; data: unknown };
    if (Date.now() - cached.at < 86400000) return cached.data;
  } catch { /* Fetch missing or expired metadata. */ }
  const data = await deezerGet(path, params);
  await writeFile(file, JSON.stringify({ at: Date.now(), data }));
  return data;
};

const existing = (await getPool().query("SELECT id,title,artist,available FROM tracks WHERE id LIKE 'deezer-%'")).rows as { id: string; title: string; artist: string; available: boolean }[];
const storedIds = new Set(existing.map(track => track.id));
const identities = new Set(existing.map(track => songIdentity(track as Track)));
let playable = existing.filter(track => track.available).length;
const report: { artist: string; providerId: number | null; imported: number; error?: string }[] = [];
const entries = Object.entries(groups).flatMap(([genre, names]) => names.map(name => ({ genre, name })));

// Round-robin the genres so a modest target still contains every family.
const balanced = Array.from({ length: Math.max(...Object.values(groups).map(names => names.length)) }, (_, index) => Object.entries(groups).flatMap(([genre, names]) => names[index] ? [{ genre, name: names[index] }] : [])).flat();
try {
  console.log(`Importing up to ${target} official artist previews. ${entries.length} curated artists; existing playable previews: ${playable}.`);
  for (let index = 0; index < balanced.length && playable < target; index += 3) {
    const batches = await Promise.all(balanced.slice(index, index + 3).map(async ({ name, genre }) => {
      try {
        const search = await cacheGet("search/artist", { q: name, limit: 25 });
        const artists = z.object({ data: z.array(artistSchema) }).parse(search).data;
        const artist = artists.filter(artist => identity(artist.name) === identity(name) && artist.nb_fan >= 1000).sort((left, right) => right.nb_fan - left.nb_fan)[0];
        if (!artist) return { name, id: null, tracks: [] as Track[], error: "No canonical artist with an established audience was found." };
        const raw = topSchema.parse(await cacheGet(`artist/${artist.id}/top`, { limit: 50 })).data;
        const candidates = raw.filter(song => (song.artist.id === artist.id || song.contributors?.some(contributor => contributor.id === artist.id)) && (song.rank || 0) >= 100000 && !/karaoke|tribute|sped.?up|slowed|nightcore|backing track|made famous|originally performed|\blive\b|\bdemo\b/i.test(song.title));
        const result: Track[] = [];
        for (const song of candidates.slice(0, 35)) {
          const album = await cacheGet(`album/${song.album.id}`);
          const track = normalizeDeezerTrack(song, album);
          if (track) { if (!track.genre) track.genre = genre; result.push(track); }
        }
        return { name, id: artist.id, tracks: result };
      } catch (error) { return { name, id: null, tracks: [] as Track[], error: error instanceof Error ? error.message : "Provider request failed." }; }
    }));
    for (const batch of batches) {
      const fresh = batch.tracks.filter(track => {
        const key = songIdentity(track);
        if (storedIds.has(track.id) || identities.has(key)) return false;
        storedIds.add(track.id); identities.add(key); return true;
      }).slice(0, target - playable);
      if (fresh.length) { await importTracks(fresh, "global-mix", undefined, { deferOrganization: true }); playable += fresh.length; }
      report.push({ artist: batch.name, providerId: batch.id, imported: fresh.length, ...(batch.error ? { error: batch.error } : {}) });
      console.log(`${batch.name}: +${fresh.length}; ${playable} playable previews${batch.error ? ` (skipped: ${batch.error.slice(0, 240)})` : ""}`);
    }
  }
} finally {
  await organizeCatalog();
  const packs = await listPacks();
  await writeFile(resolve(".data/hits-import-report.json"), JSON.stringify({ at: new Date().toISOString(), target, playable, artists: report, packs }, null, 2));
  console.log(`Ready: ${playable} official previews. Global mix: ${packs.find(pack => pack.id === "global-mix")?.count || 0} playable songs.`);
  for (const pack of packs) if (pack.count) console.log(`${pack.id}: ${pack.count}`);
  await getPool().end();
}
