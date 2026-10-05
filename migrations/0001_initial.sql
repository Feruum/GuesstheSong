CREATE TABLE IF NOT EXISTS guests (
  id uuid PRIMARY KEY, token_hash text NOT NULL UNIQUE, nickname text NOT NULL,
  avatar integer NOT NULL DEFAULT 0 CHECK (avatar BETWEEN 0 AND 7), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tracks (
  id text PRIMARY KEY, provider_id text NOT NULL UNIQUE, title text NOT NULL, artist text NOT NULL,
  artwork_url text, duration integer NOT NULL CHECK(duration >= 16), genre text, release_year integer,
  language text, play_count bigint NOT NULL DEFAULT 0 CHECK(play_count >= 0),
  clip_start_sec integer NOT NULL DEFAULT 0 CHECK(clip_start_sec >= 0 AND clip_start_sec <= duration - 16),
  source_url text NOT NULL, license text, available boolean NOT NULL DEFAULT true, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tracks_available_genre ON tracks(genre) WHERE available;
CREATE TABLE IF NOT EXISTS packs (id text PRIMARY KEY, slug text NOT NULL UNIQUE, name text NOT NULL, description text NOT NULL, genre text, cover_art text NOT NULL);
CREATE TABLE IF NOT EXISTS pack_tracks (pack_id text NOT NULL REFERENCES packs(id), track_id text NOT NULL REFERENCES tracks(id), PRIMARY KEY(pack_id,track_id));
CREATE TABLE IF NOT EXISTS daily_challenges (date text PRIMARY KEY, track_id text NOT NULL REFERENCES tracks(id), published_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS daily_entries (date text NOT NULL, guest_id uuid NOT NULL REFERENCES guests(id), game_id text NOT NULL, revision integer NOT NULL, state jsonb NOT NULL, solved boolean NOT NULL DEFAULT false, completed_at timestamptz, PRIMARY KEY(date,guest_id));
CREATE TABLE IF NOT EXISTS game_results (game_id text NOT NULL, guest_id uuid NOT NULL REFERENCES guests(id), mode text NOT NULL, pack_id text NOT NULL, difficulty integer NOT NULL DEFAULT 0, score integer NOT NULL, solved boolean NOT NULL, summary jsonb NOT NULL, completed_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(game_id,guest_id));
CREATE INDEX IF NOT EXISTS result_leaderboard ON game_results(mode,pack_id,difficulty,completed_at,score DESC);
CREATE INDEX IF NOT EXISTS result_guest ON game_results(guest_id,completed_at DESC);
CREATE TABLE IF NOT EXISTS admin_sessions (token_hash text PRIMARY KEY, expires_at timestamptz NOT NULL);
INSERT INTO packs(id,slug,name,description,genre,cover_art) VALUES
('global-mix','global-mix','The global mix','A little of everything. Find your next favorite.','', 'global'),
('electronic','electronic','After hours','Electronic discoveries for the late-night listeners.','Electronic', 'electronic'),
('hip-hop','hip-hop','Rap rotation','Independent voices. Beats you will remember.','Hip-Hop/Rap', 'hip-hop'),
('indie','indie','Off the beaten track','A fresh collection of alternative and indie sounds.','Alternative', 'indie')
ON CONFLICT(id) DO NOTHING;
