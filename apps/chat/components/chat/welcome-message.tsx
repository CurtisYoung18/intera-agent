// WelcomeMessage — shown when no messages exist

export default function WelcomeMessage() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center px-4 pb-20">
      <h1 className="font-serif text-[32px] italic text-mist mb-3">Intera</h1>
      <p className="font-sans text-[15px] text-fog">How can I help you?</p>
    </div>
  )
}
