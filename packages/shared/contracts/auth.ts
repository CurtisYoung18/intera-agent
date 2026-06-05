import { z } from 'zod'

/** Normalized email — trims whitespace and lowercases. Use at every auth boundary. */
export const emailNormalized = z.string().trim().toLowerCase().email()
