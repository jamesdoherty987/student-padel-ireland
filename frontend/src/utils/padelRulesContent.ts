/** Shared padel rules copy for the web page and A4 PDF. */

export type RulesSection = {
  title: string
  bullets: string[]
}

export const PADEL_RULES_INTRO =
  'Basics for social and student play. Your event page wins if it posts different scoring.'

export const PADEL_RULES_SECTIONS: RulesSection[] = [
  {
    title: 'The court',
    bullets: [
      'Doubles: four players, two vs two, on an enclosed court with glass and mesh.',
      'The ball can bounce once on the floor, then rebound off the walls.',
    ],
  },
  {
    title: 'Serve',
    bullets: [
      'Underarm only. Bounce the ball, then hit it at or below waist height with at least one foot on the ground.',
      'Stand behind the service line (do not step on it). Serve diagonally into the opposite service box. Lines count as in.',
      'Two serves: a fault on first gives you a second; two faults lose the point.',
      'Start each game from the right side, then alternate sides every point.',
      'The receiver must let the serve bounce before returning it.',
    ],
  },
  {
    title: 'Serve off the glass',
    bullets: [
      'After a legal serve lands in the box, it may hit the back or side glass and stay in play.',
      'If the serve bounces in the box and then hits the mesh / fence before the second bounce, it is a fault.',
      'Net cord that then lands in the correct box is a let — replay the serve.',
    ],
  },
  {
    title: 'Walls in a rally',
    bullets: [
      'Floor first on their side. Your shot must bounce on the opponents’ floor before it touches their glass or mesh. Wall first on their side = you lose the point.',
      'After one bounce on your side, the ball may hit your glass (including corners) and you can still play it before the second bounce.',
      'You may not play the ball off your own mesh / fence — that loses the point.',
      'You can volley after the return of serve; the serve itself must bounce.',
    ],
  },
  {
    title: 'What’s out',
    bullets: [
      'Second bounce on the floor before you hit it.',
      'Ball hits the mesh on the fly (before bouncing) on the opponents’ side.',
      'Ball goes over the fence / out of court where that is not allowed.',
      'Ball hits you or your partner (usually loses the point).',
    ],
  },
  {
    title: 'Lets',
    bullets: [
      'Replay if the ball breaks, something invades the court, or play is unfairly interrupted.',
      'Call a let straight away — if you play on, you usually lose the right to claim it.',
    ],
  },
  {
    title: 'Scoring at social events',
    bullets: [
      'Many student events use first to 21 points (every rally = 1 point), or whoever is ahead when the timed slot ends — check your event page.',
      'Classic padel uses games and sets (15–30–40). Organisers may still choose best of 3 for longer matches.',
      'Golden point / no-ad: at deuce, one deciding point wins the game (common in timed events).',
    ],
  },
  {
    title: 'Etiquette',
    bullets: [
      'Be ready on time; leave the court promptly when your slot ends.',
      'Agree the score after each point if needed; settle disputes with an organiser.',
      'Look after the court and other players — this is a social sport.',
    ],
  },
]

export const PADEL_RULES_FOOTER =
  'Event-specific scoring always wins when it is posted on the tournament page. Full competition rulebook: International Padel Federation (FIP).'
