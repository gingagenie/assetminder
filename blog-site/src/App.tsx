import { BrowserRouter, Routes, Route } from "react-router-dom";
import BlogIndex from "./pages/BlogIndex";
import BlogPost from "./pages/BlogPost";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<BlogIndex />} />
        <Route path="/:slug" element={<BlogPost />} />
      </Routes>
    </BrowserRouter>
  );
}
