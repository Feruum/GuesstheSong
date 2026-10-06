# Free music discovery and parsers

The user wants working free music APIs and parsers, with recognizable songs preferred over a larger collection of unfamiliar artists. Add a Bun discovery command that produces a reviewable JSON shortlist, without requiring cloud credentials or changing the deployed catalog.

Use the publisher-provided Incompetech JSON feed first: a live request returned 1,443 records, including recognizable meme music. Also support Wikimedia Commons' MediaWiki API, ccMixter's documented query API, and ordinary bounded Openverse searches. Internet Archive remains a documented alternative whose requests timed out twice from this host; do not represent it as a verified working integration. Jamendo needs a registered client ID. MusicBrainz can enrich metadata but does not provide song audio.

Normalize records into source ID, title, artist, duration, provider genre tags, audio URL/MIME, source page, exact license, attribution and publication date. Keep release year unknown unless separately verified: upload dates are not original release dates. Preserve performer credit as well as composer credit for classical recordings. Keep MP3 compatibility separate from general audio availability.

Default to CC BY, CC BY-SA and CC0. Exclude missing licenses and ND. Include NC only through an explicit noncommercial option. These checks identify candidates for review; they cannot independently establish that an uploader owns the rights to a recording. The command is a discovery tool, not an automatic publishing or rights-clearance system.

Validate JSON, file paths and source URLs. Allow only provider-owned HTTPS hosts and expected API/media paths. Bound metadata and audio transfers, cancel range-ignoring responses, limit search sizes, report errors independently and honor rate limits. Never execute scripts from retrieved pages, bypass login/CAPTCHA or mirror an entire search provider. Openverse is for focused queries, not catalog scraping.

Read the Incompetech page's static genre lookup as JSON without executing its JavaScript. This is the HTML parser needed alongside the publisher's JSON feed. Parse ccMixter file metadata and Commons derivatives, preferring existing MP3 transcodes over requiring server transcoding.

Add unit tests covering license rejection, URL validation, attribution preservation, malformed records, duration parsing, MP3 derivatives, deduplication and bounded audio verification. Run live queries and a few audio-range probes, save the actual results locally, and document exact commands, known limits and failure cases. Commit and push the verified tooling under the user's existing authorization; do not claim that production music has switched.
