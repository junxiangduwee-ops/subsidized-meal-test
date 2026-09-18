import {
  defaultWindowFor,
  mondayOf,
  dateOnly,
  toDateKey,
  cyclePhase,
  isOrderingOpen,
  serviceDatesFor,
  toLocalInputValue,
  zonedToUtc,
} from '../src/lib/cycle';
import { calculateSubsidy } from '../src/lib/subsidy';
import { formatSen, ringgitToSen } from '../src/lib/money';
import { resolveMenuImportRows, resolveWeekdayIndex, type CatalogueDish, type CatalogueRestaurant, type ImportRow } from '../src/lib/menu-import';

let pass = 0;
let fail = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    pass++;
    console.log(`  ok   ${label}`);
  } else {
    fail++;
    console.log(`  FAIL ${label}\n         expected ${e}\n         actual   ${a}`);
  }
}

console.log('\n=== Week arithmetic ===');
// 2026-08-05 is a Wednesday. Its Monday is 2026-08-03.
check('mondayOf(Wed 5 Aug 2026)', toDateKey(mondayOf(dateOnly('2026-08-05'))), '2026-08-03');
check('mondayOf(Sun 9 Aug 2026)', toDateKey(mondayOf(dateOnly('2026-08-09'))), '2026-08-03');
check('mondayOf(Mon 3 Aug 2026)', toDateKey(mondayOf(dateOnly('2026-08-03'))), '2026-08-03');

const serviceWeek = dateOnly('2026-08-10'); // Monday
check(
  'service days are Mon-Fri',
  serviceDatesFor(serviceWeek).map(toDateKey),
  ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14'],
);

const win = defaultWindowFor(serviceWeek);
// Ordering opens Monday of the previous week (3 Aug) at 00:00 Kuala Lumpur
// = 2 Aug 16:00 UTC. Cutoff Wednesday 5 Aug 17:00 KL = 5 Aug 09:00 UTC.
check('orderOpenAt', win.orderOpenAt.toISOString(), '2026-08-02T16:00:00.000Z');
check('orderCutoffAt', win.orderCutoffAt.toISOString(), '2026-08-05T09:00:00.000Z');
check('cutoff renders as Wed 17:00 local', toLocalInputValue(win.orderCutoffAt), '2026-08-05T17:00');
check('open renders as Mon 00:00 local', toLocalInputValue(win.orderOpenAt), '2026-08-03T00:00');

const cycle = {
  status: 'PUBLISHED' as const,
  serviceWeekStart: serviceWeek,
  orderOpenAt: win.orderOpenAt,
  orderCutoffAt: win.orderCutoffAt,
};

console.log('\n=== Cycle phases ===');
check('before open -> SCHEDULED', cyclePhase(cycle, zonedToUtc(2026, 8, 1, 12, 0)), 'SCHEDULED');
check('Mon of ordering week -> OPEN', cyclePhase(cycle, zonedToUtc(2026, 8, 3, 9, 0)), 'OPEN');
check('Wed 16:59 -> OPEN', cyclePhase(cycle, zonedToUtc(2026, 8, 5, 16, 59)), 'OPEN');
check('Wed 17:00 -> CLOSED', cyclePhase(cycle, zonedToUtc(2026, 8, 5, 17, 0)), 'CLOSED');
check('Thu of ordering week -> CLOSED', cyclePhase(cycle, zonedToUtc(2026, 8, 6, 12, 0)), 'CLOSED');
check('Mon of service week -> SERVING', cyclePhase(cycle, zonedToUtc(2026, 8, 10, 12, 0)), 'SERVING');
check('week after -> COMPLETED', cyclePhase(cycle, zonedToUtc(2026, 8, 17, 12, 0)), 'COMPLETED');
check('draft is never open', isOrderingOpen({ ...cycle, status: 'DRAFT' }, zonedToUtc(2026, 8, 3, 9, 0)), false);
check('published + in window is open', isOrderingOpen(cycle, zonedToUtc(2026, 8, 3, 9, 0)), true);
check('published + past cutoff is closed', isOrderingOpen(cycle, zonedToUtc(2026, 8, 6, 9, 0)), false);

