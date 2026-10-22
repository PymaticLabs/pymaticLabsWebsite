import { useTranslations } from 'next-intl'
import StorySteps, { type StoryTexts } from '@/components/home/story-steps'

// "No solo contesta. Tambien trabaja.": las tareas, contadas con el chat que avanza al bajar (ver story-steps).
export default function Story() {
  const t = useTranslations('home')
  const texts: StoryTexts = {
    frame: {
      name: t('chat.name'),
      company: t('chat.company'),
      local: t('chat.local'),
      example: t('chat.example'),
      today: t('chat.today'),
      placeholder: t('chat.placeholder'),
    },
    steps: t.raw('story.steps') as StoryTexts['steps'],
    chat: t.raw('story.chat') as StoryTexts['chat'],
  }

  return (
    <section className="bg-paper-2 pb-16 pt-24 sm:pt-32 lg:pb-8" id="como-funciona">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div data-reveal className="max-w-3xl">
          <p className="text-lg font-semibold text-brand">{t('story.eyebrow')}</p>
          <h2 className="mt-3 text-[2.75rem] font-bold leading-[1.04] tracking-[-0.04em] text-ink sm:text-7xl">{t('story.title')}</h2>
        </div>
        <div className="mt-8 lg:mt-0">
          <StorySteps texts={texts} />
        </div>
      </div>
    </section>
  )
}
