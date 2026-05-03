// WelcomeMessage — shown when no messages exist

export default function WelcomeMessage() {
  return (
    <div className="flex flex-col items-center text-center px-4 mb-8">
      <h1 className="font-serif text-[40px] italic text-mist mb-3 tracking-[-0.01em]">Intera</h1>
      <p className="font-sans text-[16px] text-fog/50 leading-relaxed">How can I help you?</p>
    </div>
  )
}
