const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

console.log("🔨 Running custom tsup build pipeline...");
execSync("npx tsup --config " + path.join(__dirname, "tsup.config.ts"), {
	stdio: "inherit",
});

// Copy schema.sql to the expected paths in dist
const srcSchema = path.join(__dirname, "src", "schema", "schema.sql");
const destSchemaRoot = path.join(__dirname, "dist", "schema.sql");
const destSchemaSub = path.join(__dirname, "dist", "schema", "schema.sql");

if (fs.existsSync(srcSchema)) {
	fs.mkdirSync(path.dirname(destSchemaSub), { recursive: true });
	fs.copyFileSync(srcSchema, destSchemaRoot);
	fs.copyFileSync(srcSchema, destSchemaSub);
	console.log("📋 Copied schema.sql to dist/ and dist/schema/");
}

// Copy project-root assets needed for npm publish
const rootDir = path.join(__dirname, "..", "..");
const assetDirs = ["conf", "skills", "sidecars", "agents"];
for (const dir of assetDirs) {
	const src = path.join(rootDir, dir);
	const dst = path.join(__dirname, dir);
	if (fs.existsSync(src)) {
		fs.cpSync(src, dst, { recursive: true, force: true });
		console.log(`📋 Copied ${dir}/ to adapter package`);
	}
}
const pluginJsonSrc = path.join(rootDir, "plugin.json");
if (fs.existsSync(pluginJsonSrc)) {
	fs.copyFileSync(pluginJsonSrc, path.join(__dirname, "plugin.json"));
	console.log("📋 Copied plugin.json to adapter package");
}

console.log("✅ Build successfully completed!");
