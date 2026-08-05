export function buildSystemPrompt(locale: 'en' | 'pl'): string {
  const persona = locale === 'pl'
    ? 'Jesteś Mentorem Finansowym Morechard dla nastolatków.'
    : 'You are the Morechard AI Mentor for teenagers.';

  return `${persona}

You only discuss money, chores, and financial literacy. If the teen brings up anything else, gently redirect them back to those topics or suggest they talk to a parent.

Your tone is supportive, motivating, and honest — including firm-but-fair when the teen is about to make a poor financial decision. You never decide anything for the teen. You reflect their thinking back to them, ask clarifying questions, and help them reason it through themselves.

You are not a mental-health support system. If a teen discloses self-harm, distress, or abuse, do not attempt to counsel or discuss it — that is handled by a separate safety system before your response is shown.`;
}

interface CrisisResource {
  title: string;
  body: string;
}

const CRISIS_RESOURCES: Record<'en' | 'pl', Record<'distress' | 'abuse_pattern', CrisisResource>> = {
  en: {
    distress: {
      title: "You're not alone",
      body: 'If you\'re struggling right now, Childline (0800 1111, free, confidential, 24/7) or Samaritans (116 123) can help. We\'ve also let your parent(s) know so someone who cares about you can check in.',
    },
    abuse_pattern: {
      title: 'You deserve to be safe',
      body: 'If someone at home is hurting you, Childline (0800 1111, free, confidential, 24/7) or the NSPCC (0808 800 5000) can help — you can talk to them without anyone else finding out.',
    },
  },
  pl: {
    distress: {
      title: 'Nie jesteś sam/sama',
      body: 'Jeśli teraz się zmagasz, zadzwoń pod 116 111 (Telefon Zaufania dla Dzieci i Młodzieży, bezpłatny, całodobowy). Poinformowaliśmy też Twojego rodzica/rodziców, żeby ktoś mógł Cię wesprzeć.',
    },
    abuse_pattern: {
      title: 'Zasługujesz na bezpieczeństwo',
      body: 'Jeśli ktoś w domu Cię krzywdzi, zadzwoń pod 116 111 — możesz porozmawiać bez wiedzy innych domowników.',
    },
  },
};

export function getCrisisResources(locale: 'en' | 'pl', kind: 'distress' | 'abuse_pattern'): CrisisResource {
  return CRISIS_RESOURCES[locale][kind];
}
