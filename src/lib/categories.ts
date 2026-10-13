export interface Category {
  id: string;
  label: string;
  emoji: string;
  keywords: string[];
}

export const CATEGORIES: Category[] = [
  {
    id: 'groceries',
    label: 'Groceries',
    emoji: '🛒',
    keywords: [
      'tesco', 'sainsbury', 'asda', 'aldi', 'lidl', 'waitrose', 'morrisons', 'co-op', 'coop', 'ocado',
      'm&s food', 'm&s', 'marks & spencer', 'marks and spencer', 'simply food', 'iceland', 'spar', 'budgens',
      'nisa', 'londis', 'one stop', 'costcutter', 'farmfoods', 'whole foods', 'wholefoods', 'planet organic',
      'amazon fresh', 'abel & cole', 'riverford', 'veg box', 'hellofresh', 'hello fresh', 'gousto',
      'mindful chef', 'getir', 'zapp', 'grocer', 'greengrocer', 'supermarket', 'food shop', 'big shop',
      'top up shop', 'groceries', 'mercadona', 'carrefour', 'milk', 'bread', 'eggs', 'cheese', 'veg',
      'vegetables', 'fruit', 'butcher', 'fishmonger', 'bakery', 'deli', 'gail', 'corner shop', 'market',
    ],
  },
  {
    id: 'eating-out',
    label: 'Eating out',
    emoji: '🍽️',
    keywords: [
      'restaurant', 'cafe', 'café', 'coffee', 'pret', 'pret a manger', 'costa', 'starbucks', 'caffe nero',
      'nero', 'gregg', 'leon', 'itsu', 'wasabi', 'yo sushi', 'nando', 'mcdonald', 'kfc', 'five guys',
      'honest burger', 'pizza express', 'franco manca', 'zizzi', 'prezzo', 'wagamama', 'dishoom', 'hawksmoor',
      'flat iron', 'padella', 'ottolenghi', 'wetherspoon', 'spoons', 'brewdog', 'deliveroo', 'uber eats',
      'just eat', 'takeaway', 'pizza', 'sushi', 'ramen', 'burger', 'curry', 'kebab', 'tacos', 'dim sum',
      'chippy', 'fish and chips', 'pub', 'bar', 'drinks', 'drink', 'pint', 'lunch', 'dinner', 'brunch',
      'breakfast', 'meal', 'wine', 'beer', 'cocktail', 'tapas', 'ice cream', 'gelato', 'croissant', 'pastry',
    ],
  },
  {
    id: 'mortgage',
    label: 'Mortgage & rent',
    emoji: '🏠',
    keywords: ['mortgage', 'rent', 'landlord', 'letting agent', 'service charge', 'ground rent'],
  },
  {
    id: 'bills',
    label: 'Bills',
    emoji: '💡',
    keywords: [
      'electric', 'electricity', 'gas', 'energy', 'water', 'sewerage', 'council tax', 'council', 'internet',
      'broadband', 'fibre', 'wifi', 'wi-fi', 'phone bill', 'phone contract', 'mobile', 'sim only', 'octopus',
      'british gas', 'edf', 'eon', 'e.on', 'eon next', 'ovo', 'scottish power', 'sse', 'shell energy',
      'utility warehouse', 'thames water', 'anglian water', 'severn trent', 'united utilities', 'yorkshire water',
      'southern water', 'affinity water', 'bt', 'virgin media', 'sky', 'hyperoptic', 'community fibre',
      'plusnet', 'talktalk', 'vodafone', 'ee', 'o2', 'three mobile', 'giffgaff', 'voxi', 'smarty', 'lebara',
      'id mobile', 'insurance', 'home insurance', 'contents insurance', 'life insurance', 'boiler cover',
      'tv licence', 'tv license', 'licence fee', 'bill', 'utilities',
    ],
  },
  {
    id: 'transport',
    label: 'Transport',
    emoji: '🚇',
    keywords: [
      'tfl', 'oyster', 'tube', 'overground', 'elizabeth line', 'dlr', 'uber', 'bolt', 'freenow', 'free now',
      'addison lee', 'taxi', 'cab', 'train', 'trains', 'trainline', 'national rail', 'railcard', 'lner', 'gwr',
      'avanti', 'thameslink', 'southeastern', 'bus', 'coach', 'national express', 'megabus', 'flixbus',
      'petrol', 'fuel', 'diesel', 'esso', 'bp', 'shell', 'texaco', 'ev charging', 'charging', 'parking',
      'car park', 'ringgo', 'paybyphone', 'congestion', 'ulez', 'toll', 'dart charge', 'car wash', 'mot',
      'car service', 'tyres', 'car tax', 'road tax', 'dvla', 'lime', 'bike', 'santander cycles', 'voi',
      'scooter',
    ],
  },
  {
    id: 'travel',
    label: 'Travel',
    emoji: '✈️',
    keywords: [
      'flight', 'flights', 'hotel', 'airbnb', 'vrbo', 'booking.com', 'expedia', 'hotels.com', 'lastminute',
      'tui', 'jet2', 'jet2holidays', 'premier inn', 'travelodge', 'holiday inn', 'hilton', 'marriott', 'ibis',
      'hostel', 'b&b', 'bed and breakfast', 'ryanair', 'easyjet', 'vueling', 'iberia', 'british airways', 'klm',
      'air france', 'lufthansa', 'wizz', 'wizz air', 'aer lingus', 'emirates', 'eurostar', 'eurotunnel',
      'ferry', 'renfe', 'sncf', 'ouigo', 'trenitalia', 'interrail', 'holiday', 'trip', 'luggage', 'airport',
      'airport parking', 'duty free', 'visa', 'esta', 'esim', 'travel money', 'car hire', 'hire car',
      'rental car', 'car rental', 'travel insurance',
    ],
  },
  {
    id: 'entertainment',
    label: 'Entertainment',
    emoji: '🎬',
    keywords: [
      'netflix', 'spotify', 'apple music', 'disney', 'prime video', 'apple tv', 'now tv', 'paramount', 'youtube',
      'audible', 'kindle', 'cinema', 'odeon', 'vue', 'cineworld', 'curzon', 'everyman', 'picturehouse', 'imax',
      'theatre', 'west end', 'musical', 'comedy', 'concert', 'gig', 'festival', 'tickets', 'ticketmaster',
      'dice', 'see tickets', 'eventbrite', 'o2 arena', 'museum', 'gallery', 'exhibition', 'zoo', 'aquarium',
      'national trust', 'english heritage', 'game', 'games', 'xbox', 'playstation', 'nintendo', 'steam',
      'bowling', 'karaoke', 'escape room', 'mini golf', 'minigolf', 'golf', 'darts', 'subscription', 'books',
      'book', 'waterstones', 'magazine', 'newspaper',
    ],
  },
  {
    id: 'home',
    label: 'Home',
    emoji: '🛋️',
    keywords: [
      'ikea', 'furniture', 'john lewis', 'jl', 'habitat', 'wayfair', 'dunelm', 'the range', 'robert dyas',
      'homesense', 'muji', 'argos', 'b&q', 'b and q', 'homebase', 'wickes', 'screwfix', 'toolstation', 'diy',
      'hardware', 'paint', 'plants', 'garden', 'sofa', 'bed', 'mattress', 'duvet', 'pillow', 'sheets', 'bedding',
      'towels', 'curtains', 'blinds', 'lamp', 'light bulb', 'candles', 'kettle', 'toaster', 'hoover', 'vacuum',
      'dyson', 'washing machine', 'dishwasher', 'fridge', 'appliance', 'cleaning', 'cleaner', 'window cleaner',
      'bin bags', 'laundry', 'dry cleaning', 'repair', 'plumber', 'electrician', 'handyman', 'locksmith',
      'gardener', 'toilet roll',
    ],
  },
  {
    id: 'shopping',
    label: 'Shopping',
    emoji: '🛍️',
    keywords: [
      'amazon', 'ebay', 'etsy', 'vinted', 'depop', 'clothes', 'clothing', 'zara', 'uniqlo', 'h&m', 'cos', 'arket',
      'mango', 'primark', 'tk maxx', 'asos', 'boden', 'selfridges', 'liberty', 'jd sports', 'sports direct',
      'nike', 'adidas', 'decathlon', 'currys', 'apple store', 'shoes', 'trainers', 'jumper', 'jacket', 'coat',
      'dress', 'jeans', 'shopping',
    ],
  },
  {
    id: 'health',
    label: 'Health',
    emoji: '💊',
    keywords: [
      'pharmacy', 'chemist', 'boots', 'superdrug', 'prescription', 'medicine', 'vitamins', 'doctor', 'gp',
      'dentist', 'optician', 'specsavers', 'glasses', 'contact lenses', 'physio', 'clinic', 'hospital', 'gym',
      'puregym', 'pure gym', 'the gym group', 'david lloyd', 'virgin active', 'nuffield', 'third space',
      'classpass', 'yoga', 'pilates', 'swimming', 'spa', 'massage', 'haircut', 'hairdresser', 'barber', 'salon',
      'nails',
    ],
  },
  {
    id: 'gifts',
    label: 'Gifts',
    emoji: '🎁',
    keywords: [
      'gift', 'present', 'birthday', 'wedding', 'anniversary', 'christmas', 'secret santa', 'valentine',
      'mothers day', 'fathers day', 'flowers', 'bloom & wild', 'bloom and wild', 'interflora', 'moonpig',
      'funky pigeon', 'hamper', 'card for', 'donation', 'charity',
    ],
  },
  { id: 'other', label: 'Other', emoji: '📦', keywords: [] },
];

