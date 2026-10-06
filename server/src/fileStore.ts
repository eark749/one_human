import fs from 'node:fs';
import path from 'node:path';
import type { SavedState, Store } from './game.js';

const DATA_FILE = path.resolve('data/state.json');

export class FileStore implements Store {
  load(): SavedState | null {
    try {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) as SavedState;
    } catch {
      return null; // first run
    }
  }

  save(state: SavedState) {
    try {
      fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
      fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
    } catch (err) {
      console.error('save failed', err);
    }
  }
}
