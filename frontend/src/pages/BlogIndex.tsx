import { useEffect } from "react";
import { Link } from "react-router-dom";
import { posts, type Post } from "virtual:blog-posts";
import { Calendar, Tag } from "lucide-react";

function formatDate(dateStr: string) {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function PostCard({ post }: { post: Post }) {
  return (
    <Link
      to={`/blog/${post.slug}`}
      className="group block bg-white rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow overflow-hidden"
    >
      {post.thumbnail && (
        <div className="aspect-video overflow-hidden bg-slate-100">
          <img
            src={post.thumbnail}
            alt=""
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        </div>
      )}
      <div className="p-6">
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 mb-3">
          {post.date && (
            <span className="flex items-center gap-1">
              <Calendar size={12} />
              {formatDate(post.date)}
            </span>
          )}
          {post.tags.length > 0 && (
            <span className="flex items-center gap-1">
              <Tag size={12} />
              {post.tags.slice(0, 2).join(", ")}
            </span>
          )}
        </div>
        <h2 className="text-lg font-bold text-slate-900 mb-2 leading-snug group-hover:text-blue-600 transition-colors">
          {post.title}
        </h2>
        <p className="text-sm text-slate-500 leading-relaxed line-clamp-3">
          {post.description}
        </p>
        <p className="mt-4 text-sm font-semibold text-slate-700 group-hover:text-blue-600 transition-colors">
          Read more →
        </p>
      </div>
    </Link>
  );
}

export default function BlogIndex() {
  useEffect(() => {
    document.title = "Blog | AssetMinder";
  }, []);

  return (
    <div style={{ fontFamily: "Inter, sans-serif", backgroundColor: "#f8fafc" }} className="min-h-screen flex flex-col">
      <header style={{ backgroundColor: "#1e293b" }}>
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link to="/" className="text-white font-semibold text-lg tracking-tight">
            AssetMinder
          </Link>
          <span className="text-white text-sm font-medium">Blog</span>
        </div>
      </header>

      <main className="flex-1 py-16">
        <div className="max-w-5xl mx-auto px-6">
          <div className="mb-12">
            <h1 className="text-4xl font-bold text-slate-900">Blog</h1>
            <p className="mt-3 text-lg text-slate-500 max-w-xl">
              Guides and tips for Jobber users on asset tracking and field
              service management.
            </p>
          </div>
          {posts.length === 0 ? (
            <p className="text-slate-500">No posts yet. Check back soon.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {posts.map((post) => (
                <PostCard key={post.slug} post={post} />
              ))}
            </div>
          )}
        </div>
      </main>

      <footer className="border-t border-slate-200 py-6">
        <p className="text-center text-xs text-slate-400">
          AssetMinder · Built for Jobber users ·{" "}
          <Link to="/terms" className="hover:text-slate-600 transition-colors">Terms of Service</Link>
          {" · "}
          <Link to="/privacy" className="hover:text-slate-600 transition-colors">Privacy Policy</Link>
        </p>
      </footer>
    </div>
  );
}
