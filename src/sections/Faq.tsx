import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { SectionTitle } from "../components/SectionTitle";
import { Reveal } from "../components/Reveal";
import { SpritePuff } from "../components/ghibli/Piggy";
import { useT } from "../i18n/LangContext";

export function Faq() {
  const { t } = useT();
  const f = t.faq;

  return (
    <section id="faq" className="relative py-20 sm:py-28 bg-paper paper-grain overflow-hidden">
      <SpritePuff className="anim-floaty-slow absolute top-24 right-[5%] w-10 opacity-70 hidden lg:block" />
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <SectionTitle
          badge={f.badge}
          title={
            <>
              {f.pre}
              <span className="text-meadow-deep">{f.hi}</span>
              {f.post}
            </>
          }
        />
        <Reveal delay={0.12} className="mt-12">
          <Accordion type="single" collapsible className="space-y-4">
            {f.items.map((item, i) => (
              <AccordionItem
                key={i}
                value={`q${i}`}
                className={`bg-paper-card sketch shadow-paint px-5 sm:px-6 border-none ${i % 2 === 0 ? "wobble" : "wobble-2"}`}
              >
                <AccordionTrigger className="font-display text-base sm:text-lg text-ink hover:no-underline py-5 text-left">
                  {item.q}
                </AccordionTrigger>
                <AccordionContent className="text-[15px] leading-relaxed text-ink-soft pb-5">
                  {item.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </Reveal>
      </div>
    </section>
  );
}
