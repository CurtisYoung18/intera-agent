// WelcomeMessage — shown when no messages exist

export default function WelcomeMessage() {
  return (
    <div className="flex flex-col items-center text-center px-4 mb-10">
      <h1 className="font-serif text-[48px] italic text-mist mb-4 tracking-[-0.02em]">Intera</h1>
      <p className="font-sans text-[15px] text-fog/40 leading-relaxed tracking-[0.01em]">How can I help you?</p>
    </div>
  )
}
