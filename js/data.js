/* STARFALL Phase 1 — data.js
 * All game data + balance numbers. Every tunable lives in SF.CONFIG.
 * Tier colors follow the global rule: white -> green -> blue -> purple -> orange -> gold.
 */
window.SF = window.SF || {};

SF.TIERS = {
  white:  '#e8e8e8',
  green:  '#3ddc5f',
  blue:   '#3fa9ff',
  purple: '#b45cff',
  orange: '#ff8c2e',
  gold:   '#ffd23f'
};
SF.TIER_ORDER = ['white', 'green', 'blue', 'purple', 'orange', 'gold'];

SF.CONFIG = {
  worldSize: 4200,          // each star system is worldSize x worldSize world units
  step: 1 / 60,             // fixed timestep

  player: {
    hull: 100,
    shield: 50,
    shieldRegen: 8,         // per second
    shieldRegenDelay: 2.5,  // seconds after last damage before regen starts
    speed: 240,             // px/s
    radius: 13,
    contactCooldown: 0.6
  },

  /* ================= balance-perf phase (2026-10-19) =================
   * Full weapon DPS pass — see BALANCE.md for the intended curves.
   * Rule of thumb: white 30-55 / green 45-70 / blue 60-95 / purple 75-110 /
   * orange 120-180 / gold 200-380 sustained DPS, with a utility discount for
   * homing / stun / blast / mine weapons. Secrets stay best-in-game.
   * Trading systemMul spreads widened so real routes clear 50+ cr/unit. */
  weapons: {
    pulse:   { damage: 9,  fireRate: 3.8, projectileSpeed: 640, price: 0,   pellets: 1, spread: 0,
               kind: 'bolt' },
    scatter: { damage: 7,  fireRate: 1.5, projectileSpeed: 560, price: 300, pellets: 5, spread: 0.38,
               kind: 'pellet' }, /* DPS 52.5 — close-range spread, falls off with distance */
    seeker:  { damage: 36, fireRate: 0.7, projectileSpeed: 420, price: 650, pellets: 1, spread: 0,
               homing: true, homingTurn: 3.6, life: 3.0, kind: 'missile' }, /* DPS 25.2 + homing */
  /* Phase 5: craft-only weapons */
  railgun:   { damage: 85, fireRate: 0.55, projectileSpeed: 950, price: 1200, pellets: 1, spread: 0,
               kind: 'slug', life: 1.4 }, /* DPS 46.8 — craft-only blue */
  seeker_mk2:{ damage: 50, fireRate: 0.8,  projectileSpeed: 480, price: 1400, pellets: 1, spread: 0,
               homing: true, homingTurn: 4.2, life: 3.2, kind: 'missile' }, /* DPS 40 + homing */
  /* weapons-arsenal phase: 14 new weapons across all tiers */
  shard:     { damage: 4,  fireRate: 4.5, projectileSpeed: 700,  price: 180,  pellets: 3, spread: 0.12,
               kind: 'bolt' },
  coilgun:   { damage: 20, fireRate: 2.2,  projectileSpeed: 800,  price: 420,  pellets: 1, spread: 0,
               kind: 'slug', life: 1.5 },
  repeater:  { damage: 9,  fireRate: 5.5,  projectileSpeed: 680,  price: 700,  pellets: 1, spread: 0,
               kind: 'orb' },
  flak:      { damage: 5,  fireRate: 1.4,  projectileSpeed: 520,  price: 850,  pellets: 9, spread: 0.55,
               kind: 'pellet' },
  beam:      { damage: 12, fireRate: 6.0,  projectileSpeed: 1200, price: 1600, pellets: 1, spread: 0,
               kind: 'beam', life: 0.55 },
  torpedo:   { damage: 110, fireRate: 0.45, projectileSpeed: 360,  price: 2400, pellets: 1, spread: 0,
               kind: 'missile', life: 4.0, blast: 130 },
  emp:       { damage: 18, fireRate: 1.2,  projectileSpeed: 600,  price: 3800, pellets: 1, spread: 0,
               kind: 'emp', emp: 3.0 },
  minelayer: { damage: 75, fireRate: 0.8,  projectileSpeed: 90,   price: 4200, pellets: 1, spread: 0,
               kind: 'mine', life: 14.0, mine: true, blast: 110 },
  lance:     { damage: 160, fireRate: 0.5, projectileSpeed: 1400, price: 5200, pellets: 1, spread: 0,
               kind: 'beam', life: 0.7 },
  hellbore:  { damage: 240, fireRate: 0.35, projectileSpeed: 1000, price: 9000, pellets: 1, spread: 0,
               kind: 'slug', life: 1.3, blast: 100 },
  storm:     { damage: 9, fireRate: 8.0,  projectileSpeed: 720,  price: 11000, pellets: 2, spread: 0.06,
               kind: 'orb' },
  starfall:  { damage: 20, fireRate: 6.0,  projectileSpeed: 900,  price: 22000, pellets: 3, spread: 0.08,
               kind: 'starfall' },
  sniper:    { damage: 120, fireRate: 0.7, projectileSpeed: 1600, price: 2000, pellets: 1, spread: 0,
               kind: 'slug', life: 1.4 },
  /* crafting-recipes-v2 phase: elite-drop craft-only weapon */
  annihilator:{ damage: 150, fireRate: 1.0, projectileSpeed: 950, price: 18000, pellets: 1, spread: 0,
               kind: 'slug', life: 1.4 }, /* DPS 150 — craft-only orange */
  vulcan:    { damage: 8,  fireRate: 10.0, projectileSpeed: 780,  price: 13500, pellets: 2, spread: 0.10,
               kind: 'bolt' },
  /* secrets-easter-eggs phase: hidden ultra weapons (secretOnly: never sold,
   * crafted, or dropped — granted only by secret means). */
  event_horizon:{ damage: 300, fireRate: 0.45, projectileSpeed: 1000, price: 0, pellets: 1, spread: 0,
               kind: 'slug', life: 1.4, blast: 260, emp: 4.0 },
  solar_requiem:{ damage: 38, fireRate: 7.0, projectileSpeed: 1350, price: 0, pellets: 2, spread: 0.05,
               kind: 'beam', life: 0.85, homing: true, homingTurn: 2.0 }
  },

  enemies: {
    drone:   { hp: 24,  speed: 150, radius: 12, contact: 10, creditsMin: 8,  creditsMax: 16,
               oreMin: 0, oreMax: 1, itemChance: 0.02, scoreName: 'Drone' },
    raider:  { hp: 46,  speed: 185, radius: 14, contact: 12, creditsMin: 22, creditsMax: 38,
               oreMin: 1, oreMax: 2, itemChance: 0.05,
               boltDamage: 7, boltSpeed: 380, fireInterval: 1.6, scoreName: 'Raider' },
    gunship: { hp: 130, speed: 105, radius: 20, contact: 18, creditsMin: 55, creditsMax: 95,
               oreMin: 2, oreMax: 4, itemChance: 0.10,
               boltDamage: 16, boltSpeed: 300, fireInterval: 3.2, homing: true, scoreName: 'Gunship' }
  },
  fleeHpFrac: 0.25,         // enemies flee when hp below this fraction
  patrolInterval: [8, 14],  // seconds between random-encounter patrol spawns
  patrolCap: 8,             // max live enemies from patrols
  patrolSize: [1, 3],

  asteroid: { hp: 34, oreMin: 2, oreMax: 4, radiusMin: 18, radiusMax: 42 },

  economy: {
    orePrice: 5,            // credits per ore when sold
    repairPerHp: 2,         // credits per hull point repaired
    enginePrice: 250,       // Engine Tuning: one-time
    engineSpeedMul: 1.22,
    shieldPrice: 250,       // Shield Cell: one-time
    shieldBonus: 30,
    travelCost: 50,         // fast travel credits
    respawnLoss: 0.10       // fraction of credits lost on death
  },

  station: {
    dockRadius: 130,
    promptRadius: 260
  },

  pickup: {
    magnetRadius: 150,
    collectRadius: 26,
    life: 25                // seconds before a pickup despawns
  }
};

