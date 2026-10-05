# Public starter catalog

`audius-starter.json` contains public metadata for 1,500 available Audius recordings from the verified local catalog, exported on 2026-10-06. It contains no audio files, guest data, credentials or private Deezer previews. Genre and release-year tags come from the provider; play counts describe the export time and are refreshed by the existing catalog jobs.

Vercel's build preparation applies the SQL migrations and loads this snapshot once into a new, empty cloud database. Genre, decade and popularity collections use the same rules as the application. A PostgreSQL transaction and advisory lock serialize deployment workers. Subsequent deployments preserve existing catalogs, administrative corrections, disabled tracks and manual collections.

Track availability can change. The player uses Audius streaming and the catalog's normal availability refresh. Attribution and the recorded license are displayed when a song is revealed. This is a starter snapshot, not permission to distribute the source recordings outside the provider's restrictions.
