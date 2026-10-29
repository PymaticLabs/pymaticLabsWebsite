> Pending: faithful translation of the Spanish text (content/legal/es/privacidad-producto.md), whose internal notes also apply here. Any change goes into both, and the lawyer reviews them together.

This policy provides information (Articles 13 and 14 of the General Data Protection Regulation, GDPR) about the personal data that Pymatic Labs processes when it sells the Digital Brain, delivers it, gives access to the member area and provides support, and about the data it does not process. What happens when you visit the website is explained in the [website privacy policy](/en/politica-privacidad).

## 1. In short

"Your information is yours. Your brain lives on your computers and procedures run on them. When the assistant needs something, it looks up only what it needs, answers you and that is it: it is not used to train any model and it does not stay in Claude's memory. The only thing left is your conversation, in your Claude account, and you delete it whenever you want. To make it so, during setup we show you how to turn off Claude's training and memory; with Claude Team, training is off by contract and memory comes off by default."

Anthropic sets two exceptions, in section 3: ratings of answers and whatever its safety filters flag.

What Pymatic Labs does process is the purchase: who buys, the invoice, the license, who signs in to the member area and the setup sessions. It is in section 4.

## 2. Controller

PYMATICLABS, SOCIEDAD LIMITADA ("Pymatic Labs"), tax ID (NIF) B88781745, Calle Alfred Giner Sorolla 3, 2º 5ª, 12006 Castellón de la Plana, Spain. Privacy email: [info@pymaticlabs.com](mailto:info@pymaticlabs.com). It is not required to appoint a data protection officer (Article 37 GDPR: it does not monitor people on a large scale or process special categories as its core activity) and has not appointed one.

## 3. What Pymatic Labs does not process

- **The content of the brain.** Documents, procedures, data and change history live on the Customer's computers (their computer or their NAS). The Digital Brain does not send that content or usage data to Pymatic Labs.
- **Passwords.** They are in the brain's password safe, on the Customer's computers. Pymatic Labs never asks for them. The member area has no passwords either: you sign in with a one-time code sent by email.
- **What the assistant reads.** It travels to its provider (Anthropic, with Claude) under the Customer's contract with it, and stays in Claude's history until it is deleted; after that, Anthropic's retention periods apply. With Claude Team or Enterprise, Anthropic processes that data as the Customer's processor, under a data processing agreement, and does not train on it; Claude's memory is off for each member by default. With Pro or Max it processes it as controller, under its consumer terms: memory is on by default and training is decided in its privacy settings. With training off, it keeps deleted conversations for 30 days; with it on, for up to five years. On all plans, a rating sent about an answer lets Anthropic keep that conversation for up to five years and use it for training, and whatever its safety filters flag it may keep for up to two years for its safety systems. Deleting a conversation does not delete what is already in memory: that is deleted separately.
- **Cowork in the cloud.** In cloud sessions, Claude takes a copy of every file it reads, files given to it directly are copied to the session and Claude's memory carries over between Cowork and chat. The brain's tools only respond with Claude Desktop open on a Customer computer.

## 4. Data Pymatic Labs processes, why and on what basis

