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
      'm&s food', 'm&s', 'iceland', 'grocer', 'supermarket', 'food shop', 'big shop', 'groceries', 'mercadona',
      'carrefour', 'milk', 'bread', 'veg', 'fruit', 'butcher', 'bakery', 'deli', 'wholefoods', 'gail',
    ],
  },
  {
    id: 'eating-out',
    label: 'Eating out',
    emoji: '🍽️',
    keywords: [
      'restaurant', 'cafe', 'café', 'coffee', 'pret', 'costa', 'starbucks', 'nando', 'deliveroo',
      'uber eats', 'just eat', 'takeaway', 'pizza', 'sushi', 'ramen', 'burger', 'pub', 'bar ', 'drinks',
      'lunch', 'dinner', 'brunch', 'breakfast', 'wagamama', 'dishoom', 'wine', 'beer', 'cocktail', 'tapas',
    ],
  },
  {
    id: 'mortgage',
    label: 'Mortgage & rent',
    emoji: '🏠',
    keywords: ['mortgage', 'rent', 'landlord', 'service charge', 'ground rent'],
  },
  {
    id: 'bills',
    label: 'Bills',
    emoji: '💡',
    keywords: [
      'electric', 'electricity', 'gas', 'water', 'council tax', 'internet', 'broadband', 'wifi', 'wi-fi',
      'phone bill', 'mobile', 'energy', 'octopus', 'british gas', 'edf', 'eon', 'ovo', 'thames water',
      'bt ', 'virgin media', 'sky', 'hyperoptic', 'insurance', 'tv licence', 'bill', 'utilities',
    ],
  },
  {
    id: 'transport',
    label: 'Transport',
    emoji: '🚇',
    keywords: [
      'tfl', 'oyster', 'uber', 'bolt', 'taxi', 'cab', 'train', 'trainline', 'railcard', 'bus', 'tube',
      'petrol', 'fuel', 'diesel', 'parking', 'congestion', 'ulez', 'car wash', 'mot', 'lime', 'bike',
    ],
  },
  {
    id: 'travel',
    label: 'Travel',
    emoji: '✈️',
    keywords: [
      'flight', 'flights', 'hotel', 'airbnb', 'booking.com', 'ryanair', 'easyjet', 'vueling', 'iberia',
      'british airways', 'jet2', 'eurostar', 'holiday', 'trip', 'hostel', 'luggage', 'airport', 'visa',
      'car hire', 'rental car', 'travel insurance',
    ],
  },
  {
    id: 'entertainment',
    label: 'Entertainment',
    emoji: '🎬',
    keywords: [
      'netflix', 'spotify', 'disney', 'prime video', 'apple tv', 'youtube', 'cinema', 'odeon', 'vue',
      'theatre', 'concert', 'gig', 'tickets', 'ticketmaster', 'museum', 'exhibition', 'game', 'bowling',
      'festival', 'subscription', 'books', 'kindle', 'audible',
    ],
  },
  {
    id: 'home',
    label: 'Home',
    emoji: '🛋️',
    keywords: [
      'ikea', 'furniture', 'cleaning', 'cleaner', 'argos', 'b&q', 'homebase', 'diy', 'hardware', 'plants',
      'garden', 'dunelm', 'john lewis', 'appliance', 'repair', 'plumber', 'electrician', 'toilet roll',
    ],
  },
  {
    id: 'shopping',
    label: 'Shopping',
    emoji: '🛍️',
    keywords: ['amazon', 'clothes', 'zara', 'uniqlo', 'h&m', 'cos', 'asos', 'shoes', 'ebay', 'vinted', 'shopping'],
  },
  {
    id: 'health',
    label: 'Health',
    emoji: '💊',
    keywords: ['pharmacy', 'boots', 'superdrug', 'gym', 'doctor', 'dentist', 'optician', 'physio', 'prescription', 'yoga', 'pilates'],
  },
  {
    id: 'gifts',
    label: 'Gifts',
    emoji: '🎁',
    keywords: ['gift', 'present', 'birthday', 'wedding', 'christmas', 'flowers', 'card for'],
  },
  { id: 'other', label: 'Other', emoji: '📦', keywords: [] },
];

export const categoryById = (id: string): Category =>
  CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[CATEGORIES.length - 1];

export const normaliseDescription = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Guess a category from a description. A learned rule for the exact description
 * wins over the built-in keyword list.
 */
export function guessCategory(description: string, rules: Record<string, string> = {}): string | null {
  const norm = normaliseDescription(description);
  if (!norm) return null;
  if (rules[norm]) return rules[norm];

  let best: { id: string; len: number } | null = null;
  for (const c of CATEGORIES) {
    for (const k of c.keywords) {
      const hit = new RegExp(`(^|[^a-z])${escapeRe(k.trim())}(s|es)?($|[^a-z])`).test(norm);
      if (hit && (!best || k.length > best.len)) best = { id: c.id, len: k.length };
    }
  }
  return best?.id ?? null;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Rules to store when the user overrides the category for a description. */
export function learnRule(description: string, category: string): Record<string, string> {
  const norm = normaliseDescription(description);
  if (!norm) return {};
  return { [norm]: category };
}
