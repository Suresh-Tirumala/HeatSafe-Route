import { motion } from "framer-motion";
import { ThermometerSun, ArrowRight, Trees, Route, ShieldCheck } from "lucide-react";
import { WorldMap } from "@/components/ui/map";

const DEMO_DOTS = [
  {
    start: { lat: 34.0522, lng: -118.2437, label: "Los Angeles" },
    end: { lat: 40.4168, lng: -3.7038, label: "Madrid" },
  },
  {
    start: { lat: -23.5505, lng: -46.6333, label: "São Paulo" },
    end: { lat: 6.5244, lng: 3.3792, label: "Lagos" },
  },
  {
    start: { lat: 40.4168, lng: -3.7038, label: "Madrid" },
    end: { lat: 28.6139, lng: 77.209, label: "New Delhi" },
  },
  {
    start: { lat: 37.9838, lng: 23.7275, label: "Athens" },
    end: { lat: 25.2048, lng: 55.2708, label: "Dubai" },
  },
  {
    start: { lat: 25.2048, lng: 55.2708, label: "Dubai" },
    end: { lat: 35.6762, lng: 139.6503, label: "Tokyo" },
  },
];

interface HeroSectionProps {
  onGetStarted: () => void;
  /** Navigate to the sign-in page (top-right corner button). */
  onSignIn?: () => void;
}

export default function HeroSection({ onGetStarted, onSignIn }: HeroSectionProps) {
  return (
    <div className="min-h-screen w-full bg-white dark:bg-[#0A0A0E] text-black dark:text-white font-sans overflow-y-auto">
      {/* ── Mobile sign-in: above hero, avoids overlap on small screens ── */}
      <div className="flex md:hidden justify-end px-6 pt-5">
        <button
          type="button"
          data-testid="hero-signin-btn-mobile"
          onClick={onSignIn}
          className="group inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-orange-500 to-red-500 px-6 text-sm font-bold text-white shadow-md shadow-orange-500/30 transition-all hover:from-orange-600 hover:to-red-600 hover:shadow-lg hover:shadow-orange-500/40 active:scale-95 cursor-pointer"
        >
          Sign in
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>

      <div
        className="max-w-7xl mx-auto px-6 pt-8 md:pt-12 pb-10 text-center"
        style={{ maxWidth: "80rem", marginLeft: "auto", marginRight: "auto", textAlign: "center" }}
      >
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="inline-flex items-center gap-2 rounded-full border border-orange-500/30 bg-orange-500/10 px-4 py-1.5 text-xs md:text-sm font-medium text-orange-600 dark:text-orange-400"
        >
          <ThermometerSun className="h-4 w-4" />
          Heat-aware navigation for every journey
        </motion.div>

        {/* ── Heading row: heading stays page-centered; Sign In shares the same line ── */}
        <div
          className="mt-6 grid items-center"
          style={{ gridTemplateColumns: "minmax(0,1fr) auto minmax(0,1fr)" }}
        >
          <span aria-hidden="true" />

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="justify-self-center text-4xl md:text-6xl font-extrabold tracking-tight leading-tight"
          >
            Travel cooler.
            <span className="bg-gradient-to-r from-yellow-500 via-orange-500 to-red-500 bg-clip-text text-transparent">
              {" "}
              Arrive safer.
            </span>
          </motion.h1>

          <div className="justify-self-end hidden md:block">
            <button
              type="button"
              data-testid="hero-signin-btn"
              onClick={onSignIn}
              className="group inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-orange-500 to-red-500 px-6 text-sm lg:text-base font-bold text-white shadow-md shadow-orange-500/30 transition-all hover:from-orange-600 hover:to-red-600 hover:shadow-lg hover:shadow-orange-500/40 hover:scale-[1.03] active:scale-95 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2"
            >
              Sign in
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </button>
          </div>
        </div>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="mt-5 text-sm md:text-lg text-neutral-500 max-w-2xl mx-auto"
          style={{
            maxWidth: "42rem",
            marginLeft: "auto",
            marginRight: "auto",
            textAlign: "center",
          }}
        >
          HeatSafe Route compares shortest, coolest and balanced routes for
          walking and vehicle journeys using surface-heat and shade data — so
          you can beat the heat on every trip, not just find one faster.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="mt-10 flex flex-col items-center gap-5"
          style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}
        >
          <button
            type="button"
            data-testid="get-started-btn"
            onClick={onGetStarted}
            className="group inline-flex h-12 items-center justify-center gap-2.5 rounded-xl bg-gradient-to-r from-orange-500 to-red-500 px-10 text-base md:text-lg font-bold text-white shadow-lg shadow-orange-500/30 transition-all hover:from-orange-600 hover:to-red-600 hover:shadow-xl hover:shadow-orange-500/40 hover:scale-[1.03] active:scale-95 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2"
          >
            Get Started
            <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-0.5" />
          </button>
          <div
            className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs md:text-sm text-neutral-500"
            style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "center" }}
          >
            <span className="inline-flex items-center gap-1.5">
              <Route className="h-4 w-4 text-orange-500" /> Walking &amp; vehicle
              routes
            </span>
            <span className="inline-flex items-center gap-1.5">
              <ThermometerSun className="h-4 w-4 text-orange-500" /> Live heat
              overlay
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Trees className="h-4 w-4 text-orange-500" /> Shaded-path scoring
            </span>
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-orange-500" /> Thermal safety
              index
            </span>
          </div>
        </motion.div>
      </div>

      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.7, delay: 0.4 }}
        className="max-w-7xl mx-auto px-6 pb-16"
      >
        <WorldMap dots={DEMO_DOTS} lineColor="#F97316" />
      </motion.div>
    </div>
  );
}