SF.WEAPONS = [
  { id: 'pulse',   name: 'Pulse Laser',    tier: 'white', price: 0,
    color: '#7df9ff', modSlots: 1, desc: 'Reliable rapid-fire laser. Standard issue.' },
  { id: 'scatter', name: 'Scatter Cannon', tier: 'green', price: 300,
    color: '#3ddc5f', modSlots: 1, desc: 'Five-pellet spread. Devastating up close.' },
  { id: 'seeker',  name: 'Seeker Missiles', tier: 'blue', price: 650,
    color: '#3fa9ff', modSlots: 2, desc: 'Slow homing missiles. Fire and forget.' },
  /* Phase 5: craft-only weapons (hidden from store BUY rows, flagged craftOnly). */
  { id: 'railgun',   name: 'Railgun', tier: 'blue', price: 1200, craftOnly: true, modSlots: 2,
    color: '#9fd8ff', desc: 'Hypervelocity slug. Deletes what it touches. WORKBENCH ONLY.' },
  { id: 'seeker_mk2',name: 'Seeker Missiles Mk-II', tier: 'blue', price: 1400, craftOnly: true, modSlots: 2,
    color: '#3fa9ff', desc: 'Upgraded homing swarm. Fire and forget, twice. WORKBENCH ONLY.' },
  /* weapons-arsenal phase: 14 new weapons. modSlots: 1 on white/green, 2 on blue+. */
  { id: 'shard',   name: 'Shard Pistol',   tier: 'white', price: 180, modSlots: 1,
    color: '#e8e8e8', desc: 'Three-shard burst sidearm. Cheap and cheerful.' },
  { id: 'coilgun', name: 'Coil Gun',       tier: 'white', price: 420, modSlots: 1,
    color: '#cfd8ff', desc: 'Magnetic slug thrower. Hits like a truck, reloads like one.' },
  { id: 'repeater',name: 'Plasma Repeater',tier: 'green', price: 700, modSlots: 1,
    color: '#7dffb0', desc: 'Rapid plasma orbs. Melts drone swarms.' },
  { id: 'flak',    name: 'Flak Cannon',    tier: 'green', price: 850, modSlots: 1,
    color: '#ffd98a', desc: 'Nine-pellet wall of flak. Close-range shredder.' },
  { id: 'beam',    name: 'Beam Laser',     tier: 'blue', price: 1600, modSlots: 2,
    color: '#9fe8ff', desc: 'Continuous-fire lash. Tracks like a laser pointer of doom.' },
  { id: 'torpedo', name: 'Torpedo Tube',   tier: 'blue', price: 2400, modSlots: 2,
    color: '#ffb35e', desc: 'Slow heavy torpedo with a nasty blast radius.' },
  { id: 'sniper',  name: 'Longshot Cannon',tier: 'blue', price: 2000, modSlots: 2,
    color: '#cfe8ff', desc: 'Extreme-range hypervelocity round. For patient killers.' },
  { id: 'emp',     name: 'EMP Blaster',    tier: 'purple', price: 3800, modSlots: 2,
    color: '#d28aff', desc: 'Ion burst that STUNS targets for 3s. Robotics hate it.' },
  { id: 'minelayer',name: 'Mine Layer',    tier: 'purple', price: 4200, modSlots: 2,
    color: '#ff9df0', desc: 'Drops proximity mines. Patient hunters welcome.' },
  { id: 'lance',   name: 'Nova Lance',     tier: 'purple', price: 5200, modSlots: 2,
    color: '#c9b6ff', desc: 'One titanic beam. Erase a gunship from the ledger.' },
  { id: 'hellbore',name: 'Hellbore Cannon',tier: 'orange', price: 9000, modSlots: 2,
    color: '#ff7a3a', desc: 'Explosive slug with a 100u blast. Collateral encouraged.' },
  { id: 'storm',   name: 'Storm Repeater', tier: 'orange', price: 11000, modSlots: 2,
    color: '#8affd2', desc: 'Twin plasma streams at 8 shots/s. A weather event.' },
  { id: 'vulcan',  name: 'Vulcan Array',   tier: 'orange', price: 13500, modSlots: 2,
    color: '#ffcf6e', desc: 'Twin rotary bolts at 10/s. Ammo is a concept, not a limit.' },
  { id: 'starfall',name: 'Starfall Obliterator', tier: 'gold', price: 22000, modSlots: 2,
    color: '#ffd23f', desc: 'Legendary tri-bolt storm. The sky, weaponized.' },
  /* crafting-recipes-v2 phase: elite-drop craft-only weapon (hidden from
   * store BUY rows + enemy drop tables by the existing craftOnly filters). */
  { id: 'annihilator', name: 'Annihilator Cannon', tier: 'orange', price: 18000, craftOnly: true, modSlots: 2,
    color: '#ff6e3a', desc: 'Forged from elite wreckage. One 150-dmg slug at a time. WORKBENCH ONLY.' },
  /* secrets-easter-eggs phase: hidden ultra weapons. craftOnly keeps them out
   * of the store + enemy drop tables (existing filters); secretOnly documents
   * that no recipe grants them either. Obtainable only via secret means. */
  { id: 'event_horizon', name: 'Event Horizon Projector', tier: 'gold', price: 0,
    craftOnly: true, secretOnly: true, modSlots: 2,
    color: '#b45cff', desc: 'SECRET. Collapses a star into a trigger pull: 300dmg slug, 260u blast, 4s EMP. The Warden carried it.' },
  { id: 'solar_requiem', name: 'Solar Requiem', tier: 'gold', price: 0,
    craftOnly: true, secretOnly: true, modSlots: 2,
    color: '#ffe9a8', desc: 'SECRET. Twin seeker-beams that hunt like they hold a grudge. The Reliquary held it.' }
];
SF.WEAPON_BY_ID = {};
SF.WEAPONS.forEach(w => { SF.WEAPON_BY_ID[w.id] = w; });

/* ================= weapons-arsenal phase: mods + drop tables ================= */

/* Lootable weapon mods. mul: damage / rate / range multipliers applied per mod.
 * mods stack across slots (multiplicative). */
SF.MODS = [
  { id: 'coils',    name: 'Extended Coils',  tier: 'white',  price: 250,
    mul: { dmg: 1.15, rate: 1,    range: 1 },
    color: '#e8e8e8', desc: 'Overwound magnetics: +15% damage.' },
  { id: 'overclock',name: 'Overclock Core',  tier: 'green',  price: 600,
    mul: { dmg: 1,    rate: 1.20, range: 1 },
    color: '#3ddc5f', desc: 'Pushes the cyclic rate: +20% fire rate.' },
  { id: 'amplifier',name: 'Damage Amplifier',tier: 'blue',   price: 1400,
    mul: { dmg: 1.30, rate: 1,    range: 1 },
    color: '#3fa9ff', desc: 'Pre-fire charge chamber: +30% damage.' },
  { id: 'fury',     name: 'Fury Regulator',  tier: 'purple', price: 3200,
    mul: { dmg: 1,    rate: 1.30, range: 1.25 },
    color: '#b45cff', desc: 'Military-grade limiter bypass: +30% fire rate, +25% range.' }
];
SF.MOD_BY_ID = {};
SF.MODS.forEach(function (m) { SF.MOD_BY_ID[m.id] = m; });

/* Tier-appropriate weapon drops by enemy type (craft-only weapons never drop). */
SF.WEAPON_DROPS = {
  drone:   ['shard', 'coilgun'],
  raider:  ['shard', 'coilgun', 'repeater', 'flak'],
  gunship: ['repeater', 'flak', 'beam', 'torpedo', 'sniper', 'emp', 'minelayer', 'lance']
};
SF.MOD_DROPS = {
  drone:   ['coils'],
  raider:  ['coils', 'overclock'],
  gunship: ['overclock', 'amplifier', 'fury']
};
SF.CONFIG.weaponDrops = { drone: 0.04, raider: 0.08, gunship: 0.14 };
SF.CONFIG.modDrops = { drone: 0.02, raider: 0.05, gunship: 0.09 };

/* Lootable components (kind: component). Sold at Haven Dock. */
SF.ITEMS = [
  { id: 'fluxcap',  name: 'Flux Capacitor',  tier: 'green',  kind: 'component', price: 70,
    desc: 'Hums faintly. Someone will pay for that hum.' },
  { id: 'plasmacoil', name: 'Plasma Coil',   tier: 'blue',   kind: 'component', price: 150,
    desc: 'Still warm from whatever it powered.' },
  { id: 'gravcore', name: 'Gravitic Core',   tier: 'purple', kind: 'component', price: 320,
    desc: 'Bends light a little. Bends prices a lot.' }
];
SF.ITEM_BY_ID = {};
SF.ITEMS.forEach(i => { SF.ITEM_BY_ID[i.id] = i; });

/* Weighted item drop table by enemy type (weights over SF.ITEMS index). */
SF.ITEM_DROPS = {
  drone:   [80, 20, 0],
  raider:  [55, 35, 10],
  gunship: [25, 45, 30]
};

/* Star systems. enemyTable entries: [typeId, weight]. */
SF.SYSTEMS = [
  { id: 'solace', name: 'Solace', color: '#7df9ff', desc: 'Calm core system. Haven Dock keeps the peace.',
    enemyMul: 1.0, asteroids: 26,
    enemyTable: [['drone', 60], ['raider', 40]],
    station: { name: 'Haven Dock', x: 2100, y: 2100 } },
  { id: 'drift', name: 'Drift', color: '#b45cff', desc: 'Nebula-choked frontier. Raiders breed here.',
    enemyMul: 1.25, asteroids: 30,
    enemyTable: [['drone', 30], ['raider', 50], ['gunship', 20]],
    station: null },
  { id: 'ember', name: 'Ember', color: '#ff8c2e', desc: 'Burning rim system. Only gunships and ghosts.',
    enemyMul: 1.6, asteroids: 22,
    enemyTable: [['raider', 40], ['gunship', 60]],
    station: null }
];
SF.SYSTEM_BY_ID = {};
SF.SYSTEMS.forEach(s => { SF.SYSTEM_BY_ID[s.id] = s; });

