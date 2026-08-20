/**
 * Development seed.
 *
 * Creates one account per role, a small catalogue, subsidy rules, three
 * completed service weeks (so the analytics and finance dashboards have
 * something to show), one week that is open for ordering right now, and one
 * draft for the admin to practise on.
 *
 * Run with: npm run db:seed
 */

import { type Dish, type SubsidyRule, type User } from '@prisma/client';
import bcrypt from 'bcryptjs';

import { prisma } from '../src/lib/prisma';
import { encodeTags } from '../src/lib/db-compat';
import {
  addWeeks,
  defaultWindowFor,
  mondayOf,
  todayInAppTz,
  serviceDatesFor,
} from '../src/lib/cycle';
import { calculateSubsidy } from '../src/lib/subsidy';

/**
 * Demo accounts all share one password. That is fine on a laptop and not fine
 * on anything reachable from the internet - the default is documented in the
 * README, so a public deployment seeded with it would have a publicly known
 * admin login. Require an explicit password when the target is remote.
 */
function seedPassword(): string {
  const explicit = process.env.SEED_DEFAULT_PASSWORD;
  if (explicit) return explicit;

  if (process.env.SEED_TARGET_REMOTE) {
    console.error(
      '\nRefusing to seed a remote database with the default demo password.\n' +
      'The default is published in the README, so seeding a hosted deployment\n' +
      'with it would leave a publicly known administrator account.\n\n' +
      'Set SEED_DEFAULT_PASSWORD to something only you know, for example:\n' +
      '  SEED_DEFAULT_PASSWORD="$(openssl rand -base64 18)" npm run db:seed\n',
    );
    process.exit(1);
  }

  return 'ChangeMe123!';
}

const PASSWORD = seedPassword();

/** Deterministic PRNG so repeated seeds produce the same demo numbers. */
function makeRandom(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}
const rand = makeRandom(20260730);

function pick<T>(items: T[]): T {
  return items[Math.floor(rand() * items.length)];
}

