import { listPacks, seedCatalog } from "../src/server/catalog";
import { getPool } from "../src/server/db";

const requested = Number(process.argv[2] ?? 1500);
if (!Number.isInteger(requested) || requested < 10) throw new Error("Choose a whole-number catalog target of at least 10 tracks.");
const target = Math.min(2000, requested);
try {
  console.log(`Importing up to ${target} eligible Audius tracks…`);
  const count = await seedCatalog(target, count => console.log(`Catalog: ${count} tracks`), { onStatus: message => console.log(message) });
  console.log(`Catalog ready with ${count} playable tracks.`);
  for (const pack of await listPacks()) console.log(`${pack.id}: ${pack.count} playable tracks — ${pack.name}`);
} finally {
  await getPool().end();
}
