const password = process.argv[2];
if (!password || password.length < 12) { console.error("Usage: bun run admin:password <password with at least 12 characters>"); process.exit(1); }
console.log(await Bun.password.hash(password, { algorithm: "argon2id", memoryCost: 65536, timeCost: 3 }));
export {};
