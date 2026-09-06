import { Nav } from "@/components/landing/Nav";
import { Hero } from "@/components/landing/Hero";
import { ProblemSection } from "@/components/landing/ProblemSection";
import { LivePreview } from "@/components/landing/LivePreview";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { Footer } from "@/components/landing/Footer";

export default function LandingPage() {
  return (
    <div className="min-h-screen">
      <Nav />
      <main>
        <Hero />
        <ProblemSection />
        <LivePreview />
        <HowItWorks />
      </main>
      <Footer />
    </div>
  );
}
