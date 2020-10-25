import { System } from 'ecsy';

import { Weapon } from '../components/weapon';
import { Active } from '../components/active';

export class WeaponSystem extends System {
  static queries = {
    activeWeapons: {
      components: [Weapon, Active]
    }
  };

  execute(delta, time) {
    this.queries.activeWeapons.results.forEach((entity) => {
      const weapon = entity.getMutableComponent(Weapon);

      if (weapon.lastFiredTimestamp + weapon.fireInterval < time) {
        weapon.lastFiredTimestamp = time;

        console.log('shooting!');
      }
    });
  }
}
