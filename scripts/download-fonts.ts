import { mkdir } from "node:fs/promises";
await mkdir("public/fonts", { recursive: true });
for (const [family, filename] of [["Space Grotesk", "space-grotesk"], ["DM Sans", "dm-sans"]]) {
  const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${family.replace(/ /g, "+")}:wght@400;500;600;700&display=swap`, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36" } })).text();
  const urls = [...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.woff2)\)/g)].map(match => match[1]);
  if (!urls.length) throw new Error(`No ${family} font returned.`);
  const response = await fetch(urls.at(-1)!);
  if (!response.ok) throw new Error(`Unable to download ${family}.`);
  await Bun.write(`public/fonts/${filename}.woff2`, response);
  const license = await fetch(`https://raw.githubusercontent.com/google/fonts/main/ofl/${filename.replace(/-/g, "")}/OFL.txt`);
  if (!license.ok) throw new Error(`Unable to download the ${family} license.`);
  await Bun.write(`public/fonts/${filename}-OFL.txt`, license);
  console.log(`${family} font saved.`);
}
export {};
