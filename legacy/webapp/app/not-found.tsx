export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center space-y-4">
        <h1 className="font-mono text-6xl font-bold text-orange-500">404</h1>
        <h2 className="font-mono text-2xl font-bold text-foreground uppercase tracking-wider">
          {'> '}PAGE NOT FOUND
        </h2>
        <p className="font-mono text-mutedForeground uppercase tracking-wide">
          The page you're looking for doesn't exist
        </p>
        <a
          href="/"
          className="inline-block mt-8 px-6 py-3 bg-orange-500 text-black font-mono font-bold uppercase tracking-wider hover:bg-orange-400 transition-colors"
        >
          {'> '}Return Home
        </a>
      </div>
    </div>
  );
}
