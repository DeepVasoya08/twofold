/** Questions on the landing page, also published as FAQPage structured data. */
export const faq: readonly { question: string; answer: string }[] = [
  {
    question: 'Can Twofold see my photos?',
    answer:
      'No. Photos, previews, albums, dates and places are encrypted on your device before they’re uploaded, with keys made from your password. Our servers store files they can’t open.',
  },
  {
    question: 'What happens if I forget my password?',
    answer:
      'There’s no password reset, because we never have your password. When you sign up you get a recovery key. Keep it somewhere safe: it’s the only way back into your library.',
  },
  {
    question: 'And if I forget my private space password?',
    answer:
      'The private space has no recovery key, so it can’t be recovered. That’s part of what keeps it private: nothing else can open it.',
  },
  {
    question: 'How much can I store?',
    answer:
      'Each account has 1 GB of encrypted storage, shared between your library and your private space.',
  },
  {
    question: 'Do I need to install anything?',
    answer:
      'No. Twofold runs in your browser on your phone or computer. Encryption happens right there in the browser.',
  },
  {
    question: 'Are there ads or tracking?',
    answer:
      'No ads, no trackers and no third-party analytics. We don’t scan or analyze your photos, and we couldn’t if we wanted to.',
  },
];