console.log('\n=== Money ===');
check('formatSen(1234)', formatSen(1234), 'RM 12.34');
check('formatSen(0)', formatSen(0), 'RM 0.00');
check('formatSen(123456789)', formatSen(123456789), 'RM 1,234,567.89');
check('ringgitToSen("12.50")', ringgitToSen('12.50'), 1250);
check('ringgitToSen("0.05")', ringgitToSen('0.05'), 5);
check('ringgitToSen("RM 8.99")', ringgitToSen('RM 8.99'), 899);

console.log('\n=== Subsidy engine ===');
const d1 = dateOnly('2026-08-10');
const d2 = dateOnly('2026-08-11');

const rule = (over: Partial<any>): any => ({
  id: 'r', name: 'r', type: 'FIXED_PER_ITEM', value: 500, capSen: null,
  scope: 'ALL', department: null, priority: 0, active: true,
  effectiveFrom: null, effectiveTo: null, createdAt: new Date(), updatedAt: new Date(),
  ...over,
});

// RM 5.00 off a RM 12.50 dish -> staff pays RM 7.50
let out = calculateSubsidy(
  [{ key: 'a', serviceDate: d1, unitPriceSen: 1250, quantity: 1 }],
  [rule({ id: 'flat' })],
  'IT',
);
check('flat RM5 off RM12.50', [out.grossSen, out.subsidySen, out.netSen], [1250, 500, 750]);

// Subsidy can never exceed the item price.
out = calculateSubsidy(
  [{ key: 'a', serviceDate: d1, unitPriceSen: 350, quantity: 1 }],
  [rule({ id: 'flat' })],
  'IT',
);
check('subsidy capped at item price (RM3.50 drink)', [out.subsidySen, out.netSen], [350, 0]);

// Percentage with a cap.
out = calculateSubsidy(
  [{ key: 'a', serviceDate: d1, unitPriceSen: 1950, quantity: 1 }],
  [rule({ id: 'pct', type: 'PERCENTAGE', value: 60, capSen: 900 })],
  'IT',
);
check('60% of RM19.50 capped at RM9.00', out.subsidySen, 900);

// Department rule outranks the everyone rule at higher priority.
out = calculateSubsidy(
  [{ key: 'a', serviceDate: d1, unitPriceSen: 1000, quantity: 1 }],
  [
    rule({ id: 'all', value: 300, priority: 0 }),
    rule({ id: 'dept', value: 700, priority: 10, scope: 'DEPARTMENT', department: 'Warehouse' }),
  ],
  'Warehouse',
);
check('warehouse gets the better dept rule', out.subsidySen, 700);

out = calculateSubsidy(
  [{ key: 'a', serviceDate: d1, unitPriceSen: 1000, quantity: 1 }],
  [
    rule({ id: 'all', value: 300, priority: 0 }),
    rule({ id: 'dept', value: 700, priority: 10, scope: 'DEPARTMENT', department: 'Warehouse' }),
  ],
  'IT',
);
check('IT falls back to the everyone rule', out.subsidySen, 300);

// Daily cap: two RM5 subsidies on one day, capped at RM8 total.
out = calculateSubsidy(
  [
    { key: 'a', serviceDate: d1, unitPriceSen: 1250, quantity: 1 },
    { key: 'b', serviceDate: d1, unitPriceSen: 1250, quantity: 1 },
  ],
  [rule({ id: 'flat' }), rule({ id: 'cap', type: 'FIXED_PER_DAY', value: 800 })],
  'IT',
);
check('daily cap RM8 applied', out.subsidySen, 800);
check('daily cap split exactly', out.lines.map((l) => l.subsidySen), [400, 400]);
check('line sums equal order total', out.lines.reduce((s, l) => s + l.subsidySen, 0), out.subsidySen);