/* twelve-hour-wave3 (B4): the 9 above used to live here. It is deleted,
 * not moved: the CANONICAL assignment is the single one at the end of
 * this file (see below). Two literals in one file meant the value
 * depended on which line ran last; one literal means it cannot. */

/* ================= gameplay-depth phase: difficulty, encounters, bounties ================= */

/* System danger scaling (gameplay-depth). budget scales spawn size/frequency,
 * dmgMul/fireMul scale enemy loadouts. Solace < Drift < Ember. */
SF.CONFIG.difficulty = {
  solace: { label: 'CALM',   budget: 1.0, dmgMul: 1.00, fireMul: 1.00 },
  drift:  { label: 'ROUGH',  budget: 1.4, dmgMul: 1.15, fireMul: 0.90 },
  ember:  { label: 'DEADLY', budget: 1.8, dmgMul: 1.30, fireMul: 0.80 }
};

/* early-game-difficulty-1 (2026-10-22): rookie grace. User report: a Lv1
 * pilot in a starter Fighter (Pulse Laser 9dmg, hull 90 + shield 45) could
 * die in Solace — the CALM starter system — within the first minutes,
 * including to a capital boss (Solace Warden, boltDamage 10) that committed
 * 45s after system entry and gunship ambush escalations (16dmg homing).
 * While the pilot is a rookie IN SOLACE ONLY, enemy bolts hit softer and
 * slower and the worst spawn classes are held back. The window is derived
 * from the already-saved pilot level (SF.Skills.level(), save blob
 * 'skills'); NOTHING here is serialized — no new save field, no
 * SAVE_VERSION bump. Easing: t = (level-1)/(fullLevel-1) clamped 0..1;
 * level 1 -> full grace, level 2 -> half, level >= fullLevel -> none.
 * Tunables (coordinator-adjustable from the phase REPORT table):
 *   dmgAtStart:      bolt damage multiplier at level 1
 *   fireIntAtStart:  fire-interval multiplier at level 1 (>1 = slower fire)
 *   contactAtStart:  contact/ramming damage multiplier at level 1 —
 *                    measured separately because the probe showed ramming
 *                    is ~75% of a stationary rookie's incoming damage
 *                    (a drone glued to the hull at 10dmg / 0.6s cooldown)
 *   havenRange:      Haven Dock safe-zone radius (dock approach bubble)
 * Applied in js/enemies.js (SF.Enemies.rookieFactor) + js/gameplay.js
 * encounter gates. */
SF.CONFIG.rookie = {
  systemId: 'solace',
  fullLevel: 3,
  dmgAtStart: 0.55,
  fireIntAtStart: 1.50,
  contactAtStart: 0.45,
  havenRange: 650
};

/* Per-class AI behavior profiles (gameplay-depth).
 * kind: swarmer | flanker | juggernaut. flank=true -> coordinated flanking
 * maneuvers (squads split left/right instead of all orbiting one way). */
SF.CONFIG.aiProfiles = {
  drone:   { kind: 'swarmer',    flank: false, weave: 0.9,  strafeWant: 0,   fleeSpd: 1.10, focusRange: 500 },
  raider:  { kind: 'flanker',    flank: true,  weave: 0.4,  strafeWant: 300, fleeSpd: 1.25, focusRange: 650 },
  gunship: { kind: 'juggernaut', flank: false, weave: 0.15, strafeWant: 380, fleeSpd: 1.00, focusRange: 750 }
};

/* Random encounters v2 (gameplay-depth): per-system weighted encounter tables.
 * patrol: faction-aware patrol spawn (existing). ambush: pirate pack with an
 * escalation wave. convoy: neutral trader convoy (attackable, consequences).
 * distress: adrift ship (50% pirate trap). minefield: hostile mines. */
SF.CONFIG.encounters = {
  solace: [ ['patrol', 55], ['ambush', 25], ['convoy', 12], ['distress', 8] ],
  drift:  [ ['patrol', 40], ['ambush', 35], ['convoy', 10], ['distress', 10], ['minefield', 5] ],
  ember:  [ ['patrol', 30], ['ambush', 50], ['convoy', 5],  ['distress', 8],  ['minefield', 7] ]
};

/* Bounty target name pools (gameplay-depth): procedural named targets. */
SF.BOUNTY_FIRST = ['Vex','Kara','Dain','Mira','Joss','Renn','Talia','Bram','Sable','Onyx',
  'Pike','Nyra','Corv','Dax','Ilsa','Morgo','Seth','Quill','Raza','Vonn'];
SF.BOUNTY_LAST = ['the Red','Blackhand','Starbleed','Voidscream','Ironjaw','the Pale',
  'Nightfire','Rusttongue','Deadreckoning','Grimwake','Holloweye','Bloodwake',
  'Frostbite','Doomcaller','Ashborn','Keelhaul','Starfall','Voidborn','Darkmatter','Widowmaker'];
SF.BOUNTY_TITLES = ['of the Drift','of Ember Row','the Unforgiven','of the Shattered Belt',
  'the Relentless'];
SF.CONFIG.bounty = {
  reward: { raider: [400, 900], gunship: [900, 2000] },
  dangerMul: { solace: 1.0, drift: 1.4, ember: 1.9 },
  eliteHpMul: 1.25,      // named targets are tougher than baseline
  sponsorBonus: 8,       // standing with the sponsoring faction
  renegadePenalty: 6,    // standing lost with the target's faction (renegade bounties)
  karmaBonus: 3          // karma for a lawful kill
};

/* ================= Phase 5: crafting + trading ================= */

SF.CONFIG.trading = {
  baseCargo: 20,        // every hull gets a free 20t hold on top of fitted cargo parts
  driftPct: 0.08,       // market prices drift +/-8% per dock visit
  driftMin: 0.5, driftMax: 2.0,
  sellSpread: 0.85,     // station sells for 85% of buy price (same visit)
  standingNeed: 25,      // standing >= 25 -> 5% better prices
  standingCut: 0.95,    // buy 5% cheaper
  standingBonus: 1.05,  // sell 5% richer
  systemFaction: { solace: 'compact', drift: 'drifters', ember: 'ember' },
  goods: [
    { id: 'food',     name: 'Foodstuffs',    base: 12 },
    { id: 'fuel',     name: 'Reactor Fuel',  base: 30 },
    { id: 'minerals', name: 'Raw Minerals',  base: 20 },
    { id: 'meds',     name: 'Medicine',      base: 45 },
    { id: 'elec',     name: 'Electronics',   base: 80 },
    { id: 'lux',      name: 'Luxuries',      base: 150 }
  ],
  /* balance-perf: spreads widened — real routes now clear 50+ cr/unit
   * (e.g. lux drift 0.8 -> solace 1.4: buy 120, sell 178 = +58/unit). */
  systemMul: {
    solace: { food: 0.8, fuel: 1.0, minerals: 1.3, meds: 1.2, elec: 0.8, lux: 1.4 },
    drift:  { food: 1.4, fuel: 1.2, minerals: 0.6, meds: 1.5, elec: 1.3, lux: 0.8 },
    ember:  { food: 1.6, fuel: 0.7, minerals: 1.0, meds: 0.8, elec: 1.5, lux: 1.0 }
  }
};

/* ================= Phase 3: crew & boarding ================= */

SF.CONFIG.crew = {
  hireBase: 150,        // hire cost = hireBase * hireGrowth^(stars-1)
  hireGrowth: 2.4,
  roleBase: { marine: 10, gunner: 6, engineer: 4 }, // boarding power at 1 star
  marineBoardMul: 2,    // marines count double in boarding assaults
  enemyCrewPower: 8,    // per-head boarding power of enemy crew (before star mult)
  depleteHullStep: 0.1, // each 10% of max hull lost...
  depleteCrewFrac: 0.1, // ...kills ~10% of crew (marines die last)
  rescueCost: 400,      // distress tow to nearest station
  rescueOreLoss: 0.25,  // fraction of ore lost on rescue
  boardRange: 230,      // board prompt appears within this distance
  boardHullFrac: 0.2,   // boardable when enemy hull below this fraction
  roundTime: 0.9,       // seconds per boarding round
  roundCasualties: 3,   // base casualty scale per round (scaled by power share)
  captureBonusMul: 2,   // captured-ship credit loot multiplier
  rosterSize: 4         // hire candidates per dock visit
};

/* Enemy crew complements (Phase 3). Drones are automated: no crew, can't be boarded. */
SF.CONFIG.enemies.drone.crew = 0;
SF.CONFIG.enemies.drone.automated = true;
SF.CONFIG.enemies.raider.crew = 3;
SF.CONFIG.enemies.raider.crewStars = [1, 2];
SF.CONFIG.enemies.gunship.crew = 8;
SF.CONFIG.enemies.gunship.crewStars = [2, 3];

/* ================= Phase 2: ship classes, parts, upgrades ================= */

