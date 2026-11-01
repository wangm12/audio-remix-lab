import { useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { useRegister } from "@/hooks/useAuth";
import { Disc3 } from "lucide-react";
import { ApiError } from "@/lib/api";

export function RegisterForm() {
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const register = useRegister();
  const issues = register.error instanceof ApiError ? register.error.issues : [];
  const issueFor = (field: string) => issues.find((issue) => issue.field === field)?.message;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmedInviteCode = inviteCode.trim();
    register.mutate({ email, username, password, ...(trimmedInviteCode ? { invite_code: trimmedInviteCode } : {}) });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-0 px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <Disc3 className="w-10 h-10 text-brand mb-3" />
          <h1 className="font-display text-2xl font-bold">Create account</h1>
          <p className="text-text-secondary text-sm mt-1">
            Start remixing your favorite songs
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="username"
              className="block text-sm font-medium mb-1.5"
            >
              Username
            </label>
            <input
              id="username"
              type="text"
              required
              value={username}
              aria-invalid={!!issueFor("username")}
              aria-describedby={issueFor("username") ? "username-error" : undefined}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-3 py-2.5 bg-surface-1 border border-surface-3 rounded-lg text-sm focus:border-brand focus:ring-1 focus:ring-brand outline-none transition-colors"
              placeholder="your_name"
            />
            {issueFor("username") && <p id="username-error" className="text-xs text-error mt-1">{issueFor("username")}</p>}
          </div>
          <div>
            <label htmlFor="email" className="block text-sm font-medium mb-1.5">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              aria-invalid={!!issueFor("email")}
              aria-describedby={issueFor("email") ? "email-error" : undefined}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2.5 bg-surface-1 border border-surface-3 rounded-lg text-sm focus:border-brand focus:ring-1 focus:ring-brand outline-none transition-colors"
              placeholder="you@example.com"
            />
            {issueFor("email") && <p id="email-error" className="text-xs text-error mt-1">{issueFor("email")}</p>}
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
              minLength={8}
              aria-invalid={!!issueFor("password")}
              aria-describedby={issueFor("password") ? "password-hint password-error" : "password-hint"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2.5 bg-surface-1 border border-surface-3 rounded-lg text-sm focus:border-brand focus:ring-1 focus:ring-brand outline-none transition-colors"
              placeholder="••••••••"
            />
            <p id="password-hint" className="text-xs text-text-muted mt-1.5">
              At least 8 characters.
            </p>
            {issueFor("password") && <p id="password-error" className="text-xs text-error mt-1">{issueFor("password")}</p>}
          </div>
          <div>
            <label htmlFor="invite-code" className="block text-sm font-medium mb-1.5">
              Invite code (if required)
            </label>
            <input
              id="invite-code"
              type="text"
              autoComplete="off"
              value={inviteCode}
              aria-invalid={!!issueFor("invite_code")}
              aria-describedby={issueFor("invite_code") ? "invite-code-error" : undefined}
              onChange={(e) => setInviteCode(e.target.value)}
              className="w-full px-3 py-2.5 bg-surface-1 border border-surface-3 rounded-lg text-sm focus:border-brand focus:ring-1 focus:ring-brand outline-none transition-colors"
            />
            {issueFor("invite_code") && <p id="invite-code-error" className="text-xs text-error mt-1">{issueFor("invite_code")}</p>}
          </div>

          {register.isError && (
            <p role="alert" className="text-error text-sm">{register.error.message}</p>
          )}

          <button
            type="submit"
            disabled={register.isPending}
            className="w-full py-2.5 bg-brand text-surface-0 font-semibold rounded-lg hover:bg-brand-bright transition-colors disabled:opacity-50"
          >
            {register.isPending ? "Creating account…" : "Create account"}
          </button>
        </form>

        <p className="text-center text-sm text-text-secondary mt-6">
          Already have an account?{" "}
          <Link to="/login" className="text-brand hover:text-brand-bright">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