// Daily cap applies per day, not per order.
out = calculateSubsidy(
  [
    { key: 'a', serviceDate: d1, unitPriceSen: 1250, quantity: 1 },
    { key: 'b', serviceDate: d1, unitPriceSen: 1250, quantity: 1 },
    { key: 'c', serviceDate: d2, unitPriceSen: 1250, quantity: 1 },
  ],
  [rule({ id: 'flat' }), rule({ id: 'cap', type: 'FIXED_PER_DAY', value: 800 })],
  'IT',
);
check('two days -> RM8 + RM5', out.subsidySen, 1300);

// Odd split must still conserve sen exactly (no rounding drift).
out = calculateSubsidy(
  [
    { key: 'a', serviceDate: d1, unitPriceSen: 1000, quantity: 1 },
    { key: 'b', serviceDate: d1, unitPriceSen: 1000, quantity: 1 },
    { key: 'c', serviceDate: d1, unitPriceSen: 1000, quantity: 1 },
  ],
  [rule({ id: 'flat' }), rule({ id: 'cap', type: 'FIXED_PER_DAY', value: 1000 })],
  'IT',
);
check('3-way split of RM10 conserves sen', out.lines.map((l) => l.subsidySen), [334, 333, 333]);
check('3-way split sums to cap', out.lines.reduce((s, l) => s + l.subsidySen, 0), 1000);

// Quantity > 1.
out = calculateSubsidy(
  [{ key: 'a', serviceDate: d1, unitPriceSen: 1250, quantity: 3 }],
  [rule({ id: 'flat' })],
  'IT',
);
check('qty 3 -> gross 37.50, subsidy 15.00', [out.grossSen, out.subsidySen, out.netSen], [3750, 1500, 2250]);

// Expired rule must not apply.
out = calculateSubsidy(
  [{ key: 'a', serviceDate: d1, unitPriceSen: 1250, quantity: 1 }],
  [rule({ id: 'old', effectiveTo: dateOnly('2026-08-01') })],
  'IT',
);
check('expired rule ignored', out.subsidySen, 0);

// Inactive rule must not apply.
out = calculateSubsidy(
  [{ key: 'a', serviceDate: d1, unitPriceSen: 1250, quantity: 1 }],
  [rule({ id: 'off', active: false })],
  'IT',
);
check('inactive rule ignored', out.subsidySen, 0);

// No rules at all -> staff pays full price.
out = calculateSubsidy([{ key: 'a', serviceDate: d1, unitPriceSen: 1250, quantity: 1 }], [], 'IT');
check('no rules -> full price', [out.subsidySen, out.netSen], [0, 1250]);

// Snapshot records what was actually applied.
out = calculateSubsidy(
  [{ key: 'a', serviceDate: d1, unitPriceSen: 1250, quantity: 1 }],
  [rule({ id: 'flat', name: 'Standard' })],
  'IT',
);
check('snapshot names the applied rule', out.snapshot.rules.map((r) => r.name), ['Standard']);

console.log('\n=== Weekly-menu import ===');

function row(overrides: Partial<ImportRow> = {}): ImportRow {
  return {
    day: 'Mon',
    restaurantCode: 'R-001',
    restaurantName: 'Nasi Kandar Corner',
    dishCode: 'D-001',
    dishName: 'Chicken Rice',
    price: '',
    capacity: '',
    ...overrides,
  };
}

const existingRestaurants: CatalogueRestaurant[] = [{ id: 'rest_1', code: 'R-001', name: 'Nasi Kandar Corner' }];
const existingDishes: CatalogueDish[] = [
  { id: 'dish_1', code: 'D-001', name: 'Chicken Rice', restaurantId: 'rest_1', priceSen: 1250 },
];

