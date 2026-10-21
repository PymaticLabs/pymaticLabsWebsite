// Facturas en Holded, por su API v2 (https://www.holded.com/es/desarrolladores, junio de 2026):
// contacto por NIF (code), factura (invoices) o rectificativa (credit-notes), aprobarla, que
// Holded la mande por correo, y su PDF para la zona.
//
// HOLDED_API_KEY: clave con sales:invoices.read/.write y contacts:contacts.read/.write.
// Impuestos (los ids de GET /api/v2/taxes de la cuenta): HOLDED_TAX_STANDARD (21 %, por defecto
// s_iva_21), HOLDED_TAX_REVERSE_CHARGE (UE con NIF-IVA valido), HOLDED_TAX_EXPORT (fuera de la UE)
// y HOLDED_TAX_EXEMPT. Si falta el que toca, el paso no factura y avisa: un IVA mal puesto en
// Verifactu no se deshace solo.
//
// Cuota: Holded limita las llamadas por minuto y por mes segun el plan (Plus, 500 al mes). Cada
// venta gasta unas 6; para 100 ventas al mes hace falta el plan Basic o superior.

import { request, requestJson, requireEnv } from './http.ts'
import { PermanentError, type Company, type InvoiceDraft, type InvoiceKind, type Invoicer, type Locale, type ProviderDocument } from '../types.ts'

const PATHS: Record<InvoiceKind, string> = { invoice: 'invoices', credit_note: 'credit-notes' }

interface HoldedDocument {
  id: string
  document_number?: string | null
  draft?: boolean | null
  approved_at?: string | null
  description?: string | null
  contact_id?: string | null
  // En la v2, texto decimal ("121.00"), segun su referencia; si no vinieran, no se emite sola.
  total?: number | string | null
  tax?: number | string | null
}

function amount(value: number | string | null | undefined): number | null {
  const parsed = typeof value === 'string' ? Number(value) : value
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null
}

export class HoldedInvoicer implements Invoicer {
  readonly name = 'holded'
  private base: string
  private key: string
  private env: Record<string, string | undefined>

  constructor(env: Record<string, string | undefined>) {
    this.env = env
    this.key = requireEnv(env, 'HOLDED_API_KEY')
    this.base = (env.HOLDED_API_URL || 'https://api.holded.com/api/v2').replace(/\/+$/, '')
  }

  private headers() {
    return { Authorization: `Bearer ${this.key}` }
  }

  async ensureContact(company: Company): Promise<string> {
    const found = await requestJson<{ items: { id: string }[] }>(
      'Holded',
      `${this.base}/contacts?${new URLSearchParams({ code: company.taxId, limit: '1' })}`,
      { headers: this.headers() }
    )
    if (found.items?.[0]?.id) return found.items[0].id
    const address = company.address
    const created = await requestJson<{ id: string }>('Holded', `${this.base}/contacts`, {
      method: 'POST',
      headers: this.headers(),
      json: {
        name: company.name,
        code: company.taxId,
        // El NIF-IVA intracomunitario, si lo es (empieza por el pais).
        vat_number: company.taxIdType === 'eu_vat' ? company.taxId : null,
        is_person: false,
        email: company.email,
        type: 'client',
        bill_address: address
          ? {
              address: [address.line1, address.line2].filter(Boolean).join(', ') || null,
              city: address.city,
              postal_code: address.postal_code,
              province: address.state,
              country: address.country,
              country_code: address.country,
            }
          : null,
        defaults: { language: company.locale, currency: company.currency.toUpperCase() },
      },
    })
    return created.id
  }

  private taxKey(draft: InvoiceDraft): string {
    const keys: Record<InvoiceDraft['taxTreatment'], string | undefined> = {
      standard: this.env.HOLDED_TAX_STANDARD || 's_iva_21',
      reverse_charge: this.env.HOLDED_TAX_REVERSE_CHARGE,
      export: this.env.HOLDED_TAX_EXPORT,
      exempt: this.env.HOLDED_TAX_EXEMPT,
    }
    if (draft.taxTreatment === 'standard' && draft.taxRate !== null && Math.abs(draft.taxRate - 21) > 0.01) {
      throw new PermanentError(`IVA del ${draft.taxRate} %: no esta previsto (solo el 21 %)`)
    }
    const key = keys[draft.taxTreatment]
    if (!key) throw new PermanentError(`falta el impuesto de Holded para ${draft.taxTreatment} (HOLDED_TAX_*)`)
    return key
  }

