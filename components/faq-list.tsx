import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { getFAQSchema } from '@/lib/schemas'

interface FaqListProps {
  title: string
  items: { q: string; a: string }[]
  id?: string
  className?: string
}

export default function FaqList({ title, items, id, className }: FaqListProps) {
  const schema = getFAQSchema(items.map((item) => ({ question: item.q, answer: item.a })))

  return (
    <section className={className ?? 'py-20 sm:py-24'} id={id}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-ink mb-10 text-center">{title}</h2>
        <Accordion type="single" collapsible className="w-full">
          {items.map((item, index) => (
            <AccordionItem key={item.q} value={`item-${index}`}>
              <AccordionTrigger className="text-left text-base font-medium text-ink">{item.q}</AccordionTrigger>
              <AccordionContent className="text-body text-base leading-relaxed">{item.a}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  )
}