- **Purchase and invoicing.** Company name, tax ID, billing address and country, name and email of the buyer, product, amounts, taxes and dates, and the payment identifier in Stripe. The purchase page asks for the country and the tax ID before payment, because the VAT depends on them (clause 4 of the [terms of use and sale](/en/condiciones)), and Stripe collects the rest on its payment page. With them the invoice is created in Holded, which issues it and sends it by email. To perform the contract, invoice and keep the accounts. Basis: performance of the contract and legal obligation (Article 6(1)(b) and (c) GDPR). Without this data the contract cannot be made. The full card number and its security code are processed by Stripe; Pymatic Labs does not receive them. It only sees the card's brand, last four digits, expiry date, country and a fingerprint.
- **VAT number check.** If the Customer is from another European Union country or from Monaco and gives their VAT number (or, as tax ID, a number in that format), before payment it is checked in VIES, the European Commission's system that verifies it with the tax authority that issued it; the query carries the Customer's VAT number and that of Pymatic Labs, which makes it. If the VAT number is valid, the query number and its date are kept with the order and, if VIES provides them, the name and address it has on record. Nothing is kept from the check of a number given as tax ID: if it is valid, the Customer is asked to enter it as a VAT number. To invoice without Spanish VAT only with a verified VAT number (Article 18 of Implementing Regulation (EU) 282/2011). Basis: legal obligation (Article 6(1)(c) GDPR).
- **Acceptance of the terms.** The version of the terms that was accepted, its fingerprint (a digest that proves which text it was), who and when. A copy is kept and arrives in the welcome email. To prove the contract. Basis: performance of the contract and legitimate interest in being able to prove it (Article 6(1)(b) and (f)).
- **License.** The license file carries the Customer's company name and tax ID, the product, whether it is with team, the purchase date and the end of maintenance and support, and is kept together with its payment identifier. Pymatic Labs signs it with its license key: today, on its own computer, with the data it receives by email; later, in a cloud key store (Google Cloud KMS), which receives that data only to sign it and does not keep it. Every day licenses are matched against payments, to detect a license without a payment. Basis: performance of the contract and legitimate interest in preventing fake licenses (Article 6(1)(b) and (f)).
- **Member area.** The email of each person with access (the buyer and, with team, the people they add), who added whom and when, additions and removals, the one-time codes (they expire within minutes), the session and the access logs (date, time, IP address and browser). To sign in without passwords, get the license, the downloads and the invoices, and protect the accounts. Basis: performance of the contract with the buyer and legitimate interest, of the Customer and of Pymatic Labs, in giving access to the people the Customer authorizes (Article 6(1)(b) and (f); Article 19 of Spanish Organic Law 3/2018, LOPDGDD). Accounts are only created by a purchase or by adding someone to the team: nobody signs up on their own.
- **Setup sessions** (Guided). Name, email, company, the day, the time and the Pymatic Labs person chosen, and whatever is said or seen in the session, without recording. The booking is made in Cal.com at purchase or from the member area. To prepare and hold the sessions. Basis: contract (Article 6(1)(b)).
- **Delivery emails.** The welcome, the sign-in codes, team access, each new license from the monthly plan, the notice of a monthly charge that could not be made, with the date on which it is suspended, refunds and new version notices, which reach every person with access. Basis: performance of the contract and, for security notices, the duty to inform about security updates (Regulation (EU) 2024/2847, CRA).
- **Launch price and abuse limits.** While a payment at that price is open, an encrypted fingerprint of the IP address (never the IP itself) is kept, so that nobody hoards the places. The payment also carries in Stripe another encrypted fingerprint of the IP, different for each payment, to recognise whoever goes back and opens another one, and give them their place. To stop anyone who opens payments or holds slots endlessly, or tries codes to get into the member area, attempts are counted by the encrypted fingerprint of the IP and of the email (never the data itself). They are deleted the next day, except the one carried by the payment, which stays with it in Stripe. Basis: legitimate interest in sharing out the places and in the security of the member area (Article 6(1)(f)).
- **Support.** Emails and notes for each incident, to resolve it. Basis: contract. What is seen in sessions with screen sharing or remote access is processed on behalf of the Customer, as processor, under the data processing agreement for support, annexed to the [terms of use and sale](/en/condiciones).
- **Business contacts.** Name, position and contact details of the people at the customer company, provided by the Customer. Basis: legitimate interest in maintaining the relationship (Article 19 of the LOPDGDD).
- **Marketing communications.** When paying, the buyer chooses whether they want to receive news. To customers, news about products similar to those purchased, with an unsubscribe link in every message (Article 21(2) of Spanish Law 34/2002, LSSI-CE); to non-customers, only with their consent. Basis: legitimate interest or consent.

There are no automated decisions with legal effects and no profiling (Article 22 GDPR). Delivery is automatic (on payment the invoice and the access are issued, and the license arrives within a few hours), but it decides nothing about people: if data is missing, or the payment's country or VAT does not match what was declared, a person reviews it.

