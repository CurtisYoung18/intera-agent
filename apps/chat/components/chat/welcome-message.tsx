// WelcomeMessage — shown when no messages exist

export default function WelcomeMessage() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center px-4 pb-12">
      <h1 className="font-serif text-[36px] italic text-mist mb-4 tracking-[-0.01em]">Intera</h1>
      <p className="font-sans text-[16px] text-fog/70 leading-relaxed">How can I help you?</p>
    </div>
  )
}
