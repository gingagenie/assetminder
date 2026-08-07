/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "virtual:blog-posts" {
  export interface Post {
    slug: string;
    title: string;
    description: string;
    date: string;
    tags: string[];
    thumbnail: string | null;
    content: string;
  }
  export const posts: Post[];
}
