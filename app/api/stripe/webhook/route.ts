import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { modalityForPaymentLink } from '@/lib/checkout'
import { formatLicenseId, signLicense } from '@/lib/license'
import { licenseTerms, purchaseFromSession } from '@/lib/delivery/purchase'
import { claimSession, completeSession, isStoreConfigured, nextLicenseSequence, releaseSession } from '@/lib/delivery/store'
import { folderUrl, releaseFolderId, shareFolder, unshareFolder } from '@/lib/delivery/drive'
import { sendCustomerEmail, sendInternalEmail } from '@/lib/delivery/email'

// Entrega al momento tras el pago (Eric, 05-10-2026; _specs/spec-entrega-tras-el-pago.md):
// 1. comprueba la firma del aviso de Stripe;
// 2. firma la licencia (lib/license.ts, igual que firmar_licencia.py);
// 3. comparte la carpeta de Drive de la version con el correo del cliente;
// 4. le manda el correo con la licencia adjunta, y avisa a info@ para la factura de Holded.
// Devolucion o contracargo: se deja de compartir la carpeta. La licencia no se revoca.

export const runtime = 'nodejs'

function stripe(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY sin configurar')
  return new Stripe(process.env.STRIPE_SECRET_KEY)
}

export async function POST(request: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  const signature = request.headers.get('stripe-signature')
  if (!secret || !signature) {
    return NextResponse.json({ error: 'webhook sin configurar o sin firma' }, { status: 400 })
  }

  let event: Stripe.Event
  try {
    event = stripe().webhooks.constructEvent(await request.text(), signature, secret)
  } catch (error) {
    console.error('[entrega] firma de Stripe no valida:', error)
    return NextResponse.json({ error: 'firma no valida' }, { status: 400 })
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
        await deliver(event.data.object)
        break
      case 'charge.refunded':
        if (event.data.object.refunded) await revoke(event.data.object, 'devolución')
        break
      case 'charge.dispute.created': {
        const charge = event.data.object.charge
        await revoke(typeof charge === 'string' ? await stripe().charges.retrieve(charge) : charge, 'contracargo')
        break
      }
    }
  } catch (error) {
    // Un 500 hace que Stripe reintente el aviso.
    console.error(`[entrega] ${event.type} ${event.id}:`, error)
    return NextResponse.json({ error: 'fallo en la entrega' }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}

async function deliver(session: Stripe.Checkout.Session) {
  if (session.payment_status !== 'paid') return // llegara async_payment_succeeded

  const modality = modalityForPaymentLink(typeof session.payment_link === 'string' ? session.payment_link : session.payment_link?.id)
  if (!modality) return // no es un enlace del Cerebro Digital

  if (!isStoreConfigured()) throw new Error('sin almacen para la secuencia de licencias')
  if (!(await claimSession(session.id))) return // ya entregada o en curso

  const purchase = purchaseFromSession(session, modality)

  // Sin empresa, NIF o correo no se puede firmar una licencia que valga: se hace a mano.
  if (!purchase.company || !purchase.taxId || !purchase.email) {
    await sendInternalEmail(`Venta sin entregar: faltan datos (${session.id})`, {
      'Qué hacer': 'Pedir los datos al cliente y emitir la licencia con firmar_licencia.py',
      Sesión: session.id,
      Modalidad: modality,
      Empresa: purchase.company,
      NIF: purchase.taxId,
      Correo: purchase.email,
    })
    await completeSession(session.id, 'manual')
    return
  }

  let licenseId: string
  try {
    const terms = licenseTerms(modality, purchase.purchasedOn)
    const year = Number(purchase.purchasedOn.slice(0, 4))
    licenseId = formatLicenseId(year, await nextLicenseSequence(year))
    const seed = process.env.LICENSE_SIGNING_KEY
    if (!seed) throw new Error('LICENSE_SIGNING_KEY sin configurar')
    const license = signLicense({ id: licenseId, cliente: purchase.company, nif: purchase.taxId, ...terms }, seed)

    const folderId = releaseFolderId()
    await shareFolder(folderId, purchase.email)
    await sendCustomerEmail({
      purchase,
      company: purchase.company,
      licenseId,
      licenseText: license.text,
      licenseFileName: license.fileName,
      downloadUrl: folderUrl(folderId),
    })
  } catch (error) {
    // Nada ha llegado al cliente: se suelta la sesion para que el reintento de Stripe la entregue.
    await releaseSession(session.id)
    throw error
  }

  await completeSession(session.id, licenseId)
  await sendInternalEmail(`Venta: ${licenseId} · ${purchase.company}`, {
    'Qué hacer': 'Emitir la factura en Holded (Verifactu) y apuntar la licencia',
    Licencia: licenseId,
    Empresa: purchase.company,
    NIF: purchase.taxId,
    Correo: purchase.email,
    País: purchase.country,
    Modalidad: modality,
    Importe: purchase.amountTotal !== null ? `${(purchase.amountTotal / 100).toFixed(2)} ${purchase.currency?.toUpperCase()}` : null,
    Fecha: purchase.purchasedOn,
    Sesión: session.id,
  })
}

async function revoke(charge: Stripe.Charge, reason: string) {
  const email = charge.billing_details?.email || charge.receipt_email
  if (!email) return
  const removed = await unshareFolder(releaseFolderId(), email)
  await sendInternalEmail(`${reason[0].toUpperCase()}${reason.slice(1)}: ${email}`, {
    'Qué hacer': 'Revisar la devolución en Holded. La licencia no se revoca: funciona sin internet.',
    Correo: email,
    'Acceso a la descarga': removed ? 'quitado' : 'no tenía acceso compartido',
    Cargo: charge.id,
  })
}
