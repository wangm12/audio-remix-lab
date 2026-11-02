import { useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { useLogin } from "@/hooks/useAuth";
import { Disc3 } from "lucide-react";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const login = useLogin();

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate({ email, password });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-0 px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <Disc3 className="w-10 h-10 text-brand mb-3" />
          <h1 className="font-display text-2xl font-bold">Welcome back</h1>
          <p className="text-text-secondary text-sm mt-1">
            Sign in to Remix Studio
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium mb-1.5">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2.5 bg-surface-1 border border-surface-3 rounded-lg text-sm focus:border-brand focus:ring-1 focus:ring-brand outline-none transition-colors"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium mb-1.5"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2.5 bg-surface-1 border border-surface-3 rounded-lg text-sm focus:border-brand focus:ring-1 focus:ring-brand outline-none transition-colors"
              placeholder="••••••••"
            />
          </div>

          {login.isError && (
            <p role="alert" className="text-error text-sm">{login.error.message}</p>
          )}

          <button
            type="submit"
            disabled={login.isPending}
            className="w-full py-2.5 bg-brand text-surface-0 font-semibold rounded-lg hover:bg-brand-bright transition-colors disabled:opacity-50"
          >
            {login.isPending ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="text-center text-sm text-text-secondary mt-6">
          Don't have an account?{" "}
          <Link to="/register" className="text-brand hover:text-brand-bright">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}
