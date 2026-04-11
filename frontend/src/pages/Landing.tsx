import { API } from "@/lib/api";

const steps = [
  {
    number: "01",
    title: "Connect Jobber",
    body: "OAuth connect in seconds. We pull your clients, jobs and custom fields automatically.",
  },
  {
    number: "02",
    title: "Map your asset field",
    body: "Tell us which custom field holds your serial number or asset ID. We do the rest.",
  },
  {
    number: "03",
    title: "Share with clients",
    body: "Generate a branded portal link per client. They see their full asset history instantly.",
  },
];

const benefits = [
  {
    title: "Organised by equipment, not job date",
    body: "Jobber shows jobs in date order. AssetMinder groups them by asset so every service visit for one machine is in one place.",
  },
  {
    title: "Compliance ready",
    body: "When a client needs to prove service history for an audit or insurance claim, you send them a link. Done.",
  },
  {
    title: "Retain clients longer",
    body: "Clients who can see their asset history don't switch providers. Their data is here.",
  },
];

export default function Landing() {
  return (
    <div style={{ fontFamily: "Inter, sans-serif", backgroundColor: "#f8fafc" }} className="min-h-screen flex flex-col">

      {/* Nav */}
      <header style={{ backgroundColor: "#1e293b" }}>
        <div className="max-w-5xl mx-auto px-6 py-4">
          <span className="text-white font-semibold text-lg tracking-tight">AssetMinder</span>
        </div>
      </header>

      {/* Hero */}
      <section style={{ backgroundColor: "#1e293b" }} className="pb-24 pt-20">
        <div className="max-w-3xl mx-auto px-6 text-center">
          <div className="inline-flex items-center gap-2 bg-white/10 text-slate-300 text-xs font-semibold px-3 py-1.5 rounded-full mb-8 tracking-wide uppercase">
            Built for Jobber users
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold text-white tracking-tight leading-tight mb-6">
            Your clients deserve to see<br className="hidden sm:block" /> their service history
          </h1>
          <p className="text-slate-300 text-lg leading-relaxed mb-10 max-w-2xl mx-auto">
            AssetMinder connects to Jobber and gives every client a branded portal showing the full service history of every asset you maintain — organised by equipment, not by job date.
          </p>
          <a
            href={`${API}/auth/jobber/connect`}
            className="inline-flex items-center justify-center h-12 px-8 rounded-xl bg-white text-slate-800 font-semibold text-sm hover:bg-slate-100 transition-colors shadow-lg"
          >
            Connect to Jobber
          </a>
          <p className="text-slate-400 text-sm mt-4">No credit card required · 14-day free trial</p>
        </div>
      </section>

      {/* Wave divider */}
      <div style={{ backgroundColor: "#1e293b" }}>
        <svg viewBox="0 0 1440 60" xmlns="http://www.w3.org/2000/svg" className="block w-full" preserveAspectRatio="none" style={{ height: 60 }}>
          <path d="M0,0 C360,60 1080,60 1440,0 L1440,60 L0,60 Z" fill="#f8fafc" />
        </svg>
      </div>

      {/* How it works */}
      <section className="py-20">
        <div className="max-w-5xl mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2">How it works</p>
            <h2 className="text-2xl font-bold text-slate-800">Up and running in minutes</h2>
          </div>
          <div className="grid sm:grid-cols-3 gap-6">
            {steps.map((step) => (
              <div key={step.number} className="bg-white rounded-xl border border-slate-200 shadow-sm px-6 py-7">
                <p style={{ color: "#1e293b" }} className="text-3xl font-bold mb-4 opacity-20">{step.number}</p>
                <p className="font-semibold text-slate-800 mb-2">{step.title}</p>
                <p className="text-sm text-slate-500 leading-relaxed">{step.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Why AssetMinder */}
      <section className="py-20" style={{ backgroundColor: "#f1f5f9" }}>
        <div className="max-w-5xl mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2">Why AssetMinder</p>
            <h2 className="text-2xl font-bold text-slate-800">The missing layer on top of Jobber</h2>
          </div>
          <div className="grid sm:grid-cols-3 gap-6">
            {benefits.map((benefit) => (
              <div key={benefit.title} className="bg-white rounded-xl border border-slate-200 shadow-sm px-6 py-7">
                <div className="h-1 w-8 rounded-full mb-5" style={{ backgroundColor: "#1e293b" }} />
                <p className="font-semibold text-slate-800 mb-2">{benefit.title}</p>
                <p className="text-sm text-slate-500 leading-relaxed">{benefit.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="py-20">
        <div className="max-w-xl mx-auto px-6 text-center">
          <h2 className="text-2xl font-bold text-slate-800 mb-4">Ready to impress your clients?</h2>
          <p className="text-slate-500 text-sm mb-8">Connect your Jobber account and have your first portal live in under five minutes.</p>
          <a
            href={`${API}/auth/jobber/connect`}
            className="inline-flex items-center justify-center h-12 px-8 rounded-xl text-white font-semibold text-sm hover:opacity-90 transition-opacity shadow-md"
            style={{ backgroundColor: "#1e293b" }}
          >
            Connect to Jobber
          </a>
          <p className="text-slate-400 text-sm mt-4">No credit card required · 14-day free trial</p>
        </div>
      </section>

      {/* Footer */}
      <footer className="mt-auto border-t border-slate-200 py-6">
        <p className="text-center text-xs text-slate-400">
          Powered by AssetMinder · Built for Jobber users
        </p>
      </footer>

    </div>
  );
}
