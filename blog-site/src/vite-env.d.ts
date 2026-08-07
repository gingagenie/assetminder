/// <reference types="vite/client" />

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
