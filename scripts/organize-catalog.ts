import { organizeCatalog } from "../src/server/catalog";
import { getPool } from "../src/server/db";

try {
  const packs = await organizeCatalog();
  console.log("Automatic genre, decade, and popularity packs are organized.");
  for (const pack of packs) console.log(`${pack.id}: ${pack.count} playable tracks — ${pack.name}`);
} finally {
  await getPool().end();
}
