// Every headline the market can print. Edit freely: add lines, change wording,
// delete ones you don't like. The engine picks from these at random.
//
// GOALS      announced ahead of time with a deadline. win / lose / mixed are the outcome headlines.
//            The first goals in each list are the original ones, so goals that were already
//            running when the new engine went live still find their headlines. Add new ones at the end.
// GOOD / BAD surprise news with no warning. The price moves the moment it lands.
// RUMORS     unconfirmed whispers. up = good rumor, down = bad rumor.
//            Each has the rumor itself, the headline if it turns out true, and the one if it's denied.
// MARKET     news that hits every company at once (dir: 1 good, -1 bad).
// CROSSOVER  two companies in the same story. a/b are tickers, moveA/moveB are 1 (up) or -1 (down).

const GOALS = {
  RRM: [
    { goal: 'Render Room aims to hit a new member record.', win: 'Render Room smashes its member record!', lose: 'Render Room falls short of its member record.', mixed: 'Render Room ties its member record. Nobody is sure how to feel.' },
    { goal: 'Render Room promises a server-wide event with zero outages.', win: 'Render Room event goes off without a hitch!', lose: 'Render Room event crashes halfway through.', mixed: 'Render Room event survives, with one brief outage everyone pretends not to notice.' },
    { goal: 'Render Room plans to launch a new season on schedule.', win: 'New season launches right on time!', lose: 'New season delayed. Again.', mixed: 'New season launches on time, with half the features missing.' },
    { goal: 'Render Room is cleaning out its dead channels.', win: 'Render Room channel cleanup goes smoothly. It feels roomier already.', lose: 'Render Room deletes the wrong channel. Members mourn #general-2.', mixed: 'Render Room cleans up most channels. A few refuse to die.' },
    { goal: 'Render Room is promising a mod team with no drama for a full day.', win: 'Twenty-four hours, zero mod drama. Render Room calls it a miracle.', lose: 'Render Room mod drama breaks out before lunch.', mixed: 'Render Room reports "only a little" mod drama.' }
  ],
  NACH: [
    { goal: 'De Nacho is opening three new nacho stands.', win: 'De Nacho opens three stands, lines around the block!', lose: 'De Nacho stands fail their health inspection.', mixed: 'De Nacho opens two of its three stands. The third is "a vibe."' },
    { goal: "De Nacho attempts the world's largest nacho.", win: "De Nacho builds the world's largest nacho!", lose: "World's largest nacho collapses under its own cheese.", mixed: "De Nacho builds the world's second-largest nacho." },
    { goal: 'De Nacho vows to survive the cheese shortage.', win: 'De Nacho secures a secret cheese supply!', lose: 'Cheese shortage hits De Nacho hard.', mixed: 'De Nacho survives the cheese shortage on mostly-cheese.' },
    { goal: 'De Nacho is launching a spicy new salsa.', win: 'New De Nacho salsa is a hit. Customers report seeing colors.', lose: 'New De Nacho salsa recalled for being "legally a weapon."', mixed: 'New De Nacho salsa splits the room. Half love it, half are still crying.' },
    { goal: 'De Nacho promises delivery in under 30 minutes.', win: 'De Nacho delivers in 29 minutes flat!', lose: 'De Nacho delivery arrives three hours late and cold.', mixed: 'De Nacho delivers on time. The chips, sadly, did not survive.' }
  ],
  BLU: [
    { goal: "Builder's League United starts work on a community megabuild.", win: 'BLU finishes the megabuild, and it is magnificent!', lose: 'BLU megabuild abandoned after a dispute over the roof.', mixed: 'BLU finishes the megabuild. The roof is still being argued about.' },
    { goal: "Builder's League United tries to agree on a single blueprint.", win: 'BLU agrees on a blueprint. Historians stunned.', lose: 'BLU blueprint talks end in shouting.', mixed: 'BLU agrees on two blueprints. Progress, technically.' },
    { goal: "Builder's League United pledges to fix the old bridge.", win: 'BLU fixes the bridge. It holds!', lose: 'BLU bridge repair somehow makes the bridge worse.', mixed: 'BLU fixes the bridge. It holds, mostly, if you walk softly.' },
    { goal: "Builder's League United is entering a building competition.", win: 'BLU takes first place in the building competition!', lose: 'BLU disqualified for building outside the plot.', mixed: 'BLU places third. Everyone gets a participation trophy.' },
    { goal: "Builder's League United will finally finish the spawn redesign.", win: 'BLU unveils the new spawn. Members gasp.', lose: 'BLU spawn redesign scrapped. The old spawn remains, smug.', mixed: 'BLU unveils half a spawn. The other half is "coming soon."' }
  ],
  BNW: [
    { goal: 'Business Numbers Working sets out to make the numbers work.', win: 'BNW confirms: the numbers are working!', lose: 'BNW admits the numbers are not working.', mixed: 'BNW says the numbers are "working-adjacent."' },
    { goal: 'Business Numbers Working promises a quarterly report on time.', win: 'BNW publishes its report, and it adds up!', lose: 'BNW report missing several pages and most of the numbers.', mixed: 'BNW report arrives on time. It is one page long.' },
    { goal: 'Business Numbers Working is hiring a real accountant.', win: 'BNW hires an accountant, investors relieved!', lose: 'BNW accountant quits on day one.', mixed: 'BNW hires an accountant. He is also the CEO\'s cousin.' },
    { goal: 'Business Numbers Working is moving its books off a single spreadsheet.', win: 'BNW moves to real accounting software. The spreadsheet is laid to rest.', lose: 'BNW migration fails. The spreadsheet is now two spreadsheets.', mixed: 'BNW migrates most of its books. The spreadsheet refuses to die.' },
    { goal: 'Business Numbers Working wants to pass its first audit.', win: 'BNW passes its audit! The auditor needed a lie-down afterward.', lose: 'BNW audit uncovers a column labeled "VIBES."', mixed: 'BNW passes its audit "with notes." Many notes.' }
  ],
  BSTG: [
    { goal: 'Bastardly Glory announces its next game will launch on time.', win: 'Bastardly Glory ships on time! Reviews call it "glorious, somehow."', lose: 'Bastardly Glory delays the game indefinitely. Fans riot in the forums.', mixed: 'Bastardly Glory ships on time, as an early-access beta.' },
    { goal: 'Bastardly Glory promises a launch day with zero server crashes.', win: 'Launch day servers hold! Bastardly Glory players are actually playing!', lose: 'Bastardly Glory servers melt on launch day. Queue times reach eleven hours.', mixed: 'Bastardly Glory servers hold, if you live in exactly one region.' },
    { goal: 'Bastardly Glory teases a sequel nobody asked for.', win: 'The sequel nobody asked for is a smash hit!', lose: 'The sequel nobody asked for is exactly what everybody feared.', mixed: 'The sequel nobody asked for is fine. Just fine.' },
    { goal: 'Bastardly Glory enters crunch to finish the big update.', win: 'Bastardly Glory big update lands, and it fixes everything!', lose: 'Bastardly Glory update deletes everyone\'s save files.', mixed: 'Bastardly Glory update fixes ten bugs and adds eleven.' },
    { goal: 'Bastardly Glory is chasing a perfect review score.', win: 'Bastardly Glory scores a perfect 10. Critics weeping.', lose: 'Bastardly Glory review score leaks: 2 out of 10.', mixed: 'Bastardly Glory scores a 7. "Glorious in places."' },
    { goal: 'Bastardly Glory is running a public playtest this weekend.', win: 'Bastardly Glory playtest goes viral. Wishlists explode!', lose: 'Bastardly Glory playtest leaks every unfinished asset.', mixed: 'Bastardly Glory playtest goes okay. The streamers were polite.' },
    { goal: 'Bastardly Glory is showing a trailer at the big games showcase.', win: 'Bastardly Glory trailer steals the showcase!', lose: 'Bastardly Glory trailer turns out to be pre-rendered. Fans notice immediately.', mixed: 'Bastardly Glory trailer airs between two bigger announcements. Polite applause.' }
  ]
};