SF.CONFIG.upgrades = {
  starStep: 0.25,      // each star multiplies part/weapon stats by (1 + starStep*(stars-1))
  partCreditMul: 0.6,  // upgrade credit cost = price * partCreditMul * toStar^2 * tierMul
  weaponCreditMul: 0.8,
  oreDiv: 40,          // upgrade ore cost = round(price / oreDiv * toStar)
  weaponBasePrice: 100 // upgrade cost basis for price-0 weapons (Pulse Laser)
};
SF.CONFIG.partDrops = { raider: 0.03, gunship: 0.08 }; // chance to drop a white/green part

/* Ship classes. Bigger = more grid slots, slower, hungrier crew. */
SF.SHIP_CLASSES = [
  { id: 'fighter',     name: 'Fighter',     gridW: 4,  gridH: 3,  speed: 250, hull: 90,
    shield: 45,  crewReq: 1,  cargoBonus: 0,  price: 0,
    color: '#9fd8ff', desc: 'Nimble starter frame. Everybody learns in one of these.' },
  { id: 'interceptor', name: 'Interceptor', gridW: 4,  gridH: 4,  speed: 300, hull: 65,
    shield: 35,  crewReq: 1,  cargoBonus: 0,  price: 800,
    color: '#7df9ff', desc: 'Paper hull, absurd engines. Catch anything.' },
  { id: 'frigate',     name: 'Frigate',     gridW: 6,  gridH: 4,  speed: 220, hull: 170,
    shield: 85,  crewReq: 3,  cargoBonus: 0,  price: 2500,
    color: '#3fa9ff', desc: 'The workhorse. Room to grow in every direction.' },
  { id: 'hauler',       name: 'Hauler',      gridW: 6,  gridH: 5,  speed: 165, hull: 210,
    shield: 65,  crewReq: 4,  cargoBonus: 60, price: 4000,
    color: '#3ddc5f', desc: 'Trading barge. Slow, fat, profitable.' },
  { id: 'corvette',     name: 'Corvette',    gridW: 7,  gridH: 5,  speed: 200, hull: 270,
    shield: 125, crewReq: 6,  cargoBonus: 0,  price: 8000,
    color: '#b45cff', desc: 'Escort hunter. Enough guns to matter.' },
  { id: 'destroyer',    name: 'Destroyer',   gridW: 8,  gridH: 6,  speed: 180, hull: 430,
    shield: 185, crewReq: 10, cargoBonus: 0,  price: 16000,
    color: '#ff8c2e', desc: 'Line ship. Brings its own weather.' },
  { id: 'battleship',   name: 'Battleship',  gridW: 10, gridH: 7,  speed: 150, hull: 720,
    shield: 310, crewReq: 18, cargoBonus: 0,  price: 32000,
    color: '#ff5e3a', desc: 'A wall with engines and opinions.' },
  { id: 'carrier',      name: 'Carrier',     gridW: 11, gridH: 8,  speed: 130, hull: 950,
    shield: 400, crewReq: 30, cargoBonus: 40, price: 55000,
    color: '#ffd23f', desc: 'Carries wings, crew, and grudges.' },
  { id: 'mothership',   name: 'Mothership',  gridW: 14, gridH: 10, speed: 105, hull: 1600,
    shield: 650, crewReq: 60, cargoBonus: 0,  price: 100000,
    color: '#ff4fd8', desc: 'A city that decided to fly.' }
];
SF.SHIP_CLASS_BY_ID = {};
SF.SHIP_CLASSES.forEach(function (c) { SF.SHIP_CLASS_BY_ID[c.id] = c; });

/* Parts. power > 0 generates, power < 0 consumes. stats keys: speed/hull/shield/cargo/crew/slots. */
SF.PARTS = [
  { id: 'ion_thruster',    name: 'Ion Thruster',    type: 'engine',  tier: 'white', maker: 'kestrel',  w: 1, h: 2, power: -8,  stats: { speed: 30 },   price: 200,  desc: '+30 engine speed.' },
  { id: 'fusion_drive',    name: 'Fusion Drive',    type: 'engine',  tier: 'green', maker: 'kestrel',  w: 1, h: 2, power: -14, stats: { speed: 70 },   price: 600,  desc: '+70 engine speed.' },
  { id: 'antimatter_torch',name: 'Antimatter Torch',type: 'engine',  tier: 'blue', maker: 'kestrel',   w: 2, h: 2, power: -26, stats: { speed: 140 },  price: 1800, desc: '+140 engine speed.' },
  { id: 'warp_coil',       name: 'Warp Coil',       type: 'engine',  tier: 'purple', maker: 'kestrel', w: 2, h: 3, power: -45, stats: { speed: 240 },  price: 4500, desc: '+240 engine speed.' },

  { id: 'fission_cell',    name: 'Fission Cell',    type: 'reactor', tier: 'white', maker: 'vantia',  w: 1, h: 1, power: 20,  stats: {},               price: 150,  desc: '+20 power.' },
  { id: 'fusion_core',     name: 'Fusion Core',     type: 'reactor', tier: 'green', maker: 'vantia',  w: 2, h: 2, power: 55,  stats: {},               price: 700,  desc: '+55 power.' },
  { id: 'quantum_reactor', name: 'Quantum Reactor', type: 'reactor', tier: 'blue', maker: 'vantia',   w: 2, h: 2, power: 110, stats: {},               price: 2000, desc: '+110 power.' },
  { id: 'singularity_core',name: 'Singularity Core',type: 'reactor', tier: 'orange', maker: 'vantia', w: 3, h: 3, power: 260, stats: {},               price: 9000, desc: '+260 power. Handle with respect.' },

  { id: 'deflector_dish',  name: 'Deflector Dish',  type: 'shield',  tier: 'white', maker: 'aegis',  w: 1, h: 1, power: -6,  stats: { shield: 25 },   price: 180,  desc: '+25 max shield.' },
  { id: 'phase_shield',    name: 'Phase Shield',    type: 'shield',  tier: 'green', maker: 'aegis',  w: 2, h: 1, power: -12, stats: { shield: 60 },   price: 650,  desc: '+60 max shield.' },
  { id: 'aegis_generator', name: 'Aegis Generator', type: 'shield',  tier: 'blue', maker: 'aegis',   w: 2, h: 2, power: -25, stats: { shield: 130 },  price: 1900, desc: '+130 max shield.' },
  { id: 'nova_barrier',    name: 'Nova Barrier',    type: 'shield',  tier: 'purple', maker: 'aegis', w: 3, h: 2, power: -50, stats: { shield: 260 },  price: 5200, desc: '+260 max shield.' },

  { id: 'light_hardpoint', name: 'Light Hardpoint', type: 'mount',   tier: 'white', maker: 'helion',  w: 1, h: 1, power: -4,  stats: { slots: 1 },     price: 250,  turret: true,  desc: '+1 weapon slot. Turret: tracks the aim stick 360°.' },
  { id: 'heavy_hardpoint', name: 'Heavy Hardpoint', type: 'mount',   tier: 'green', maker: 'helion',  w: 2, h: 1, power: -10, stats: { slots: 2 },     price: 900,  turret: false, desc: '+2 weapon slots. Fixed forward.' },
  { id: 'titan_mount',     name: 'Titan Mount',     type: 'mount',   tier: 'blue', maker: 'helion',   w: 2, h: 2, power: -20, stats: { slots: 3 },     price: 2400, turret: false, desc: '+3 weapon slots. Fixed forward.' },

  { id: 'cargo_hold',      name: 'Cargo Hold',      type: 'cargo',   tier: 'white', maker: 'vantia',  w: 2, h: 2, power: -5,  stats: { cargo: 40 },    price: 300,  desc: '+40 cargo space.' },
  { id: 'freight_bay',     name: 'Freight Bay',     type: 'cargo',   tier: 'green', maker: 'vantia',  w: 3, h: 2, power: -10, stats: { cargo: 100 },   price: 900,  desc: '+100 cargo space.' },
  { id: 'vault_bay',       name: 'Vault Bay',       type: 'cargo',   tier: 'blue', maker: 'vantia',   w: 3, h: 3, power: -18, stats: { cargo: 220 },   price: 2500, desc: '+220 cargo space.' },

  { id: 'crew_bunks',      name: 'Crew Bunks',      type: 'quarters',tier: 'white', maker: 'vantia',  w: 2, h: 1, power: -4,  stats: { crew: 2 },      price: 250,  desc: '+2 crew capacity.' },
  { id: 'hab_deck',        name: 'Habitation Deck', type: 'quarters',tier: 'green', maker: 'vantia',  w: 2, h: 2, power: -9,  stats: { crew: 6 },      price: 800,  desc: '+6 crew capacity.' },
  { id: 'command_spire',   name: 'Command Spire',   type: 'quarters',tier: 'blue', maker: 'vantia',   w: 3, h: 2, power: -16, stats: { crew: 14 },     price: 2200, desc: '+14 crew capacity.' },

  { id: 'hull_plating',    name: 'Hull Plating',    type: 'armor',   tier: 'white', maker: 'vantia',  w: 1, h: 1, power: -2,  stats: { hull: 20 },     price: 150,  desc: '+20 max hull.' },
  { id: 'composite_armor', name: 'Composite Armor', type: 'armor',   tier: 'green', maker: 'vantia',  w: 2, h: 2, power: -6,  stats: { hull: 70 },     price: 700,  desc: '+70 max hull.' },
  { id: 'neutronium_weave',name: 'Neutronium Weave',type: 'armor',   tier: 'purple', maker: 'vantia', w: 2, h: 2, power: -12, stats: { hull: 180 },    price: 3200, desc: '+180 max hull.' },

  /* Phase 5: craft-only parts (workbench outputs, flagged craftOnly, hidden from store BUY rows). */
  { id: 'craft_phase_shield',    name: 'Phase Shield (Crafted)',   type: 'shield',  tier: 'green', maker: 'aegis',  w: 2, h: 1, power: -12, stats: { shield: 80 },  price: 900,  craftOnly: true, desc: '+80 max shield. Bench-tuned.' },
  { id: 'craft_fusion_drive',    name: 'Fusion Drive (Crafted)',   type: 'engine',  tier: 'green', maker: 'kestrel',  w: 1, h: 2, power: -13, stats: { speed: 90 },   price: 1000, craftOnly: true, desc: '+90 engine speed. Bench-tuned.' },
  { id: 'craft_aegis_generator', name: 'Aegis Generator (Crafted)',type: 'shield',  tier: 'blue', maker: 'aegis',   w: 2, h: 2, power: -22, stats: { shield: 155 }, price: 2600, craftOnly: true, desc: '+155 max shield. Bench-tuned.' },
  { id: 'craft_overdrive_coil',  name: 'Overdrive Coil',           type: 'engine',  tier: 'blue', maker: 'helion',   w: 2, h: 2, power: -30, stats: { speed: 175 },  price: 4200, craftOnly: true, desc: '+175 engine speed. Experimental winding.' },
  { id: 'craft_bastion_array',   name: 'Bastion Array',            type: 'shield',  tier: 'purple', maker: 'aegis', w: 3, h: 2, power: -55, stats: { shield: 310 }, price: 7000, craftOnly: true, desc: '+310 max shield. Station-grade plating.' },
  { id: 'craft_smugglers_hold',  name: "Smuggler's Hold",          type: 'cargo',   tier: 'blue', maker: 'vantia',   w: 3, h: 3, power: -15, stats: { cargo: 180 }, price: 2400, craftOnly: true, scanEvade: 0.5, desc: '+180 cargo space. Shielded bays halve customs detection. No questions asked.' },
  { id: 'craft_singularity_core',name: 'Singularity Core (Crafted)',type: 'reactor', tier: 'orange', maker: 'vantia', w: 3, h: 3, power: 320,  stats: {},              price: 11000,craftOnly: true, desc: '+320 power. Bench-tuned to the edge.' },
  /* crafting-recipes-v2 phase: craft-only recipe outputs (hidden from store
   * BUY rows by the existing craftOnly filter in station.js).
   * - elite-drop line: forged from the components elites guarantee-drop
   * - smuggler-hold upgrade line: Mk-II consumes the Mk-I hold, Mk-III the Mk-II
   * - companion-loyalty rewards: gated on SF.CompanionQuests loyalty tier 3 */
  { id: 'craft_warden_plate',    name: 'Warden Plate (Crafted)',  type: 'shield',  tier: 'purple', maker: 'aegis',   w: 3, h: 2, power: -60, stats: { shield: 420 }, price: 10000, craftOnly: true, desc: '+420 max shield. Forged from elite wreckage.' },
  { id: 'craft_hellburner_drive',name: 'Hellburner Drive (Crafted)',type: 'engine', tier: 'orange', maker: 'helion',  w: 2, h: 2, power: -42, stats: { speed: 260 },  price: 17000, craftOnly: true, desc: '+260 engine speed. Burns elite salvage.' },
  { id: 'craft_smugglers_hold_2',name: "Smuggler's Hold Mk-II",    type: 'cargo',   tier: 'purple', maker: 'vantia',  w: 3, h: 3, power: -18, stats: { cargo: 320 },  price: 7000,  craftOnly: true, scanEvade: 0.65, desc: "+320 cargo space. Customs catches 35% of you." },
  { id: 'craft_smugglers_hold_3',name: "Smuggler's Hold Mk-III",   type: 'cargo',   tier: 'orange', maker: 'vantia',  w: 3, h: 3, power: -22, stats: { cargo: 500 },  price: 15000, craftOnly: true, scanEvade: 0.8,  desc: '+500 cargo space. A ghost with a cargo manifest.' },
  { id: 'craft_vex_gambit',     name: "Vex's Gambit (Crafted)",    type: 'engine',  tier: 'purple', maker: 'kestrel', w: 2, h: 2, power: -34, stats: { speed: 215 },  price: 9000,  craftOnly: true, desc: "+215 engine speed. Vex tunes it herself. Loyalty reward." },
  { id: 'craft_bram_bulwark',   name: "Bram's Bulwark (Crafted)",  type: 'shield',  tier: 'purple', maker: 'aegis',   w: 3, h: 2, power: -58, stats: { shield: 360 }, price: 9000,  craftOnly: true, desc: "+360 max shield. Old navy plating, Bram-approved. Loyalty reward." }
];
SF.PART_BY_ID = {};
SF.PARTS.forEach(function (p) { SF.PART_BY_ID[p.id] = p; });

