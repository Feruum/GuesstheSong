import { parseArgs } from "node:util";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { discoverIncompetech } from "./incompetech";
import { discoverCommons } from "./commons";
import { discoverCCMixter } from "./ccmixter";
import { discoverOpenverse } from "./openverse";
import { MusicSourceError, uniqueAudio, type DiscoveryResult, type MusicCandidate, type MusicSource, type SearchOptions } from "./shared";

const sources: MusicSource[] = ["incompetech", "commons", "ccmixter", "openverse"];
export interface DiscoveryOptions extends SearchOptions {
  source: MusicSource | "all";
  verifyAudio: boolean;
  output: string;
  help: boolean;
}
export interface DiscoveryFailure { source: MusicSource; message: string; status?: number; retryAfter?: string | null }
export interface DiscoveryReport { results: DiscoveryResult[]; errors: DiscoveryFailure[]; candidates: MusicCandidate[] }
type Providers = Record<MusicSource, (options: SearchOptions) => Promise<DiscoveryResult>>;
const providers: Providers = { incompetech: discoverIncompetech, commons: discoverCommons, ccmixter: discoverCCMixter, openverse: discoverOpenverse };

export function parseDiscoveryArgs(args: string[]): DiscoveryOptions {
  const { values } = parseArgs({ args, strict: true, allowPositionals: false, options: {
    source: { type: "string", default: "all" }, query: { type: "string", default: "" }, limit: { type: "string", default: "20" },
    output: { type: "string", default: ".data/music-discovery/latest.json" },
    "non-commercial": { type: "boolean", default: false }, "verify-audio": { type: "boolean", default: false },
    help: { type: "boolean", default: false, short: "h" },
  } });
  const source = values.source;
  if (source !== "all" && !sources.includes(source as MusicSource)) throw new Error("Source must be all, incompetech, commons, ccmixter, or openverse.");
  if (!/^\d+$/.test(values.limit) || Number(values.limit) < 1 || Number(values.limit) > 50) throw new Error("Limit must be an integer from 1 to 50 per source (Openverse: up to 20).");
  const query = values.query.trim();
  if (query.length > 200) throw new Error("Use a focused query of at most 200 characters.");
  if (!values.help && !query && ["all", "commons", "openverse"].includes(source)) throw new Error("This source needs --query, for example --query \"Monkeys Spinning Monkeys\".");
  discoveryOutputPath(values.output);
  return { source: source as DiscoveryOptions["source"], query, limit: Number(values.limit), output: values.output, help: values.help, nonCommercial: values["non-commercial"], verifyAudio: values["verify-audio"] };
}

export function discoveryOutputPath(file: string, cwd = process.cwd()): string {
  const directory = resolve(cwd, ".data");
  const output = resolve(cwd, file);
  const location = relative(directory, output);
  if (!location || location === ".." || location.startsWith(`..${sep}`) || isAbsolute(location) || !output.endsWith(".json")) {
    throw new Error("Output must be a .json file inside this project's .data directory.");
  }
  return output;
}

export async function discoverMusic(options: DiscoveryOptions, adapters: Providers = providers): Promise<DiscoveryReport> {
  const selected = options.source === "all" ? sources : [options.source];
  const responses = await Promise.allSettled(selected.map(source => adapters[source](options)));
  const results: DiscoveryResult[] = [], errors: DiscoveryFailure[] = [];
  responses.forEach((response, index) => {
    if (response.status === "fulfilled") { results.push(response.value); return; }
    const error: unknown = response.reason;
    errors.push({ source: selected[index], message: error instanceof Error ? error.message : "Provider search failed.",
      ...(error instanceof MusicSourceError ? { status: error.status, retryAfter: error.retryAfter } : {}),
    });
  });
  return { results, errors, candidates: uniqueAudio(results.flatMap(result => result.candidates)) };
}
