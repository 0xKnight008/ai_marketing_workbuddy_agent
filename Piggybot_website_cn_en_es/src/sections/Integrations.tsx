import { Share2, Blocks, Plug } from "lucide-react";
import { SectionTitle } from "../components/SectionTitle";
import { Reveal } from "../components/Reveal";
import { StarSparkle } from "../components/ghibli/Piggy";
import { useT } from "../i18n/LangContext";

const SOCIAL = [
  { name: "Instagram", c: "#FBD9DE" }, { name: "TikTok", c: "#CFF0EE" }, { name: "YouTube", c: "#F8C8C4" },
  { name: "X / Twitter", c: "#E3E2DF" }, { name: "LinkedIn", c: "#C8E0F0" }, { name: "Facebook", c: "#CFE0F5" },
  { name: "Threads", c: "#EDE9DE" }, { name: "Pinterest", c: "#F6D0CE" }, { name: "Reddit", c: "#FAD9C0" },
  { name: "Bluesky", c: "#CDE9F8" }, { name: "WhatsApp", c: "#D5EDCF" }, { name: "Telegram", c: "#CDE7F6" },
  { name: "Discord", c: "#DDE0F8" }, { name: "Snapchat", c: "#FBF3C0" }, { name: "Google Business", c: "#D9EAD3" },
];

const ADS = ["Meta Ads", "Google Ads", "TikTok Ads", "LinkedIn Ads", "Pinterest Ads", "X Ads"];

function Chip({ name, c }: { name: string; c?: string }) {
  return (
    <span className="inline-flex items-center gap-2 px-3.5 py-2 bg-paper-card sketch-soft wobble-3 text-sm font-bold text-ink hover:-translate-y-0.5 hover:shadow-paint-sm transition-all cursor-default">
      <i className="w-3.5 h-3.5 rounded-full sketch-soft" style={{ background: c ?? "#F4C95D" }} />
      {name}
    </span>
  );
}

export function Integrations() {
  const { t } = useT();
  const itg = t.integrations;

  return (
    <section id="integrations" className="relative py-20 sm:py-28 bg-paper paper-grain overflow-hidden">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionTitle
          badge={itg.badge}
          title={
            <>
              {itg.pre}
              <span className="text-meadow-deep">{itg.hi}</span>
            </>
          }
          subtitle={itg.subtitle}
        />

        <div className="mt-14 space-y-8">
          <Reveal>
            <div className="bg-paper-card sketch wobble shadow-paint p-6 sm:p-8">
              <div className="flex items-center gap-3">
                <span className="grid place-items-center w-11 h-11 bg-piggy-light sketch blob"><Share2 className="w-[22px] h-[22px] text-ink" /></span>
                <div>
                  <h3 className="font-display text-xl text-ink">{itg.socialTitle}</h3>
                  <p className="text-sm text-ink-soft">{itg.socialSub}</p>
                </div>
              </div>
              <div className="mt-5 flex flex-wrap gap-2.5">
                {SOCIAL.map((s) => <Chip key={s.name} {...s} />)}
              </div>
              <div className="mt-4 pt-4 border-t-2 border-dashed border-ink/15 flex flex-wrap items-center gap-2.5">
                <span className="text-sm font-bold text-ink-faint mr-1">{itg.adsLabel}</span>
                {ADS.map((a) => (
                  <span key={a} className="px-3 py-1.5 bg-sun/50 sketch-dash wobble-2 text-[13px] font-bold text-ink">{a}</span>
                ))}
              </div>
            </div>
          </Reveal>

          <Reveal delay={0.12}>
            <div className="bg-paper-card sketch wobble-2 shadow-paint p-6 sm:p-8">
              <div className="flex items-center gap-3">
                <span className="grid place-items-center w-11 h-11 bg-meadow-light sketch blob"><Blocks className="w-[22px] h-[22px] text-ink" /></span>
                <div>
                  <h3 className="font-display text-xl text-ink">{itg.saasTitle}</h3>
                  <p className="text-sm text-ink-soft">{itg.saasSub}</p>
                </div>
              </div>
              <div className="mt-5 flex flex-wrap gap-2.5">
                {itg.saas.map((s) => <Chip key={s.name} {...s} />)}
              </div>
            </div>
          </Reveal>

          <Reveal delay={0.18} className="text-center">
            <p className="inline-flex items-center gap-2 px-5 py-2.5 bg-ink text-paper-card font-bold text-sm wobble-2">
              <Plug className="w-4 h-4 text-sun" />
              {itg.devNote}
              <StarSparkle className="w-4 h-4 text-sun" />
            </p>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