check('resolveWeekdayIndex accepts short and long names', [resolveWeekdayIndex('Wed'), resolveWeekdayIndex('friday')], [2, 4]);
check('resolveWeekdayIndex rejects unknown days', resolveWeekdayIndex('Saturday'), null);

// Matching code + matching name -> reuse the existing restaurant and dish.
let plan = resolveMenuImportRows([row()], { restaurants: existingRestaurants, dishes: existingDishes });
check('existing code+name matches', plan[0].ok, true);
if (plan[0].ok) {
  check('existing restaurant reused', plan[0].restaurant.existingId, 'rest_1');
  check('existing dish reused', plan[0].dish.existingId, 'dish_1');
}

// Same code, different name -> conflict, row rejected.
plan = resolveMenuImportRows(
  [row({ restaurantName: 'Totally Different Name' })],
  { restaurants: existingRestaurants, dishes: existingDishes },
);
check('same restaurant code different name is rejected', plan[0].ok, false);

// Same dish code, different name -> conflict.
plan = resolveMenuImportRows([row({ dishName: 'Beef Rendang' })], {
  restaurants: existingRestaurants,
  dishes: existingDishes,
});
check('same dish code different name is rejected', plan[0].ok, false);

// Brand new restaurant + dish (new code, new name) -> created, needs a price.
plan = resolveMenuImportRows(
  [row({ restaurantCode: 'R-099', restaurantName: 'New Spot', dishCode: 'D-099', dishName: 'New Dish' })],
  { restaurants: existingRestaurants, dishes: existingDishes },
);
check('brand new restaurant+dish without price is rejected', plan[0].ok, false);

plan = resolveMenuImportRows(
  [
    row({
      restaurantCode: 'R-099',
      restaurantName: 'New Spot',
      dishCode: 'D-099',
      dishName: 'New Dish',
      price: '9.90',
    }),
  ],
  { restaurants: existingRestaurants, dishes: existingDishes },
);
check('brand new restaurant+dish with price is accepted', plan[0].ok, true);
if (plan[0].ok) {
  check('new restaurant has no existing id', plan[0].restaurant.existingId, null);
  check('new dish has no existing id', plan[0].dish.existingId, null);
}

// A new code claiming a name that already belongs to someone else -> conflict.
plan = resolveMenuImportRows(
  [row({ restaurantCode: 'R-050', restaurantName: 'Nasi Kandar Corner' })],
  { restaurants: existingRestaurants, dishes: existingDishes },
);
check('new code with an existing name is rejected', plan[0].ok, false);

// Two rows in the same file both declaring the same brand-new restaurant
// code consistently should both succeed and share one restaurant.
plan = resolveMenuImportRows(
  [
    row({ restaurantCode: 'R-200', restaurantName: 'Second Spot', dishCode: 'D-200', dishName: 'Dish A', price: '5.00' }),
    row({
      day: 'Tue',
      restaurantCode: 'R-200',
      restaurantName: 'Second Spot',
      dishCode: 'D-201',
      dishName: 'Dish B',
      price: '6.00',
    }),
  ],
  { restaurants: existingRestaurants, dishes: existingDishes },
);
check('two rows sharing a new restaurant code both succeed', [plan[0].ok, plan[1].ok], [true, true]);

// ...but the same new code with an inconsistent name across rows is a conflict.
plan = resolveMenuImportRows(
  [
    row({ restaurantCode: 'R-300', restaurantName: 'Third Spot', dishCode: 'D-300', dishName: 'Dish A', price: '5.00' }),
    row({
      day: 'Tue',
      restaurantCode: 'R-300',
      restaurantName: 'A Different Name',
      dishCode: 'D-301',
      dishName: 'Dish B',
      price: '6.00',
    }),
  ],
  { restaurants: existingRestaurants, dishes: existingDishes },
);
check('inconsistent new restaurant name within the same file is rejected', [plan[0].ok, plan[1].ok], [true, false]);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
