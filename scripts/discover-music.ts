import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { discoverMusic, discoveryOutputPath, parseDiscoveryArgs } from "./music-sources/discovery";
import { probeAudio, type AudioProbe, type MusicCandidate } from "./music-sources/shared";

const help = `Find free music through public publisher catalogs and APIs.

Usage: bun run music:discover --source <source> --query <text> [options]

  --source           all | incompetech | commons | ccmixter | openverse (default: all)
  --query            Title, artist or genre; Commons also accepts File: titles
  --limit            1–50 results per source (default: 20; Openverse maximum: 20)
  --verify-audio     Check bounded MPEG/OGG file samples; no full downloads
  --non-commercial  Also include CC BY-NC and BY-NC-SA; excludes ND licenses
  --output           JSON artifact under .data (default: .data/music-discovery/latest.json)
  --help, -h         Show this help

Examples:
  bun run music:discover --source incompetech --query "Sneaky" --verify-audio
  bun run music:discover --source commons --query "File:Moonlight.ogg" --verify-audio
  bun run music:discover --source ccmixter --query hip_hop --limit 5
  bun run music:discover --source all --query "Monkeys Spinning Monkeys" --limit 5

This command exports candidates with attribution and licenses. It does not
activate a new catalog in the game. See docs/free-music-apis.md.
`;

async function main(): Promise<void> {
  const options = parseDiscoveryArgs(process.argv.slice(2));
  if (options.help) { console.log(help); return; }
  console.log(`Searching ${options.source} for ${options.query || "publisher catalog"}…`);
  const report = await discoverMusic(options);
  for (const result of report.results) {
    console.log(`${result.source}: ${result.fetched} metadata records; ${result.accepted} accepted; ${result.candidates.length} selected.`);
  }
  for (const error of report.errors) {
    console.error(`${error.source}: ${error.message}${error.retryAfter ? ` Retry-After: ${error.retryAfter}` : ""}`);
  }
  const tracks: (MusicCandidate & { audioProbe: AudioProbe | null })[] = [];
  for (const track of report.candidates) {
    // Serialized probes avoid a burst of downloads against a publisher's host.
    if (options.verifyAudio && tracks.length) await Bun.sleep(1000);
    const audioProbe = options.verifyAudio ? await probeAudio(track.audioUrl) : null;
    tracks.push({ ...track, audioProbe });
    if (audioProbe) console.log(`${audioProbe.ok ? "Available" : "Unavailable"}: ${track.title} — ${track.artist}${audioProbe.error ? ` (${audioProbe.error})` : ""}`);
  }
  const output = discoveryOutputPath(options.output);
  await mkdir(dirname(output), { recursive: true });
  const passed = tracks.filter(track => track.audioProbe?.ok).length;
  await writeFile(output, `${JSON.stringify({
    schemaVersion: 1, generatedAt: new Date().toISOString(), query: options.query,
    licensePolicy: options.nonCommercial ? "permissive-plus-noncommercial" : "permissive", activatedInGame: false,
    verification: { requested: options.verifyAudio, checked: options.verifyAudio ? tracks.length : 0, passed, scope: "At most 64 KiB per MPEG/OGG asset; not a full playback or rights-clearance test." },
    sources: report.results.map(({ source, fetched, accepted, candidates }) => ({ source, fetched, accepted, selected: candidates.length })),
    errors: report.errors, tracks,
  }, null, 2)}\n`, "utf8");
  console.log(`Exported ${tracks.length} unique candidates to ${output}${options.verifyAudio ? `; ${passed}/${tracks.length} audio samples passed` : ""}.`);
  if (report.errors.length) process.exitCode = report.results.length ? 2 : 1;
  else if (options.verifyAudio && passed !== tracks.length) process.exitCode = 3;
}

if (import.meta.main) {
  main().catch(error => { console.error(error instanceof Error ? error.message : "Music discovery failed."); process.exitCode = 1; });
}
