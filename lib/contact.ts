import type { ModalityId } from '@/lib/offer'

export const CONTACT_INTERESTS = [
  'hazlo-tu',
  'hazlo-tu-equipo',
  'acompanado',
  'acompanado-equipo',
  'a-medida',
  'no-lo-se',
] as const satisfies readonly (ModalityId | 'a-medida' | 'no-lo-se')[]

export type ContactInterest = (typeof CONTACT_INTERESTS)[number]

export function isContactInterest(value: unknown): value is ContactInterest {
  return typeof value === 'string' && (CONTACT_INTERESTS as readonly string[]).includes(value)
}