/* ================= set-bonuses phase (2026-10-19) =================
 * Manufacturer set bonuses. Each part carries a `maker` line; fitting 2/3/4
 * parts from the same line grants an escalating multiplier to one stat.
 * Purely computed from the active ship's fitted parts (SF.Player.setMul) —
 * save-neutral, no save-version bump, no new saved fields. */
SF.SET_LINES = {
  helion: { name: 'Helion Dynamics', color: '#ff7a3a', stat: 'dmg',
            tiers: { 2: { mul: 1.05, text: '+5% weapon damage' },
                     3: { mul: 1.12, text: '+12% weapon damage' },
                     4: { mul: 1.20, text: '+20% weapon damage' } },
            desc: 'Gun-metal workhorses. Helion parts hit harder, together.' },
  aegis:  { name: 'Aegis Systems', color: '#3fa9ff', stat: 'shield',
            tiers: { 2: { mul: 1.10, text: '+10% max shield' },
                     3: { mul: 1.20, text: '+20% max shield' },
                     4: { mul: 1.35, text: '+35% max shield' } },
            desc: 'Shield weavers. Aegis hulls shrug off what others fear.' },
  kestrel:{ name: 'Kestrel Drive Yards', color: '#7df9ff', stat: 'speed',
            tiers: { 2: { mul: 1.06, text: '+6% engine speed' },
                     3: { mul: 1.12, text: '+12% engine speed' },
                     4: { mul: 1.20, text: '+20% engine speed' } },
            desc: 'Drives and the power to feed them. Kestrel ships arrive first.' },
  vantia: { name: 'Vantia Works', color: '#3ddc5f', stat: 'regen',
            tiers: { 2: { mul: 1.15, text: '+15% shield regen' },
                     3: { mul: 1.30, text: '+30% shield regen' },
                     4: { mul: 1.50, text: '+50% shield regen' } },
            desc: 'Utilitarian guts — reactors, holds, quarters. Vantia crews bounce back.' }
};
SF.LINE_BY_ID = SF.SET_LINES;

SF.TIER_MUL = { white: 1, green: 1.5, blue: 2.2, purple: 3.2, orange: 4.5, gold: 6 };

/* ================= planets-facilities phase (save v9 -> v10) ================= */

/* Dockable planets. facilities: bar | blackmarket | repair | news.
 * goods: trade-good ids this planet prices well (local production). */
SF.PLANETS = [
  { id: 'verdant',  name: 'Verdant Prime', systemId: 'solace', x: 900,  y: 3200,
    color: '#3ddc5f', desc: 'Agri-world breadbasket of the Compact. Lawful, green, boring in the best way.',
    faction: 'compact', facilities: ['bar', 'repair', 'news'], goods: ['food', 'meds'] },
  { id: 'rustanch', name: 'Rust Anchorage', systemId: 'solace', x: 3300, y: 900,
    color: '#b06a3a', desc: 'Rust-belt mining colony. The Compact collects taxes; the miners collect grudges.',
    faction: 'drifters', facilities: ['bar', 'blackmarket', 'repair'], goods: ['minerals', 'fuel'] },
  { id: 'kestrel',  name: 'New Kestrel', systemId: 'drift', x: 800,  y: 800,
    color: '#3fa9ff', desc: 'Free-port boomtown. If it can be sold, it is sold here. If it cannot, ask downstairs.',
    faction: 'drifters', facilities: ['bar', 'blackmarket', 'repair', 'news'], goods: ['elec', 'lux'] },
  { id: 'shatters', name: 'The Shatters', systemId: 'drift', x: 3400, y: 3300,
    color: '#8a7a6a', desc: 'Shattered planetoid, no law, no taxes, no rescue. The Drift\u2019s open secret.',
    faction: null, facilities: ['blackmarket', 'repair'], goods: ['minerals', 'fuel'] },
  { id: 'cinder',   name: 'Cinderfall', systemId: 'ember', x: 1100, y: 3100,
    color: '#ff5e3a', desc: 'Volcanic forge-world. The Ember Pact builds its warships over rivers of lava.',
    faction: 'ember', facilities: ['bar', 'repair', 'news'], goods: ['fuel', 'elec'] },
  { id: 'deadlight',name: 'Deadlight', systemId: 'ember', x: 3200, y: 700,
    color: '#b45cff', desc: 'Irradiated graveyard of a dead fleet. Scavengers, ghosts, and very quiet deals.',
    faction: null, facilities: ['blackmarket', 'repair', 'news'], goods: ['lux', 'elec'] }
];
SF.PLANET_BY_ID = {};
SF.PLANETS.forEach(function (p) { SF.PLANET_BY_ID[p.id] = p; });