**Stripe.** When the Customer pays, Stripe Payments Europe, Limited (Ireland) and the other companies in its group process the payment data in two roles. On behalf of Pymatic Labs, as processor, they process the payment, the subscription and the Customer portal, under the data processing agreement that Stripe includes in its services agreement. On their own behalf, as controller, they select and use banks and payment methods, prevent and detect fraud and losses, comply with anti-money-laundering law and requests from authorities, manage their relationship and their billing and analyse and improve their products, including their fraud models; for that they apply their [privacy policy](https://stripe.com/privacy) and may use cookies and device data on the payment page. If the buyer saves their details in Link, Stripe's fast checkout service, Stripe also acts as controller. Pymatic Labs receives from Stripe: name or company name, email, billing address, phone if the form asks for it, product, amount and dates; and, from the payment method, only the brand, last four digits, expiry date, country and a fingerprint.

## 5. Who receives the data

- **Stripe**, which collects payments and provides the customer portal for the monthly plan. Stripe Payments Europe, Limited (Ireland) and its group process the payment data in two roles: on behalf of Pymatic Labs, as processor, and on their own behalf, as controller (see section 4 and Stripe's privacy policy).
- **Providers that process it on behalf of Pymatic Labs**, under a data processing agreement accepted with their terms:
  - Supabase, in its European Union region (Ireland): database for delivery and licenses, access to the member area with a code by email and private store for downloads, invoices and accepted terms.
  - Google Cloud (Cloud KMS), in a European region: when licenses are signed in the cloud, it signs them without letting the key out.
  - Brevo (Sendinblue SAS, France): the delivery emails and the one-time codes to sign in to the member area without a password.
  - Holded: invoicing through its API and accounting; it sends the invoices by email.
  - Cal.com: the calendar for the setup sessions.
  - Vercel: hosts the website and the delivery.
  - Google (Google Workspace): email, documents and video calls with Google Meet.
  - AnyDesk (AnyDesk Software GmbH, Germany): remote access in support.
- **The European Commission**, with VIES, and the tax authority of the Customer's country, when a European Union VAT number is checked (section 4).
- The Spanish Tax Agency, other public authorities and the courts, when the law requires it.

Pymatic Labs does not sell data or share it with anyone else.

## 6. International transfers

Some providers may process data outside the European Economic Area, especially in the United States. Only with the safeguards of Chapter V GDPR: the adequacy decision of the EU-US Data Privacy Framework for certified companies, or European Commission standard contractual clauses.

Each provider's safeguards are these:

- EU-US Data Privacy Framework (Commission adequacy decision, Article 45 GDPR): Stripe, Google, Vercel and Cal.com appear as certified and active on the official list ([dataprivacyframework.gov](https://www.dataprivacyframework.gov), checked on 25 October 2026).
- European Commission standard contractual clauses (Implementing Decision (EU) 2021/914; Article 46(2)(c) GDPR), included in the data processing agreement of all of them. They are the main safeguard for Supabase, which stores the data in its European Union region (Ireland) but uses a Singapore entity and is not in the Framework; for the others, they back up the Framework where it does not cover the transfer.

Anyone who asks at [info@pymaticlabs.com](mailto:info@pymaticlabs.com) receives a copy of each provider's safeguards.

## 7. How long it is kept

- Purchase, invoicing (with the VIES check), licenses, accepted terms and business correspondence: six years (Article 30 of the Spanish Commercial Code).
- Access to the member area: while the company has a valid license. A person removed from the team can no longer sign in from that moment; their addition and removal are kept like the rest of the purchase.
- Sign-in codes: minutes, until used or expired. Member area session: until it is closed or after 7 days without use. Access logs: the provider's short period.
- Fingerprint of the IP for the launch price and fingerprints of IP and email for the limits: until the next day; the one carried by the payment in Stripe, for as long as that payment is kept.
- Support: while the relationship lasts, and afterwards like the correspondence.
- Marketing communications: until unsubscribing or withdrawing consent.

When data is no longer needed for its purpose, it is blocked while liabilities may arise (Article 32 of the LOPDGDD) and then deleted.

## 8. Rights

Anyone can request access, rectification, erasure, objection, restriction of processing and portability (Articles 15 to 22 GDPR), and withdraw consent they gave, by writing to [info@pymaticlabs.com](mailto:info@pymaticlabs.com). Pymatic Labs replies within one month (Article 12(3)). If the data belongs to someone the Customer shows in support, the Customer is the controller and Pymatic Labs passes the request on to them. Anyone who is not satisfied can complain to the Spanish Data Protection Agency (AEPD), at [www.aepd.es](https://www.aepd.es), or to the authority of their European Union country (Article 77 GDPR).

## 9. Security

Pymatic Labs applies technical and organizational measures appropriate to the risk (Article 32 GDPR): access only by those who need it and no copy of the content of its customers' brains. In the member area: no passwords, with one-time codes; each company only sees its own data, checked by the website and again by the database; downloads and invoices come from a private store with links that expire within minutes, never public; and the key that signs the licenses does not leave the Pymatic Labs computer where it is (nor, when they are signed in the cloud, the key store, which logs every signature).

## 10. Changes

Each version of this policy is published with its date. Important changes are notified to customers by email.

*This English version is provided for convenience. In case of discrepancy, the Spanish version prevails.*
