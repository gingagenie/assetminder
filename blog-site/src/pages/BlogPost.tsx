import { useEffect } from "react";
import { Link, useParams, Navigate } from "react-router-dom";
import { posts } from "virtual:blog-posts";
import { ArrowLeft, Calendar, Tag } from "lucide-react";

function formatDate(dateStr: string) {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default function BlogPost() {
  const { slug } = useParams<{ slug: string }>();
  const post = posts.find((p) => p.slug === slug);

  useEffect(() => {
    if (post) document.title = `${post.title} | AssetMinder Blog`;
  }, [post]);

  if (!post) return <Navigate to="/" replace />;

  return (
    <div
      style={{ fontFamily: "Inter, sans-serif", backgroundColor: "#f8fafc" }}
      className="min-h-screen flex flex-col"
    >
      <header style={{ backgroundColor: "#1e293b" }}>
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link to="/" className="text-white font-semibold text-lg tracking-tight">
            AssetMinder
          </Link>
          <a
            href="https://minderapps.io"
            className="text-slate-300 hover:text-white text-sm font-medium transition-colors"
          >
            ← Back to app
          </a>
        </div>
      </header>

      <main className="flex-1 bg-white">
        {post.thumbnail && (
          <div className="w-full max-h-80 overflow-hidden">
            <img
              src={post.thumbnail}
              alt=""
              className="w-full h-full object-cover"
            />
          </div>
        )}

        <div className="max-w-2xl mx-auto px-6 py-12">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-900 transition-colors mb-8"
          >
            <ArrowLeft size={14} />
            Back to blog
          </Link>

          <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500 mb-5">
            {post.date && (
              <span className="flex items-center gap-1">
                <Calendar size={12} />
                {formatDate(post.date)}
              </span>
            )}
            {post.tags.length > 0 && (
              <span className="flex items-center gap-1">
                <Tag size={12} />
                {post.tags.join(", ")}
              </span>
            )}
          </div>

          <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-10 leading-tight">
            {post.title}
          </h1>

          <div
            className="prose prose-slate max-w-none"
            dangerouslySetInnerHTML={{ __html: post.content }}
          />
        </div>
      </main>

      <footer className="border-t border-slate-200 py-6">
        <p className="text-center text-xs text-slate-400">
          <a
            href="https://minderapps.io"
            className="hover:text-slate-600 transition-colors"
          >
            AssetMinder
          </a>{" "}
          · Built for Jobber users
        </p>
      </footer>
    </div>
  );
}