/* Faction HQ capital stations. inventory: hqOnly item ids. bm: black market presence. */
SF.FACTION_HQ = [
  { id: 'aegis',  name: 'Aegis Citadel', factionId: 'compact',  systemId: 'solace', x: 2900, y: 2900,
    blurb: 'The gleaming fist of Compact law. Every corridor polished, every form in triplicate.',
    inventory: ['guardian_lance', 'aegis_plating'], bm: false,
    stock: ['beam', 'torpedo', 'coilgun', 'aegis_generator', 'composite_armor'] },
  { id: 'karavan', name: 'Karavan Prime', factionId: 'drifters', systemId: 'drift', x: 2100, y: 2100,
    blurb: 'A lashed-together city of docked hulls. The Drifters\u2019 floating capital — bring credits, leave richer.',
    inventory: ['smugglers_tuning'], bm: true,
    stock: ['scatter', 'repeater', 'flak', 'fusion_drive', 'freight_bay', 'craft_smugglers_hold'] },
  { id: 'ashen',  name: 'Ashen Throne', factionId: 'ember',    systemId: 'ember', x: 2100, y: 2100,
    blurb: 'Throne of the Ember Pact. The air smells of ozone and ambition.',
    inventory: ['cinder_reaper'], bm: true,
    stock: ['hellbore', 'storm', 'lance', 'neutronium_weave', 'antimatter_torch'] }
];
SF.HQ_BY_ID = {};
SF.FACTION_HQ.forEach(function (h) { SF.HQ_BY_ID[h.id] = h; });

/* HQ-exclusive weapons (hqOnly: never in the regular store; firing stats are
 * generic kinds so no ship.js changes are needed). */
SF.CONFIG.weapons.guardian_lance = { damage: 140, fireRate: 0.6, projectileSpeed: 1300,
  price: 6800, pellets: 1, spread: 0, kind: 'beam', life: 0.7 };
SF.CONFIG.weapons.cinder_reaper = { damage: 75, fireRate: 0.9, projectileSpeed: 380,
  price: 5200, pellets: 1, spread: 0, kind: 'missile', homing: true, homingTurn: 3.0, life: 3.5, blast: 90 };
SF.WEAPONS.push(
  { id: 'guardian_lance', name: 'Guardian Lance', tier: 'purple', price: 6800,
    hqOnly: 'compact', modSlots: 2, color: '#9fe8ff',
    desc: 'AEGIS ONLY. Compact beam doctrine in a tube. Requires Compact standing 25+.' },
  { id: 'cinder_reaper', name: 'Cinder Reaper', tier: 'purple', price: 5200,
    hqOnly: 'ember', modSlots: 2, color: '#ff7a3a',
    desc: 'ASHEN ONLY. Ember homing torpedo with a 90u blast. Requires Ember standing 25+.' }
);
SF.WEAPON_BY_ID.guardian_lance = SF.WEAPONS[SF.WEAPONS.length - 2];
SF.WEAPON_BY_ID.cinder_reaper = SF.WEAPONS[SF.WEAPONS.length - 1];

/* HQ-exclusive mod (drifters) and part (compact). */
SF.MODS.push(
  { id: 'smugglers_tuning', name: "Smuggler's Tuning", tier: 'green', price: 900,
    hqOnly: 'drifters', mul: { dmg: 1.10, rate: 1.10, range: 1.30 }, color: '#7dffb0',
    desc: 'KARAVAN ONLY. +10% dmg, +10% rate, +30% range. Requires Drifters standing 25+.' }
);
SF.MOD_BY_ID.smugglers_tuning = SF.MODS[SF.MODS.length - 1];
SF.PARTS.push(
  { id: 'aegis_plating', name: 'Aegis Plating', type: 'armor', tier: 'blue', maker: 'aegis',
    w: 2, h: 2, power: -10, stats: { hull: 120 }, price: 2600, hqOnly: 'compact',
    desc: '+120 max hull. AEGIS ONLY. Requires Compact standing 25+.' }
);
SF.PART_BY_ID.aegis_plating = SF.PARTS[SF.PARTS.length - 1];

/* Black-market contraband (illegal everywhere civilized). */
SF.CONFIG.contraband = {
  sellSpread: 0.85,   // station buys at 85% of the ask
  karmaPerBuy: -1,     // the underworld remembers a customer
  fenceMul: 2.5,       // smuggling-runs: stations quietly fence hot goods at 2.5x street price
  goods: [
    { id: 'bliss', name: 'Stardust Bliss', base: 220, desc: 'Euphoric dust. Illegal on every civilized rock.' },
    { id: 'stims', name: 'Combat Stims',   base: 150, desc: 'Military-grade reflex boosters. Unlicensed.' },
    { id: 'arms_c', name: 'Unregistered Arms', base: 480, desc: 'Serials filed off. Ask no questions.' },
    { id: 'cyber', name: 'Grey Cyberware', base: 650, desc: 'Second-hand neuralware. Still warm.' },
    { id: 'xeno_c', name: 'Xenotech Relics', base: 900, desc: 'Pre-Fall artifacts. The Compact wants these very badly.' }
  ]
};
SF.CONTRABAND_BY_ID = {};
SF.CONFIG.contraband.goods.forEach(function (g) { SF.CONTRABAND_BY_ID[g.id] = g; });

/* smuggling-runs phase (2026-10-19): dock security scans.
 * chance = contraband tons / hold size, mitigated by allied standing
 * (>= standNeed: x standCut), a fitted part with scanEvade (x 1-scanEvade),
 * or bribing the inspector (x bribeMul, costs bribeBase + bribePerTon x tons).
 * Caught: fineBase + finePerTon x tons credits, -standHit standing with the
 * local faction, -karmaHit karma. Save-neutral: no new saved fields. */
SF.CONFIG.customs = {
  standNeed: 50, standCut: 0.5,
  bribeMul: 0.2, bribeBase: 100, bribePerTon: 60,
  fineBase: 200, finePerTon: 150,
  standHit: 10, karmaHit: 2
};

/* Shady jobs: instant credits, karma/standing consequences, heat risk. */
SF.BLACKMARKET_JOBS = [
  { id: 'job_heist', name: 'Patrol data heist', desc: 'Steal Compact patrol routes for a Drifter fence.',
    reward: 900, karma: -4, stand: { compact: -8 }, heat: 0.35 },
  { id: 'job_run',   name: 'Weapons run to Ember rebels', desc: 'Move hot cargo past the blockade. No manifest.',
    reward: 1600, karma: -6, stand: { compact: -10 }, heat: 0.45 },
  { id: 'job_sabotage', name: 'Sabotage a freighter', desc: 'A rival outfit pays to see a hauler dead in the Drift.',
    reward: 2400, karma: -10, stand: { drifters: -6 }, heat: 0.60 },
  { id: 'job_ledger', name: 'Ledger wipe', desc: 'Erase a debtor\u2019s marker from the syndicate books.',
    reward: 1200, karma: -3, stand: { ember: 4 }, heat: 0.25 }
];

/* twelve-hour-wave3 (B4): CANONICAL SF.SAVE_VERSION — the ONLY assignment
 * in the tree (js/save.js no longer assigns it). Because save.js never
 * re-assigns, this value is correct regardless of script load order:
 * data.js-first (normal) and save.js-first (hypothetical reorder) both
 * end at 12, since nothing after this line overwrites it. Do NOT add a
 * second assignment anywhere; bump ONLY this literal, with a matching
 * migrate() step in js/save.js. */
SF.SAVE_VERSION = 12;

/* ================= boss-encounters phase (2026-10-19) =================
 * One capital-ship boss per system. Bosses are runtime-only entities
 * (save-neutral: no save bump, kill timers live in memory).
 * telegraph: attack telegraph duration; attacks cycle in order.
 * Attacks: 'volley' (turret spread), 'lance' (telegraphed warning line ->
 * high-damage beam), 'salvo' (homing missiles), 'nova' (radial bullet ring).
 * Boss AI builds on the gameplay-depth juggernaut profile conventions:
 * slow, deliberate, never flees, holds range instead of strafing. */