  async findDocument(kind: InvoiceKind, contactId: string, reference: string): Promise<ProviderDocument | null> {
    const list = await requestJson<{ items: HoldedDocument[] }>(
      'Holded',
      `${this.base}/${PATHS[kind]}?${new URLSearchParams({ contact_id: contactId, limit: '100', sort: '-date' })}`,
      { headers: this.headers() }
    )
    const match = (list.items ?? []).find((doc) => doc.description?.includes(reference))
    // El listado no trae si esta en borrador ni si se aprobo: el estado de verdad, del documento.
    return match ? this.getDocument(kind, match.id) : null
  }

  async createDocument(kind: InvoiceKind, draft: InvoiceDraft): Promise<ProviderDocument> {
    const tax = this.taxKey(draft)
    const series = kind === 'invoice' ? this.env.HOLDED_INVOICE_SERIES_ID : this.env.HOLDED_CREDIT_NOTE_SERIES_ID
    const created = await requestJson<{ id: string }>('Holded', `${this.base}/${PATHS[kind]}`, {
      method: 'POST',
      headers: this.headers(),
      json: {
        contact_id: draft.contactId,
        // La descripcion lleva el pago de Stripe: asi un reintento encuentra la factura (findDocument).
        description: draft.reference,
        date: draft.date,
        notes: draft.notes,
        body: draft.body,
        language: draft.language,
        currency: draft.currency.toUpperCase(),
        items: draft.lines.map((line) => ({
          name: line.name,
          type: 'service',
          description: line.description,
          units: line.units,
          price: line.price,
          taxes: [tax],
        })),
        tags: ['cerebro-digital', 'web'],
        ...(series ? { number_line_id: series } : {}),
      },
    })
    return { id: created.id, number: null, approved: false }
  }

  async getDocument(kind: InvoiceKind, id: string): Promise<ProviderDocument> {
    const doc = await requestJson<HoldedDocument>('Holded', `${this.base}/${PATHS[kind]}/${encodeURIComponent(id)}`, {
      headers: this.headers(),
    })
    return this.toProvider(doc)
  }

  async approveDocument(kind: InvoiceKind, id: string): Promise<ProviderDocument> {
    await request('Holded', `${this.base}/${PATHS[kind]}/${encodeURIComponent(id)}/approve`, { method: 'POST', headers: this.headers() })
    const doc = await this.getDocument(kind, id)
    if (!doc.approved) throw new PermanentError(`Holded no dejo aprobada la ${kind} ${id}`)
    return doc
  }

  async sendDocument(kind: InvoiceKind, id: string, email: string, locale: Locale): Promise<void> {
    await request('Holded', `${this.base}/${PATHS[kind]}/${encodeURIComponent(id)}/send`, {
      method: 'POST',
      headers: this.headers(),
      json: {
        emails: [email],
        subject: locale === 'en' ? 'Your Digital Brain invoice' : 'Tu factura del Cerebro Digital',
      },
    })
  }

  async getPdf(kind: InvoiceKind, id: string): Promise<Buffer> {
    const res = await request('Holded', `${this.base}/${PATHS[kind]}/${encodeURIComponent(id)}/pdf`, {
      headers: { ...this.headers(), Accept: 'application/pdf' },
    })
    const bytes = Buffer.from(await res.arrayBuffer())
    // Por si la cuenta responde con el PDF en base64 dentro de un JSON (como la API v1).
    if (bytes.subarray(0, 4).toString('latin1') !== '%PDF') {
      try {
        const parsed = JSON.parse(bytes.toString('utf-8')) as { data?: string }
        if (parsed.data) return Buffer.from(parsed.data, 'base64')
      } catch {
        // no era JSON
      }
      throw new PermanentError(`Holded no devolvio un PDF de ${id}`)
    }
    return bytes
  }

  private toProvider(doc: HoldedDocument): ProviderDocument {
    return {
      id: doc.id,
      number: doc.document_number ?? null,
      approved: doc.draft === false || Boolean(doc.approved_at),
      total: amount(doc.total),
      tax: amount(doc.tax),
    }
  }
}
