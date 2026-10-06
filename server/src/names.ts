// Generated usernames. Players never type their own, so there is nothing to moderate.
// Bots and humans draw from the same generator.

const ADJECTIVES = [
  'Wobbly', 'Sleepy', 'Brave', 'Clumsy', 'Sneaky', 'Lazy', 'Jumpy', 'Grumpy', 'Lucky', 'Shaky',
  'Bouncy', 'Sweaty', 'Dizzy', 'Mighty', 'Tiny', 'Spicy', 'Fuzzy', 'Nervous', 'Cosmic', 'Soggy',
  'Bold', 'Quiet', 'Rusty', 'Speedy', 'Wiggly', 'Loyal', 'Restless', 'Gentle', 'Stubborn', 'Polite',
];

const NOUNS = [
  'Knee', 'Elbow', 'Toe', 'Thumb', 'Ankle', 'Pinky', 'Shin', 'Wrist', 'Kneecap', 'Heel',
  'Spine', 'Hip', 'Neuron', 'Tendon', 'Femur', 'Earlobe', 'Nostril', 'Molar', 'Eyebrow', 'Knuckle',
  'Ribcage', 'Shoulder', 'Pupil', 'Bicep', 'Calf', 'Pelvis', 'Tonsil', 'Collarbone', 'Fingertip', 'Muscle',
];

const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];

export function makeName(taken: Set<string>): string {
  for (let i = 0; i < 50; i++) {
    const name = pick(ADJECTIVES) + pick(NOUNS) + (10 + Math.floor(Math.random() * 90));
    if (!taken.has(name)) return name;
  }
  let name: string;
  do {
    name = pick(ADJECTIVES) + pick(NOUNS) + (1000 + Math.floor(Math.random() * 9000));
  } while (taken.has(name));
  return name;
}
