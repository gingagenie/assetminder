import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { readFileSync, readdirSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import type { Plugin } from "vite";

interface PostData {
  slug: string;
  title: string;
  description: string;
  date: string;
  tags: string[];
  thumbnail: string | null;
  content: string;
}

async function loadPosts(postsDir: string): Promise<PostData[]> {
  if (!existsSync(postsDir)) return [];

  const { default: matter } = await import("gray-matter");
  const { marked } = await import("marked");

  const files = readdirSync(postsDir)
    .filter((f) => f.endsWith(".md"))
    .sort();

  const posts = await Promise.all(
    files.map(async (filename) => {
      const raw = readFileSync(join(postsDir, filename), "utf-8");
      const { data, content } = matter(raw);
      const html = String(await marked.parse(content));
      return {
        slug: String(data.slug || filename.replace(".md", "")),
        title: String(data.title || "Untitled"),
        description: String(data.description || ""),
        date: data.date ? String(data.date) : "",
        tags: Array.isArray(data.tags) ? data.tags : [],
        thumbnail: data.thumbnail || null,
        content: html,
      };
    })
  );

  return posts.sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );
}

function blogPlugin(): Plugin {
  let root: string;
  let outDir: string;

  return {
    name: "blog",

    configResolved(config) {
      root = config.root;
      outDir = join(config.root, config.build.outDir);
    },

    resolveId(id) {
      if (id === "virtual:blog-posts") return "\0virtual:blog-posts";
    },

    async load(id) {
      if (id !== "\0virtual:blog-posts") return;
      const posts = await loadPosts(join(root, "src/posts"));
      return `export const posts = ${JSON.stringify(posts)}`;
    },

    async closeBundle() {
      if (!existsSync(join(outDir, "index.html"))) return;

      const posts = await loadPosts(join(root, "src/posts"));
      const siteUrl = "https://minderapps.io";
      const today = new Date().toISOString().split("T")[0];

      const staticUrls = ["/", "/#/terms", "/#/privacy", "/#/help"];
      const blogUrls = ["/#/blog", ...posts.map((p) => `/#/blog/${p.slug}`)];

      const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[...staticUrls, ...blogUrls]
  .map(
    (url) => `  <url>
    <loc>${siteUrl}${url}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${url === "/" ? "monthly" : "weekly"}</changefreq>
    <priority>${url === "/" ? "1.0" : url === "/#/blog" ? "0.8" : "0.6"}</priority>
  </url>`
  )
  .join("\n")}
</urlset>`;

      writeFileSync(join(outDir, "sitemap.xml"), sitemap);
      console.log(`[blog] Generated sitemap with ${posts.length} post(s)`);
    },
  };
}

export default defineConfig({
  plugins: [react(), blogPlugin()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  server: {
    port: 3000,
    proxy: {
      "/api": "http://localhost:3001",
      "/auth": "http://localhost:3001",
    },
  },
});
