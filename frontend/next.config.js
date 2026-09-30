/** Static export for GitHub Pages. NEXT_PUBLIC_BASE_PATH = "/<repository-name>" for a project site, "" for a user site. */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
module.exports = { output: "export", basePath, trailingSlash: true, images: { unoptimized: true }, reactStrictMode: true };