const GOOD = {
  RRM: [
    'Render Room trends on the front page of the server list!',
    'A famous streamer joins Render Room and says hi in #general.',
    'Render Room members throw a surprise birthday party for the server.',
    'Render Room boost count hits a new high overnight.',
    'Render Room memes channel produces an all-time classic.'
  ],
  NACH: [
    'De Nacho nachos go viral after a celebrity is spotted eating one.',
    'De Nacho wins "Best Snack" at the regional food awards!',
    'De Nacho finds a supplier with impossibly cheap cheese.',
    'De Nacho catering saves a wedding. The couple names a dog after them.',
    'Food critic calls De Nacho "the nacho of the decade."'
  ],
  BLU: [
    "BLU build featured in a magazine. They framed the page.",
    'BLU signs a contract to build a whole new district.',
    'BLU members finish a project ahead of schedule. Nobody knows how.',
    'A rival guild merges into BLU, bringing their best builders.',
    'BLU discovers a building technique that saves half the materials.'
  ],
  BNW: [
    'BNW finds money it forgot it had.',
    'BNW calculator upgrade boosts productivity by 400%.',
    'BNW lands a client that pays on time.',
    'BNW spreadsheet goes a whole day without a #REF! error.',
    'BNW quarterly numbers come in suspiciously strong.'
  ],
  BSTG: [
    'Bastardly Glory game goes viral thanks to a bug that turned out to be fun.',
    'Bastardly Glory announces a surprise free weekend. Servers fill instantly.',
    'Bastardly Glory speedrun community breaks a world record live.',
    'Bastardly Glory signs a publishing deal with a big studio.',
    'Bastardly Glory mascot becomes an internet meme overnight.',
    'Bastardly Glory DLC sells out its collector\'s edition in minutes.'
  ]
};

