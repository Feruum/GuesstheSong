# Public hit previews

The operator reports provider approval for production playback and has authorized publishing through the existing GitHub/Vercel project. This work enables that application's official previews; open-source distribution of the code does not grant rights to recordings.

1. Add regression tests for an explicit, origin-bound public preview opt-in, default-disabled catalogs, source revocation and Audius-only Chart Clash.
2. Keep private loopback opt-in working; add a production approval flag and matching HTTPS origin. Apply the source gate to catalog, import, games and bounded audio before cache access.
3. Update source attribution, pack copy, the environment template and setup documentation without changing scoring or provider availability checks.
4. Import the verified 100-artist/500-song metadata shortlist into production PostgreSQL, preserving existing Audius recordings and administrative changes. Configure only the Production environment on Vercel.
5. Run relevant tests, TypeScript, lint and the production build, then commit and push. Verify actual public pack counts, search, authenticated gameplay, audio ranges and a rendered Classic round after deployment.

Preparation manifests record their original local-only preparation state. Production activation is environment configuration, not a permission transferable to forks. Credentials, audio URLs, sessions and audio files stay out of Git.
