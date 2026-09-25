/**
 * LuxeWear Kenya Delivery Pricing Calculator
 *
 * Enforces official LuxeWear delivery fee rules:
 * - Zone 1: Nairobi Metro → KES 300
 * - Zone 2: Greater Nairobi → KES 400
 * - Zone 3: Nationwide / Upcountry → KES 500
 * - Free Delivery Threshold: Free delivery for subtotal >= KES 7,500
 */
export function calculateDeliveryFee(
  subtotalKes: number,
  deliveryAddress: { city?: string; suburbArea?: string }
): number {
  // Free delivery for orders KES 7,500 and above
  if (subtotalKes >= 7500) {
    return 0;
  }

  const city = (deliveryAddress.city || '').toLowerCase().trim();
  const suburb = (deliveryAddress.suburbArea || '').toLowerCase().trim();

  const nairobiMetroSuburbs = [
    'kilimani',
    'kileleshwa',
    'lavington',
    'westlands',
    'cbd',
    'karen',
    'parklands',
    'hurlingham',
    'runda',
    'muthaiga',
    'gigiri',
    'spring valley',
    'upper hill',
    'madaraka',
    'south c',
    'south b',
    'ngara',
    'highridge',
    'loresho',
    'kitisuru',
    'riverside',
    'langata',
    'nairobi',
  ];

  const greaterNairobiZones = [
    'kiambu',
    'ruiru',
    'kikuyu',
    'machakos',
    'ngong',
    'ongata rongai',
    'thika',
    'kitengela',
    'syokimau',
    'athi river',
    'juja',
    'limuru',
    'ruaka',
    'karuri',
    'kahawa',
  ];

  const isNairobiMetro =
    city === 'nairobi' ||
    nairobiMetroSuburbs.some((s) => suburb.includes(s) || city.includes(s));

  if (isNairobiMetro) {
    return 300; // Zone 1
  }

  const isGreaterNairobi = greaterNairobiZones.some(
    (z) => suburb.includes(z) || city.includes(z)
  );

  if (isGreaterNairobi) {
    return 400; // Zone 2
  }

  return 500; // Zone 3 Nationwide
}