const BAD = {
  RRM: [
    'Render Room bot goes down for an hour. Chaos in every channel.',
    'Render Room hit by a raid of spam bots.',
    'Render Room members discover the cat in #pets was a stock photo.',
    'Render Room loses its best emoji to an accidental deletion.',
    'Render Room roles reset by mistake. Everyone is "@everyone" now.'
  ],
  NACH: [
    'De Nacho fryer catches fire. Nobody hurt, many chips lost.',
    'De Nacho accused of using store-bought salsa.',
    'Jalapeño prices spike. De Nacho margins melt.',
    'De Nacho mascot costume seen sleeping on the job.',
    'De Nacho stand flooded by a cheese-pipe burst.'
  ],
  BLU: [
    'BLU tower collapses. Everyone blames the intern.',
    'BLU builders go on strike over the snack budget.',
    'BLU accidentally builds a house inside another house.',
    'BLU loses a week of progress to a rollback.',
    'A creeper gets into the BLU warehouse.'
  ],
  BNW: [
    'BNW spreadsheet crashes. No backups.',
    'BNW caught rounding everything to the nearest ten.',
    'BNW office printer achieves sentience and refuses to print.',
    'BNW CFO admits he "doesn\'t really do decimals."',
    'BNW quarterly report contains the word "oops" eleven times.'
  ],
  BSTG: [
    'Bastardly Glory pushes a patch that makes the main character walk backwards.',
    'Bastardly Glory lead designer quits to open a bakery.',
    'Bastardly Glory caught reusing assets from its last game. Again.',
    'Bastardly Glory community manager posts the wrong tweet from the official account.',
    'Bastardly Glory servers go down during the big sale.',
    'Bastardly Glory game review-bombed over a hat cosmetic.'
  ]
};

