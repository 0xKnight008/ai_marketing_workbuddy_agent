import { Nav } from "../sections/Nav";
import { Hero } from "../sections/Hero";
import { Marquee } from "../sections/Marquee";
import { Features } from "../sections/Features";
import { CopilotDemo } from "../sections/CopilotDemo";
import { Workflows } from "../sections/Workflows";
import { AgentModes } from "../sections/AgentModes";
import { Governance } from "../sections/Governance";
import { Integrations } from "../sections/Integrations";
import { Pricing } from "../sections/Pricing";
import { Faq } from "../sections/Faq";
import { Footer } from "../sections/Footer";

export default function Home() {
  return (
    <div className="min-h-screen bg-paper text-ink antialiased">
      <Nav />
      <main>
        <Hero />
        <Marquee />
        <Features />
        <CopilotDemo />
        <Workflows />
        <AgentModes />
        <Governance />
        <Integrations />
        <Pricing />
        <Faq />
      </main>
      <Footer />
    </div>
  );
}
