// world/corpus.mjs — the deterministic offline world the flashcard-capsule loop
// works in. Four topics × 7 facts each, ALL topics sharing the same shape
// multiset [definition×2, process, quantity, location, example×2] so that cost
// deltas between iterations are attributable to the bones, not to topic luck.
// Every fact's text embeds its own term (the honest validator relies on this).

export const TOPICS = ['photosynthesis', 'plate-tectonics', 'the-moon', 'black-holes'];

export const TOPIC_TITLES = {
  'photosynthesis': 'Photosynthesis',
  'plate-tectonics': 'Plate Tectonics',
  'the-moon': 'The Moon',
  'black-holes': 'Black Holes',
};

const RAW = [
  // photosynthesis
  ['photosynthesis', 'definition', 'chlorophyll', 'chlorophyll is the green pigment that absorbs light energy and starts the light reactions'],
  ['photosynthesis', 'definition', 'a thylakoid', 'a thylakoid is a membrane sac inside the chloroplast where the light reactions occur'],
  ['photosynthesis', 'process', 'the Calvin cycle', 'the Calvin cycle fixes carbon dioxide into sugar using ATP and NADPH from the light reactions'],
  ['photosynthesis', 'quantity', 'the oxygen yield', 'the oxygen yield is one O2 molecule for every two water molecules split'],
  ['photosynthesis', 'location', 'the stroma', 'the stroma is the fluid surrounding the thylakoids, where carbon fixation happens'],
  ['photosynthesis', 'example', 'C4 photosynthesis', 'C4 photosynthesis is a variant used by maize that concentrates CO2 before the Calvin cycle'],
  ['photosynthesis', 'example', 'a leaf', 'a leaf is the organ where most photosynthesis happens, packed with palisade mesophyll'],
  // plate-tectonics
  ['plate-tectonics', 'definition', 'a subduction zone', 'a subduction zone is a boundary where one plate dives beneath another and returns crust to the mantle'],
  ['plate-tectonics', 'definition', 'the lithosphere', 'the lithosphere is the rigid outer shell of rock that is broken into moving plates'],
  ['plate-tectonics', 'process', 'seafloor spreading', 'seafloor spreading creates new oceanic crust at mid-ocean ridges as plates pull apart'],
  ['plate-tectonics', 'quantity', 'plate speed', 'plate speed for most plates is two to ten centimeters per year, about fingernail growth'],
  ['plate-tectonics', 'location', 'the Ring of Fire', 'the Ring of Fire is the Pacific rim where most subduction zones and earthquakes concentrate'],
  ['plate-tectonics', 'example', 'the Himalayas', 'the Himalayas are a collision zone where India rammed Eurasia and folded the crust upward'],
  ['plate-tectonics', 'example', 'Iceland', 'Iceland is an island straddling a mid-ocean ridge, so it grows as the Atlantic widens'],
  // the-moon
  ['the-moon', 'definition', 'a mare', 'a mare is a dark basalt plain formed by ancient lava floods into impact basins'],
  ['the-moon', 'definition', 'the regolith', 'the regolith is the loose layer of dust and broken rock blanketing the lunar surface'],
  ['the-moon', 'process', 'tidal locking', 'tidal locking keeps one hemisphere facing Earth because rotation and orbit periods match'],
  ['the-moon', 'quantity', 'lunar distance', 'lunar distance averages about 384,400 kilometers from Earth'],
  ['the-moon', 'location', 'the South Pole-Aitken basin', 'the South Pole-Aitken basin is the largest known impact basin, on the lunar far side'],
  ['the-moon', 'example', 'a lunar eclipse', 'a lunar eclipse is an event where Earth shadows the full moon, tinting it copper'],
  ['the-moon', 'example', 'Apollo 17', 'Apollo 17 was the last crewed landing, returning 110 kilograms of lunar rock'],
  // black-holes
  ['black-holes', 'definition', 'an event horizon', 'an event horizon is the boundary where escape velocity exceeds the speed of light'],
  ['black-holes', 'definition', 'a singularity', 'a singularity is the predicted point of infinite density at the center of a black hole'],
  ['black-holes', 'process', 'accretion', 'accretion converts infalling matter into the brightest X-ray sources near black holes'],
  ['black-holes', 'quantity', 'the Schwarzschild radius', 'the Schwarzschild radius is three kilometers of horizon per solar mass of collapsed matter'],
  ['black-holes', 'location', 'Sagittarius A*', 'Sagittarius A* is the supermassive black hole at the center of the Milky Way'],
  ['black-holes', 'example', 'Cygnus X-1', 'Cygnus X-1 is an X-ray binary that gave the first widely accepted black hole evidence'],
  ['black-holes', 'example', 'M87*', 'M87* is the first black hole imaged, with a mass of 6.5 billion suns'],
];

export const FACTS = RAW.map(([topic, shape, term, text], i) => ({
  id: `f${String(i + 1).padStart(2, '0')}`,
  topic, shape, term, text,
}));

export const CORPUS = {
  all: () => FACTS,
  byId: (id) => FACTS.find(f => f.id === id),
  byTopic: (topic) => FACTS.filter(f => f.topic === topic),
};

// Question templates, one per fact shape. The naive attempt tries these in
// canonical order until one fits (each try costs an op); the LUT bone dispatches
// directly.
export const TEMPLATE_ORDER = ['definition', 'process', 'quantity', 'location', 'example'];

export const TEMPLATES = {
  definition: {
    q: (f, task) => `What is ${f.term}?`,
    a: (f, task) => capital(f.text),
  },
  process: {
    q: (f, task) => `How does ${f.term} work in ${TOPIC_TITLES[task.topic]}?`,
    a: (f, task) => capital(f.text),
  },
  quantity: {
    q: (f, task) => `What quantity characterizes ${f.term} in ${TOPIC_TITLES[task.topic]}?`,
    a: (f, task) => capital(f.text),
  },
  location: {
    q: (f, task) => `Where does ${f.term} fit in ${TOPIC_TITLES[task.topic]}?`,
    a: (f, task) => capital(f.text),
  },
  example: {
    q: (f, task) => `What is a concrete instance of ${f.term} in ${TOPIC_TITLES[task.topic]}?`,
    a: (f, task) => capital(f.text),
  },
};

function capital(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
