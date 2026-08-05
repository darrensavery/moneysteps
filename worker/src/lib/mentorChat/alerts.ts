import { EmailService } from '../email.js';
import type { Env } from '../../types.js';

export async function notifyParentsOfDistress(
  env: Env,
  opts: { familyId: string; childDisplayName: string; locale: 'en' | 'pl' },
): Promise<void> {
  const parents = await env.DB
    .prepare(`SELECT u.email FROM users u
              JOIN family_roles fr ON fr.user_id = u.id
              WHERE fr.family_id = ? AND fr.role = 'parent' AND u.email IS NOT NULL`)
    .bind(opts.familyId)
    .all<{ email: string }>();

  const subject = opts.locale === 'pl'
    ? `Wiadomość od ${opts.childDisplayName} wymaga Twojej uwagi`
    : `A message from ${opts.childDisplayName} needs your attention`;

  const text = opts.locale === 'pl'
    ? `${opts.childDisplayName} napisał(a) coś w czacie z Mentorem AI, co sugeruje, że może potrzebować wsparcia. Zalecamy jak najszybszą rozmowę.`
    : `${opts.childDisplayName} wrote something in their AI Mentor chat that suggests they may need support. We'd recommend checking in with them as soon as you can.`;

  const emailService = new EmailService(env);
  await Promise.all(
    parents.results.map((p) =>
      emailService.sendTransactional({
        to: p.email,
        subject,
        html: `<p>${text}</p>`,
        text,
      }),
    ),
  );
}