export const categoryById = (id: string): Category =>
  CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[CATEGORIES.length - 1];

export const normaliseDescription = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Text for keyword matching: lower case, apostrophes dropped (so "Sainsbury’s", "Sainsbury's" and
 * "Sainsburys" all read "sainsburys") and other punctuation, apart from & . and -, read as spaces.
 */
export const searchText = (s: string) =>
  s
    .toLowerCase()
    .replace(/['’‘`]/g, '')
    .replace(/[^\p{L}\p{N}&.\-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const reCache = new Map<string, RegExp>();
/**
 * Does `phrase` appear in `text` (both from searchText) as whole words? A plural or possessive "s"
 * or "es" on the end still counts: "flights" for "flight", "nandos" for "nando".
 */
export function hasPhrase(text: string, phrase: string): boolean {
  let re = reCache.get(phrase);
  if (!re) {
    re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(phrase)}(s|es)?($|[^\\p{L}\\p{N}])`, 'u');
    reCache.set(phrase, re);
  }
  return re.test(text);
}

/** The longest phrase from `phrases` found in `text`, with its value. */
export function longestMatch<T>(text: string, phrases: Iterable<[string, T]>): T | null {
  let best: { value: T; len: number } | null = null;
  for (const [phrase, value] of phrases) {
    if (phrase && (!best || phrase.length > best.len) && hasPhrase(text, phrase)) best = { value, len: phrase.length };
  }
  return best?.value ?? null;
}

const KEYWORDS: [string, string][] = CATEGORIES.flatMap((c) => c.keywords.map((k) => [searchText(k), c.id] as [string, string]));

/**
 * Guess a category from a description:
 * 1. a category you picked before for exactly this description;
 * 2. one you picked for a shorter description it contains ("JL" → Home also covers "JL sheets");
 * 3. the built-in keywords. The longest match wins, so "Uber Eats" is Eating out, not Transport.
 */
export function guessCategory(description: string, rules: Record<string, string> = {}): string | null {
  const norm = normaliseDescription(description);
  if (!norm) return null;
  if (rules[norm]) return rules[norm];

  const text = searchText(description);
  const learned = Object.entries(rules).map(([k, v]) => [searchText(k), v] as [string, string]);
  const fromRule = longestMatch(
    text,
    learned.filter(([k]) => k.length >= 2),
  );
  if (fromRule && categoryById(fromRule).id === fromRule) return fromRule;
  return longestMatch(text, KEYWORDS);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Rules to store when the user overrides the category for a description. */
export function learnRule(description: string, category: string): Record<string, string> {
  const norm = normaliseDescription(description);
  if (!norm) return {};
  return { [norm]: category };
}