SF.CONFIG.bosses = {
  boss_solace: {
    name: 'Solace Warden', title: 'WARDEN OF SOLACE', systemId: 'solace',
    color: '#4da3ff', glowColor: '#9fd0ff',
    hp: 1500, speed: 82, radius: 46, contact: 26,
    boltDamage: 10, boltSpeed: 420,
    turrets: [{ x: 38, y: -16 }, { x: 38, y: 16 }, { x: 0, y: -30 }, { x: 0, y: 30 }],
    attacks: ['volley', 'lance'], telegraph: 0.9,
    creditReward: [1200, 1800], dropItem: 'gravcore', dropWeapon: 'beam',
    standFaction: 'compact', stand: 10, karma: 6,
    blurb: 'A renegade Compact capital ship, gone rogue over Solace.'
  },
  boss_drift: {
    name: 'Drift Marauder', title: 'MARAUDER OF THE DRIFT', systemId: 'drift',
    color: '#3ddc5f', glowColor: '#a8ffb8',
    hp: 2800, speed: 96, radius: 50, contact: 32,
    boltDamage: 13, boltSpeed: 440,
    turrets: [{ x: 42, y: -20 }, { x: 42, y: 20 }, { x: 10, y: -34 }, { x: 10, y: 34 },
               { x: -18, y: -22 }, { x: -18, y: 22 }],
    attacks: ['volley', 'salvo', 'lance'], telegraph: 1.0,
    creditReward: [2000, 2800], dropItem: 'gravcore', dropWeapon: 'lance',
    standFaction: 'drifters', stand: 10, karma: 6,
    blurb: 'The Drift\'s biggest raider lord, flying a stolen fleet tender.'
  },
  boss_ember: {
    name: 'Ember Dreadnought', title: 'DREADNOUGHT OF EMBER', systemId: 'ember',
    color: '#ff5e3a', glowColor: '#ffb08a',
    hp: 4200, speed: 74, radius: 56, contact: 38,
    boltDamage: 16, boltSpeed: 460,
    turrets: [{ x: 46, y: -22 }, { x: 46, y: 22 }, { x: 12, y: -38 }, { x: 12, y: 38 },
               { x: -20, y: -26 }, { x: -20, y: 26 }, { x: -40, y: 0 }],
    attacks: ['volley', 'nova', 'salvo', 'lance'], telegraph: 1.1,
    creditReward: [3200, 4200], dropItem: 'gravcore', dropWeapon: 'hellbore',
    standFaction: 'ember', stand: 10, karma: 6,
    blurb: 'The Ember Pact\'s flagship. The sky burns where it flies.'
  }
};
/* Enemy-spec entries so generic enemy plumbing (contact, draw helpers) can
 * read boss stats; bosses are created by SF.Bosses and bypass the spawn()
 * difficulty scaling EXCEPT bolt damage (scaled at fire time like normal foes). */
SF.CONFIG.enemies.boss_solace = { hp: 1500, speed: 82, radius: 46, contact: 26,
  creditsMin: 0, creditsMax: 0, oreMin: 0, oreMax: 0, itemChance: 0,
  scoreName: 'Solace Warden', boss: true, automated: true };
SF.CONFIG.enemies.boss_drift = { hp: 2800, speed: 96, radius: 50, contact: 32,
  creditsMin: 0, creditsMax: 0, oreMin: 0, oreMax: 0, itemChance: 0,
  scoreName: 'Drift Marauder', boss: true, automated: true };
SF.CONFIG.enemies.boss_ember = { hp: 4200, speed: 74, radius: 56, contact: 38,
  creditsMin: 0, creditsMax: 0, oreMin: 0, oreMax: 0, itemChance: 0,
  scoreName: 'Ember Dreadnought', boss: true, automated: true };

/* ================= enemy-elites phase (2026-10-19) =================
 * Elite enemy variants. RUNTIME-ONLY, SAVE-NEUTRAL: nothing here touches the
 * save blob and SAVE_VERSION must not be bumped for elites.
 *
 * Spawn roll lives in SF.Enemies.spawnPatrol and is governed by system
 * danger (gameplay-depth): ~1 elite per 8 normal spawns in Drift,
 * ~1 per 5 in Ember, none in the calm core (Solace).
 * Faction patrols are never elites (keeps standing consequences legible).
 */
SF.ELITE_VARIANTS = {
  fast: {
    id: 'fast', name: 'Fast', speedMul: 1.40, hullMul: 0.80,
    aura: '#39d5e8', creditMul: 2.0,
    names: ['Vex the Quick', 'Zephyr', 'Dash Calloway', 'Fleetfoot',
            'Zip Tarkin', 'Gale Rider', 'Nix the Blur']
  },
  bulwark: {
    id: 'bulwark', name: 'Bulwark', speedMul: 0.80, hullMul: 1.80,
    aura: '#ff9d5e', creditMul: 2.5,
    names: ['Bram the Wall', 'Iron Hilda', 'Bastion', 'Garrison Flint',
            'Stone Voss', 'Anchor', 'Dreadnought Dale']
  },
  swarmlord: {
    id: 'swarmlord', name: 'Swarmlord', speedMul: 1.00, hullMul: 1.30,
    aura: '#b45cff', creditMul: 3.0, adds: 3,
    names: ['Broodmother Kex', 'Hive Warden', 'Skar the Many',
            'Matriarch Zol', 'The Swarm Queen', 'Warden Vex']
  }
};
/* elite roll chance per normal patrol spawn, by system danger */
SF.CONFIG.eliteRate = { solace: 0, drift: 1 / 8, ember: 1 / 5 };
/* elite loot: elite-grade drop chances through the weapons-arsenal drop
 * logic (same SF.WEAPON_DROPS / SF.MOD_DROPS tables as the base type) */
SF.CONFIG.eliteDrops = {
  weaponChance: 0.50, // roll from the base type's SF.WEAPON_DROPS list
  modChance: 0.35,    // roll from the base type's SF.MOD_DROPS list
  itemChance: 1.0,    // guaranteed component drop (elite-weighted tiers)
  partChance: 0.50    // elite part roll: green/blue/purple ship parts
};
/* weights over SF.ITEMS (green/blue/purple) for the guaranteed elite component */
SF.ELITE_ITEM_WEIGHTS = [10, 50, 40];
/* standing reward for killing an elite: local (system) faction */
SF.CONFIG.eliteStanding = 4;

/* ================= death-legacy-retry phase (2026-10-19) =================
 * Death consequences: ship insurance, wreck-recovery beacons, legacy bonuses
 * for new pilots.
 *
 * SAVE-NEUTRAL: every bit of persistent state lives in localStorage
 * 'starfall_legacy_v1', a separate key from starfall_save_v1. No save blob
 * fields are touched and SAVE_VERSION must NOT be bumped for this phase.
 * Wrecks survive save/load precisely because they never ride the save blob.
 */
SF.CONFIG.legacy = {
  wreckOreFrac: 0.5,  // fraction of aboard ore at death that ends up in the wreck
  reclaimRadius: 200, // fly within this (world units) of a beacon to reclaim it
  maxWrecks: 8,       // oldest wrecks are dropped past this
  insBasePct: 25,     // premium% = insBasePct - bestStanding * insStandFactor
  insStandFactor: 0.15,
  insMinPct: 5, insMaxPct: 25,
  bonusPerDeath: 50,  // starting credits granted per prior death
  bonusCap: 500,
  bonusStanding: 2    // +standing with every faction on a fresh pilot
};