const RUMORS = {
  RRM: {
    up: [
      ['Whispers say Render Room is about to announce a huge partnership.', 'Confirmed: Render Room partners up!', 'Render Room denies the partnership rumor.'],
      ['Insiders hint Render Room is getting a brand new feature.', 'Confirmed: Render Room rolls out the new feature!', 'Render Room says there is no new feature. "Stop asking."']
    ],
    down: [
      ['Rumor: a Render Room mod is about to quit in protest.', 'Confirmed: the Render Room mod walks out.', 'Render Room mod says they are "literally not going anywhere."'],
      ['Rumor: Render Room is quietly losing members.', 'Confirmed: Render Room member count dips.', 'Render Room member count is fine, says Render Room.']
    ]
  },
  NACH: {
    up: [
      ['Insiders say De Nacho is close to a deal with a major cinema chain.', 'Confirmed: De Nacho nachos coming to cinemas!', 'Cinema chain says it has "never heard of De Nacho."'],
      ['Rumor: De Nacho has a secret new chip recipe.', 'Confirmed: De Nacho reveals the new chip!', 'De Nacho says the chip is the same chip.']
    ],
    down: [
      ['Rumor: a health inspector has De Nacho on a list.', 'Confirmed: De Nacho gets a surprise inspection. It goes badly.', 'Inspector visits De Nacho, leaves with a free plate.'],
      ['Whispers of a cheese supplier dispute at De Nacho.', 'Confirmed: De Nacho loses its cheese supplier.', 'De Nacho and its cheese supplier "have never been closer."']
    ]
  },
  BLU: {
    up: [
      ['Rumor: BLU is bidding on the biggest contract in server history.', 'Confirmed: BLU wins the contract!', 'BLU loses the bid to "some guy with a shovel."'],
      ['Whispers say BLU is about to recruit a legendary builder.', 'Confirmed: the legend joins BLU!', 'The legendary builder says he just "came by for snacks."']
    ],
    down: [
      ['Rumor: BLU leadership is split on the next project.', 'Confirmed: BLU leadership splits into two camps.', 'BLU leaders pose for a photo, holding hands.'],
      ['Rumor: a BLU build has a structural flaw.', 'Confirmed: the BLU build is leaning.', 'BLU says the lean is "an artistic choice."']
    ]
  },
  BNW: {
    up: [
      ['Rumor: BNW is about to be bought by a bigger company.', 'Confirmed: BNW gets a buyout offer!', 'Bigger company says it would "rather not."'],
      ['Whispers say BNW numbers are better than they look.', 'Confirmed: BNW numbers are better than they look!', 'BNW numbers are exactly as bad as they look.']
    ],
    down: [
      ['Rumor: BNW is being investigated for creative math.', 'Confirmed: BNW under investigation.', 'Investigators find BNW math "unusual but legal."'],
      ['Whispers say BNW lost a key client.', 'Confirmed: BNW client walks.', 'BNW client says they are "staying, for now."']
    ]
  },
  BSTG: {
    up: [
      ['Leakers say Bastardly Glory has a secret game in development.', 'Confirmed: Bastardly Glory reveals the secret game!', 'Bastardly Glory says the "secret game" was a placeholder file.'],
      ['Rumor: Bastardly Glory is getting a movie adaptation.', 'Confirmed: Bastardly Glory movie is happening!', 'Bastardly Glory movie rumor was a fan edit.']
    ],
    down: [
      ['Rumor: Bastardly Glory is about to delay its next game.', 'Confirmed: Bastardly Glory delays the game.', 'Bastardly Glory insists the game is "on track, probably."'],
      ['Whispers of layoffs at Bastardly Glory.', 'Confirmed: Bastardly Glory cuts staff.', 'Bastardly Glory says everyone is "still here, in spirit and in person."']
    ]
  }
};

const MARKET = [
  { dir: 1, headline: 'Polygon confidence surges. Buyers flood the whole market!' },
  { dir: 1, headline: 'Render Room economy report comes in strong. Every stock gets a lift.' },
  { dir: 1, headline: 'Holiday cheer sweeps the market. Everyone is feeling generous.' },
  { dir: -1, headline: 'Polygon inflation scare spooks the whole market.' },
  { dir: -1, headline: 'Server-wide outage rattles investors. Everything dips.' },
  { dir: -1, headline: 'TODD says something ominous in the logs. The market gets nervous.' },
  { dir: -1, headline: 'Panic selling spreads after a typo in a market report.' }
];

const CROSSOVER = [
  { a: 'NACH', b: 'BLU', moveA: 1, moveB: 1, headline: "De Nacho caters the BLU megabuild. Builders work twice as fast on nachos." },
  { a: 'BSTG', b: 'RRM', moveA: 1, moveB: -1, headline: 'Bastardly Glory poaches three Render Room moderators.' },
  { a: 'BNW', b: 'BSTG', moveA: 1, moveB: 1, headline: 'BNW takes over Bastardly Glory\'s books. Both sides somehow better off.' },
  { a: 'BLU', b: 'RRM', moveA: 1, moveB: 1, headline: 'BLU builds Render Room a new hangout channel. Members love it.' },
  { a: 'NACH', b: 'BNW', moveA: -1, moveB: -1, headline: 'BNW audits De Nacho. Both companies emerge embarrassed.' },
  { a: 'BSTG', b: 'NACH', moveA: 1, moveB: 1, headline: 'Bastardly Glory adds a De Nacho stand to its game. Fans hungry, literally.' },
  { a: 'BLU', b: 'BSTG', moveA: 1, moveB: -1, headline: 'BLU builders mod Bastardly Glory\'s game into something better than the original.' }
];


