import React, { useState } from "react";
import {
  Eye,
  EyeOff,
  ArrowRight,
  ThermometerSun,
  AlertCircle,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Globe } from "@/components/ui/cobe-globe";
import { signIn, signUp } from "@/utils/auth";

const cn = (...classes: string[]) => {
  return classes.filter(Boolean).join(" ");
};

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  className?: string;
}

const Button = ({ children, className = "", ...props }: ButtonProps) => {
  const baseStyles =
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50";
  const brandStyles =
    "bg-gradient-to-r from-orange-500 to-red-500 text-white hover:from-orange-600 hover:to-red-600";

  return (
    <button className={`${baseStyles} ${brandStyles} ${className}`} {...props}>
      {children}
    </button>
  );
};

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  className?: string;
}

const Input = ({ className = "", ...props }: InputProps) => {
  return (
    <input
      className={`block h-11 w-full rounded-lg border border-gray-200 bg-gray-50 px-3.5 text-sm text-gray-900 placeholder:text-gray-400 transition-colors focus:border-orange-400 focus:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/30 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      {...props}
    />
  );
};

type AuthMode = "signin" | "signup";

const ORANGE: [number, number, number] = [0.976, 0.451, 0.086];
const WARM_WHITE: [number, number, number] = [1, 0.98, 0.94];

const GLOBE_MARKERS = [
  { id: "la", location: [34.0522, -118.2437] as [number, number] },
  { id: "madrid", location: [40.4168, -3.7038] as [number, number] },
  { id: "saopaulo", location: [-23.5505, -46.6333] as [number, number] },
  { id: "lagos", location: [6.5244, 3.3792] as [number, number] },
  { id: "delhi", location: [28.6139, 77.209] as [number, number] },
  { id: "athens", location: [37.9838, 23.7275] as [number, number] },
  { id: "dubai", location: [25.2048, 55.2708] as [number, number] },
  { id: "tokyo", location: [35.6762, 139.6503] as [number, number] },
];

const GLOBE_ARCS = [
  { id: "la-madrid", from: [34.0522, -118.2437] as [number, number], to: [40.4168, -3.7038] as [number, number] },
  { id: "saopaulo-lagos", from: [-23.5505, -46.6333] as [number, number], to: [6.5244, 3.3792] as [number, number] },
  { id: "athens-dubai", from: [37.9838, 23.7275] as [number, number], to: [25.2048, 55.2708] as [number, number] },
  { id: "dubai-tokyo", from: [25.2048, 55.2708] as [number, number], to: [35.6762, 139.6503] as [number, number] },
];

interface TravelConnectSignInProps {
  /** Called after successful sign-in or sign-up, with the user's email and name. */
  onSignIn?: (email?: string, name?: string) => void;
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-gray-700">
        {label}
      </label>
      {children}
    </div>
  );
}

const SignInCard = ({ onSignIn }: TravelConnectSignInProps) => {
  const [mode, setMode] = useState<AuthMode>("signin");
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const isSignup = mode === "signup";

  const switchMode = (next: AuthMode) => {
    setMode(next);
    setError(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (isSignup) {
      const result = signUp(fullName, email, password);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onSignIn?.(result.user.email, result.user.name);
      return;
    }

    const result = signIn(email, password);
    if (!result.ok) {
      setError(result.error);
      // Unknown email while signing in → guide the user to sign up.
      if (result.code === "no-account") {
        setMode("signup");
        setPassword("");
      }
      return;
    }
    onSignIn?.(result.user.email, result.user.name);
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-orange-50 to-amber-100 p-4 sm:p-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full flex flex-col md:flex-row rounded-2xl bg-white shadow-xl ring-1 ring-black/5 overflow-hidden"
        style={{ maxWidth: "1000px" }}
      >
        {/* ── Left: brand visual ─────────────────────────────── */}
        <div
          className="hidden md:block md:w-1/2 shrink-0 relative overflow-hidden border-r border-gray-100"
          style={{ minHeight: 620 }}
        >
          <div className="absolute inset-0 bg-gradient-to-br from-orange-50 to-amber-100 flex flex-col items-center px-8 pt-10 pb-9">
            <div className="flex-1 w-full min-h-0 flex items-center justify-center">
              <Globe
                markers={GLOBE_MARKERS}
                arcs={GLOBE_ARCS}
                markerColor={ORANGE}
                baseColor={WARM_WHITE}
                arcColor={ORANGE}
                glowColor={[0.98, 0.92, 0.84]}
                dark={0}
                mapBrightness={10}
                markerSize={0.03}
                markerElevation={0.01}
                speed={0.0035}
                className="w-full max-w-[340px] xl:max-w-[380px]"
              />
            </div>

            <div className="shrink-0 pointer-events-none text-center">
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.45, duration: 0.4 }}
                className="mb-3 flex justify-center"
              >
                <div className="h-10 w-10 rounded-full bg-gradient-to-br from-orange-500 to-red-500 flex items-center justify-center shadow-md shadow-orange-200">
                  <ThermometerSun className="text-white h-5 w-5" />
                </div>
              </motion.div>
              <h2 className="text-xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-orange-600 to-red-600">
                HeatSafe Route
              </h2>
              <p className="mt-1.5 text-[13px] leading-relaxed text-gray-500 max-w-[250px] mx-auto">
                Beat the heat on every walk — routes ranked by shade,
                surface temperature and thermal safety
              </p>
            </div>
          </div>
        </div>

        {/* ── Right: auth form (horizontally centered) ───────── */}
        <div
          className="w-full md:w-1/2 bg-white"
          style={{ display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <div
            className="w-full"
            style={{
              maxWidth: "26rem",
              paddingLeft: 48,
              paddingRight: 48,
              paddingTop: 40,
              paddingBottom: 40,
            }}
          >
            {/* Segmented toggle */}
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-gray-100 p-1">
              {(["signin", "signup"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  data-testid={`tab-${m}`}
                  onClick={() => switchMode(m)}
                  className={cn(
                    "relative rounded-lg py-2 text-sm font-medium transition-colors cursor-pointer",
                    mode === m ? "text-gray-900" : "text-gray-500 hover:text-gray-700"
                  )}
                >
                  {mode === m && (
                    <span className="absolute inset-0 rounded-lg bg-white shadow-sm" />
                  )}
                  <span className="relative z-10">
                    {m === "signin" ? "Sign In" : "Sign Up"}
                  </span>
                </button>
              ))}
            </div>

            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={mode}
                initial={{ opacity: 0, x: isSignup ? 32 : -32 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: isSignup ? -32 : 32 }}
                transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
              >
                {/* Heading */}
                <h1 className="mt-7 text-[26px] leading-tight font-bold tracking-tight text-gray-900">
                  {isSignup ? "Create your account" : "Welcome back"}
                </h1>
                <p className="mt-1 text-sm text-gray-500">
                  {isSignup
                    ? "Start planning cooler walks in minutes."
                    : "Sign in to continue to your routes."}
                </p>

                {/* Error */}
                {error && (
                  <div
                    data-testid="auth-error"
                    className="mt-5 flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700"
                  >
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                {/* Form */}
                <form onSubmit={handleSubmit} className="mt-6 space-y-4">
                  {isSignup && (
                    <Field label="Full name" htmlFor="name">
                      <Input
                        id="name"
                        type="text"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        placeholder="Your name"
                        autoComplete="name"
                      />
                    </Field>
                  )}

                  <Field label="Email address" htmlFor="email">
                    <Input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="Enter your email address"
                      autoComplete="email"
                      required
                    />
                  </Field>

                  <Field label="Password" htmlFor="password">
                    <div className="relative">
                      <Input
                        id="password"
                        type={isPasswordVisible ? "text" : "password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder={
                          isSignup ? "At least 8 characters" : "Enter your password"
                        }
                        autoComplete={isSignup ? "new-password" : "current-password"}
                        required
                        className="pr-11"
                      />
                      <button
                        type="button"
                        aria-label={isPasswordVisible ? "Hide password" : "Show password"}
                        className="absolute inset-y-0 right-0 flex items-center pr-3.5 text-gray-400 hover:text-gray-600 transition-colors cursor-pointer"
                        onClick={() => setIsPasswordVisible(!isPasswordVisible)}
                      >
                        {isPasswordVisible ? <EyeOff size={17} /> : <Eye size={17} />}
                      </button>
                    </div>
                  </Field>

                  {!isSignup && (
                    <div className="flex justify-end">
                      <a
                        href="#"
                        className="text-sm font-medium text-orange-600 hover:text-orange-700 transition-colors"
                      >
                        Forgot password?
                      </a>
                    </div>
                  )}

                  <button
                    type="submit"
                    data-testid="signin-submit-btn"
                    className="group inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-orange-500 to-red-500 text-sm font-semibold text-white shadow-md shadow-orange-500/25 transition-all hover:from-orange-600 hover:to-red-600 hover:shadow-lg hover:shadow-orange-500/30 active:scale-[0.99] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2"
                  >
                    {isSignup ? "Create account" : "Sign in"}
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  </button>

                  {isSignup && (
                    <p className="pt-1 text-center text-xs leading-relaxed text-gray-400">
                      By creating an account you agree to our{" "}
                      <a href="#" className="underline hover:text-gray-500">Terms</a>{" "}
                      and{" "}
                      <a href="#" className="underline hover:text-gray-500">Privacy Policy</a>.
                    </p>
                  )}
                </form>

                {/* Mode switch */}
                <p className="mt-6 text-center text-sm text-gray-500">
                  {isSignup ? (
                    <>
                      Already have an account?{" "}
                      <button
                        type="button"
                        data-testid="switch-mode-btn"
                        onClick={() => switchMode("signin")}
                        className="font-semibold text-orange-600 hover:text-orange-700 transition-colors cursor-pointer"
                      >
                        Sign in
                      </button>
                    </>
                  ) : (
                    <>
                      Don't have an account?{" "}
                      <button
                        type="button"
                        data-testid="switch-mode-btn"
                        onClick={() => switchMode("signup")}
                        className="font-semibold text-orange-600 hover:text-orange-700 transition-colors cursor-pointer"
                      >
                        Sign up free
                      </button>
                    </>
                  )}
                </p>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default function TravelConnectSignIn({ onSignIn }: TravelConnectSignInProps) {
  return <SignInCard onSignIn={onSignIn} />;
}