SF.Legacy = (function () {
  'use strict';
  var KEY = 'starfall_legacy_v1';

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  var data = { deaths: 0, wrecks: [] }; // wrecks: [{x,y,systemId,credits,ore,ts}]
  var lastDeath = null; // runtime: {lost, lostOre}, consumed by respawn()
  var insured = false;  // runtime: buyback purchased this death

  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) {}
  }
  function validWreck(w) {
    return w && isFinite(w.x) && isFinite(w.y) && typeof w.systemId === 'string';
  }
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var s = JSON.parse(raw);
        if (s && typeof s === 'object') {
          data.deaths = Math.max(0, s.deaths | 0);
          data.wrecks = Array.isArray(s.wrecks) ? s.wrecks.filter(validWreck) : [];
        }
      }
    } catch (e) { /* storage unavailable: legacy runs session-only */ }
  }
  load();

  /* Insurance is underwritten by whoever likes you most: premium% drops with
   * your best faction standing. */
  function bestFaction() {
    var best = -100, bf = null;
    if (window.SF && SF.Factions && SF.FACTION_LIST) {
      SF.FACTION_LIST.forEach(function (f) {
        try {
          var s = SF.Factions.standing(f.id);
          if (s > best) { best = s; bf = f; }
        } catch (e) {}
      });
    }
    return { faction: bf, standing: best };
  }
  function premiumPct() {
    var cfg = SF.CONFIG.legacy;
    return clamp(Math.round(cfg.insBasePct - bestFaction().standing * cfg.insStandFactor),
                 cfg.insMinPct, cfg.insMaxPct);
  }

  return {
    /* Recorded at onPlayerDeath, BEFORE respawn() resets the player.
     * Spawns the wreck beacon and stages the insurance offer. */
    onDeath: function () {
      var cfg = SF.CONFIG.legacy;
      var p = SF.Player;
      var lost = Math.floor(p.credits * SF.CONFIG.economy.respawnLoss);
      var lostOre = Math.floor(p.ore * cfg.wreckOreFrac);
      data.wrecks.push({
        x: Math.round(p.x), y: Math.round(p.y),
        systemId: SF.Game.systemId,
        credits: lost, ore: lostOre, ts: Date.now()
      });
      while (data.wrecks.length > cfg.maxWrecks) data.wrecks.shift();
      lastDeath = { lost: lost, lostOre: lostOre };
      insured = false;
      persist();
      return lastDeath;
    },

    /* Current insurance offer, or null when there is nothing to insure. */
    offer: function () {
      if (!lastDeath || lastDeath.lost <= 0) return null;
      var pct = premiumPct();
      var bf = bestFaction();
      return {
        lost: lastDeath.lost,
        pct: pct,
        cost: Math.ceil(lastDeath.lost * pct / 100),
        faction: bf.faction, standing: bf.standing,
        insured: insured
      };
    },

    /* Player buys the buyback on the gameover screen. Premium is deducted
     * immediately; the lost credits are refunded by respawn(). */
    buyInsurance: function () {
      var o = this.offer();
      if (!o || o.insured) return false;
      if (SF.Player.credits < o.cost) return false;
      SF.Player.credits -= o.cost;
      insured = true;
      return true;
    },

    /* Consumed by respawn(): refunds the lost credits iff insured, drops the
     * wreck's ore out of the kept total, counts the death for legacy. */
    respawnDelta: function () {
      var d = lastDeath || { lost: 0, lostOre: 0 };
      var wasInsured = insured;
      lastDeath = null; insured = false;
      data.deaths++;
      persist();
      return { lost: d.lost, lostOre: d.lostOre, insured: wasInsured };
    },

    /* Legacy bonus for a brand-new pilot (called from SF.Game.newGame).
     * Small starting credits + a standing nudge from prior pilots. */
    applyNewPilotBonus: function () {
      if (data.deaths <= 0) return null;
      var cfg = SF.CONFIG.legacy;
      var credits = Math.min(data.deaths * cfg.bonusPerDeath, cfg.bonusCap);
      SF.Player.credits += credits;
      if (window.SF && SF.Factions && SF.FACTION_LIST) {
        SF.FACTION_LIST.forEach(function (f) {
          try { SF.Factions.shift(f.id, cfg.bonusStanding); } catch (e) {}
        });
      }
      var msg = 'LEGACY — pilot #' + data.deaths + ' is remembered: +' +
        credits.toLocaleString('en-US') + 'cr · +' + cfg.bonusStanding + ' all standings';
      if (window.SF && SF.HUD && SF.HUD.toast) SF.HUD.toast(msg);
      return { credits: credits, standing: cfg.bonusStanding };
    },

    deaths: function () { return data.deaths; },
    wrecks: function () { return data.wrecks.slice(); },

    /* Proximity reclaim, run every frame from main.js update(). */
    update: function () {
      if (!window.SF || !SF.Game || SF.Game.state !== 'PLAYING') return;
      var p = SF.Player;
      if (!p || !p.alive) return;
      var cfg = SF.CONFIG.legacy;
      for (var i = data.wrecks.length - 1; i >= 0; i--) {
        var w = data.wrecks[i];
        if (w.systemId !== SF.Game.systemId) continue;
        var dx = w.x - p.x, dy = w.y - p.y;
        if (dx * dx + dy * dy < cfg.reclaimRadius * cfg.reclaimRadius) {
          data.wrecks.splice(i, 1);
          persist();
          if (w.credits > 0) p.credits += w.credits;
          if (w.ore > 0) p.ore += w.ore;
          if (window.SF && SF.HUD) SF.HUD.toast('WRECK RECOVERED: +' +
            Math.floor(w.credits).toLocaleString('en-US') + 'cr · +' +
            Math.floor(w.ore) + ' ore');
          if (window.SF && SF.Audio && SF.Audio.ui) SF.Audio.ui();
        }
      }
    },

    /* World-space beacon markers, drawn from main.js render(). */
    draw: function (ctx) {
      if (!window.SF || !SF.Game) return;
      var t = (typeof performance !== 'undefined' ? performance.now() : 0) / 1000;
      for (var i = 0; i < data.wrecks.length; i++) {
        var w = data.wrecks[i];
        if (w.systemId !== SF.Game.systemId) continue;
        var pulse = 0.5 + 0.5 * Math.sin(t * 3 + i);
        ctx.save();
        ctx.globalAlpha = 0.55 + 0.35 * pulse;
        ctx.strokeStyle = '#ffd23f';
        ctx.lineWidth = 2;
        ctx.setLineDash([10, 7]);
        ctx.beginPath();
        ctx.arc(w.x, w.y, 34 + pulse * 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#ffd23f';
        ctx.font = 'bold 20px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('!', w.x, w.y - 42);
        ctx.font = 'bold 11px monospace';
        ctx.fillText('WRECK', w.x, w.y + 52);
        ctx.restore();
      }
    },

    /* test hooks */
    _reset: function () { data = { deaths: 0, wrecks: [] }; lastDeath = null; insured = false; persist(); },
    _premiumPct: premiumPct
  };
})();

/* ================= companion-gear phase (2026-10-19) =================
 * Companion equipment: 2 slots per wingman (weapon + armor), companion-scaled
 * gear bought / crafted / looted like player parts but smaller in spirit —
 * wingmen fly lighter frames, so bonuses are modest additive percentages.
 *
 * slot: 'weapon' -> bonus.dmg (additive +X% wingman damage, stacks additively
 *         on top of the companion-quests loyalty multiplier)
 * slot: 'armor'  -> bonus.regen (additive +X hull/sec passive regen)
 *
 * craftParts: salvage-part cost to fabricate at the outfitter (no workbench
 * integration this phase — crafting stays dockside, next phase may move it
 * into the Phase 5 workbench UI, which lives outside this phase's scope).
 *
 * SAVE-NEUTRAL: fitted slots + owned inventory live inside the existing
 * P.companions blob under the additive keys `gear` and `gearInv`, which are
 * deep-copied by ship.js serialize() already. No SF.SAVE_VERSION bump. */
SF.COMP_GEAR = [
  /* ---- weapon slot: wingman damage ---- */
  { id: 'cg_sidearm',  name: 'Sidearm Laser',  slot: 'weapon', tier: 'white',  price: 400,
    craftParts: 4,  bonus: { dmg: 0.06 }, color: '#e8e8e8',
    desc: '+6% wingman damage. A holdout pistol for the hired gun.' },
  { id: 'cg_repeater', name: 'Wing Repeater',  slot: 'weapon', tier: 'green',  price: 900,
    craftParts: 8,  bonus: { dmg: 0.12 }, color: '#3ddc5f',
    desc: '+12% wingman damage. Drifter-pattern rapid repeater.' },
  { id: 'cg_escort',   name: 'Escort Cannon',  slot: 'weapon', tier: 'blue',   price: 2000,
    craftParts: 14, bonus: { dmg: 0.20 }, color: '#3fa9ff',
    desc: '+20% wingman damage. Navy surplus, wingman-tuned.' },
  { id: 'cg_plasma',   name: 'Plasma Battery', slot: 'weapon', tier: 'purple', price: 4500,
    craftParts: 24, bonus: { dmg: 0.30 }, color: '#b45cff',
    desc: '+30% wingman damage. Overcharged plasma feeds.' },
  { id: 'cg_storm',    name: 'Storm Projector',slot: 'weapon', tier: 'orange', price: 9000,
    craftParts: 36, bonus: { dmg: 0.45 }, color: '#ff8c2e',
    desc: '+45% wingman damage. A weather event, sized for a wingman.' },
  /* ---- armor slot: wingman-granted regen ---- */
  { id: 'cg_patchkit', name: 'Patch Kit',      slot: 'armor',  tier: 'white',  price: 400,
    craftParts: 4,  bonus: { regen: 0.15 }, color: '#e8e8e8',
    desc: '+0.15 hull/s. Your wingman patches your hull between passes.' },
  { id: 'cg_fieldplate', name: 'Field Plate',  slot: 'armor',  tier: 'green',  price: 900,
    craftParts: 8,  bonus: { regen: 0.30 }, color: '#3ddc5f',
    desc: '+0.30 hull/s. Ablative plates and a practiced hand.' },
  { id: 'cg_nanoweave', name: 'Nano Weave',    slot: 'armor',  tier: 'blue',   price: 2000,
    craftParts: 14, bonus: { regen: 0.50 }, color: '#3fa9ff',
    desc: '+0.50 hull/s. Self-sealing weave, applied mid-flight.' },
  { id: 'cg_aegis',    name: 'Aegis Mantle',   slot: 'armor',  tier: 'purple', price: 4500,
    craftParts: 24, bonus: { regen: 0.90 }, color: '#b45cff',
    desc: '+0.90 hull/s. Your wingman is practically your engineer now.' }
];
SF.COMP_GEAR_BY_ID = {};
SF.COMP_GEAR.forEach(function (g) { SF.COMP_GEAR_BY_ID[g.id] = g; });

/* gear loot: ~4% of kills drop a companion gear piece, weighted by tier */
SF.CONFIG.gearDropChance = 0.04;
SF.CONFIG.gearDropWeights = { white: 55, green: 27, blue: 13, purple: 5 };
