/**
 * A more specific icon for an expense, bill or repeating expense, picked from its description
 * within its category: Thames Water shows 💧 and Octopus ⚡, though both are Bills. Worked out when
 * shown, never stored, so it's the same on both phones and improves for existing entries too.
 * Only the icon changes: the category (and so Spending) stays as it was.
 */
import { categoryById, longestMatch, searchText } from './categories';

const ICONS: Record<string, [string, string[]][]> = {
  bills: [
    ['⚡', ['electric', 'electricity', 'energy', 'octopus', 'edf', 'eon', 'e.on', 'eon next', 'ovo', 'scottish power', 'sse', 'shell energy']],
    ['🔥', ['gas', 'british gas', 'boiler cover']],
    ['💧', ['water', 'sewerage', 'thames water', 'anglian water', 'severn trent', 'united utilities', 'yorkshire water', 'southern water', 'affinity water']],
    ['🏛️', ['council tax', 'council']],
    ['📶', ['wifi', 'wi-fi', 'internet', 'broadband', 'fibre', 'bt', 'virgin media', 'hyperoptic', 'community fibre', 'plusnet', 'talktalk']],
    ['📱', ['mobile', 'phone bill', 'phone contract', 'phone', 'sim only', 'vodafone', 'ee', 'o2', 'three mobile', 'giffgaff', 'voxi', 'smarty', 'lebara', 'id mobile']],
    ['📺', ['tv licence', 'tv license', 'licence fee', 'sky', 'sky tv']],
    ['🛡️', ['insurance', 'home insurance', 'contents insurance', 'life insurance']],
  ],
  home: [
    ['🧹', ['cleaner', 'cleaning', 'window cleaner', 'laundry', 'dry cleaning', 'hoover', 'vacuum', 'bin bags']],
    ['🔧', ['repair', 'plumber', 'electrician', 'handyman', 'locksmith', 'diy', 'hardware', 'b&q', 'b and q', 'wickes', 'screwfix', 'toolstation', 'paint']],
    ['🪴', ['plants', 'garden', 'gardener']],
    ['🛏️', ['bed', 'mattress', 'duvet', 'pillow', 'sheets', 'bedding', 'towels']],
  ],
  transport: [
    ['🚆', ['train', 'trains', 'trainline', 'national rail', 'railcard', 'lner', 'gwr', 'avanti', 'thameslink', 'southeastern', 'overground', 'elizabeth line']],
    ['🚕', ['uber', 'bolt', 'freenow', 'free now', 'addison lee', 'taxi', 'cab']],
    ['⛽', ['petrol', 'fuel', 'diesel', 'esso', 'bp', 'shell', 'texaco']],
    ['🔌', ['ev charging', 'charging']],
    ['🅿️', ['parking', 'car park', 'ringgo', 'paybyphone']],
    ['🚌', ['bus', 'coach', 'national express', 'megabus', 'flixbus']],
    ['🚲', ['bike', 'lime', 'santander cycles', 'scooter', 'voi']],
    ['🚗', ['car wash', 'mot', 'car service', 'tyres', 'car tax', 'road tax', 'dvla', 'congestion', 'ulez', 'toll', 'dart charge']],
  ],
  travel: [
    ['🏨', ['hotel', 'airbnb', 'vrbo', 'booking.com', 'hotels.com', 'premier inn', 'travelodge', 'holiday inn', 'hilton', 'marriott', 'ibis', 'hostel', 'b&b', 'bed and breakfast']],
    ['🚄', ['eurostar', 'renfe', 'sncf', 'ouigo', 'trenitalia', 'interrail']],
    ['⛴️', ['ferry', 'eurotunnel']],
    ['🚗', ['car hire', 'hire car', 'rental car', 'car rental']],
  ],
  'eating-out': [
    ['☕', ['coffee', 'cafe', 'café', 'pret', 'pret a manger', 'costa', 'starbucks', 'caffe nero', 'nero', 'croissant', 'pastry']],
    ['🍺', ['pub', 'bar', 'drinks', 'drink', 'pint', 'beer', 'wine', 'cocktail', 'wetherspoon', 'spoons', 'brewdog']],
    ['🍕', ['pizza', 'pizza express', 'franco manca', 'zizzi', 'prezzo']],
    ['🍔', ['burger', 'five guys', 'honest burger', 'mcdonald', 'kfc']],
    ['🍣', ['sushi', 'yo sushi', 'itsu', 'wasabi']],
    ['🍜', ['ramen', 'wagamama']],
    ['🥡', ['takeaway', 'deliveroo', 'uber eats', 'just eat']],
    ['🍦', ['ice cream', 'gelato']],
  ],
  entertainment: [
    ['📺', ['netflix', 'disney', 'prime video', 'apple tv', 'now tv', 'paramount', 'youtube']],
    ['🎵', ['spotify', 'apple music', 'concert', 'gig', 'festival', 'o2 arena']],
    ['🎭', ['theatre', 'west end', 'musical', 'comedy']],
    ['📚', ['books', 'book', 'kindle', 'audible', 'waterstones', 'magazine', 'newspaper']],
    ['🎮', ['game', 'games', 'xbox', 'playstation', 'nintendo', 'steam']],
    ['🖼️', ['museum', 'gallery', 'exhibition', 'national trust', 'english heritage']],
  ],
  health: [
    ['🏋️', ['gym', 'puregym', 'pure gym', 'the gym group', 'david lloyd', 'virgin active', 'nuffield', 'third space', 'classpass', 'yoga', 'pilates', 'swimming']],
    ['🦷', ['dentist']],
    ['👓', ['optician', 'specsavers', 'glasses', 'contact lenses']],
    ['💇', ['haircut', 'hairdresser', 'barber', 'salon', 'nails']],
  ],
  gifts: [
    ['💐', ['flowers', 'bloom & wild', 'bloom and wild', 'interflora']],
    ['🎂', ['birthday']],
    ['🎄', ['christmas', 'secret santa']],
  ],
  shopping: [
    ['👟', ['shoes', 'trainers', 'nike', 'adidas', 'jd sports']],
    ['👕', ['clothes', 'clothing', 'zara', 'uniqlo', 'h&m', 'cos', 'arket', 'mango', 'primark', 'boden', 'jumper', 'jacket', 'coat', 'dress', 'jeans']],
  ],
};

const LOOKUP: Record<string, [string, string][]> = Object.fromEntries(
  Object.entries(ICONS).map(([cat, list]) => [cat, list.flatMap(([emoji, words]) => words.map((w) => [searchText(w), emoji] as [string, string]))]),
);

export function iconFor(description: string, category: string): string {
  const list = LOOKUP[category];
  return (list && longestMatch(searchText(description), list)) || categoryById(category).emoji;
}
