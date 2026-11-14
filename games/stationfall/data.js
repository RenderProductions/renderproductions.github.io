// Stationfall: the game's tables. Items, buildings, recipes and crew jobs.
// Everything here is plain data; station.js reads it.
window.SF = window.SF || {};

SF.ITEMS = {
  ore:     { name: 'Iron Ore', stack: 50, kind: 'mat' },
  ice:     { name: 'Ice', stack: 50, kind: 'mat' },
  crystal: { name: 'Crystal', stack: 50, kind: 'mat' },
  bar:     { name: 'Iron Bar', stack: 50, kind: 'mat' },
  circuit: { name: 'Circuit', stack: 50, kind: 'mat' },
  food:    { name: 'Ration', stack: 20, kind: 'food', info: 'Restores 32 food' },
  ammo:    { name: 'Rifle Ammo', stack: 300, kind: 'mat' },
  medkit:  { name: 'Medkit', stack: 5, kind: 'heal', info: 'Restores 45 health' },
  laser:   { name: 'Mining Laser', stack: 1, kind: 'tool', mine: 45, info: 'Hold click on rock, ice or ore' },
  cutter:  { name: 'Plasma Cutter', stack: 1, kind: 'tool', mine: 110, info: 'Mines more than twice as fast' },
  pistol:  { name: 'Pistol', stack: 1, kind: 'gun', dmg: 12, rate: 0.26, speed: 720, info: 'Never runs out' },
  rifle:   { name: 'Rifle', stack: 1, kind: 'gun', dmg: 10, rate: 0.09, speed: 900, ammo: 'ammo', info: 'Fast, uses Rifle Ammo' },
  suit:    { name: 'Space Suit', stack: 1, kind: 'suit', info: 'Wear it: 2.5x the air outside, 30% less damage' }
};

// Build menu. cost is in items, taken from your inventory first, then station storage (crates).
// inside: needs a floor. use: power per second while running. seal: holds air in a room.
SF.BUILD_TABS = [
  { id: 'structure', label: 'Structure', items: ['floor', 'wall', 'door', 'airlock'] },
  { id: 'power', label: 'Power', items: ['solar', 'battery', 'lamp'] },
  { id: 'life', label: 'Life support', items: ['o2gen', 'o2tank', 'farm', 'med'] },
  { id: 'industry', label: 'Industry', items: ['crate', 'furnace', 'workbench', 'drill'] },
  { id: 'defense', label: 'Defense', items: ['turret'] },
  { id: 'living', label: 'Living', items: ['bed', 'table', 'chair', 'comms'] }
];

SF.BUILDINGS = {
  floor:     { name: 'Floor', cost: { bar: 1 }, info: 'Rooms need floors. Wall them in to hold air.' },
  wall:      { name: 'Wall', cost: { bar: 2 }, hp: 160, seal: true, info: 'Seals rooms. Blocks drones.' },
  door:      { name: 'Door', cost: { bar: 2 }, hp: 140, seal: true, walk: true, leaky: true, info: 'Lets air out while someone stands in it.' },
  airlock:   { name: 'Airlock', cost: { bar: 4, circuit: 1 }, hp: 220, seal: true, walk: true, info: 'A door that never leaks air.' },
  solar:     { name: 'Solar Panel', cost: { bar: 3, crystal: 1 }, hp: 50, gen: 1.6, info: 'Power by day. Nothing at night.' },
  battery:   { name: 'Battery', cost: { bar: 3, crystal: 2 }, hp: 60, inside: true, store: 100, info: 'Stores 100 power for the night.' },
  lamp:      { name: 'Lamp', cost: { bar: 1, crystal: 1 }, hp: 30, use: 0.05, prio: 4, light: 4.5, info: 'Light at night.' },
  o2gen:     { name: 'O2 Generator', cost: { bar: 6, circuit: 1 }, hp: 80, inside: true, use: 1.2, prio: 0, info: 'Burns 1 ice every 30s while it fills the air. Rests when the air is full.' },
  o2tank:    { name: 'O2 Tank', cost: { bar: 4 }, hp: 70, inside: true, holds: 1, info: 'Stores spare air and refills its room.' },
  farm:      { name: 'Farm', cost: { bar: 3, ice: 2 }, hp: 50, inside: true, use: 0.4, prio: 2, info: 'Grows 2 rations every 90s. Needs air and power.' },
  med:       { name: 'Med Bay', cost: { bar: 5, circuit: 1 }, hp: 60, inside: true, use: 0.1, prio: 1, info: 'Heals anyone standing next to it.' },
  crate:     { name: 'Crate', cost: { bar: 4 }, hp: 80, holds: 300, info: 'Station storage. All crates share one pool.' },
  furnace:   { name: 'Furnace', cost: { ore: 10 }, hp: 90, use: 0.8, prio: 3, station: 'furnace', info: 'Smelts iron ore into bars.' },
  workbench: { name: 'Workbench', cost: { bar: 6 }, hp: 80, use: 0.4, prio: 3, station: 'workbench', info: 'Crafts circuits, ammo, gear and weapons.' },
  drill:     { name: 'Drill', cost: { bar: 6, circuit: 2 }, hp: 90, use: 0.8, prio: 3, info: 'Mines the tile next to it into storage.' },
  turret:    { name: 'Turret', cost: { bar: 6, circuit: 2 }, hp: 130, use: 0.2, prio: 1, info: 'Shoots drones over your walls.' },
  bed:       { name: 'Bed', cost: { bar: 3 }, hp: 40, inside: true, info: 'One bed per crew member.' },
  table:     { name: 'Table', cost: { bar: 2 }, hp: 40, inside: true, info: 'Furniture.' },
  chair:     { name: 'Chair', cost: { bar: 1 }, hp: 30, inside: true, walk: true, info: 'Furniture.' },
  comms:     { name: 'Comms Console', cost: { bar: 8, circuit: 3 }, hp: 70, inside: true, use: 0.2, prio: 3, station: 'comms', info: 'Call down survivors to join your crew.' }
};

SF.RECIPES = {
  furnace: [
    { out: 'bar', n: 1, cost: { ore: 2 }, time: 4 }
  ],
  workbench: [
    { out: 'circuit', n: 2, cost: { bar: 1, crystal: 1 }, time: 5 },
    { out: 'ammo', n: 40, cost: { bar: 1 }, time: 4 },
    { out: 'medkit', n: 1, cost: { food: 1, crystal: 1 }, time: 6 },
    { out: 'cutter', n: 1, cost: { bar: 4, crystal: 3, circuit: 2 }, time: 12 },
    { out: 'rifle', n: 1, cost: { bar: 6, circuit: 3 }, time: 15 },
    { out: 'suit', n: 1, cost: { bar: 6, circuit: 2, crystal: 2 }, time: 18 }
  ]
};

SF.ROLES = {
  miner:    { name: 'Miner', info: 'Mines rock near the station and hauls it to a crate.' },
  farmer:   { name: 'Farmer', info: 'Harvests ripe farms and stores the food.' },
  guard:    { name: 'Guard', info: 'Fights drones near the station.' },
  engineer: { name: 'Engineer', info: 'Repairs damaged buildings with bars from storage.' }
};

SF.CREW_NAMES = ['Ade', 'Bram', 'Cass', 'Dov', 'Esme', 'Fitz', 'Gale', 'Hux', 'Ines', 'Jory', 'Kip', 'Lark', 'Milo', 'Nell', 'Orin', 'Pax', 'Quill', 'Rue', 'Sol', 'Tam', 'Uma', 'Vex', 'Wren', 'Yuri', 'Zed'];
