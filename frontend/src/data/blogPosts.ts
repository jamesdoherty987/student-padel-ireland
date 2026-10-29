export type BlogBlock =
  | { type: 'p'; text: string }
  | { type: 'h2'; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'cta'; text: string; to: string; label: string }

export type BlogPost = {
  slug: string
  title: string
  description: string
  publishedAt: string
  updatedAt?: string
  tags: string[]
  readingMinutes: number
  body: BlogBlock[]
}

export const BLOG_POSTS: BlogPost[] = [
  {
    slug: 'what-is-student-padel-ireland',
    title: 'What is Student Padel Ireland?',
    description:
      'Student Padel Ireland is the platform for student padel tournaments, community games, live scores, and national rankings across Ireland.',
    publishedAt: '2026-10-01',
    tags: ['Student Padel Ireland', 'overview'],
    readingMinutes: 4,
    body: [
      {
        type: 'p',
        text: 'Student Padel Ireland (SPI) is Ireland’s home for student padel. It brings tournaments, private community ladders, invite codes, live scoring, and an Ireland-wide ranking into one place - so university and college players can find a game without hunting through group chats.',
      },
      {
        type: 'h2',
        text: 'Who it is for',
      },
      {
        type: 'ul',
        items: [
          'Students looking for padel tournaments near their campus',
          'Friends who want a private ladder or community competition',
          'Organisers running doubles or singles events',
          'Players who want a clear Ireland ranking from real results',
        ],
      },
      {
        type: 'h2',
        text: 'What you can do on the platform',
      },
      {
        type: 'p',
        text: 'Browse upcoming events in Dublin, Cork, Galway, Limerick, Belfast, Waterford and beyond. Join with a partner, pay online or on arrival when the organiser allows it, follow live scores on the day, and see rankings update after matches.',
      },
      {
        type: 'p',
        text: 'Community mode lets you invite friends with a code, log singles and doubles matches, and climb a shared ladder - useful when there is no official tournament that weekend.',
      },
      {
        type: 'cta',
        text: 'Ready to play?',
        to: '/tournaments',
        label: 'Browse tournaments',
      },
    ],
  },
  {
    slug: 'how-to-join-a-student-padel-tournament',
    title: 'How to join a student padel tournament in Ireland',
    description:
      'Step-by-step guide to finding and joining student padel tournaments on Student Padel Ireland - with or without an invite code.',
    publishedAt: '2026-10-02',
    tags: ['tournaments', 'how-to'],
    readingMinutes: 5,
    body: [
      {
        type: 'p',
        text: 'Joining a student padel event in Ireland should take minutes, not a week of WhatsApp chasing. Here is how registration works on Student Padel Ireland.',
      },
      {
        type: 'h2',
        text: '1. Create an account',
      },
      {
        type: 'p',
        text: 'Sign up with your name, email, and university. You will use the same account for tournaments, community games, and rankings.',
      },
      {
        type: 'h2',
        text: '2. Find an open event',
      },
      {
        type: 'p',
        text: 'Open Tournaments and filter for open or upcoming events. Each page shows venue, date, format (singles or doubles), entry fee, and spots left.',
      },
      {
        type: 'h2',
        text: '3. Register with your partner (doubles)',
      },
      {
        type: 'p',
        text: 'Most student padel events are doubles. One player starts registration as captain; the partner confirms. Fees can be paid online, or at the venue if the organiser collects on arrival.',
      },
      {
        type: 'h2',
        text: 'Have a code instead?',
      },
      {
        type: 'p',
        text: 'If a friend or organiser shared a code or QR, tap Have a code? (or open the link), enter the code, and you will land on the right tournament or community group.',
      },
      {
        type: 'ul',
        items: [
          'Tournament codes take you to that event’s join flow',
          'Community codes add you to a private ladder or group',
          'Codes are short - paste carefully and avoid extra spaces',
        ],
      },
      {
        type: 'cta',
        text: 'See what is open this season.',
        to: '/tournaments',
        label: 'View tournaments',
      },
    ],
  },
  {
    slug: 'student-padel-dublin',
    title: 'Student padel in Dublin: find games and tournaments',
    description:
      'Looking for student padel in Dublin? How students find tournaments, community games, and rankings through Student Padel Ireland.',
    publishedAt: '2026-10-03',
    tags: ['Dublin', 'cities'],
    readingMinutes: 4,
    body: [
      {
        type: 'p',
        text: 'Dublin has the densest cluster of student padel activity in Ireland - campus clubs, social boxes, and one-day tournaments. Student Padel Ireland lists Dublin events in one feed so you are not relying on a single society Instagram story.',
      },
      {
        type: 'h2',
        text: 'How Dublin students use SPI',
      },
      {
        type: 'ul',
        items: [
          'Browse Upcoming events filtered by location for Dublin venues',
          'Join with a partner for doubles opens',
          'Use community competitions for midweek ladders between tournaments',
          'Check Ireland rankings after results are posted',
        ],
      },
      {
        type: 'h2',
        text: 'Tips for getting a spot',
      },
      {
        type: 'p',
        text: 'Popular Dublin dates fill quickly. Follow the tournaments list, turn up with a partner already agreed, and keep an invite code handy if your society shares one. If a full event opens a waitlist or a second wave, it will show on the event page.',
      },
      {
        type: 'cta',
        text: 'See Dublin and nationwide events.',
        to: '/tournaments',
        label: 'Browse tournaments',
      },
    ],
  },
  {
    slug: 'student-padel-cork-galway-limerick',
    title: 'Student padel outside Dublin: Cork, Galway, Limerick & more',
    description:
      'Student padel is growing in Cork, Galway, Limerick, Belfast and Waterford. How to find local tournaments and community games on Student Padel Ireland.',
    publishedAt: '2026-10-04',
    tags: ['Cork', 'Galway', 'Limerick', 'cities'],
    readingMinutes: 4,
    body: [
      {
        type: 'p',
        text: 'Student padel is not only a Dublin story. Cork, Galway, Limerick, Belfast, and Waterford all have active players - and Student Padel Ireland is built so regional events sit beside the capital in the same rankings.',
      },
      {
        type: 'h2',
        text: 'Why a national platform helps regional campuses',
      },
      {
        type: 'p',
        text: 'When every university runs its own spreadsheet, it is hard to compare results or recruit partners from another city. One Ireland ranking and shared tournament tools mean a Limerick open and a Cork ladder both count toward the same competitive picture.',
      },
      {
        type: 'h2',
        text: 'Starting play on your campus',
      },
      {
        type: 'ul',
        items: [
          'Create a community competition and invite your society with a code',
          'Log friendly matches so ratings move even without a full draw',
          'Promote your first open tournament on the SPI events list',
          'Link your club Instagram bio to studentpadel.ie so new members find you',
        ],
      },
      {
        type: 'cta',
        text: 'Start a community group or find an event near you.',
        to: '/community',
        label: 'Open community',
      },
    ],
  },
  {
    slug: 'how-student-padel-rankings-work',
    title: 'How Student Padel Ireland rankings work',
    description:
      'Learn how Ireland student padel rankings update from tournament and community match results on Student Padel Ireland.',
    publishedAt: '2026-10-05',
    tags: ['rankings', 'ratings'],
    readingMinutes: 5,
    body: [
      {
        type: 'p',
        text: 'Rankings on Student Padel Ireland are designed for real student play: tournament brackets and community matches both matter, including doubles where partners share the result.',
      },
      {
        type: 'h2',
        text: 'What feeds the ranking',
      },
      {
        type: 'ul',
        items: [
          'Official tournament match results once scores are confirmed',
          'Community singles and doubles matches logged in a competition',
          'Player profiles that show form over time, not only one weekend',
        ],
      },
      {
        type: 'h2',
        text: 'Doubles-aware ratings',
      },
      {
        type: 'p',
        text: 'Doubles is the default format for many student events. Ratings account for partners and opponents as a team average, so beating a strong pair moves you more than beating a mismatched one - and your partner’s level is part of the story.',
      },
      {
        type: 'h2',
        text: 'How to climb',
      },
      {
        type: 'p',
        text: 'Play regularly. Mix tournament days with community matches. Partner with different players when you can. Check the Rankings board after events to see national, friends, and university filters.',
      },
      {
        type: 'cta',
        text: 'See the live Ireland board.',
        to: '/rankings',
        label: 'View rankings',
      },
    ],
  },
  {
    slug: 'organise-a-student-padel-tournament',
    title: 'How to organise a student padel tournament',
    description:
      'Practical checklist for society organisers running a student padel tournament in Ireland with Student Padel Ireland.',
    publishedAt: '2026-10-06',
    tags: ['organisers', 'how-to'],
    readingMinutes: 6,
    body: [
      {
        type: 'p',
        text: 'Running a student padel day is easier when registration, payments, draws, and live scores live in one tool. Here is a practical organiser checklist for Ireland campuses.',
      },
      {
        type: 'h2',
        text: 'Before the event',
      },
      {
        type: 'ul',
        items: [
          'Book courts and confirm hours with the venue',
          'Create the tournament on Student Padel Ireland (format, fee, max teams, deadline)',
          'Share the public link and invite code in your society channels',
          'Decide online payment vs pay-on-arrival (or both)',
        ],
      },
      {
        type: 'h2',
        text: 'On the day',
      },
      {
        type: 'p',
        text: 'Use the organiser tools to generate the draw, call matches to courts, and enter scores. Players can follow a live phone view; a TV display route works for the venue screen.',
      },
      {
        type: 'h2',
        text: 'After the final',
      },
      {
        type: 'p',
        text: 'Confirmed results flow into Ireland rankings. Post the event link back to your club so next year’s committee inherits a clear history - not a lost spreadsheet.',
      },
      {
        type: 'cta',
        text: 'Create your next event.',
        to: '/organiser',
        label: 'Organiser dashboard',
      },
    ],
  },
  {
    slug: 'beginners-guide-student-padel',
    title: 'Beginner’s guide to student padel in Ireland',
    description:
      'New to padel at college? What to bring, how doubles works, and how to find your first student padel game in Ireland.',
    publishedAt: '2026-10-07',
    tags: ['beginners', 'guide'],
    readingMinutes: 5,
    body: [
      {
        type: 'p',
        text: 'Padel is one of the fastest-growing sports on Irish campuses because it is social, easy to start, and built around doubles. If you are new, you do not need a perfect smash - you need a racket, non-marking shoes, and a way to find a court booking.',
      },
      {
        type: 'h2',
        text: 'What to bring',
      },
      {
        type: 'ul',
        items: [
          'A padel racket (many venues rent them for first sessions)',
          'Court shoes with non-marking soles',
          'Water and a basic warm-up',
          'A partner if the event is doubles - or arrive early to meet one',
        ],
      },
      {
        type: 'h2',
        text: 'Your first student event',
      },
      {
        type: 'p',
        text: 'Look for beginner-friendly or mixed-level opens on Student Padel Ireland. Social formats and group stages are common, so you get several matches rather than a single knock-out loss.',
      },
      {
        type: 'h2',
        text: 'Keep playing between tournaments',
      },
      {
        type: 'p',
        text: 'Join a community competition with friends from your course or society. Logging matches keeps you sharp and starts building a ranking before the next open.',
      },
      {
        type: 'cta',
        text: 'Find a beginner-friendly event.',
        to: '/tournaments',
        label: 'Browse events',
      },
    ],
  },
  {
    slug: 'university-padel-clubs-ireland',
    title: 'University padel clubs in Ireland: how SPI fits in',
    description:
      'How campus padel clubs and societies across Ireland can use Student Padel Ireland for events, invites, and rankings.',
    publishedAt: '2026-10-08',
    tags: ['universities', 'clubs'],
    readingMinutes: 4,
    body: [
      {
        type: 'p',
        text: 'More Irish universities now have padel clubs or informal societies. Student Padel Ireland does not replace your committee - it gives every campus the same rails for invites, draws, scores, and a shared national ranking.',
      },
      {
        type: 'h2',
        text: 'What clubs typically use SPI for',
      },
      {
        type: 'ul',
        items: [
          'Public tournament pages instead of fragile signup forms',
          'QR / invite codes for Fresher’s week and WhatsApp groups',
          'Community ladders for weekly social play',
          'A single Ireland ranking when clubs play each other',
        ],
      },
      {
        type: 'h2',
        text: 'Working with venues and federations',
      },
      {
        type: 'p',
        text: 'Campus groups often start on nearby commercial courts while facilities catch up. SPI stays venue-agnostic: list wherever you play, keep eligibility clear on the event page, and point new members to studentpadel.ie from your bio.',
      },
      {
        type: 'cta',
        text: 'Set up your club’s next competition.',
        to: '/signup',
        label: 'Get started',
      },
    ],
  },
  {
    slug: 'student-padel-belfast',
    title: 'Student padel in Belfast and across Northern Ireland',
    description:
      'Find student padel tournaments and community games in Belfast on Student Padel Ireland - and how NI players join the Ireland ranking.',
    publishedAt: '2026-10-09',
    tags: ['Belfast', 'cities'],
    readingMinutes: 4,
    body: [
      {
        type: 'p',
        text: 'Belfast’s student padel scene is growing alongside the rest of the island. Student Padel Ireland lists Northern Ireland events in the same feed as Dublin and Cork, so partners and rankings travel with you when you play south or north.',
      },
      {
        type: 'h2',
        text: 'Finding a Belfast event',
      },
      {
        type: 'p',
        text: 'Check the tournaments board for Belfast venues, or ask your society for an invite code. Community competitions work well for midweek boxes when a full tournament draw is not needed.',
      },
      {
        type: 'h2',
        text: 'One island ranking',
      },
      {
        type: 'p',
        text: 'Results from Belfast events count toward the same Ireland rankings as everywhere else on SPI. That keeps inter-varsity and social play comparable without separate scoreboards.',
      },
      {
        type: 'cta',
        text: 'See open events nationwide.',
        to: '/tournaments',
        label: 'Browse tournaments',
      },
    ],
  },
  {
    slug: 'live-scores-student-padel',
    title: 'Live scores and match day on Student Padel Ireland',
    description:
      'How live scoring, player views, and TV displays work at student padel tournaments on Student Padel Ireland.',
    publishedAt: '2026-10-10',
    tags: ['live scores', 'tournaments'],
    readingMinutes: 4,
    body: [
      {
        type: 'p',
        text: 'Match day is chaotic when scores live in a notebook. Student Padel Ireland gives organisers a scoring flow and players a live phone view so the next court call is obvious.',
      },
      {
        type: 'h2',
        text: 'For players',
      },
      {
        type: 'ul',
        items: [
          'Open your tournament’s live page on your phone',
          'See scheduled, called, and live matches',
          'Follow set scores as the organiser updates them',
        ],
      },
      {
        type: 'h2',
        text: 'For organisers and venues',
      },
      {
        type: 'p',
        text: 'Organisers enter results as matches finish. A dedicated display route can drive a TV at the venue so spectators and waiting pairs see the board without crowding the desk.',
      },
      {
        type: 'cta',
        text: 'Find a live or upcoming event.',
        to: '/tournaments',
        label: 'View tournaments',
      },
    ],
  },
  {
    slug: 'find-a-padel-partner-at-college',
    title: 'How to find a padel partner at college in Ireland',
    description:
      'Practical ways Irish students find doubles partners for padel - campus clubs, invite codes, and Student Padel Ireland events.',
    publishedAt: '2026-10-11',
    tags: ['beginners', 'doubles'],
    readingMinutes: 4,
    body: [
      {
        type: 'p',
        text: 'Most student padel events are doubles, so the partner question comes up fast. You do not need a permanent pair - you need a reliable way to meet people at your level.',
      },
      {
        type: 'h2',
        text: 'Where partners come from',
      },
      {
        type: 'ul',
        items: [
          'Your university padel society or WhatsApp group',
          'Community competitions on Student Padel Ireland',
          'Mixed-level opens where captains can still register early',
          'Classmates who already play tennis or squash',
        ],
      },
      {
        type: 'h2',
        text: 'Using SPI to meet players',
      },
      {
        type: 'p',
        text: 'Join a community group with a code from a friend, play a few logged matches, then enter a tournament together. Rankings and profiles make it easier to see who is active on your campus.',
      },
      {
        type: 'cta',
        text: 'Join the community feed.',
        to: '/community',
        label: 'Open community',
      },
    ],
  },
]

export function getPostBySlug(slug: string): BlogPost | undefined {
  return BLOG_POSTS.find((p) => p.slug === slug)
}

export function getAllPosts(): BlogPost[] {
  return [...BLOG_POSTS].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
}

export function getRelatedPosts(slug: string, limit = 3): BlogPost[] {
  const current = getPostBySlug(slug)
  if (!current) return getAllPosts().slice(0, limit)
  const scored = getAllPosts()
    .filter((p) => p.slug !== slug)
    .map((p) => ({
      post: p,
      score: p.tags.filter((t) => current.tags.includes(t)).length,
    }))
    .sort((a, b) => b.score - a.score || b.post.publishedAt.localeCompare(a.post.publishedAt))
  return scored.slice(0, limit).map((s) => s.post)
}