// THE CRASH  headlines for the scheduled crash (see CRASH in engine.js).
//   tremor: the build-up · start: the moment it hits · during: every few hours while it lasts
//   panic: one company gets dumped ({n} = company name) · halt: circuit breaker ({p} = average drop)
//   end: the selling stops · over: recovery is finished
const CRASH = {
  tremor: [
    'Something is wrong. Sell orders are piling up across the whole board and nobody can say why.',
    'Traders report a "weird feeling" about the market. The tickers are flickering.',
    'TODD posts a single line in the logs: "it is coming." Nobody knows what "it" is.'
  ],
  start: [
    'THE MARKET IS CRASHING. Every stock on the board is in freefall.',
    'BLACK MONDAY COMES EARLY. Panic selling rips through every company at once.',
    'Polygon confidence collapses. The whole market is going down with it.'
  ],
  during: [
    'Selling accelerates. Brokers are seen crying into their keyboards.',
    'The floor gives way again. Analysts stop answering their phones.',
    'Rend-Conomy loses another chunk of its value. "Buy the dip," says someone, still at the top of the dip.',
    'TODD offers comment on the crash: "ha." Markets fall further.',
    'Margin calls everywhere. Portfolios melt like cheap nacho cheese.',
    'Experts insist this is the bottom. It is not the bottom.',
    'A rumor of rescue lifts hopes for four minutes. Then it is gone.',
    'The board flashes red from top to bottom. Investors are told to "stay calm" by a man who is not calm.'
  ],
  panic: [
    'Panic selling hits {n}. Shareholders run for the exits.',
    '{n} shares get dumped in a single brutal minute.',
    'Someone sold a mountain of {n} stock all at once. Nobody knows who.',
    '{n} plunges as investors give up on it.'
  ],
  halt: [
    'CIRCUIT BREAKER TRIPPED. The board fell {p}% in an hour. Trading is frozen.',
    'Trading halted after a {p}% plunge in one hour. Everyone take a breath.',
    'The market slams the brakes: {p}% gone in an hour. Halted.'
  ],
  end: [
    'The selling finally stops. Survivors climb out of the rubble.',
    'The crash is over. Nobody is sure what is left standing.',
    'Quiet returns to the market. It is the quiet after a bomb goes off.'
  ],
  over: [
    'The market has found its feet again. Mostly. Some of it.',
    'Crash recovery complete. The scars remain.'
  ]
};

// BANKRUPTCY  {n} = company name.
//   brink: falls under 1.50 · enter: drops under 0 · appeal / appealAgain: files for a TODD bailout
//   approved / denied: TODD's verdict · hope / doom: news while bankrupt · swim: climbs out on its own
const BANKRUPT = {
  brink: [
    '{n} is on the brink. One more bad day and it goes under.',
    'Creditors circle {n}. The stock is worth almost nothing.',
    '{n} insists everything is fine. The stock suggests otherwise.'
  ],
  enter: [
    '{n} HAS GONE BANKRUPT. Every share is now worthless, and gone.',
    '{n} files for bankruptcy. Shareholders lose everything.',
    'IT IS OVER FOR {n}. The company hits zero and takes every share with it.'
  ],
  appeal: [
    '{n} begs TODD for a bailout. TODD is "reviewing the request."',
    '{n} files for a TODD bailout. The fate of the company is in a computer\'s hands.',
    '{n} crawls to TODD, hat in hand, asking for a rescue.'
  ],
  appealAgain: [
    '{n} appeals to TODD again. Desperation levels: rising.',
    '{n} sends TODD another bailout request, this time with a sad face emoji.',
    '{n} tries TODD one more time. TODD sighs audibly.'
  ],
  approved: [
    'TODD APPROVES THE BAILOUT. {n} is back from the dead. TODD will want something in return.',
    'TODD bails out {n}. "you owe me," says TODD.',
    '{n} rescued by TODD at the last second. Trading resumes.'
  ],
  denied: [
    'TODD DENIES {n}\'s bailout. "no," says TODD.',
    'TODD rejects {n}. The company sinks deeper.',
    'TODD reads the {n} appeal, laughs, and deletes it.'
  ],
  hope: [
    '{n} holds a fundraiser. Members chip in a few Polygons.',
    '{n} sells off the office chairs. Every Polygon counts.',
    '{n} lands a tiny contract. It\'s something.',
    '{n} staff work for free this week. The hole gets a little shallower.'
  ],
  doom: [
    '{n} finds another unpaid bill under the couch.',
    '{n} loses its last remaining client.',
    'The lights go out at {n} headquarters. Literally.',
    '{n} creditors seize the coffee machine.'
  ],
  swim: [
    '{n} CLAWS ITS WAY OUT OF BANKRUPTCY. No bailout needed.',
    'Against all odds, {n} is solvent again.',
    '{n} swims back to the surface. Shareholders weep with joy.'
  ]
};

module.exports = { GOALS, GOOD, BAD, RUMORS, MARKET, CROSSOVER, CRASH, BANKRUPT };
