import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import type { Plugin } from "vite";

const SITE_URL = "https://blog.minderapps.io";

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

function esc(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function injectMeta(
  html: string,
  opts: {
    title: string;
    description: string;
    path: string;
    ogImage?: string | null;
    ogType?: string;
  }
): string {
  const { title, description, path, ogImage, ogType = "website" } = opts;

  const absoluteImage =
    ogImage && !ogImage.startsWith("http") ? SITE_URL + ogImage : ogImage;

  let result = html.replace(
    /<title>[^<]*<\/title>/,
    `<title>${esc(title)}</title>`
  );
  result = result.replace(
    /<meta name="description" content="[^"]*"\s*\/?>/,
    `<meta name="description" content="${esc(description)}" />`
  );

  const tags = [
    `<meta property="og:type" content="${ogType}" />`,
    `<meta property="og:url" content="${SITE_URL}${path}" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(description)}" />`,
    absoluteImage
      ? `<meta property="og:image" content="${esc(absoluteImage)}" />`
      : "",
    `<meta name="twitter:card" content="${absoluteImage ? "summary_large_image" : "summary"}" />`,
    `<meta name="twitter:title" content="${esc(title)}" />`,
    `<meta name="twitter:description" content="${esc(description)}" />`,
    absoluteImage
      ? `<meta name="twitter:image" content="${esc(absoluteImage)}" />`
      : "",
  ]
    .filter(Boolean)
    .join("\n    ");

  return result.replace("</head>", `    ${tags}\n  </head>`);
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
      const posts = await loadPosts(join(root, "posts"));
      return `export const posts = ${JSON.stringify(posts)}`;
    },

    async closeBundle() {
      const indexPath = join(outDir, "index.html");
      if (!existsSync(indexPath)) return;

      const posts = await loadPosts(join(root, "posts"));
      const baseHtml = readFileSync(indexPath, "utf-8");
      const today = new Date().toISOString().split("T")[0];

      // Overwrite dist/index.html with blog-index meta tags
      writeFileSync(
        indexPath,
        injectMeta(baseHtml, {
          title: "AssetMinder Blog",
          description:
            "Guides and tips for Jobber users on asset tracking and field service management.",
          path: "/",
        })
      );

      // Write dist/<slug>/index.html for each post
      for (const post of posts) {
        mkdirSync(join(outDir, post.slug), { recursive: true });
        writeFileSync(
          join(outDir, post.slug, "index.html"),
          injectMeta(baseHtml, {
            title: `${post.title} | AssetMinder Blog`,
            description: post.description,
            path: `/${post.slug}/`,
            ogImage: post.thumbnail,
            ogType: "article",
          })
        );
      }

      // sitemap.xml
      const urls = ["/", ...posts.map((p) => `/${p.slug}/`)];
      const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (path) => `  <url>
    <loc>${SITE_URL}${path}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${path === "/" ? "weekly" : "monthly"}</changefreq>
    <priority>${path === "/" ? "0.8" : "0.7"}</priority>
  </url>`
  )
  .join("\n")}
</urlset>`;

      writeFileSync(join(outDir, "sitemap.xml"), sitemap);
      console.log(
        `[blog] SSG: ${posts.length} post(s), sitemap.xml → ${SITE_URL}`
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), blogPlugin()],
});