async function main() {
  console.log('Seeding MR DIY Food Ordering...');

  // --- Users -----------------------------------------------------------
  const passwordHash = await bcrypt.hash(PASSWORD, 12);

  const staffSpec = [
    {
      email: 'admin@mrdiy.com',
      name: 'Aisyah Rahman',
      role: 'ADMIN' as const,
      department: 'IT',
      staffId: 'EMP-00001',
    },
    {
      email: 'analytics@mrdiy.com',
      name: 'Daniel Wong',
      role: 'ANALYTICS' as const,
      department: 'Strategy',
      staffId: 'EMP-00002',
    },
    {
      email: 'finance@mrdiy.com',
      name: 'Priya Nair',
      role: 'FINANCE' as const,
      department: 'Finance',
      staffId: 'EMP-00003',
    },
    {
      email: 'user@mrdiy.com',
      name: 'Farhan Idris',
      role: 'USER' as const,
      department: 'Operations',
      staffId: 'EMP-00004',
    },
    {
      email: 'siti.zahra@mrdiy.com',
      name: 'Siti Zahra',
      role: 'USER' as const,
      department: 'Operations',
      staffId: 'EMP-00005',
    },
    {
      email: 'lim.wei@mrdiy.com',
      name: 'Lim Wei Jian',
      role: 'USER' as const,
      department: 'Merchandising',
      staffId: 'EMP-00006',
    },
    {
      email: 'kavitha.r@mrdiy.com',
      name: 'Kavitha Ramasamy',
      role: 'USER' as const,
      department: 'Merchandising',
      staffId: 'EMP-00007',
    },
    {
      email: 'hafiz.omar@mrdiy.com',
      name: 'Hafiz Omar',
      role: 'USER' as const,
      department: 'Warehouse',
      staffId: 'EMP-00008',
    },
    {
      email: 'chong.mei@mrdiy.com',
      name: 'Chong Mei Ling',
      role: 'USER' as const,
      department: 'Warehouse',
      staffId: 'EMP-00009',
    },
    {
      email: 'arif.samad@mrdiy.com',
      name: 'Arif Samad',
      role: 'USER' as const,
      department: 'IT',
      staffId: 'EMP-00010',
    },
    {
      email: 'nurul.ain@mrdiy.com',
      name: 'Nurul Ain',
      role: 'USER' as const,
      department: 'Finance',
      staffId: 'EMP-00011',
    },
    {
      email: 'tan.hock@mrdiy.com',
      name: 'Tan Hock Seng',
      role: 'USER' as const,
      department: 'Operations',
      staffId: 'EMP-00012',
    },
  ];

  // --- Bulk employees ----------------------------------------------------
  // Tune these two constants for a bigger or smaller demo dataset. Every
  // extra employee here automatically gets orders in every historical week
  // below - the order-generation loop just iterates whatever is in `users`.
  const BULK_EMPLOYEE_COUNT = 150;
  const BULK_DEPARTMENTS = ['Operations', 'Merchandising', 'Warehouse', 'IT', 'Finance', 'Strategy'];

  const FIRST_NAMES = [
    'Ahmad', 'Aiman', 'Amirah', 'Azlan', 'Balqis', 'Danish', 'Farah', 'Hasnah',
    'Idris', 'Iskandar', 'Junaidi', 'Khadijah', 'Mahathir', 'Nabila', 'Nazrin', 'Rosnah',
    'Syafiq', 'Zulaikha', 'Wei Ling', 'Jia Hao', 'Mei Xin', 'Kok Wei', 'Shu Fen', 'Chee Keong',
    'Yee Ting', 'Boon Hui', 'Sze Ming', 'Wai Kit', 'Li Wen', 'Cheng Yee',
    'Kamala', 'Suresh', 'Priyanka', 'Ravindran', 'Deepa', 'Anand', 'Meera', 'Vignesh',
    'Lakshmi', 'Kumaran', 'Shalini', 'Ganesh',
  ];
  const LAST_NAMES = [
    'bin Abdullah', 'bin Ismail', 'binti Rahman', 'binti Yusof', 'bin Hashim', 'binti Kassim',
    'bin Salleh', 'binti Zainal', 'bin Hamid', 'binti Aziz',
    'Tan', 'Lim', 'Wong', 'Lee', 'Ng', 'Chan', 'Ong', 'Chong', 'Yap', 'Goh',
    'a/l Muthu', 'a/p Raman', 'a/l Subramaniam', 'a/p Krishnan', 'a/l Perumal',
  ];

  const bulkEmployees: typeof staffSpec = [];
  const usedEmails = new Set(staffSpec.map((s) => s.email));
  for (let i = 0; i < BULK_EMPLOYEE_COUNT; i++) {
    const first = pick(FIRST_NAMES);
    const last = pick(LAST_NAMES);
    const name = `${first} ${last}`;
    const staffId = `EMP-${String(staffSpec.length + i + 1).padStart(5, '0')}`;

    let email = `${first}.${last}`
      .toLowerCase()
      .replace(/[^a-z.]/g, '')
      .replace(/\.+/g, '.') + '@mrdiy.com';
    // Common names collide once name pools repeat - fall back to staffId.
    if (usedEmails.has(email)) email = `${staffId.toLowerCase()}@mrdiy.com`;
    usedEmails.add(email);

    bulkEmployees.push({
      email,
      name,
      role: 'USER' as const,
      department: pick(BULK_DEPARTMENTS),
      staffId,
    });
  }
  staffSpec.push(...bulkEmployees);

  const users: User[] = [];
  for (const spec of staffSpec) {
    users.push(
      await prisma.user.upsert({
        where: { email: spec.email },
        update: {
          name: spec.name,
          role: spec.role,
          department: spec.department,
          staffId: spec.staffId,
        },
        create: { ...spec, passwordHash, authProvider: 'LOCAL' },
      }),
    );
  }
  console.log(`  ${users.length} users`);

  // --- Catalogue -------------------------------------------------------
  const catalogue: Array<{
    restaurant: { name: string; cuisine: string; contactName: string; contactPhone: string };
    dishes: Array<{
      name: string;
      priceSen: number;
      category: string;
      tags: string[];
      description?: string;
    }>;
  }> = [
      {
        restaurant: {
          name: 'Nasi Kandar Pelita',
          cuisine: 'Mamak',
          contactName: 'Encik Zul',
          contactPhone: '03-2141 5678',
        },
        dishes: [
          {
            name: 'Nasi Kandar Ayam Goreng',
            priceSen: 1250,
            category: 'Main',
            tags: ['halal', 'spicy'],
            description: 'Fried chicken with mixed curry gravy',
          },
          { name: 'Nasi Kandar Daging Kicap', priceSen: 1450, category: 'Main', tags: ['halal'] },
          { name: 'Roti Canai Set', priceSen: 750, category: 'Light', tags: ['halal', 'vegetarian'] },
          { name: 'Mee Goreng Mamak', priceSen: 950, category: 'Main', tags: ['halal', 'spicy'] },
        ],
      },
      {
        restaurant: {
          name: 'Kedai Kopi Ah Seng',
          cuisine: 'Chinese',
          contactName: 'Ah Seng',
          contactPhone: '03-7788 1234',
        },
        dishes: [
          {
            name: 'Chicken Rice',
            priceSen: 1100,
            category: 'Main',
            tags: [],
            description: 'Steamed chicken with fragrant rice',
          },
          { name: 'Wantan Mee', priceSen: 1000, category: 'Main', tags: [] },
          { name: 'Char Kuey Teow', priceSen: 1150, category: 'Main', tags: ['spicy'] },
          { name: 'Kopi O Ice', priceSen: 350, category: 'Drink', tags: ['vegetarian'] },
        ],
      },
      {
        restaurant: {
          name: 'Green Bowl',
          cuisine: 'Healthy',
          contactName: 'Melissa Koh',
          contactPhone: '012-345 6789',
        },
        dishes: [
          {
            name: 'Grilled Chicken Quinoa Bowl',
            priceSen: 1650,
            category: 'Main',
            tags: ['halal', 'high-protein'],
          },
          {
            name: 'Tofu Buddha Bowl',
            priceSen: 1450,
            category: 'Main',
            tags: ['vegetarian', 'vegan'],
          },
          { name: 'Salmon Poke Bowl', priceSen: 1950, category: 'Main', tags: ['contains-fish'] },
          { name: 'Fresh Fruit Cup', priceSen: 600, category: 'Side', tags: ['vegetarian', 'vegan'] },
        ],
      },
      {
        restaurant: {
          name: 'Warung Bu Tini',
          cuisine: 'Indonesian',
          contactName: 'Bu Tini',
          contactPhone: '011-2233 4455',
        },
        dishes: [
          { name: 'Nasi Ayam Penyet', priceSen: 1350, category: 'Main', tags: ['halal', 'spicy'] },
          {
            name: 'Gado-Gado',
            priceSen: 1050,
            category: 'Main',
            tags: ['halal', 'vegetarian', 'contains-nuts'],
          },
          { name: 'Soto Ayam', priceSen: 1200, category: 'Main', tags: ['halal'] },
          { name: 'Es Teh Manis', priceSen: 400, category: 'Drink', tags: ['halal', 'vegetarian'] },
        ],
      },
      {
        restaurant: {
          name: 'Restoran Sri Ananda Bahwan',
          cuisine: 'Indian',
          contactName: 'Muthu Kumar',
          contactPhone: '03-4256 7890',
        },
        dishes: [
          { name: 'Banana Leaf Rice', priceSen: 1250, category: 'Main', tags: ['halal', 'vegetarian option'] },
          { name: 'Chicken Briyani', priceSen: 1400, category: 'Main', tags: ['halal', 'spicy'] },
          { name: 'Fish Head Curry', priceSen: 1800, category: 'Main', tags: ['halal', 'contains-fish', 'spicy'] },
          { name: 'Teh Tarik', priceSen: 350, category: 'Drink', tags: ['halal', 'vegetarian'] },
        ],
      },
      {
        restaurant: {
          name: 'Sakura Japanese Kitchen',
          cuisine: 'Japanese',
          contactName: 'Kenji Tanaka',
          contactPhone: '03-9012 3456',
        },
        dishes: [
          { name: 'Chicken Katsu Curry', priceSen: 1650, category: 'Main', tags: [] },
          { name: 'Salmon Teriyaki Bento', priceSen: 1950, category: 'Main', tags: ['contains-fish'] },
          { name: 'Vegetable Gyoza', priceSen: 950, category: 'Side', tags: ['vegetarian'] },
          { name: 'Miso Soup', priceSen: 500, category: 'Side', tags: ['vegetarian'] },
        ],
      },
      {
        restaurant: {
          name: 'Seoul Garden Express',
          cuisine: 'Korean',
          contactName: 'Park Min-jun',
          contactPhone: '03-6234 5678',
        },
        dishes: [
          { name: 'Bibimbap', priceSen: 1550, category: 'Main', tags: ['halal option'] },
          { name: 'Korean Fried Chicken', priceSen: 1750, category: 'Main', tags: ['spicy'] },
          { name: 'Kimchi Jjigae', priceSen: 1400, category: 'Main', tags: ['spicy'] },
          { name: 'Japchae', priceSen: 1150, category: 'Side', tags: ['vegetarian'] },
        ],
      },
      {
        restaurant: {
          name: 'Restoran Yut Kee',
          cuisine: 'Hainanese',
          contactName: 'David Yong',
          contactPhone: '03-2691 1054',
        },
        dishes: [
          { name: 'Hainanese Chicken Chop', priceSen: 1450, category: 'Main', tags: [] },
          { name: 'Roti Babi', priceSen: 1050, category: 'Main', tags: ['contains-pork'] },
          { name: 'Curry Debal', priceSen: 1550, category: 'Main', tags: ['spicy'] },
          { name: 'Iced Milo', priceSen: 400, category: 'Drink', tags: ['vegetarian'] },
        ],
      },
      {
        restaurant: {
          name: 'Subway Sandwiches',
          cuisine: 'Western',
          contactName: 'Store Manager',
          contactPhone: '03-7801 2345',
        },
        dishes: [
          { name: 'Chicken Teriyaki Sub', priceSen: 1650, category: 'Main', tags: ['halal'] },
          { name: 'Tuna Sub', priceSen: 1550, category: 'Main', tags: ['halal', 'contains-fish'] },
          { name: 'Veggie Delite Sub', priceSen: 1350, category: 'Main', tags: ['halal', 'vegetarian'] },
          { name: 'Cookies (2pc)', priceSen: 550, category: 'Side', tags: ['vegetarian'] },
        ],
      },
      {
        restaurant: {
          name: 'Pizza Corner PJ',
          cuisine: 'Italian',
          contactName: 'Marco Rossi',
          contactPhone: '03-7955 6677',
        },
        dishes: [
          { name: 'Margherita Pizza Slice', priceSen: 1200, category: 'Main', tags: ['halal', 'vegetarian'] },
          { name: 'Chicken Pepperoni Pizza Slice', priceSen: 1400, category: 'Main', tags: ['halal'] },
          { name: 'Chicken Alfredo Pasta', priceSen: 1650, category: 'Main', tags: ['halal'] },
          { name: 'Garlic Bread', priceSen: 700, category: 'Side', tags: ['halal', 'vegetarian'] },
        ],
      },
      {
        restaurant: {
          name: 'Nasi Lemak Antarabangsa',
          cuisine: 'Malay',
          contactName: 'Kak Yah',
          contactPhone: '03-2273 8899',
        },
        dishes: [
          { name: 'Nasi Lemak Ayam Rendang', priceSen: 1350, category: 'Main', tags: ['halal', 'spicy'] },
          { name: 'Nasi Lemak Sotong Sambal', priceSen: 1300, category: 'Main', tags: ['halal', 'spicy'] },
          { name: 'Nasi Lemak Biasa', priceSen: 700, category: 'Main', tags: ['halal', 'vegetarian option'] },
          { name: 'Kuih-Muih Assorted', priceSen: 450, category: 'Side', tags: ['halal', 'vegetarian'] },
        ],
      },
      {
        restaurant: {
          name: 'The Chicken Rice Shop',
          cuisine: 'Chinese',
          contactName: 'Outlet Manager',
          contactPhone: '03-7873 4455',
        },
        dishes: [
          { name: 'Steamed Chicken Rice Set', priceSen: 1250, category: 'Main', tags: [] },
          { name: 'Roasted Chicken Rice Set', priceSen: 1300, category: 'Main', tags: [] },
          { name: 'Herbal Chicken Soup', priceSen: 1100, category: 'Side', tags: [] },
          { name: 'Barley Drink', priceSen: 350, category: 'Drink', tags: ['vegetarian'] },
        ],
      },
      {
        restaurant: {
          name: 'Mynt Cafe',
          cuisine: 'Western',
          contactName: 'Aina Zulkifli',
          contactPhone: '03-2145 9988',
        },
        dishes: [
          { name: 'Beef Lasagna', priceSen: 1750, category: 'Main', tags: ['contains-beef'] },
          { name: 'Grilled Chicken Chop', priceSen: 1650, category: 'Main', tags: ['halal'] },
          { name: 'Carbonara Pasta', priceSen: 1550, category: 'Main', tags: ['contains-pork option'] },
          { name: 'Iced Lemon Tea', priceSen: 400, category: 'Drink', tags: ['vegetarian'] },
        ],
      },
      {
        restaurant: {
          name: 'Restoran Nasi Kukus Bunga Tanjung',
          cuisine: 'Malay',
          contactName: 'Pak Long',
          contactPhone: '019-345 6721',
        },
        dishes: [
          { name: 'Nasi Kukus Ayam Berempah', priceSen: 1300, category: 'Main', tags: ['halal', 'spicy'] },
          { name: 'Nasi Kukus Daging', priceSen: 1450, category: 'Main', tags: ['halal', 'spicy'] },
          { name: 'Ayam Golek', priceSen: 1550, category: 'Main', tags: ['halal'] },
          { name: 'Air Sirap', priceSen: 300, category: 'Drink', tags: ['halal', 'vegetarian'] },
        ],
      },
      {
        restaurant: {
          name: "Papparich",
          cuisine: 'Malaysian',
          contactName: 'Outlet Manager',
          contactPhone: '03-7845 2211',
        },
        dishes: [
          { name: 'Nasi Lemak Papparich', priceSen: 1450, category: 'Main', tags: ['halal', 'spicy'] },
          { name: 'Curry Mee', priceSen: 1350, category: 'Main', tags: ['halal', 'spicy'] },
          { name: 'Roti Telur Bawang', priceSen: 850, category: 'Light', tags: ['halal', 'vegetarian'] },
          { name: 'Papparich White Coffee', priceSen: 450, category: 'Drink', tags: ['halal', 'vegetarian'] },
        ],
      },
      {
        restaurant: {
          name: 'Vegetarian Delight',
          cuisine: 'Vegetarian',
          contactName: 'Ms. Tan',
          contactPhone: '012-987 6543',
        },
        dishes: [
          { name: 'Mock Meat Rice', priceSen: 1050, category: 'Main', tags: ['vegetarian', 'vegan'] },
          { name: 'Yong Tau Foo (Vegetarian)', priceSen: 950, category: 'Main', tags: ['vegetarian'] },
          { name: 'Buddhist Delight', priceSen: 1100, category: 'Main', tags: ['vegetarian', 'vegan'] },
          { name: 'Soy Milk', priceSen: 300, category: 'Drink', tags: ['vegetarian', 'vegan'] },
        ],
      },
      {
        restaurant: {
          name: 'Bakerzin',
          cuisine: 'Bakery & Cafe',
          contactName: 'Outlet Manager',
          contactPhone: '03-2168 7733',
        },
        dishes: [
          { name: 'Chicken Chop Sandwich', priceSen: 1550, category: 'Main', tags: ['halal'] },
          { name: 'Mushroom Soup', priceSen: 900, category: 'Side', tags: ['vegetarian'] },
          { name: 'Chocolate Croissant', priceSen: 650, category: 'Side', tags: ['vegetarian'] },
          { name: 'Cappuccino', priceSen: 500, category: 'Drink', tags: ['vegetarian'] },
        ],
      },
      {
        restaurant: {
          name: 'Restoran Kari Bawang Kajang',
          cuisine: 'Malay',
          contactName: 'Pak Man',
          contactPhone: '03-8736 4521',
        },
        dishes: [
          { name: 'Nasi Kari Bawang Ayam', priceSen: 1250, category: 'Main', tags: ['halal', 'spicy'] },
          { name: 'Nasi Kari Bawang Daging', priceSen: 1450, category: 'Main', tags: ['halal', 'spicy'] },
          { name: 'Sup Tulang', priceSen: 1350, category: 'Side', tags: ['halal'] },
          { name: 'Air Bandung', priceSen: 350, category: 'Drink', tags: ['halal', 'vegetarian'] },
        ],
      },
    ];

  const allDishes: Dish[] = [];
  for (const entry of catalogue) {
    const restaurant = await prisma.restaurant.upsert({
      where: { name: entry.restaurant.name },
      update: {},
      create: entry.restaurant,
    });

    for (const dish of entry.dishes) {
      allDishes.push(
        await prisma.dish.upsert({
          where: { restaurantId_name: { restaurantId: restaurant.id, name: dish.name } },
          update: { priceSen: dish.priceSen },
          create: { ...dish, tags: encodeTags(dish.tags), restaurantId: restaurant.id },
        }),
      );
    }
  }
  console.log(`  ${catalogue.length} restaurants, ${allDishes.length} dishes`);

  // --- Delivery sites ----------------------------------------------------
  // Edit this list to match your actual sites - it's the only part of this
  // block you should need to touch.
  const DELIVERY_SITES: string[] = ['Warehouse A', 'Warehouse B', 'Warehouse H', 'Warehouse P', 'Warehouse Q', 'Warehouse X', 'Warehouse Y', 'Mines 2 Office'];

  await prisma.deliverySite.deleteMany({});
  await prisma.deliverySite.createMany({
    data: DELIVERY_SITES.map((name) => ({ name, active: true })),
  });
  const deliverySites = await prisma.deliverySite.findMany({ select: { id: true } });
  console.log(`  ${DELIVERY_SITES.length} delivery sites`);

  // --- Subsidy rules ---------------------------------------------------
  await prisma.subsidyRule.deleteMany({});
  await prisma.subsidyRule.createMany({
    data: [
      {
        name: 'Standard staff meal subsidy',
        type: 'FIXED_PER_ITEM',
        value: 500, // RM 5.00 off each item
        scope: 'ALL',
        priority: 0,
        active: true,
      },
      {
        name: 'Daily subsidy cap',
        type: 'FIXED_PER_DAY',
        value: 800, // company never pays more than RM 8.00 per person per day
        scope: 'ALL',
        priority: 0,
        active: true,
      },
      {
        name: 'Warehouse shift allowance',
        type: 'PERCENTAGE',
        value: 60,
        capSen: 900, // 60% off, capped at RM 9.00 per item
        scope: 'DEPARTMENT',
        department: 'Warehouse',
        priority: 10,
        active: true,
      },
      {
        name: 'Merchandising travel meal top-up',
        type: 'FIXED_PER_ITEM',
        value: 300, // an extra RM 3.00 off, on top of the standard subsidy
        scope: 'DEPARTMENT',
        department: 'Merchandising',
        priority: 10,
        active: true,
      },
      {
        name: 'IT on-call allowance',
        type: 'PERCENTAGE',
        value: 40,
        capSen: 600, // 40% off, capped at RM 6.00 per item
        scope: 'DEPARTMENT',
        department: 'IT',
        priority: 10,
        active: true,
      },
    ],
  });
  const rules: SubsidyRule[] = await prisma.subsidyRule.findMany({ where: { active: true } });
  console.log(`  ${rules.length} subsidy rules`);

  // --- Weekly cycles ---------------------------------------------------
  const thisMonday = mondayOf(todayInAppTz());
  const now = new Date();

  // Past service weeks, already delivered. Tune WEEKS_OF_HISTORY for a
  // bigger or smaller demo dataset - each week seeds a full menu plus
  // orders for every employee, so this scales seeding time linearly.
  const WEEKS_OF_HISTORY = 16;
  for (let back = WEEKS_OF_HISTORY; back >= 1; back--) {
    const weekStart = addWeeks(thisMonday, -back);
    await buildCycle({
      weekStart,
      status: 'FULFILLED',
      ...defaultWindowFor(weekStart),
      withOrders: true,
    });
  }

  // The week people are ordering for right now. The window is forced open
  // relative to "now" so the demo works whichever day it is seeded.
  const openWeekStart = addWeeks(thisMonday, 1);
  await buildCycle({
    weekStart: openWeekStart,
    status: 'PUBLISHED',
    orderOpenAt: new Date(now.getTime() - 24 * 3600_000),
    orderCutoffAt: new Date(now.getTime() + 48 * 3600_000),
    withOrders: true,
    partialOrders: true,
    title: 'Ordering open now',
  });

  // Next week's draft, for the admin to practise publishing.
  const draftWeekStart = addWeeks(thisMonday, 2);
  await buildCycle({
    weekStart: draftWeekStart,
    status: 'DRAFT',
    ...defaultWindowFor(draftWeekStart),
    withOrders: false,
    title: 'Draft - not yet published',
  });

  console.log('\nDone. Sign in with:');
  for (const s of staffSpec.slice(0, 4)) {
    console.log(`  ${s.role.padEnd(9)} ${s.email}  /  ${PASSWORD}`);
  }
  console.log('\nChange these passwords before deploying anywhere real.\n');

  // -------------------------------------------------------------------
  async function buildCycle(opts: {
    weekStart: Date;
    status: 'DRAFT' | 'PUBLISHED' | 'CLOSED' | 'FULFILLED';
    orderOpenAt: Date;
    orderCutoffAt: Date;
    withOrders: boolean;
    partialOrders?: boolean;
    title?: string;
  }) {
    const existing = await prisma.menuCycle.findFirst({
      where: { serviceWeekStart: opts.weekStart },
    });
    if (existing) return;

    const admin = users[0];
    const cycle = await prisma.menuCycle.create({
      data: {
        serviceWeekStart: opts.weekStart,
        title: opts.title ?? null,
        status: opts.status,
        orderOpenAt: opts.orderOpenAt,
        orderCutoffAt: opts.orderCutoffAt,
        publishedAt: opts.status === 'DRAFT' ? null : opts.orderOpenAt,
        closedAt: opts.status === 'FULFILLED' ? opts.orderCutoffAt : null,
        createdById: admin.id,
        notes:
          opts.status === 'PUBLISHED'
            ? 'Collection from the Level 3 pantry between 12:15 pm and 1:00 pm.'
            : null,
      },
    });

    // Four dishes a day, rotated so weeks are not identical.
    const menuItems: Array<{ id: string; priceSen: number; serviceDate: Date }> = [];

    for (const [dayIndex, serviceDate] of serviceDatesFor(opts.weekStart).entries()) {
      const day = await prisma.menuDay.create({
        data: { cycleId: cycle.id, serviceDate, slot: 'LUNCH' },
      });

      const offset = (dayIndex * 3) % allDishes.length;
      const chosen = Array.from(
        { length: 4 },
        (_, i) => allDishes[(offset + i * 3) % allDishes.length],
      );
      const unique = [...new Map(chosen.map((d) => [d.id, d])).values()];

      for (const [i, dish] of unique.entries()) {
        const item = await prisma.menuItem.create({
          data: {
            menuDayId: day.id,
            dishId: dish.id,
            priceSen: dish.priceSen,
            capacity: i === 0 ? 40 : null, // one capped dish per day to exercise the limit
            sortOrder: i,
          },
        });
        menuItems.push({ id: item.id, priceSen: item.priceSen, serviceDate });
      }
    }

    if (!opts.withOrders) return;

    // Employees order 2-4 days of the week.
    const employees = users.filter((u) => u.role === 'USER' || u.role === 'FINANCE');
    for (const employee of employees) {
      if (opts.partialOrders && rand() < 0.35) continue; // some have not ordered yet

      const daysOrdered = 2 + Math.floor(rand() * 3);
      const chosenDates = serviceDatesFor(opts.weekStart)
        .filter(() => rand() < 0.75)
        .slice(0, daysOrdered);
      if (chosenDates.length === 0) continue;

      const lines = chosenDates.map((date) => {
        const candidates = menuItems.filter((m) => m.serviceDate.getTime() === date.getTime());
        const item = pick(candidates);
        return { menuItem: item, quantity: 1 };
      });

      const outcome = calculateSubsidy(
        lines.map((l, i) => ({
          key: String(i),
          serviceDate: l.menuItem.serviceDate,
          unitPriceSen: l.menuItem.priceSen,
          quantity: l.quantity,
        })),
        rules,
        employee.department,
      );

      const reference = `MRD-SEED-${cycle.id.slice(-4).toUpperCase()}-${employee.staffId?.slice(-3) ?? '000'}`;
      const paid = opts.status !== 'PUBLISHED' || rand() < 0.8;

      const order = await prisma.order.create({
        data: {
          reference,
          userId: employee.id,
          cycleId: cycle.id,
          status: paid ? 'PAID' : 'AWAITING_PAYMENT',
          grossSen: outcome.grossSen,
          subsidySen: outcome.subsidySen,
          netSen: outcome.netSen,
          subsidySnapshot: outcome.snapshot as never,
          submittedAt: opts.orderCutoffAt,
          paidAt: paid ? opts.orderCutoffAt : null,
          deliverySiteId: deliverySites[Math.floor(rand() * deliverySites.length)]?.id,
        },
      });

      for (const [i, line] of lines.entries()) {
        const result = outcome.lines[i];
        const menuItem = await prisma.menuItem.findUniqueOrThrow({
          where: { id: line.menuItem.id },
          include: { dish: { include: { restaurant: true } } },
        });

        await prisma.orderItem.upsert({
          where: { orderId_menuItemId: { orderId: order.id, menuItemId: menuItem.id } },
          update: {},
          create: {
            orderId: order.id,
            menuItemId: menuItem.id,
            quantity: line.quantity,
            unitPriceSen: menuItem.priceSen,
            grossSen: result.grossSen,
            subsidySen: result.subsidySen,
            netSen: result.netSen,
            serviceDate: line.menuItem.serviceDate,
            dishName: menuItem.dish.name,
            restaurantName: menuItem.dish.restaurant.name,
          },
        });
      }

      if (paid && outcome.netSen > 0) {
        await prisma.payment.create({
          data: {
            orderId: order.id,
            requestId: `seed-req-${order.id.slice(-10)}`,
            paymentId: `seed-pay-${order.id.slice(-10)}`,
            status: 'SUCCEEDED',
            amountSen: outcome.netSen,
            currency: 'MYR',
            paymentMethod: pick(['fpx', 'card', 'duitnow_qr']),
          },
        });
      }
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
