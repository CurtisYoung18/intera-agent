import { redirect } from 'next/navigation'

export default function BuildPlaygroundPage() {
  redirect('/build/pilot-lab?tab=playground')
}
