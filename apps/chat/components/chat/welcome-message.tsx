// WelcomeMessage — shown when no messages exist

export default function WelcomeMessage() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center px-4 -mt-16">
      {/* Brand name */}
      <h1 className="font-serif italic text-[40px] sm:text-[48px] text-mist mb-4 select-none">
        Intera
      </h1>

      {/* Tagline */}
      <p className="font-sans text-[15px] sm:text-[17px] text-fog max-w-[320px] text-balance leading-relaxed">
        How can I help you?
      </p>

      {/* Subtle hint */}
      <p className="mt-8 font-sans text-[13px] text-smoke max-w-[280px] text-balance leading-relaxed">
        Describe your issue and I&rsquo;ll work with you to resolve it
      </p>
    </div>
  )
}
