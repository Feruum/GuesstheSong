# Imagegen prompts

Tool: built-in imagegen. Four individual generations; no CLI fallback.

## 01-discover

```text
Use case: ui-mockup. Create one high-fidelity desktop discovery screen for a music guessing web game. This is a flat, full-bleed viewport, preferably 1600 x 1000 landscape, with readable product UI and no device frame.
Visual system: warm charcoal #151713, subtly lighter olive panels, warm white #F3F0E6, acid lime #D7FF3F reserved for primary actions, crisp thin rules, restrained corners. Bold tightly spaced geometric display type; clean humanist interface type. A music collection feels browsable through original record-sleeve artwork, while the immediate play action dominates. Choose the layout and composition freely within that hierarchy.
Persistent header: a small lime audio-bar mark and lowercase wordmark "guess the song"; navigation "Discover", "Daily", "Party", "Leaderboard"; avatar "You". Main headline "Know it in a beat." Supporting text "Hear a clip. Find the song. Keep the streak." Primary button "Start guessing", secondary "Play with friends". A quieter daily invitation says "Daily challenge", "One song. Six guesses.", "Play today's song".
Discovery section "Find your sound" includes search "Search artists or packs", separate "Genre", "Decade", "Language" filter controls, and tags "All", "Pop", "Hip-Hop", "Rock", "K-Pop", "Afrobeats", "Latin".
Show four generous record-sleeve tiles titled "Pop essentials", "Hip-Hop essentials", "Rock classics", "K-Pop favorites". Each has distinct original editorial music artwork, no real album cover, and a small play affordance. Keep this a single readable discovery viewport. Avoid tiny text, unsupported statistics, and decorative elements competing with the play action. No watermark or annotations.
```

## 02-guessing-round

```text
Use case: ui-mockup. Create one high-fidelity desktop ACTIVE GUESSING ROUND screen for a music guessing web game, a flat full-bleed viewport preferably 1600 x 1000 landscape.
Visual system: warm charcoal #151713, subtly lighter olive surfaces, warm white #F3F0E6, acid lime #D7FF3F for the primary listening control, crisp thin dividers and restrained corners. Bold tightly spaced geometric headings; clean humanist UI type. Listening is the dominant action; track identity remains a mystery until answered. Compose a focused, spacious listening interface rather than a browsing page.
Persistent header has a small lime audio-bar mark, lowercase "guess the song", navigation "Discover", "Daily", "Party", "Leaderboard", avatar "You". Current context uses "Back to Discover", "CLASSIC", "Pop essentials", "Round 3 of 10", "Score 240". Headline "What's this song?" A large tactile anonymous vinyl record or abstract mystery sleeve with a question mark is integrated with a clear lime play button. No title or artist is revealed. Nearby labels "Play 1-second clip" and "Replay". Render a simple audio waveform for the unlocked one-second excerpt, then six distinct progress segments labelled "1s", "2s", "4s", "7s", "11s", "16s"; only "1s" is available.
The answer area is a generous search field "Search a song or artist", a quiet disabled "Submit guess", and secondary "Skip · unlock 2s". Supporting caption "6 guesses remaining" and a discreet volume control. No autocomplete results, wrong-answer history, or success state yet. Preserve the mystery. Choose composition and materials freely within the shared role system. Avoid tiny controls, answer leakage, and competing decoration. No device frame, watermark, or annotation.
```

## 03-party-lobby

```text
Use case: ui-mockup. Create one high-fidelity desktop FRIENDS PARTY LOBBY screen for a music guessing web game, flat full-bleed viewport preferably 1600 x 1000 landscape.
Use warm charcoal #151713, subtly lighter olive surfaces, warm white #F3F0E6, acid lime #D7FF3F for the host's main action, crisp thin dividers, restrained corners, bold tightly spaced geometric headings and clean humanist UI text. A shared listening room should feel like friends gathered around records: participants are central, configuration supports them. Choose composition freely, with a sociable medium-density rhythm distinct from solo gameplay.
Persistent header: small lime audio-bar mark and lowercase "guess the song"; "Discover", "Daily", "Party", "Leaderboard"; avatar "You"; Party active.
Visible copy and fixtures: "Play it together.", "Invite your friends. Guess the same songs.", "Room code", "K7M4Q2", "Copy invite", "4 players". Present four distinct simple illustrated avatars with exact names/states: "You" — "Host"; "Mia" — "Ready"; "Jay" — "Ready"; "Alex" — "Ready". Also an unfilled participant slot labelled "Invite a friend".
A compact session setup includes "Playlist" with selected "Global mix", "Rounds" with selected "10", "Clip length" with selected "1 second", and "Difficulty" with selected "Mixed". A subtle unique playlist-sleeve artwork combines record textures with warm muted coral, olive and lime. The primary button is "Start game". Supporting action "Leave room".
Keep every participant and setting readable without a chat feed or live game results. These are illustrative lobby fixtures, not real people or a live room. Avoid unsupported badges or service claims, overpacked panels, and decoration competing with participants. No device frame, watermark, or annotation.
```

## 04-mobile-round

```text
Use case: ui-mockup. Create one high-fidelity MOBILE ACTIVE GUESSING ROUND screen for the same music guessing web game. Flat edge-to-edge portrait app viewport, preferred proportion 9:19.5, approximately 430 x 932 logical UI scale, rendered sharply. No phone hardware frame or surrounding scenery.
Visual system: warm charcoal #151713, subtly lighter olive panels, warm white #F3F0E6, acid lime #D7FF3F for listening, crisp thin rules, restrained corners, tightly spaced bold geometric headings and clean humanist interface text. Translate the focused listening ritual into a comfortable one-handed vertical flow. Choose the composition freely while preserving large readable text and thumb-friendly controls.
Compact header contains a small lime audio-bar mark and lowercase "guess the song", back affordance, and quiet volume icon. Context "Pop essentials", "Round 3 of 10", "Score 240". Headline "What's this song?" Show an anonymous vinyl or mystery sleeve with a question mark, integrated with a large lime play button. No song name or artist is exposed.
Labels "Play 1-second clip" and "Replay"; a compact audio waveform. Six clear progress segments labelled "1s", "2s", "4s", "7s", "11s", "16s", only the first unlocked. Search field "Search a song or artist", quiet disabled "Submit guess", separate secondary action "Skip · unlock 2s", caption "6 guesses remaining". Keep all these in the visible portrait viewport without an on-screen keyboard.
This is the same illustrative round as the desktop concept. Keep the interface calm and controls comfortably separated. Avoid answer leakage, tiny typography, or desktop navigation squeezed onto mobile. No watermark, captions, or extra screens.
```

